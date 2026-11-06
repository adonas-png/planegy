/**
 * Einstellungen. Alle Werte liegen in den Skripteigenschaften
 * (Apps-Script-Editor > Projekteinstellungen > Skripteigenschaften)
 * und lassen sich in der App unter "Einstellungen" ändern.
 */

var STANDARD_EINSTELLUNGEN = {
  FIRMA_NAME: 'PLANEGY',
  FIRMA_USTID: 'DE275026433',
  FIRMA_ORT: 'Waiblingen',
  // Gmail-Suche nach Belegen. Wird pro Lauf um "after:" ergänzt.
  GMAIL_SUCHE: '((has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) ' +
    '(rechnung OR invoice OR receipt OR quittung OR beleg OR zahlungsbestätigung OR "payment confirmation" OR gutschrift OR "credit note" OR bill)) ' +
    'OR subject:(rechnung OR invoice OR receipt OR quittung OR "your receipt" OR "ihre rechnung" OR zahlungsbeleg) ' +
    'OR label:belege) -in:spam -in:trash',
  // Erster Lauf durchsucht ab diesem Datum (JJJJ-MM-TT).
  SCAN_AB: '2026-01-01',
  // Mails ohne Anhang, deren Text die Rechnung ist (z. B. Stripe-Quittungen), als PDF ablegen.
  HTML_ALS_PDF: 'true',
  // Max. Mails pro Lauf. Apps Script bricht nach 6 Minuten ab.
  MAX_MAILS_PRO_LAUF: '25',
  // Claude-Modell für die Auslesung. Haiku ist günstig; "Genau auslesen" in der App nutzt GENAU_MODELL.
  MODELL: 'claude-haiku-5-5',
  GENAU_MODELL: 'claude-opus-5-5',
  // Optional: Beleg-Mailadresse von DATEV Unternehmen online (Upload Mail), lexoffice oder sevDesk.
  BELEGMAIL: '',
  // Freigegebene Belege sofort an BELEGMAIL senden.
  AUTO_UEBERMITTELN: 'false',
  // E-Mail des Steuerberaters für das Monatspaket.
  STEUERBERATER_MAIL: '',
  STEUERBERATER_NAME: 'Herr Baumann',
  // Monatspaket am 3. des Folgemonats als Gmail-Entwurf anlegen.
  MONATSPAKET_AUTO: 'true'
};

// Diese Schlüssel zeigt die App nicht im Klartext an.
var GEHEIME_EINSTELLUNGEN = ['ANTHROPIC_API_KEY'];

function einstellung(schluessel) {
  var v = PropertiesService.getScriptProperties().getProperty(schluessel);
  if (v === null || v === undefined || v === '') {
    return STANDARD_EINSTELLUNGEN.hasOwnProperty(schluessel) ? STANDARD_EINSTELLUNGEN[schluessel] : '';
  }
  return v;
}

function setzeEinstellung(schluessel, wert) {
  PropertiesService.getScriptProperties().setProperty(schluessel, String(wert === null || wert === undefined ? '' : wert));
}

function eigeneFirma() {
  return { name: einstellung('FIRMA_NAME'), ustid: einstellung('FIRMA_USTID'), ort: einstellung('FIRMA_ORT') };
}

function tabelle() {
  var id = einstellung('SHEET_ID');
  if (!id) throw new Error('Belegbox ist noch nicht eingerichtet. Bitte zuerst die Funktion "einrichten" ausführen.');
  return SpreadsheetApp.openById(id);
}

function blatt(name) {
  var b = tabelle().getSheetByName(name);
  if (!b) throw new Error('Blatt "' + name + '" fehlt.');
  return b;
}

function wurzelordner() {
  return DriveApp.getFolderById(einstellung('ORDNER_ID'));
}

function unterordner(eltern, name) {
  var it = eltern.getFoldersByName(name);
  return it.hasNext() ? it.next() : eltern.createFolder(name);
}

// Ablageordner: Belegbox/Belege/2026/2026-10/Eingang
function ablageordner(belegdatum, richtung) {
  var d = alsDatum(belegdatum) || new Date();
  var jahr = String(d.getFullYear());
  var monat = monatVon(d);
  var belege = unterordner(wurzelordner(), 'Belege');
  var jahrOrdner = unterordner(belege, jahr);
  var monatOrdner = unterordner(jahrOrdner, monat);
  var art = richtung === 'Ausgang' ? 'Ausgang' : (richtung === 'Eingang' ? 'Eingang' : 'Unklar');
  return unterordner(monatOrdner, art);
}

function kategorienKarte() {
  var werte = blatt('Kategorien').getDataRange().getValues().slice(1);
  var karte = {};
  werte.forEach(function (z) { if (z[0]) karte[String(z[0])] = String(z[1] || ''); });
  return karte;
}

function regelnLaden() {
  var werte = blatt('Regeln').getDataRange().getValues().slice(1);
  return werte.filter(function (z) { return z[1]; }).map(function (z) {
    return {
      aktiv: z[0] === true || String(z[0]).toLowerCase() === 'true' || String(z[0]).toLowerCase() === 'ja',
      feld: String(z[1]).trim(), bedingung: String(z[2]).trim(), wert: String(z[3]),
      aktion: String(z[4]).trim(), parameter: String(z[5] || ''), beschreibung: String(z[6] || '')
    };
  });
}

function protokoll(nachricht, details) {
  try {
    blatt('Protokoll').appendRow([new Date(), nachricht, details ? String(details).slice(0, 5000) : '']);
  } catch (e) {
    console.log(nachricht + ' ' + (details || ''));
  }
}
