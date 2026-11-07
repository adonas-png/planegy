/**
 * Weitergabe: einzelne Belege an eine Beleg-Mailadresse (DATEV Upload Mail, lexoffice, sevDesk)
 * und Monatspakete für den Steuerberater (CSV, Excel, ZIP mit allen Belegen).
 */

function anBelegmailSenden(id) {
  var ziel = einstellung('BELEGMAIL');
  if (!ziel) throw new Error('Keine Beleg-Mailadresse hinterlegt (Einstellung BELEGMAIL).');
  var beleg = belegNachId(id);
  if (!beleg) throw new Error('Beleg nicht gefunden');
  if (beleg.status === STATUS.DUBLETTE || beleg.status === STATUS.AUSGESCHLOSSEN) {
    throw new Error('Dubletten und ausgeschlossene Belege werden nicht übermittelt.');
  }
  var datei = DriveApp.getFileById(beleg.datei_id);
  var betreff = [beleg.richtung === 'Ausgang' ? 'Ausgangsrechnung' : 'Eingangsbeleg', beleg.partner, deDatum(beleg.belegdatum),
    beleg.rechnungsnummer, betragDe(beleg.brutto) + ' ' + beleg.waehrung].filter(String).join(' | ');
  GmailApp.sendEmail(ziel, betreff, 'Beleg ' + beleg.id + (beleg.notiz ? '\nNotiz: ' + beleg.notiz : ''), {
    attachments: [datei.getBlob().setName(beleg.datei_name)],
    name: einstellung('FIRMA_NAME') + ' Belegbox'
  });
  beleg.status = STATUS.UEBERMITTELT;
  beleg.uebermittelt = new Date();
  belegSpeichern(beleg);
  return beleg;
}

/**
 * Erstellt das Monatspaket. monat = 'JJJJ-MM'.
 * optionen = { entwurf: true|false, teilen: true|false }
 *   entwurf: Gmail-Entwurf an den Steuerberater anlegen (wird nicht automatisch gesendet)
 *   teilen:  Exportordner für die Steuerberater-Adresse in Drive freigeben (nötig, wenn das ZIP zu groß für Mail ist)
 */
function monatspaketErstellen(monat, optionen) {
  optionen = optionen || {};
  if (!/^\d{4}-\d{2}$/.test(monat)) throw new Error('Monat im Format JJJJ-MM angeben');

  var alle = alleBelege().filter(function (b) { return monatVon(b.belegdatum || b.eingang) === monat; });
  var belege = alle.filter(exportierbar);
  var offen = alle.filter(nochNichtFreigegeben);
  belege.sort(function (a, b) {
    return (a.richtung > b.richtung ? 1 : a.richtung < b.richtung ? -1 : 0) || ((alsDatum(a.belegdatum) || 0) - (alsDatum(b.belegdatum) || 0));
  });

  var zeitstempel = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd_HHmm');
  var exporte = unterordner(wurzelordner(), 'Exporte');
  var ordner = unterordner(exporte, monat).createFolder(zeitstempel);
  var name = einstellung('FIRMA_NAME') + '_Belege_' + monat;

  var csv = Utilities.newBlob(baueCsv(belege), 'text/csv', name + '.csv');
  ordner.createFile(csv);
  var xlsx = excelErzeugen(belege, name);
  if (xlsx) ordner.createFile(xlsx);

  var dateien = [];
  var eingang = ordner.createFolder('Eingang');
  var ausgang = ordner.createFolder('Ausgang');
  belege.forEach(function (b) {
    if (!b.datei_id) return;
    var blob = DriveApp.getFileById(b.datei_id).getBlob().setName((b.richtung === 'Ausgang' ? 'Ausgang/' : 'Eingang/') + b.datei_name);
    (b.richtung === 'Ausgang' ? ausgang : eingang).createFile(blob.copyBlob().setName(b.datei_name));
    dateien.push(blob);
  });
  var zip = dateien.length ? Utilities.zip(dateien, name + '.zip') : null;
  if (zip) ordner.createFile(zip);

  var s = summen(belege);
  var info = {
    monat: monat, anzahl: belege.length, offen: offen.length, summen: s, ordner: ordner.getUrl(), entwurf: false
  };

  var stb = einstellung('STEUERBERATER_MAIL');
  if (optionen.teilen && stb) ordner.addViewer(stb);
  if (optionen.entwurf && stb) {
    var anhaenge = [csv];
    if (xlsx) anhaenge.push(xlsx);
    var zipPasst = zip && zip.getBytes().length < 18 * 1024 * 1024;
    if (zipPasst) anhaenge.push(zip);
    var text = [
      'Guten Tag ' + einstellung('STEUERBERATER_NAME') + ',',
      '',
      'anbei die Belege von ' + einstellung('FIRMA_NAME') + ' für ' + monatText(monat) + ':',
      '',
      '- Eingangsbelege: ' + belege.filter(function (b) { return b.richtung !== 'Ausgang'; }).length + ', Summe brutto ' + betragDe(s.eingang) + ' EUR',
      '- Ausgangsrechnungen: ' + belege.filter(function (b) { return b.richtung === 'Ausgang'; }).length + ', Summe brutto ' + betragDe(s.ausgang) + ' EUR',
      s.ohneEur ? '- ' + s.ohneEur + ' Beleg(e) ohne Euro-Umrechnung, siehe Liste' : '',
      '',
      'Die Liste liegt als CSV und Excel bei' + (zipPasst ? ', die Belege als ZIP.' : '. Die Belege liegen wegen der Größe im freigegebenen Drive-Ordner:\n' + ordner.getUrl()),
      'Fremdwährungen sind mit dem EZB-Referenzkurs des Belegdatums umgerechnet. Die Kontonummern sind Vorschläge nach SKR03.',
      '',
      'Viele Grüße',
      'Alexios Donas'
    ].filter(function (z) { return z !== null; }).join('\n');
    GmailApp.createDraft(stb, einstellung('FIRMA_NAME') + ' – Belege ' + monatText(monat), text, { attachments: anhaenge });
    info.entwurf = true;
  }

  blatt('Exporte').appendRow([new Date(), monat, belege.length, s.eingang, s.ausgang, ordner.getUrl(),
    info.entwurf ? stb : '', optionen.entwurf ? 'Entwurf' : 'Nur Ablage']);
  protokoll('Monatspaket ' + monat, belege.length + ' Belege, ' + offen.length + ' nicht freigegeben');
  return info;
}

function monatText(monat) {
  var namen = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var t = monat.split('-');
  return namen[Number(t[1]) - 1] + ' ' + t[0];
}

function excelErzeugen(belege, name) {
  var temp = SpreadsheetApp.create(name);
  try {
    var b = temp.getSheets()[0];
    b.setName('Belege');
    var kopf = EXPORT_SPALTEN.map(function (s) { return s[0]; });
    var zahlenSpalten = ['Netto', 'USt', 'Brutto', 'Brutto EUR', 'USt %', 'Kurs EUR'];
    var zeilen = belege.map(function (beleg) {
      return EXPORT_SPALTEN.map(function (s) {
        if (s[0] === 'Belegdatum') return alsDatum(beleg.belegdatum) || '';
        if (zahlenSpalten.indexOf(s[0]) > -1) {
          var key = { 'Netto': 'netto', 'USt': 'ust_betrag', 'Brutto': 'brutto', 'Brutto EUR': 'brutto_eur', 'USt %': 'ust_satz', 'Kurs EUR': 'kurs' }[s[0]];
          var n = zahl(beleg[key]);
          return n === null ? '' : n;
        }
        return s[1](beleg);
      });
    });
    b.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
    if (zeilen.length) {
      b.getRange(2, 1, zeilen.length, kopf.length).setValues(zeilen);
      b.getRange(2, kopf.indexOf('Belegdatum') + 1, zeilen.length, 1).setNumberFormat('dd.mm.yyyy');
    }
    b.setFrozenRows(1);
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + temp.getId() + '/export?format=xlsx';
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      protokoll('Excel-Export fehlgeschlagen', res.getResponseCode());
      return null;
    }
    return res.getBlob().setName(name + '.xlsx');
  } finally {
    DriveApp.getFileById(temp.getId()).setTrashed(true);
  }
}

/** Zeitauslöser am 3. des Monats: Paket für den Vormonat. */
function monatspaketAutomatisch() {
  if (einstellung('MONATSPAKET_AUTO') !== 'true') return;
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  var monat = monatVon(d);
  var info = monatspaketErstellen(monat, { entwurf: true });
  var ich = Session.getEffectiveUser().getEmail();
  GmailApp.sendEmail(ich, 'Belegbox: Monatspaket ' + monatText(monat) + ' bereit', [
    info.anzahl + ' freigegebene Belege im Paket, ' + info.offen + ' noch nicht freigegeben und daher nicht enthalten.',
    info.entwurf ? 'Der Entwurf an den Steuerberater liegt in Gmail unter "Entwürfe".' : 'Keine Steuerberater-Adresse hinterlegt, daher kein Entwurf.',
    'Ordner: ' + info.ordner
  ].join('\n'));
}
