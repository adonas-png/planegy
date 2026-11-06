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
  blatt('Belege').appendRow(objektZuZeile(beleg));
}

function belegSpeichern(beleg) {
  if (!beleg._zeile) {
    var alt = belegNachId(beleg.id);
    if (!alt) throw new Error('Beleg ' + beleg.id + ' nicht gefunden');
    beleg._zeile = alt._zeile;
  }
  blatt('Belege').getRange(beleg._zeile, 1, 1, BELEG_SPALTEN.length).setValues([objektZuZeile(beleg)]);
}

function neueBelegId() {
  var lock = LockService.getScriptLock();
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
  var bestehende = alleBelege();
  for (var i = 0; i < bestehende.length; i++) {
    if (bestehende[i].hash === hash) return { ergebnis: 'Datei schon vorhanden (' + bestehende[i].id + ')', id: bestehende[i].id };
  }

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
    var x = belegAuslesen(blob, meta);
    if (x) {
      auslesungUebernehmen(beleg, x);
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

  var dublette = null;
  if (beleg.status !== STATUS.AUSGESCHLOSSEN) {
    dublette = findeDublette(beleg, bestehende.filter(function (b) { return b.status !== STATUS.AUSGESCHLOSSEN; }));
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
  if (beleg.status !== STATUS.AUSGESCHLOSSEN && beleg.partner) lieferantAktualisieren(beleg);

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
  var x = belegAuslesen(blob, { absender: beleg.absender, betreff: beleg.betreff }, modell);
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
