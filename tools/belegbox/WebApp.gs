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
  'bereich', 'notiz'];

var SICHTBARE_EINSTELLUNGEN = ['FIRMA_NAME', 'FIRMA_USTID', 'FIRMA_ORT', 'GMAIL_SUCHE', 'SCAN_AB', 'HTML_ALS_PDF', 'MAX_MAILS_PRO_LAUF',
  'MODELL', 'BELEGMAIL', 'AUTO_UEBERMITTELN', 'STEUERBERATER_MAIL', 'STEUERBERATER_NAME', 'MONATSPAKET_AUTO'];

function fuerClient(b) {
  var o = {};
  BELEG_SPALTEN.forEach(function (s) {
    var v = b[s[0]];
    if (Object.prototype.toString.call(v) === '[object Date]') v = s[0] === 'eingang' || s[0] === 'uebermittelt' ? v.toISOString() : isoDatum(v);
    o[s[0]] = v === undefined || v === null ? '' : v;
  });
  o.monat = monatVon(b.belegdatum || b.eingang);
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
  var vorher = { brutto: beleg.brutto, waehrung: beleg.waehrung, belegdatum: String(beleg.belegdatum), kategorie: beleg.kategorie };
  BEARBEITBAR.forEach(function (k) {
    if (!felder.hasOwnProperty(k)) return;
    var v = felder[k];
    if (k === 'belegdatum') v = alsDatum(v) || '';
    if (['netto', 'ust_satz', 'ust_betrag', 'brutto'].indexOf(k) > -1) { var n = zahl(v); v = n === null ? '' : n; }
    if (k === 'waehrung') v = String(v || 'EUR').toUpperCase();
    beleg[k] = v;
  });
  if (beleg.kategorie !== vorher.kategorie && !felder.konto) {
    beleg.konto = kategorienKarte()[beleg.kategorie] || beleg.konto;
  }
  if (beleg.brutto !== vorher.brutto || beleg.waehrung !== vorher.waehrung || String(beleg.belegdatum) !== vorher.belegdatum) {
    beleg.kurs = '';
    beleg.brutto_eur = '';
    inEuroUmrechnen(beleg);
  }
  dateiEinordnen(beleg);
  belegSpeichern(beleg);
  if (beleg.status === STATUS.FREIGEGEBEN && einstellung('AUTO_UEBERMITTELN') === 'true' && einstellung('BELEGMAIL')) {
    beleg = anBelegmailSenden(id);
  }
  return fuerClient(beleg);
}

function belegeStatusSetzen(ids, status) {
  return ids.map(function (id) { return belegAktualisieren(id, { status: status }); });
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

function neuAuslesenAusApp(id) {
  return fuerClient(belegNeuAuslesen(id));
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
