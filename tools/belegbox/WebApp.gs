/**
 * Web-Oberfläche. Bereitstellen als Web-App mit "Ausführen als: Ich" und "Zugriff: Nur ich".
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('PLANEGY Belegbox')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

var BEARBEITBAR = ['status', 'richtung', 'dokumentart', 'belegdatum', 'rechnungsnummer', 'partner', 'partner_ustid', 'beschreibung',
  'kategorie', 'konto', 'netto', 'ust_satz', 'ust_betrag', 'brutto', 'waehrung', 'reverse_charge', 'zahlungsart', 'bezahlt',
  'bereich', 'notiz', 'leistungszeitraum'];

var SICHTBARE_EINSTELLUNGEN = ['FIRMA_NAME', 'FIRMA_USTID', 'FIRMA_ORT', 'GMAIL_SUCHE', 'SCAN_AB', 'HTML_ALS_PDF', 'MAX_MAILS_PRO_LAUF',
  'MODELL', 'GENAU_MODELL', 'ZWEITE_RUNDE', 'FIRMA_MERKMALE', 'BELEGMAIL', 'AUTO_UEBERMITTELN', 'STEUERBERATER_MAIL', 'STEUERBERATER_NAME', 'MONATSPAKET_AUTO'];

function fuerClient(b) {
  var o = {};
  BELEG_SPALTEN.forEach(function (s) {
    var v = b[s[0]];
    if (Object.prototype.toString.call(v) === '[object Date]') v = s[0] === 'eingang' || s[0] === 'uebermittelt' ? v.toISOString() : isoDatum(v);
    o[s[0]] = v === undefined || v === null ? '' : v;
  });
  o.monat = monatVon(b.belegdatum || b.eingang);
  o.rc_art = rcArt(b);
  return o;
}

function appDaten() {
  var belege = alleBelege().map(fuerClient);
  belege.sort(function (a, b) {
    return String(b.belegdatum || b.eingang).localeCompare(String(a.belegdatum || a.eingang));
  });
  var einst = {};
  SICHTBARE_EINSTELLUNGEN.forEach(function (k) { einst[k] = einstellung(k); });
  var letzter = PropertiesService.getScriptProperties().getProperty('SCAN_LETZTER');
  return {
    belege: belege,
    kategorien: Object.keys(kategorienKarte()),
    kategorieKonten: kategorienKarte(),
    dokumentarten: DOKUMENTARTEN,
    status: Object.keys(STATUS).map(function (k) { return STATUS[k]; }),
    einstellungen: einst,
    hatSchluessel: !!einstellung('ANTHROPIC_API_KEY'),
    fehlgeschlagen: belege.filter(function (b) { return /^(Auslesung fehlgeschlagen|Nicht ausgelesen)/.test(String(b.grund)); }).length,
    letzterScan: letzter ? new Date(Number(letzter)).toISOString() : '',
    links: {
      tabelle: tabelle().getUrl(),
      ordner: wurzelordner().getUrl()
    }
  };
}

function belegAktualisieren(id, felder) {
  var beleg = belegNachId(id);
  if (!beleg) throw new Error('Beleg nicht gefunden');
  return fuerClient(aenderungAnwenden(beleg, felder));
}

// Übernimmt Formularwerte, schreibt die Zeile und protokolliert, welche Felder sich geändert haben.
function aenderungAnwenden(beleg, felder) {
  var vorher = {};
  BEARBEITBAR.forEach(function (k) { vorher[k] = beleg[k]; });
  BEARBEITBAR.forEach(function (k) {
    if (!felder.hasOwnProperty(k)) return;
    var v = felder[k];
    if (k === 'belegdatum') v = alsDatum(v) || '';
    if (['netto', 'ust_satz', 'ust_betrag', 'brutto'].indexOf(k) > -1) { var n = zahl(v); v = n === null ? '' : n; }
    if (k === 'waehrung') v = String(v || 'EUR').toUpperCase();
    beleg[k] = v;
  });
  var geaendert = BEARBEITBAR.filter(function (k) { return feldText(vorher[k]) !== feldText(beleg[k]); });
  if (!geaendert.length) return beleg;
  if (geaendert.indexOf('kategorie') > -1 && geaendert.indexOf('konto') < 0) {
    beleg.konto = kategorienKarte()[beleg.kategorie] || beleg.konto;
  }
  if (['brutto', 'waehrung', 'belegdatum'].some(function (k) { return geaendert.indexOf(k) > -1; })) {
    beleg.kurs = '';
    beleg.brutto_eur = '';
    inEuroUmrechnen(beleg);
  }
  if (['status', 'richtung', 'belegdatum', 'partner', 'rechnungsnummer', 'brutto', 'waehrung'].some(function (k) { return geaendert.indexOf(k) > -1; })) {
    dateiEinordnen(beleg);
  }
  belegSpeichern(beleg);
  protokoll('Geändert ' + beleg.id, geaendert.map(function (k) { return k + ': ' + feldText(vorher[k]) + ' > ' + feldText(beleg[k]); }).join('; '));
  if (beleg.status === STATUS.FREIGEGEBEN && geaendert.indexOf('status') > -1 &&
      einstellung('AUTO_UEBERMITTELN') === 'true' && einstellung('BELEGMAIL')) {
    beleg = anBelegmailSenden(beleg.id);
  }
  return beleg;
}

function feldText(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return deDatum(v);
  if (typeof v === 'number') return betragDe(v);
  return String(v === null || v === undefined ? '' : v);
}

// Sammelfreigabe: liest die Tabelle einmal und speichert nur die betroffenen Zeilen
function belegeStatusSetzen(ids, status) {
  if (ids.length > 50) throw new Error('Höchstens 50 Belege auf einmal.');
  var karte = {};
  alleBelege().forEach(function (b) { karte[b.id] = b; });
  return ids.filter(function (id) { return karte[id]; }).map(function (id) {
    return fuerClient(aenderungAnwenden(karte[id], { status: status }));
  });
}

function belegHochladen(name, mime, base64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
  var r = dateiVerarbeiten(blob, { quelle: 'Upload', eingang: new Date() });
  return { ergebnis: r.ergebnis, beleg: fuerClient(belegNachId(r.id)) };
}

function scanStarten() {
  return postfachScannen();
}

function monatspaketAusApp(monat, entwurf, teilen) {
  return monatspaketErstellen(monat, { entwurf: !!entwurf, teilen: !!teilen });
}

function uebermittelnAusApp(id) {
  return fuerClient(anBelegmailSenden(id));
}

function neuAuslesenAusApp(id, genau) {
  return fuerClient(belegNeuAuslesen(id, genau ? einstellung('GENAU_MODELL') : ''));
}

function einstellungenSpeichern(werte) {
  Object.keys(werte).forEach(function (k) {
    if (SICHTBARE_EINSTELLUNGEN.indexOf(k) > -1) setzeEinstellung(k, werte[k]);
    if (k === 'ANTHROPIC_API_KEY' && werte[k]) setzeEinstellung(k, String(werte[k]).trim());
  });
  return appDaten();
}

function vorschauUrl(dateiId) {
  return 'https://drive.google.com/file/d/' + dateiId + '/preview';
}

function listeBereinigenAusApp() {
  return listeBereinigen();
}

function jahresUebersichtAusApp(jahr, mitPrivat) {
  var belege = alleBelege();
  var jahre = {};
  belege.forEach(function (b) { var d = alsDatum(b.belegdatum); if (d) jahre[d.getFullYear()] = true; });
  jahr = Number(jahr) || new Date().getFullYear();
  var heute = new Date();
  var stichtag = jahr < heute.getFullYear() ? new Date(jahr, 11, 31) : heute;
  return {
    jahre: Object.keys(jahre).map(Number).sort().reverse(),
    uebersicht: jahresUebersicht(belege, jahr, { mitPrivat: !!mitPrivat, stichtag: stichtag }),
    laufend: laufendeKosten(belege, { mitPrivat: !!mitPrivat, stichtag: heute })
  };
}

function hashPruefenAusApp() {
  return hashPruefen();
}

// Quelltext der Rechenregeln für die Seite (Index.html), damit Browser und Server gleich zählen
function gemeinsameFunktionen() {
  return [zahl, zaehltFuerAuswertung, bruttoEur].map(String).join('\n');
}
