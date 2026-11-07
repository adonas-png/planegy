/**
 * Einmalige Einrichtung. Im Apps-Script-Editor die Funktion "einrichten" auswählen und ausführen.
 * Legt Drive-Ordner, Tabelle, Gmail-Labels und Zeitauslöser an. Mehrfaches Ausführen schadet nicht.
 */
function einrichten() {
  var props = PropertiesService.getScriptProperties();

  // Drive-Ordner
  var ordnerId = props.getProperty('ORDNER_ID');
  var ordner;
  try { ordner = ordnerId ? DriveApp.getFolderById(ordnerId) : null; } catch (e) { ordner = null; }
  if (!ordner) {
    ordner = DriveApp.createFolder('PLANEGY Belegbox');
    props.setProperty('ORDNER_ID', ordner.getId());
  }
  unterordner(ordner, 'Belege');
  unterordner(ordner, 'Exporte');
  unterordner(ordner, 'Hochgeladen');

  // Tabelle
  var sheetId = props.getProperty('SHEET_ID');
  var ss;
  try { ss = sheetId ? SpreadsheetApp.openById(sheetId) : null; } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('PLANEGY Belegbox – Belegliste');
    DriveApp.getFileById(ss.getId()).moveTo(ordner);
    props.setProperty('SHEET_ID', ss.getId());
  }
  ss.setSpreadsheetLocale('de_DE');
  ss.setSpreadsheetTimeZone('Europe/Berlin');

  var belege = blattAnlegen(ss, 'Belege', spaltenNamen());
  belege.setFrozenColumns(2);
  var spalte = function (key) { return BELEG_SPALTEN.map(function (s) { return s[0]; }).indexOf(key) + 1; };
  belege.getRange(2, spalte('belegdatum'), belege.getMaxRows() - 1, 1).setNumberFormat('dd.mm.yyyy');
  belege.getRange(2, spalte('eingang'), belege.getMaxRows() - 1, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  // Textspalten: Sheets soll Rechnungsnummern wie "2026-10" nicht als Datum deuten
  ['id', 'rechnungsnummer', 'partner_ustid', 'konto', 'mail_id', 'datei_id', 'hash', 'dublette_von'].forEach(function (k) {
    belege.getRange(2, spalte(k), belege.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  ['netto', 'ust_betrag', 'brutto', 'brutto_eur'].forEach(function (k) {
    belege.getRange(2, spalte(k), belege.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');
  });
  var statusRegel = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.keys(STATUS).map(function (k) { return STATUS[k]; }), true).build();
  belege.getRange(2, spalte('status'), belege.getMaxRows() - 1, 1).setDataValidation(statusRegel);

  var regeln = blattAnlegen(ss, 'Regeln', ['Aktiv', 'Feld', 'Bedingung', 'Wert', 'Aktion', 'Parameter', 'Beschreibung']);
  if (regeln.getLastRow() < 2) {
    regeln.getRange(2, 1, STANDARD_REGELN.length, 7).setValues(STANDARD_REGELN);
  } else {
    standardregelnErgaenzen(regeln);
  }
  regeln.getRange(2, 1, 200, 1).insertCheckboxes();
  regeln.getRange(2, 3, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['ist', 'enthält', 'beginnt mit', 'ist eines von', 'regex'], true).build());
  regeln.getRange(2, 5, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['ausschließen', 'kategorie', 'bereich', 'richtung', 'prüfen'], true).build());
  regeln.getRange(2, 2, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['partner', 'absender', 'betreff', 'dokumentart', 'richtung', 'beschreibung', 'waehrung', 'partner_ustid'], true).build());

  var kat = blattAnlegen(ss, 'Kategorien', ['Kategorie', 'Konto SKR03 (Vorschlag)', 'Hinweis']);
  if (kat.getLastRow() < 2) {
    kat.getRange(2, 1, STANDARD_KATEGORIEN.length, 3).setValues(STANDARD_KATEGORIEN);
  }

  blattAnlegen(ss, 'Lieferanten', ['Name', 'USt-IdNr.', 'Kategorie', 'Bereich', 'Anzahl Belege', 'Zuletzt', 'Absender-Adressen']);
  blattAnlegen(ss, 'Verarbeitet', ['Gmail-ID', 'Zeitpunkt', 'Ergebnis']);
  blattAnlegen(ss, 'Exporte', ['Zeitpunkt', 'Monat', 'Belege', 'Summe Eingang EUR', 'Summe Ausgang EUR', 'Ordner', 'Empfänger', 'Art']);
  blattAnlegen(ss, 'Protokoll', ['Zeitpunkt', 'Meldung', 'Details']);

  var leer = ss.getSheetByName('Tabellenblatt1') || ss.getSheetByName('Sheet1');
  if (leer && ss.getSheets().length > 1) ss.deleteSheet(leer);

  // Gmail-Labels
  ['Belege', 'Belege/erfasst'].forEach(function (n) {
    if (!GmailApp.getUserLabelByName(n)) GmailApp.createLabel(n);
  });

  // Zeitauslöser
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['postfachScannen', 'monatspaketAutomatisch'].indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postfachScannen').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('monatspaketAutomatisch').timeBased().onMonthDay(3).atHour(7).create();

  if (!props.getProperty('ANTHROPIC_API_KEY')) {
    protokoll('Einrichtung fertig, aber ANTHROPIC_API_KEY fehlt. Ohne Schlüssel werden Belege nur abgelegt, nicht ausgelesen.');
  } else {
    protokoll('Einrichtung abgeschlossen');
  }
  console.log('Ordner: ' + ordner.getUrl());
  console.log('Tabelle: ' + ss.getUrl());
  return { ordner: ordner.getUrl(), tabelle: ss.getUrl() };
}

// Hängt Standardregeln an, die im Blatt noch fehlen (gleiches Feld und gleicher Wert). Eigene Regeln bleiben unberührt.
function standardregelnErgaenzen(regelBlatt) {
  regelBlatt = regelBlatt || blatt('Regeln');
  var werte = regelBlatt.getDataRange().getValues();
  var vorhanden = {};
  werte.slice(1).forEach(function (z) { if (z[1]) vorhanden[String(z[1]).toLowerCase() + '|' + String(z[3]).toLowerCase()] = true; });
  var neu = STANDARD_REGELN.filter(function (r) { return !vorhanden[String(r[1]).toLowerCase() + '|' + String(r[3]).toLowerCase()]; });
  if (!neu.length) return 0;
  // In die erste leere Zeile schreiben (die Checkboxen reichen bis Zeile 201)
  var erste = werte.length + 1;
  for (var i = 1; i < werte.length; i++) { if (!werte[i][1]) { erste = i + 1; break; } }
  regelBlatt.getRange(erste, 1, neu.length, 7).setValues(neu);
  return neu.length;
}

function blattAnlegen(ss, name, kopf) {
  var b = ss.getSheetByName(name) || ss.insertSheet(name);
  b.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold').setBackground('#e8eef3');
  b.setFrozenRows(1);
  return b;
}

/** Entfernt die Zeitauslöser, z. B. vor dem Löschen des Projekts. */
function ausloeserEntfernen() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
