/**
 * Zugriff auf die Belegliste und die Verarbeitung einzelner Dateien.
 */

function alleBelege() {
  var b = blatt('Belege');
  var letzte = b.getLastRow();
  if (letzte < 2) return [];
  return b.getRange(2, 1, letzte - 1, BELEG_SPALTEN.length).getValues().map(function (z, i) {
    var o = zeileZuObjekt(z);
    o._zeile = i + 2;
    return o;
  }).filter(function (o) { return o.id; });
}

function belegNachId(id) {
  var liste = alleBelege();
  for (var i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
  return null;
}

function belegAnhaengen(beleg) {
  kopfzeileSicherstellen();
  blatt('Belege').appendRow(objektZuZeile(beleg));
}

// Ergänzt neue Spalten (z. B. Leistungszeitraum) in bestehenden Tabellen. Einmal je Ausführung.
function kopfzeileSicherstellen() {
  if (_cache.kopfOk) return;
  var b = blatt('Belege');
  var namen = spaltenNamen();
  var ist = b.getRange(1, 1, 1, namen.length).getValues()[0];
  if (String(ist[namen.length - 1]) !== namen[namen.length - 1]) {
    b.getRange(1, 1, 1, namen.length).setValues([namen]).setFontWeight('bold').setBackground('#e8eef3');
  }
  _cache.kopfOk = true;
}

function belegSpeichern(beleg) {
  if (!beleg._zeile) {
    var alt = belegNachId(beleg.id);
    if (!alt) throw new Error('Beleg ' + beleg.id + ' nicht gefunden');
    beleg._zeile = alt._zeile;
  }
  blatt('Belege').getRange(beleg._zeile, 1, 1, BELEG_SPALTEN.length).setValues([objektZuZeile(beleg)]);
}

// Die Jahreszahl der Beleg-ID ist das Eingangsjahr, nicht das Belegjahr: Eine Dezemberrechnung,
// die im Januar ankommt, heißt B2027-…. Für die Buchhaltung zählt das Belegdatum in der Tabelle.
function neueBelegId() {
  // Eigene Benutzersperre. Die Skriptsperre hält währenddessen der Scan; sie hier freizugeben
  // hat früher parallele Scans und doppelte Einträge verursacht.
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var n = Number(props.getProperty('ZAEHLER') || '0') + 1;
    props.setProperty('ZAEHLER', String(n));
    var jahr = new Date().getFullYear();
    return 'B' + jahr + '-' + ('00000' + n).slice(-5);
  } finally {
    lock.releaseLock();
  }
}

function hashVorhanden(hash) {
  var b = blatt('Belege');
  var n = b.getLastRow();
  if (n < 2) return '';
  var spalteHash = BELEG_SPALTEN.map(function (s) { return s[0]; }).indexOf('hash') + 1;
  var ids = b.getRange(2, 1, n - 1, 1).getValues();
  var hashes = b.getRange(2, spalteHash, n - 1, 1).getValues();
  for (var i = 0; i < hashes.length; i++) if (hashes[i][0] === hash) return ids[i][0];
  return '';
}

/**
 * Liest mit dem Standardmodell. Bei Reverse Charge, Fremdwährung oder KI-Sicherheit unter 0,85
 * liest das genauere Modell (GENAU_MODELL) ein zweites Mal, statt den Beleg nur auf Prüfen zu setzen.
 */
function auslesenMitZweiterRunde(blob, meta) {
  var x = belegAuslesen(blob, meta);
  if (!x || !x.ist_beleg || einstellung('ZWEITE_RUNDE') !== 'true') return x;
  var genau = einstellung('GENAU_MODELL');
  if (!genau || genau === einstellung('MODELL')) return x;
  var unsicher = x.reverse_charge || String(x.waehrung || 'EUR').toUpperCase() !== 'EUR' || !(Number(x.vertrauen) >= 0.85);
  if (!unsicher) return x;
  try {
    var x2 = belegAuslesen(blob, meta, genau);
    if (x2) { x2._zweiteRunde = genau; return x2; }
  } catch (e) {
    protokoll('Zweite Auslesung fehlgeschlagen', blob.getName() + ': ' + e.message);
  }
  return x;
}

function sha256(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function endungVon(blob) {
  var m = String(blob.getName() || '').match(/\.([A-Za-z0-9]{2,5})$/);
  if (m) return m[1].toLowerCase();
  var mime = blob.getContentType();
  return { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mime] || 'bin';
}

function zielordnerFuer(beleg) {
  if (beleg.status === STATUS.DUBLETTE || beleg.status === STATUS.AUSGESCHLOSSEN) {
    var d = alsDatum(beleg.belegdatum) || alsDatum(beleg.eingang) || new Date();
    var monat = unterordner(unterordner(unterordner(wurzelordner(), 'Belege'), String(d.getFullYear())), monatVon(d));
    return unterordner(monat, 'Aussortiert');
  }
  return ablageordner(beleg.belegdatum || beleg.eingang, beleg.richtung);
}

/** Legt die Datei passend zu Status, Datum und Richtung ab und benennt sie. */
function dateiEinordnen(beleg) {
  if (!beleg.datei_id) return;
  var datei = DriveApp.getFileById(beleg.datei_id);
  var name = dateiname(beleg, (beleg.datei_name.match(/\.([a-z0-9]+)$/i) || [, 'pdf'])[1]);
  if (datei.getName() !== name) datei.setName(name);
  beleg.datei_name = name;
  var ziel = zielordnerFuer(beleg);
  var eltern = datei.getParents();
  if (!eltern.hasNext() || eltern.next().getId() !== ziel.getId()) datei.moveTo(ziel);
}

/**
 * Kernablauf für eine Datei aus Gmail oder Upload.
 * meta = { quelle, absender, betreff, eingang, mail_id, text }
 * Rückgabe: { ergebnis, id }
 */
function dateiVerarbeiten(blob, meta) {
  var bytes = blob.getBytes();
  var hash = sha256(bytes);
  // Nur die Hash-Spalte lesen, die volle Liste erst für die Dublettensuche nach der Auslesung
  var vorhanden = hashVorhanden(hash);
  if (vorhanden) return { ergebnis: 'Datei schon vorhanden (' + vorhanden + ')', id: vorhanden };

  var beleg = zeileZuObjekt([]);
  beleg.id = neueBelegId();
  beleg.status = STATUS.NEU;
  beleg.quelle = meta.quelle || '';
  beleg.absender = meta.absender || '';
  beleg.betreff = meta.betreff || '';
  beleg.eingang = meta.eingang || new Date();
  beleg.mail_id = meta.mail_id || '';
  beleg.hash = hash;
  beleg.waehrung = 'EUR';
  beleg.bereich = 'Geschäftlich';

  try {
    var x = auslesenMitZweiterRunde(blob, meta, beleg);
    if (x) {
      auslesungUebernehmen(beleg, x);
      if (x._zweiteRunde) beleg.grund = [beleg.grund, 'Mit ' + x._zweiteRunde + ' nachgelesen'].filter(String).join('; ');
    } else {
      beleg.status = STATUS.PRUEFEN;
      beleg.grund = 'Nicht ausgelesen: ANTHROPIC_API_KEY fehlt';
    }
  } catch (e) {
    beleg.status = STATUS.PRUEFEN;
    beleg.grund = 'Auslesung fehlgeschlagen: ' + e.message;
    protokoll('Auslesung fehlgeschlagen', blob.getName() + ': ' + e.message);
  }

  wendeRegelnAn(beleg, regelnLaden(), kategorienKarte());
  if (beleg.status !== STATUS.AUSGESCHLOSSEN) inEuroUmrechnen(beleg);

  // Während der Auslesung kann ein anderer Lauf dieselbe Datei gespeichert haben
  var schonDa = hashVorhanden(hash);
  if (schonDa) return { ergebnis: 'Datei schon vorhanden (' + schonDa + ')', id: schonDa };

  var dublette = null;
  if (beleg.status !== STATUS.AUSGESCHLOSSEN) {
    dublette = findeDublette(beleg, alleBelege().filter(function (b) { return b.status !== STATUS.AUSGESCHLOSSEN; }));
  }

  // Datei ablegen
  var endung = endungVon(blob);
  var datei = wurzelordner().createFile(blob.copyBlob().setName(beleg.id + '.' + endung));
  beleg.datei_id = datei.getId();
  beleg.datei_name = beleg.id + '.' + endung;

  if (dublette) {
    if (dublette.behalteNeu) {
      var alt = dublette.beleg;
      alt.status = STATUS.DUBLETTE;
      alt.dublette_von = beleg.id;
      alt.grund = [alt.grund, dublette.grund].filter(String).join('; ');
      dateiEinordnen(alt);
      belegSpeichern(alt);
    } else {
      beleg.status = STATUS.DUBLETTE;
      beleg.dublette_von = dublette.beleg.id;
      beleg.grund = [beleg.grund, dublette.grund].filter(String).join('; ');
    }
  }

  dateiEinordnen(beleg);
  belegAnhaengen(beleg);
  if ([STATUS.AUSGESCHLOSSEN, STATUS.DUBLETTE].indexOf(beleg.status) < 0 && beleg.partner) lieferantAktualisieren(beleg);

  if (beleg.status === STATUS.FREIGEGEBEN && einstellung('AUTO_UEBERMITTELN') === 'true') {
    try { anBelegmailSenden(beleg.id); } catch (e) { protokoll('Übermittlung fehlgeschlagen', beleg.id + ': ' + e.message); }
  }
  return { ergebnis: beleg.status + (beleg.grund ? ' – ' + beleg.grund : ''), id: beleg.id };
}

function lieferantAktualisieren(beleg) {
  var b = blatt('Lieferanten');
  var werte = b.getDataRange().getValues();
  var schluessel = normalisiereName(beleg.partner);
  var adresse = (String(beleg.absender).match(/<([^>]+)>/) || [, beleg.absender])[1] || '';
  for (var i = 1; i < werte.length; i++) {
    if (normalisiereName(werte[i][0]) === schluessel) {
      var adressen = String(werte[i][6] || '').split(',').map(function (s) { return s.trim(); }).filter(String);
      if (adresse && adressen.indexOf(adresse) < 0) adressen.push(adresse);
      b.getRange(i + 1, 1, 1, 7).setValues([[
        werte[i][0], werte[i][1] || beleg.partner_ustid, werte[i][2] || beleg.kategorie, werte[i][3] || beleg.bereich,
        Number(werte[i][4] || 0) + 1, beleg.belegdatum || new Date(), adressen.join(', ')
      ]]);
      return;
    }
  }
  b.appendRow([beleg.partner, beleg.partner_ustid, beleg.kategorie, beleg.bereich, 1, beleg.belegdatum || new Date(), adresse]);
}

/** Beleg erneut auslesen, z. B. nachdem der API-Schlüssel hinterlegt wurde. */
function belegNeuAuslesen(id, modell) {
  var beleg = belegNachId(id);
  if (!beleg) throw new Error('Beleg nicht gefunden');
  var blob = DriveApp.getFileById(beleg.datei_id).getBlob();
  var meta = { absender: beleg.absender, betreff: beleg.betreff };
  var x = modell ? belegAuslesen(blob, meta, modell) : auslesenMitZweiterRunde(blob, meta);
  if (!x) throw new Error('ANTHROPIC_API_KEY fehlt');
  var notiz = beleg.notiz;
  beleg.status = STATUS.NEU;
  beleg.dublette_von = '';
  beleg.konto = '';
  auslesungUebernehmen(beleg, x);
  wendeRegelnAn(beleg, regelnLaden(), kategorienKarte());
  if (beleg.status !== STATUS.AUSGESCHLOSSEN) inEuroUmrechnen(beleg);
  beleg.notiz = notiz;
  dateiEinordnen(beleg);
  belegSpeichern(beleg);
  return beleg;
}

/**
 * Räumt die bestehende Liste auf:
 *  1. liest Belege nach, die ohne API-Schlüssel oder mit Fehler erfasst wurden
 *  2. markiert doppelte Dateien (gleicher Hash) und Dubletten desselben Vorgangs
 * Ändert nur den Status, löscht nichts. Dubletten wandern in Drive nach "Aussortiert".
 */
function listeBereinigen() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { meldung: 'Gerade läuft ein Scan. Bitte in ein paar Minuten erneut versuchen.' };
  var start = Date.now();
  var ergebnis = { nachgelesen: 0, dubletten: 0, kurse: 0, regeln: 0, fehler: 0, unvollstaendig: false };
  try {
    kopfzeileSicherstellen();
    ergebnis.regeln = standardregelnErgaenzen();
    _cache.regeln = null;
    alleBelege().forEach(function (b) {
      if (b.status !== STATUS.PRUEFEN || !/^(Nicht ausgelesen|Auslesung fehlgeschlagen)/.test(String(b.grund))) return;
      if (Date.now() - start > LAUFZEIT_MS - 60000) { ergebnis.unvollstaendig = true; return; }
      try { belegNeuAuslesen(b.id); ergebnis.nachgelesen++; } catch (e) { ergebnis.fehler++; protokoll('Nachlesen fehlgeschlagen', b.id + ': ' + e.message); }
    });

    // Fremdwährung ohne Euro-Betrag nachrechnen
    alleBelege().forEach(function (b) {
      if (String(b.waehrung || 'EUR').toUpperCase() === 'EUR' || b.brutto_eur !== '' || zahl(b.brutto) === null) return;
      if ([STATUS.DUBLETTE, STATUS.AUSGESCHLOSSEN].indexOf(b.status) > -1) return;
      inEuroUmrechnen(b);
      if (b.brutto_eur !== '') { belegSpeichern(b); ergebnis.kurse++; }
    });

    var liste = alleBelege().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    var gesehen = [];
    var hashes = {};
    liste.forEach(function (b) {
      var geaendert = null;
      if (b.status !== STATUS.DUBLETTE && b.hash && hashes[b.hash]) {
        geaendert = b;
        b.status = STATUS.DUBLETTE;
        b.dublette_von = hashes[b.hash];
        b.grund = [b.grund, 'Identische Datei'].filter(String).join('; ');
      } else if ([STATUS.NEU, STATUS.PRUEFEN, STATUS.FREIGEGEBEN].indexOf(b.status) > -1) {
        var d = findeDublette(b, gesehen.filter(function (x) { return x.status !== STATUS.AUSGESCHLOSSEN; }));
        if (d) {
          var verlierer = d.behalteNeu ? d.beleg : b;
          // Bereits übermittelte Belege bleiben, wie sie sind
          if (verlierer.status !== STATUS.UEBERMITTELT) {
            verlierer.status = STATUS.DUBLETTE;
            verlierer.dublette_von = verlierer === b ? d.beleg.id : b.id;
            verlierer.grund = [verlierer.grund, d.grund].filter(String).join('; ');
            geaendert = verlierer;
          }
        }
      }
      if (b.hash && !hashes[b.hash]) hashes[b.hash] = b.id;
      gesehen.push(b);
      if (geaendert) {
        try { dateiEinordnen(geaendert); } catch (e) { protokoll('Datei nicht verschoben', geaendert.id + ': ' + e.message); }
        belegSpeichern(geaendert);
        ergebnis.dubletten++;
      }
    });
    ergebnis.meldung = ergebnis.nachgelesen + ' Belege nachgelesen, ' + ergebnis.dubletten + ' Dubletten markiert' +
      (ergebnis.kurse ? ', ' + ergebnis.kurse + ' Euro-Beträge nachgerechnet' : '') +
      (ergebnis.regeln ? ', ' + ergebnis.regeln + ' Standardregeln ergänzt' : '') +
      (ergebnis.fehler ? ', ' + ergebnis.fehler + ' Fehler (siehe Protokoll)' : '') +
      (ergebnis.unvollstaendig ? '. Noch nicht fertig, bitte erneut starten.' : '.');
    protokoll('Liste bereinigt', ergebnis.meldung);
    return ergebnis;
  } finally {
    lock.releaseLock();
  }
}

/**
 * GoBD-Prüfung: berechnet für jede Drive-Datei den SHA-256 neu und vergleicht ihn mit der Tabelle.
 * Abweichungen und fehlende Dateien landen im Protokoll. Ändert nichts.
 */
function hashPruefen() {
  var start = Date.now();
  var erg = { geprueft: 0, abweichend: [], fehlend: [], unvollstaendig: false };
  alleBelege().forEach(function (b) {
    if (!b.datei_id || !b.hash) return;
    if (Date.now() - start > LAUFZEIT_MS) { erg.unvollstaendig = true; return; }
    try {
      var datei = DriveApp.getFileById(b.datei_id);
      if (datei.isTrashed()) { erg.fehlend.push(b.id); return; }
      if (sha256(datei.getBlob().getBytes()) !== b.hash) erg.abweichend.push(b.id);
      erg.geprueft++;
    } catch (e) {
      erg.fehlend.push(b.id);
    }
  });
  erg.meldung = erg.geprueft + ' Dateien geprüft, ' + erg.abweichend.length + ' verändert, ' + erg.fehlend.length + ' fehlen' +
    (erg.unvollstaendig ? '. Zeitlimit erreicht, nicht alle geprüft.' : '.');
  protokoll('Hash-Prüfung: ' + erg.meldung, (erg.abweichend.length ? 'Verändert: ' + erg.abweichend.join(', ') + '. ' : '') +
    (erg.fehlend.length ? 'Fehlen: ' + erg.fehlend.join(', ') : ''));
  return erg;
}
