/**
 * Reine Logik ohne Google-Dienste: Spalten, Regeln, Dubletten, Dateinamen, CSV.
 * Diese Datei läuft auch unter Node (siehe test/logic.test.js).
 */

// Spalten der Tabelle "Belege". Reihenfolge = Spaltenreihenfolge im Sheet.
var BELEG_SPALTEN = [
  ['id', 'Beleg-ID'],
  ['status', 'Status'],
  ['richtung', 'Richtung'],
  ['dokumentart', 'Dokumentart'],
  ['belegdatum', 'Belegdatum'],
  ['rechnungsnummer', 'Rechnungsnummer'],
  ['partner', 'Lieferant / Kunde'],
  ['partner_ustid', 'USt-IdNr. Partner'],
  ['beschreibung', 'Beschreibung'],
  ['kategorie', 'Kategorie'],
  ['konto', 'Konto (Vorschlag)'],
  ['netto', 'Netto'],
  ['ust_satz', 'USt-Satz %'],
  ['ust_betrag', 'USt-Betrag'],
  ['brutto', 'Brutto'],
  ['waehrung', 'Währung'],
  ['kurs', 'Kurs EUR'],
  ['brutto_eur', 'Brutto EUR'],
  ['reverse_charge', 'Reverse Charge'],
  ['zahlungsart', 'Zahlungsart'],
  ['bezahlt', 'Bezahlt'],
  ['bereich', 'Bereich'],
  ['dublette_von', 'Dublette von'],
  ['grund', 'Hinweis / Grund'],
  ['quelle', 'Quelle'],
  ['absender', 'Absender'],
  ['betreff', 'Betreff'],
  ['eingang', 'Eingangsdatum'],
  ['mail_id', 'Gmail-ID'],
  ['datei_id', 'Drive-Datei-ID'],
  ['datei_name', 'Dateiname'],
  ['hash', 'SHA-256'],
  ['vertrauen', 'KI-Sicherheit'],
  ['uebermittelt', 'Übermittelt am'],
  ['notiz', 'Notiz']
];

var STATUS = {
  NEU: 'Neu',
  PRUEFEN: 'Prüfen',
  FREIGEGEBEN: 'Freigegeben',
  UEBERMITTELT: 'Übermittelt',
  DUBLETTE: 'Dublette',
  AUSGESCHLOSSEN: 'Ausgeschlossen'
};

// Dokumentarten, die keine Buchungsbelege sind.
var KEIN_BUCHUNGSBELEG = ['Angebot', 'Pro-forma', 'Auftragsbestätigung', 'Bestellung', 'Lieferschein', 'Mahnung', 'Sonstiges'];
// Zahlungsnachweise, die neben einer Rechnung zum selben Vorgang doppelt wären.
var ZAHLUNGSNACHWEIS = ['Quittung', 'Zahlungsbestätigung'];

// Kategorien mit SKR03-Kontovorschlag. Der Steuerberater entscheidet final.
// Wird bei der Einrichtung in das Blatt "Kategorien" geschrieben und kann dort geändert werden.
var STANDARD_KATEGORIEN = [
  ['Software & Abos', '4964', 'SaaS, Lizenzen, Cloud-Dienste'],
  ['Hosting & Domains', '4925', 'Webhosting, Domains, Internet'],
  ['Telefon & Mobilfunk', '4920', ''],
  ['Porto & Versand', '4910', ''],
  ['Bürobedarf', '4930', ''],
  ['Fachliteratur', '4940', 'Bücher, Zeitschriften, Normen'],
  ['Fortbildung', '4945', 'Seminare, Kurse'],
  ['Werbung & Marketing', '4600', 'Anzeigen, Werbemittel, Marketing-Tools'],
  ['Bewirtung', '4650', 'Bewirtungsbeleg mit Anlass und Teilnehmern nötig'],
  ['Reisekosten', '4670', 'Bahn, Flug, Hotel, Taxi'],
  ['Kfz-Kosten', '4530', 'Tanken, Werkstatt, Parken'],
  ['Versicherungen', '4360', ''],
  ['Beiträge', '4380', 'Kammern, Verbände'],
  ['Miete & Raumkosten', '4210', 'Miete, Coworking, Postdienst'],
  ['Rechts- & Beratungskosten', '4950', ''],
  ['Buchführung & Steuerberatung', '4955', ''],
  ['Fremdleistungen', '3100', 'Subunternehmer, Gutachten'],
  ['Geldverkehr', '4970', 'Bankgebühren, Zahlungsdienste'],
  ['Hardware & GWG', '4855', 'Geringwertige Wirtschaftsgüter'],
  ['Sonstiges', '4900', ''],
  ['Erlöse 19 %', '8400', 'Ausgangsrechnungen Inland'],
  ['Erlöse Ausland / steuerfrei', '8338', 'Ausgangsrechnungen EU/Drittland, vom Steuerberater prüfen lassen']
];

// Regeln aus der WellyBox-Auswertung als Startpunkt. Blatt "Regeln".
// Spalten: Aktiv | Feld | Bedingung | Wert | Aktion | Parameter | Beschreibung
var STANDARD_REGELN = [
  [true, 'dokumentart', 'ist eines von', 'Angebot, Pro-forma, Auftragsbestätigung, Bestellung, Lieferschein', 'ausschließen', '', 'Kein Buchungsbeleg'],
  [true, 'dokumentart', 'ist', 'Mahnung', 'ausschließen', '', 'Mahnungen sind keine neuen Belege'],
  [true, 'partner', 'enthält', 'Saily', 'bereich', 'Privat', 'Beispiel: privat genutzte Dienste'],
  [true, 'partner', 'enthält', 'Anthropic', 'kategorie', 'Software & Abos', ''],
  [true, 'partner', 'enthält', 'Netlify', 'kategorie', 'Hosting & Domains', ''],
  [true, 'partner', 'enthält', 'Caya', 'kategorie', 'Miete & Raumkosten', 'Digitaler Briefkasten'],
  [false, 'absender', 'enthält', 'noreply@example.com', 'ausschließen', '', 'Vorlage: Absender ausschließen']
];

function spaltenNamen() {
  return BELEG_SPALTEN.map(function (s) { return s[1]; });
}

function zeileZuObjekt(zeile) {
  var o = {};
  BELEG_SPALTEN.forEach(function (s, i) { o[s[0]] = zeile[i] === undefined ? '' : zeile[i]; });
  return o;
}

function objektZuZeile(o) {
  return BELEG_SPALTEN.map(function (s) { return o[s[0]] === undefined || o[s[0]] === null ? '' : o[s[0]]; });
}

function normalisiereName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(gmbh|ug|ag|kg|ohg|e\.?k\.?|inc|llc|ltd|limited|corp|corporation|co|bv|b\.v\.|sarl|sas|srl|plc|pbc|haftungsbeschraenkt)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function zahl(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).trim().replace(/[^\d,.\-]/g, '');
  // "1.234,56" -> 1234.56 ; "1,234.56" -> 1234.56
  if (s.indexOf(',') > -1 && s.indexOf('.') > -1) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.indexOf(',') > -1) {
    s = s.replace(',', '.');
  }
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function alsDatum(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

function isoDatum(d) {
  d = alsDatum(d);
  if (!d) return '';
  return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate());
}

function deDatum(d) {
  d = alsDatum(d);
  if (!d) return '';
  return zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear();
}

function monatVon(d) {
  d = alsDatum(d);
  return d ? d.getFullYear() + '-' + zwei(d.getMonth() + 1) : '';
}

function zwei(n) { return (n < 10 ? '0' : '') + n; }

function tageZwischen(a, b) {
  a = alsDatum(a); b = alsDatum(b);
  if (!a || !b) return Infinity;
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

/**
 * Prüft eine Regel gegen einen Beleg.
 * regel = { aktiv, feld, bedingung, wert, aktion, parameter }
 */
function regelTrifft(regel, beleg) {
  if (!regel.aktiv) return false;
  var ist = String(beleg[regel.feld] === undefined ? '' : beleg[regel.feld]).toLowerCase();
  var soll = String(regel.wert || '').toLowerCase().trim();
  switch (String(regel.bedingung || '').toLowerCase()) {
    case 'ist': return ist === soll;
    case 'enthält':
    case 'enthaelt': return soll !== '' && ist.indexOf(soll) > -1;
    case 'beginnt mit': return ist.indexOf(soll) === 0;
    case 'ist eines von':
      return soll.split(',').map(function (x) { return x.trim(); }).filter(String).indexOf(ist) > -1;
    case 'regex':
      try { return new RegExp(regel.wert, 'i').test(String(beleg[regel.feld] || '')); } catch (e) { return false; }
    default: return false;
  }
}

function istEigeneFirma(name, ustid, eigeneFirma) {
  if (!eigeneFirma) return false;
  var u1 = String(ustid || '').replace(/\s/g, '').toUpperCase();
  var u2 = String(eigeneFirma.ustid || '').replace(/\s/g, '').toUpperCase();
  if (u1 && u2 && u1 === u2) return true;
  var firma = normalisiereName(eigeneFirma.name);
  var n = normalisiereName(name);
  return !!(firma && n && (' ' + n + ' ').indexOf(' ' + firma + ' ') > -1);
}

/**
 * Legt Richtung und Geschäftspartner fest. Die eigene Firma ist nie der Partner:
 * stellt sie die Rechnung aus, ist es ein Ausgangsbeleg mit dem Empfänger als Kunde.
 * x = Rohdaten der Auslesung { aussteller_name, aussteller_ustid, empfaenger_name, empfaenger_ustid, richtung }
 */
function bestimmeRichtung(x, eigeneFirma) {
  var ausstellerEigen = istEigeneFirma(x.aussteller_name, x.aussteller_ustid, eigeneFirma);
  var empfaengerEigen = istEigeneFirma(x.empfaenger_name, x.empfaenger_ustid, eigeneFirma);
  if (ausstellerEigen && !empfaengerEigen) {
    return { richtung: 'Ausgang', partner: x.empfaenger_name || '', partner_ustid: x.empfaenger_ustid || '' };
  }
  if (empfaengerEigen && !ausstellerEigen) {
    return { richtung: 'Eingang', partner: x.aussteller_name || '', partner_ustid: x.aussteller_ustid || '' };
  }
  var r = x.richtung === 'Ausgang' ? 'Ausgang' : (x.richtung === 'Eingang' ? 'Eingang' : 'Unklar');
  return r === 'Ausgang'
    ? { richtung: r, partner: x.empfaenger_name || '', partner_ustid: x.empfaenger_ustid || '' }
    : { richtung: r, partner: x.aussteller_name || '', partner_ustid: x.aussteller_ustid || '' };
}

/**
 * Wendet Regeln und feste Plausibilitätsprüfungen an. Verändert den Beleg und gibt ihn zurück.
 */
function wendeRegelnAn(beleg, regeln, kategorien) {
  var hinweise = [];

  (regeln || []).forEach(function (r) {
    if (!regelTrifft(r, beleg)) return;
    var aktion = String(r.aktion || '').toLowerCase();
    if (aktion === 'ausschließen' || aktion === 'ausschliessen') {
      beleg.status = STATUS.AUSGESCHLOSSEN;
      hinweise.push('Regel: ' + (r.beschreibung || (r.feld + ' ' + r.bedingung + ' ' + r.wert)));
    } else if (aktion === 'kategorie') {
      beleg.kategorie = r.parameter;
    } else if (aktion === 'bereich') {
      beleg.bereich = r.parameter;
    } else if (aktion === 'richtung') {
      beleg.richtung = r.parameter;
    } else if (aktion === 'prüfen' || aktion === 'pruefen') {
      if (beleg.status !== STATUS.AUSGESCHLOSSEN) beleg.status = STATUS.PRUEFEN;
      hinweise.push('Regel verlangt Prüfung');
    }
  });

  if (beleg.status !== STATUS.AUSGESCHLOSSEN && KEIN_BUCHUNGSBELEG.indexOf(beleg.dokumentart) > -1) {
    beleg.status = STATUS.AUSGESCHLOSSEN;
    hinweise.push(beleg.dokumentart + ' ist kein Buchungsbeleg');
  }

  if (beleg.kategorie && kategorien && kategorien[beleg.kategorie] && !beleg.konto) {
    beleg.konto = kategorien[beleg.kategorie];
  }

  if (!beleg.status || beleg.status === STATUS.NEU) {
    var unsicher = Number(beleg.vertrauen) < 0.7 || !beleg.brutto || !beleg.belegdatum || beleg.richtung === 'Unklar';
    beleg.status = unsicher ? STATUS.PRUEFEN : STATUS.NEU;
    if (unsicher) hinweise.push('Angaben unvollständig oder unsicher');
  }

  if (hinweise.length) beleg.grund = [beleg.grund].concat(hinweise).filter(String).join('; ');
  return beleg;
}

/**
 * Sucht zu einem neuen Beleg einen bestehenden Beleg desselben Vorgangs.
 * Gibt { beleg, behalteNeu, grund } zurück oder null.
 *  - gleicher Hash: identische Datei
 *  - gleicher Partner + gleiche Rechnungsnummer
 *  - gleicher Partner + gleicher Betrag + Datum ±5 Tage, wenn eine Seite Zahlungsnachweis ist
 *    oder beide dieselbe Dokumentart haben
 */
function findeDublette(neu, bestehende) {
  var nPartner = normalisiereName(neu.partner);
  var nBetrag = zahl(neu.brutto);
  for (var i = 0; i < bestehende.length; i++) {
    var alt = bestehende[i];
    if (alt.status === STATUS.DUBLETTE || alt.id === neu.id) continue;
    if (neu.hash && alt.hash && neu.hash === alt.hash) {
      return { beleg: alt, behalteNeu: false, grund: 'Identische Datei' };
    }
    if (!nPartner || normalisiereName(alt.partner) !== nPartner) continue;
    if (neu.richtung && alt.richtung && neu.richtung !== alt.richtung) continue;

    var rnNeu = String(neu.rechnungsnummer || '').replace(/\s/g, '').toLowerCase();
    var rnAlt = String(alt.rechnungsnummer || '').replace(/\s/g, '').toLowerCase();
    var gleicheRn = rnNeu && rnAlt && rnNeu === rnAlt;

    var aBetrag = zahl(alt.brutto);
    var gleicherBetrag = nBetrag !== null && aBetrag !== null && Math.abs(nBetrag - aBetrag) < 0.01 &&
      String(neu.waehrung || 'EUR') === String(alt.waehrung || 'EUR');
    var nah = tageZwischen(neu.belegdatum, alt.belegdatum) <= 5;

    var neuIstZahlung = ZAHLUNGSNACHWEIS.indexOf(neu.dokumentart) > -1;
    var altIstZahlung = ZAHLUNGSNACHWEIS.indexOf(alt.dokumentart) > -1;

    if (gleicheRn || (gleicherBetrag && nah && (neuIstZahlung !== altIstZahlung || neu.dokumentart === alt.dokumentart))) {
      // Rechnung schlägt Quittung. Bei Gleichstand bleibt der ältere Eintrag.
      var behalteNeu = altIstZahlung && !neuIstZahlung;
      var grund = gleicheRn ? 'Gleiche Rechnungsnummer' :
        (neuIstZahlung !== altIstZahlung ? 'Rechnung und Zahlungsnachweis zum selben Vorgang' : 'Gleicher Betrag, gleiches Datum');
      return { beleg: alt, behalteNeu: behalteNeu, grund: grund };
    }
  }
  return null;
}

function dateiname(beleg, endung) {
  var teile = [
    isoDatum(beleg.belegdatum) || 'ohne-datum',
    beleg.richtung === 'Ausgang' ? 'AR' : 'ER',
    sauber(beleg.partner || 'unbekannt', 40),
    beleg.rechnungsnummer ? sauber(beleg.rechnungsnummer, 30) : '',
    beleg.brutto !== '' && beleg.brutto !== null && beleg.brutto !== undefined
      ? String(Number(beleg.brutto).toFixed(2)).replace('.', ',') + (beleg.waehrung || 'EUR') : ''
  ].filter(String);
  return teile.join('_') + (endung ? '.' + endung : '');
}

function sauber(s, max) {
  return String(s)
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9.\-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, max);
}

function betragDe(v) {
  var n = zahl(v);
  if (n === null) return '';
  return n.toFixed(2).replace('.', ',');
}

function csvFeld(v) {
  var s = String(v === null || v === undefined ? '' : v);
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Spalten der CSV für den Steuerberater (deutsches Format, Semikolon, Komma als Dezimaltrenner).
var EXPORT_SPALTEN = [
  ['Beleg-ID', function (b) { return b.id; }],
  ['Richtung', function (b) { return b.richtung; }],
  ['Belegdatum', function (b) { return deDatum(b.belegdatum); }],
  ['Rechnungsnummer', function (b) { return b.rechnungsnummer; }],
  ['Lieferant / Kunde', function (b) { return b.partner; }],
  ['USt-IdNr.', function (b) { return b.partner_ustid; }],
  ['Beschreibung', function (b) { return b.beschreibung; }],
  ['Kategorie', function (b) { return b.kategorie; }],
  ['Konto SKR03 (Vorschlag)', function (b) { return b.konto; }],
  ['Netto', function (b) { return betragDe(b.netto); }],
  ['USt %', function (b) { return b.ust_satz === '' ? '' : String(b.ust_satz).replace('.', ','); }],
  ['USt', function (b) { return betragDe(b.ust_betrag); }],
  ['Brutto', function (b) { return betragDe(b.brutto); }],
  ['Währung', function (b) { return b.waehrung; }],
  ['Kurs EUR', function (b) { return b.kurs === '' ? '' : String(b.kurs).replace('.', ','); }],
  ['Brutto EUR', function (b) { return betragDe(b.brutto_eur); }],
  ['Reverse Charge §13b', function (b) { return b.reverse_charge === true || b.reverse_charge === 'TRUE' || b.reverse_charge === 'ja' ? 'ja' : ''; }],
  ['Zahlungsart', function (b) { return b.zahlungsart; }],
  ['Bezahlt', function (b) { return b.bezahlt; }],
  ['Datei', function (b) { return b.datei_name; }],
  ['Notiz', function (b) { return b.notiz; }]
];

function baueCsv(belege) {
  var zeilen = [EXPORT_SPALTEN.map(function (s) { return csvFeld(s[0]); }).join(';')];
  belege.forEach(function (b) {
    zeilen.push(EXPORT_SPALTEN.map(function (s) { return csvFeld(s[1](b)); }).join(';'));
  });
  return '﻿' + zeilen.join('\r\n') + '\r\n';
}

function summen(belege) {
  var s = { eingang: 0, ausgang: 0, anzahl: belege.length, ohneEur: 0 };
  belege.forEach(function (b) {
    var eur = zahl(b.brutto_eur);
    if (eur === null && (b.waehrung || 'EUR') === 'EUR') eur = zahl(b.brutto);
    if (eur === null) { s.ohneEur++; return; }
    if (b.richtung === 'Ausgang') s.ausgang += eur; else s.eingang += eur;
  });
  s.eingang = Math.round(s.eingang * 100) / 100;
  s.ausgang = Math.round(s.ausgang * 100) / 100;
  return s;
}

// Belege, die in ein Monatspaket gehören.
function exportierbar(b) {
  return b.status === STATUS.FREIGEGEBEN || b.status === STATUS.UEBERMITTELT || b.status === STATUS.NEU;
}

if (typeof module !== 'undefined') {
  module.exports = {
    BELEG_SPALTEN: BELEG_SPALTEN, STATUS: STATUS, STANDARD_REGELN: STANDARD_REGELN, STANDARD_KATEGORIEN: STANDARD_KATEGORIEN,
    zeileZuObjekt: zeileZuObjekt, objektZuZeile: objektZuZeile, normalisiereName: normalisiereName, zahl: zahl,
    alsDatum: alsDatum, isoDatum: isoDatum, deDatum: deDatum, monatVon: monatVon, regelTrifft: regelTrifft,
    wendeRegelnAn: wendeRegelnAn, bestimmeRichtung: bestimmeRichtung, istEigeneFirma: istEigeneFirma, findeDublette: findeDublette, dateiname: dateiname, baueCsv: baueCsv,
    summen: summen, exportierbar: exportierbar, betragDe: betragDe
  };
}
