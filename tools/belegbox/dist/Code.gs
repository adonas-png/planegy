// PLANEGY Belegbox – automatisch erzeugt aus tools/belegbox/*.gs (node tools/belegbox/build.js). Nicht von Hand ändern.

// ===== Logic.gs =====

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
  ['notiz', 'Notiz'],
  // Neue Spalten nur hinten anhängen, damit bestehende Tabellen passen
  ['leistungszeitraum', 'Leistungszeitraum']
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
  [true, 'partner', 'enthält', 'Calendly', 'kategorie', 'Software & Abos', ''],
  [true, 'partner', 'enthält', 'Google Cloud', 'kategorie', 'Software & Abos', 'Google Workspace'],
  [true, 'partner', 'enthält', 'HubSpot', 'kategorie', 'Software & Abos', ''],
  [true, 'partner', 'enthält', 'Gamma', 'kategorie', 'Software & Abos', ''],
  [true, 'partner', 'enthält', 'AEGEAN', 'kategorie', 'Reisekosten', ''],
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
  var n = ' ' + normalisiereName(name) + ' ';
  if (!n.trim()) return false;
  // Firmenname plus weitere Merkmale wie Inhabername oder Straße (Einstellung FIRMA_MERKMALE)
  var merkmale = [eigeneFirma.name].concat(eigeneFirma.merkmale || []);
  return merkmale.some(function (m) {
    var x = normalisiereName(m);
    return x && n.indexOf(' ' + x + ' ') > -1;
  });
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
  ['Leistungszeitraum', function (b) { return b.leistungszeitraum; }],
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
  ['Reverse Charge §13b', function (b) { return rcArt(b); }],
  ['USt §13b EUR (19 %)', function (b) { var u = ustParagraf13b(b); return u === null ? '' : betragDe(u); }],
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
    var eur = bruttoEur(b);
    if (eur === null) { s.ohneEur++; return; }
    if (b.richtung === 'Ausgang') s.ausgang += eur; else s.eingang += eur;
  });
  s.eingang = Math.round(s.eingang * 100) / 100;
  s.ausgang = Math.round(s.ausgang * 100) / 100;
  return s;
}

// ---------- Reverse Charge ----------

var EU_LAENDER = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'EL', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];

function istReverseCharge(b) {
  return b.reverse_charge === true || b.reverse_charge === 'TRUE' || b.reverse_charge === 'ja';
}

/**
 * Art des §13b-Falls nach Herkunft des Leistenden: EU-Unternehmer (Abs. 1) oder Drittland (Abs. 2).
 * Grundlage ist das Länderpräfix der USt-IdNr. Kennungen wie "EU372082401" (OSS-Nummer von
 * Drittlandsanbietern, z. B. Calendly) zählen als Drittland, weil "EU" kein Mitgliedstaat ist.
 */
function rcArt(b) {
  if (!istReverseCharge(b)) return '';
  var land = String(b.partner_ustid || '').replace(/\s/g, '').slice(0, 2).toUpperCase();
  return EU_LAENDER.indexOf(land) > -1 ? 'EU §13b Abs. 1' : 'Drittland §13b Abs. 2';
}

// Selbst zu berechnende USt bei §13b, 19 % auf den Nettobetrag in Euro. Satz mit dem Steuerberater abstimmen.
function ustParagraf13b(b) {
  if (!istReverseCharge(b)) return null;
  var n = nettoEur(b);
  return n === null ? null : runden(n * 0.19);
}

// Erlöskategorie für Ausgangsrechnungen: Inland mit USt oder Ausland / steuerfrei
function erloesKategorie(b) {
  var ustid = String(b.partner_ustid || '').replace(/\s/g, '').toUpperCase();
  var ohneUst = b.ust_satz !== '' && b.ust_satz !== null && b.ust_satz !== undefined && Number(b.ust_satz) === 0;
  var ausland = ustid && ustid.slice(0, 2) !== 'DE';
  return ohneUst || ausland ? 'Erlöse Ausland / steuerfrei' : 'Erlöse 19 %';
}

// Belege, die in ein Monatspaket gehören.
// Nur geprüfte Belege gehen an den Steuerberater.
function exportierbar(b) {
  return b.status === STATUS.FREIGEGEBEN || b.status === STATUS.UEBERMITTELT;
}

function nochNichtFreigegeben(b) {
  return b.status === STATUS.NEU || b.status === STATUS.PRUEFEN;
}

// ---------- Jahresübersicht und laufende Kosten ----------

// Zählt für Auswertungen: gültige Buchungsbelege, keine Dubletten, nichts Ausgeschlossenes.
function zaehltFuerAuswertung(b) {
  return [STATUS.NEU, STATUS.PRUEFEN, STATUS.FREIGEGEBEN, STATUS.UEBERMITTELT].indexOf(b.status) > -1 &&
    ['Rechnung', 'Quittung', 'Zahlungsbestätigung', 'Gutschrift', ''].indexOf(b.dokumentart || '') > -1;
}

function bruttoEur(b) {
  var eur = zahl(b.brutto_eur);
  if (eur === null && String(b.waehrung || 'EUR').toUpperCase() === 'EUR') eur = zahl(b.brutto);
  if (eur === null) return null;
  return b.dokumentart === 'Gutschrift' ? -Math.abs(eur) : eur;
}

function nettoEur(b) {
  var netto = zahl(b.netto);
  var kurs = String(b.waehrung || 'EUR').toUpperCase() === 'EUR' ? 1 : zahl(b.kurs);
  if (netto !== null && kurs) {
    var n = netto * kurs;
    return b.dokumentart === 'Gutschrift' ? -Math.abs(n) : n;
  }
  return bruttoEur(b);
}

function runden(n) { return Math.round(n * 100) / 100; }

/**
 * Übersicht für ein Kalenderjahr bis zum Stichtag (Standard: heute).
 * optionen = { mitPrivat: false, stichtag: Date }
 */
function jahresUebersicht(belege, jahr, optionen) {
  optionen = optionen || {};
  var stichtag = alsDatum(optionen.stichtag) || new Date();
  var leer = function () { return { netto: 0, ust: 0, brutto: 0, anzahl: 0 }; };
  var erg = {
    jahr: jahr, stichtag: isoDatum(stichtag),
    ausgaben: leer(), einnahmen: leer(),
    monate: [], kategorien: {}, lieferanten: {}, ohneEur: 0, zuPruefen: 0
  };
  for (var m = 0; m < 12; m++) erg.monate.push({ monat: jahr + '-' + zwei(m + 1), ausgaben: 0, einnahmen: 0 });

  belege.forEach(function (b) {
    if (!zaehltFuerAuswertung(b)) return;
    if (!optionen.mitPrivat && b.bereich === 'Privat') return;
    var d = alsDatum(b.belegdatum);
    if (!d || d.getFullYear() !== Number(jahr) || d > stichtag) return;
    var brutto = bruttoEur(b);
    if (brutto === null) { erg.ohneEur++; return; }
    var netto = nettoEur(b);
    if (b.status === STATUS.PRUEFEN) erg.zuPruefen++;
    var ziel = b.richtung === 'Ausgang' ? erg.einnahmen : erg.ausgaben;
    ziel.netto += netto; ziel.brutto += brutto; ziel.ust += brutto - netto; ziel.anzahl++;
    var monat = erg.monate[d.getMonth()];
    if (b.richtung === 'Ausgang') monat.einnahmen += brutto; else monat.ausgaben += brutto;
    if (b.richtung !== 'Ausgang') {
      var k = b.kategorie || 'Ohne Kategorie';
      erg.kategorien[k] = (erg.kategorien[k] || 0) + netto;
      var l = b.partner || 'Unbekannt';
      erg.lieferanten[l] = (erg.lieferanten[l] || 0) + netto;
    }
  });

  [erg.ausgaben, erg.einnahmen].forEach(function (x) { x.netto = runden(x.netto); x.brutto = runden(x.brutto); x.ust = runden(x.ust); });
  erg.monate.forEach(function (m) { m.ausgaben = runden(m.ausgaben); m.einnahmen = runden(m.einnahmen); });
  var sortiert = function (obj, max) {
    return Object.keys(obj).map(function (k) { return { name: k, netto: runden(obj[k]) }; })
      .sort(function (a, b) { return b.netto - a.netto; }).slice(0, max || 100);
  };
  erg.kategorien = sortiert(erg.kategorien);
  erg.lieferanten = sortiert(erg.lieferanten, 10);
  return erg;
}

/**
 * Erkennt wiederkehrende Ausgaben (Abos, Mieten, Versicherungen) und rechnet sie aufs Jahr hoch.
 * Ein Lieferant gilt als wiederkehrend, wenn er in den letzten 13 Monaten in mindestens zwei
 * verschiedenen Monaten einen Beleg hatte. Jährliche Zahlungen fallen erst nach zwei Jahren auf.
 */
function laufendeKosten(belege, optionen) {
  optionen = optionen || {};
  var stichtag = alsDatum(optionen.stichtag) || new Date();
  var grenze = new Date(stichtag.getTime() - 400 * 86400000);
  var proPartner = {};
  belege.forEach(function (b) {
    if (!zaehltFuerAuswertung(b) || b.richtung === 'Ausgang' || b.dokumentart === 'Gutschrift') return;
    if (!optionen.mitPrivat && b.bereich === 'Privat') return;
    var d = alsDatum(b.belegdatum);
    var n = nettoEur(b);
    if (!d || d < grenze || d > stichtag || n === null || !b.partner) return;
    var key = normalisiereName(b.partner);
    (proPartner[key] = proPartner[key] || { name: b.partner, kategorie: b.kategorie, posten: [] }).posten.push({ d: d, netto: n, brutto: bruttoEur(b) });
  });

  var liste = [];
  Object.keys(proPartner).forEach(function (key) {
    var p = proPartner[key];
    p.posten.sort(function (a, b) { return a.d - b.d; });
    var monate = {};
    p.posten.forEach(function (x) { monate[monatVon(x.d)] = true; });
    if (Object.keys(monate).length < 2) return;
    // Abstand zwischen den Zahlungen, Median in Tagen
    var abstaende = [];
    for (var i = 1; i < p.posten.length; i++) {
      var t = Math.round((p.posten[i].d - p.posten[i - 1].d) / 86400000);
      if (t >= 20) abstaende.push(t);
    }
    if (!abstaende.length) return;
    abstaende.sort(function (a, b) { return a - b; });
    var median = abstaende[Math.floor(abstaende.length / 2)];
    var rhythmus, proJahr;
    if (median <= 45) { rhythmus = 'monatlich'; proJahr = 12; }
    else if (median <= 120) { rhythmus = 'quartalsweise'; proJahr = 4; }
    else if (median <= 200) { rhythmus = 'halbjährlich'; proJahr = 2; }
    else { rhythmus = 'jährlich'; proJahr = 1; }
    var letzter = p.posten[p.posten.length - 1];
    var tageSeitLetztem = Math.round((stichtag - letzter.d) / 86400000);
    liste.push({
      name: p.name, kategorie: p.kategorie || '', rhythmus: rhythmus,
      letzterBetragNetto: runden(letzter.netto), letzterBetragBrutto: runden(letzter.brutto || letzter.netto),
      letzteZahlung: isoDatum(letzter.d), anzahl: p.posten.length,
      proJahrNetto: runden(letzter.netto * proJahr), proJahrBrutto: runden((letzter.brutto || letzter.netto) * proJahr),
      // Ausgelaufen, wenn die nächste Zahlung deutlich überfällig ist
      aktiv: tageSeitLetztem <= median * 1.6 + 10
    });
  });
  liste.sort(function (a, b) { return b.proJahrNetto - a.proJahrNetto; });
  var aktive = liste.filter(function (x) { return x.aktiv; });
  return {
    posten: liste,
    summeNetto: runden(aktive.reduce(function (s, x) { return s + x.proJahrNetto; }, 0)),
    summeBrutto: runden(aktive.reduce(function (s, x) { return s + x.proJahrBrutto; }, 0))
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    BELEG_SPALTEN: BELEG_SPALTEN, STATUS: STATUS, STANDARD_REGELN: STANDARD_REGELN, STANDARD_KATEGORIEN: STANDARD_KATEGORIEN,
    zeileZuObjekt: zeileZuObjekt, objektZuZeile: objektZuZeile, normalisiereName: normalisiereName, zahl: zahl,
    alsDatum: alsDatum, isoDatum: isoDatum, deDatum: deDatum, monatVon: monatVon, regelTrifft: regelTrifft,
    wendeRegelnAn: wendeRegelnAn, bestimmeRichtung: bestimmeRichtung, istEigeneFirma: istEigeneFirma, findeDublette: findeDublette, dateiname: dateiname, baueCsv: baueCsv,
    summen: summen, exportierbar: exportierbar, betragDe: betragDe, rcArt: rcArt, ustParagraf13b: ustParagraf13b,
    erloesKategorie: erloesKategorie, nochNichtFreigegeben: nochNichtFreigegeben, zaehltFuerAuswertung: zaehltFuerAuswertung, bruttoEur: bruttoEur,
    jahresUebersicht: jahresUebersicht, laufendeKosten: laufendeKosten
  };
}

// ===== Config.gs =====

/**
 * Einstellungen. Alle Werte liegen in den Skripteigenschaften
 * (Apps-Script-Editor > Projekteinstellungen > Skripteigenschaften)
 * und lassen sich in der App unter "Einstellungen" ändern.
 */

var STANDARD_EINSTELLUNGEN = {
  FIRMA_NAME: 'PLANEGY',
  FIRMA_USTID: 'DE275026433',
  FIRMA_ORT: 'Waiblingen',
  // Weitere Merkmale der eigenen Firma, kommagetrennt (Inhaber, Straße). Hilft bei Belegen ohne Firmennamen.
  FIRMA_MERKMALE: 'Alexios Donas, Im Raisger 22',
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
  // Unsichere Fälle (Reverse Charge, Fremdwährung, KI-Sicherheit unter 0,85) automatisch mit GENAU_MODELL nachlesen
  ZWEITE_RUNDE: 'true',
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
  return {
    name: einstellung('FIRMA_NAME'), ustid: einstellung('FIRMA_USTID'), ort: einstellung('FIRMA_ORT'),
    merkmale: String(einstellung('FIRMA_MERKMALE') || '').split(',').map(function (s) { return s.trim(); }).filter(String)
  };
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

// Je Ausführung zwischengespeichert, damit ein Scan Regeln und Kategorien nicht pro Datei neu liest
var _cache = {};

function kategorienKarte() {
  if (_cache.kategorien) return _cache.kategorien;
  var werte = blatt('Kategorien').getDataRange().getValues().slice(1);
  var karte = {};
  werte.forEach(function (z) { if (z[0]) karte[String(z[0])] = String(z[1] || ''); });
  _cache.kategorien = karte;
  return karte;
}

function regelnLaden() {
  if (_cache.regeln) return _cache.regeln;
  var werte = blatt('Regeln').getDataRange().getValues().slice(1);
  return _cache.regeln = werte.filter(function (z) { return z[1]; }).map(function (z) {
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

// ===== Setup.gs =====

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

// ===== Extract.gs =====

/**
 * Auslesung von Belegen mit der Claude-API (Messages API, direkter HTTP-Aufruf,
 * weil es für Apps Script kein offizielles SDK gibt).
 * Liefert ein Objekt nach AUSLESE_SCHEMA zurück oder null, wenn kein Schlüssel hinterlegt ist.
 */

var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

var DOKUMENTARTEN = ['Rechnung', 'Quittung', 'Zahlungsbestätigung', 'Gutschrift', 'Angebot', 'Pro-forma',
  'Auftragsbestätigung', 'Bestellung', 'Lieferschein', 'Mahnung', 'Sonstiges'];

var AUSLESE_SCHEMA = {
  type: 'object',
  properties: {
    ist_beleg: { type: 'boolean', description: 'false, wenn das Dokument kein kaufmännisches Dokument ist (z. B. Newsletter, AGB, Foto ohne Beleg)' },
    dokumentart: { type: 'string', enum: DOKUMENTARTEN },
    richtung: { type: 'string', enum: ['Eingang', 'Ausgang', 'Unklar'], description: 'Eingang = die eigene Firma ist Empfänger/Käufer. Ausgang = die eigene Firma ist Aussteller/Verkäufer.' },
    aussteller_name: { type: 'string' },
    aussteller_ustid: { type: 'string', description: 'USt-IdNr. oder Steuernummer des Ausstellers, leer wenn nicht vorhanden' },
    empfaenger_name: { type: 'string' },
    empfaenger_ustid: { type: 'string' },
    rechnungsnummer: { type: 'string' },
    belegdatum: { type: 'string', description: 'Rechnungs- oder Belegdatum im Format JJJJ-MM-TT, leer wenn unbekannt' },
    leistungszeitraum: { type: 'string', description: 'Format TT.MM.JJJJ bis TT.MM.JJJJ, bei einem einzelnen Tag nur TT.MM.JJJJ, leer wenn nicht angegeben' },
    beschreibung: { type: 'string', description: 'Was wurde gekauft oder geliefert, höchstens 12 Wörter, deutsch' },
    netto: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    ust_satz: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Prozent, z. B. 19, 7 oder 0' },
    ust_betrag: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    brutto: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Zahlbetrag bzw. Gesamtbetrag' },
    waehrung: { type: 'string', description: 'ISO-Code, z. B. EUR, USD' },
    reverse_charge: { type: 'boolean', description: 'true nur bei ausdrücklichem Hinweis auf Steuerschuldnerschaft des Leistungsempfängers / reverse charge oder bei 0 % USt eines ausländischen Unternehmers, wenn die USt-IdNr. der eigenen Firma auf dem Beleg steht' },
    zahlungsart: { type: 'string', description: 'z. B. Kreditkarte, PayPal, Lastschrift, Überweisung, leer wenn unbekannt' },
    bezahlt: { type: 'string', enum: ['ja', 'nein', 'unbekannt'] },
    kategorie: { type: 'string', description: 'Eine Kategorie aus der vorgegebenen Liste' },
    bereich_vorschlag: { type: 'string', enum: ['Geschäftlich', 'Privat', 'Unklar'] },
    vertrauen: { type: 'number', description: '0 bis 1: wie sicher die Angaben sind' },
    hinweis: { type: 'string', description: 'Nur echte Auffälligkeiten, höchstens ein Satz mit 20 Wörtern, Daten immer als TT.MM.JJJJ. Leistungszeitraum, Betrag und Zahlungsart nicht wiederholen. Leer, wenn nichts auffällt.' }
  },
  required: ['ist_beleg', 'dokumentart', 'richtung', 'aussteller_name', 'aussteller_ustid', 'empfaenger_name', 'empfaenger_ustid',
    'rechnungsnummer', 'belegdatum', 'leistungszeitraum', 'beschreibung', 'netto', 'ust_satz', 'ust_betrag', 'brutto', 'waehrung',
    'reverse_charge', 'zahlungsart', 'bezahlt', 'kategorie', 'bereich_vorschlag', 'vertrauen', 'hinweis'],
  additionalProperties: false
};

function systemPrompt(kategorien) {
  var f = eigeneFirma();
  return [
    'Du liest Belege für die Buchhaltung eines deutschen Unternehmens aus.',
    'Eigene Firma: ' + f.name + ', Sitz ' + f.ort + ', USt-IdNr. ' + f.ustid + '.' +
      (f.merkmale.length ? ' Die eigene Firma erkennt man auch an: ' + f.merkmale.join(', ') + '. Ein Beleg an diese Person oder Anschrift ist an die eigene Firma gerichtet.' : ''),
    'Bestimme, wer Aussteller und wer Empfänger ist. Stellt die eigene Firma das Dokument aus, ist es ein Ausgangsbeleg.',
    'Unterscheide genau zwischen Rechnung, Quittung/Zahlungsbestätigung zu einer Rechnung, Angebot, Pro-forma, Auftragsbestätigung und Bestellung.',
    'Eine Bestellung oder Auftragsbestätigung eines Kunden an die eigene Firma ist kein Eingangsbeleg.',
    'Beträge als Zahl mit Punkt als Dezimaltrenner. Fehlende Angaben leer lassen bzw. null, nichts erfinden.',
    'Bezeichne Reverse-Charge-Fälle als Steuerschuldnerschaft nach §13b UStG, niemals als Eigenverbrauch.',
    'Schreibe Datumsangaben in Texten immer als TT.MM.JJJJ.',
    'Kategorien: ' + kategorien.join(', ') + '.',
    'Antworte nur mit dem geforderten JSON.'
  ].join('\n');
}

/**
 * blob: PDF oder Bild. kontext: { absender, betreff, text } aus der Mail.
 */
function belegAuslesen(blob, kontext, modell) {
  var schluessel = einstellung('ANTHROPIC_API_KEY');
  if (!schluessel) return null;

  var mime = blob.getContentType();
  var daten = Utilities.base64Encode(blob.getBytes());
  var block;
  if (mime === 'application/pdf') {
    block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: daten } };
  } else if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].indexOf(mime) > -1) {
    block = { type: 'image', source: { type: 'base64', media_type: mime, data: daten } };
  } else {
    throw new Error('Dateityp ' + mime + ' kann nicht ausgelesen werden');
  }

  var kategorien = Object.keys(kategorienKarte());
  var hinweis = 'Dateiname: ' + blob.getName();
  if (kontext) {
    hinweis += '\nE-Mail von: ' + (kontext.absender || '') + '\nBetreff: ' + (kontext.betreff || '');
    if (kontext.text) hinweis += '\nAuszug aus dem Mailtext:\n' + String(kontext.text).slice(0, 1500);
  }

  var body = {
    model: modell || einstellung('MODELL') || 'claude-haiku-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: AUSLESE_SCHEMA } },
    system: systemPrompt(kategorien),
    messages: [{ role: 'user', content: [block, { type: 'text', text: hinweis + '\n\nLies diesen Beleg aus.' }] }]
  };

  // Haiku hat keinen serverseitigen Rückfall auf ein anderes Modell, Opus und Sonnet schon.
  var mitRueckfall = !/haiku/.test(body.model);
  if (mitRueckfall) body.fallbacks = 'default';
  var antwort = claudeAnfrage(schluessel, body, mitRueckfall);
  if (antwort.stop_reason === 'refusal') {
    throw new Error('Claude hat die Auslesung abgelehnt');
  }
  var text = (antwort.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  if (!text) throw new Error('Leere Antwort (stop_reason ' + antwort.stop_reason + ')');
  return JSON.parse(text);
}

function claudeAnfrage(schluessel, body, mitRueckfall) {
  var optionen = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': schluessel,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  if (mitRueckfall) optionen.headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  var versuche = 0;
  while (true) {
    versuche++;
    var res = UrlFetchApp.fetch(CLAUDE_URL, optionen);
    var code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    // 429, 5xx und 529 (überlastet) wiederholen, 4xx sofort melden
    if ((code === 429 || code >= 500) && versuche < 4) {
      Utilities.sleep(2000 * Math.pow(2, versuche - 1));
      continue;
    }
    var meldung = res.getContentText();
    try { meldung = JSON.parse(meldung).error.message; } catch (e) { /* Rohtext behalten */ }
    throw new Error('Claude-API ' + code + ': ' + meldung);
  }
}

/** Überträgt die Auslesung in die Felder eines Belegs. */
function auslesungUebernehmen(beleg, x) {
  var r = bestimmeRichtung(x, eigeneFirma());
  beleg.richtung = r.richtung;
  beleg.partner = r.partner;
  beleg.partner_ustid = r.partner_ustid;
  beleg.dokumentart = x.dokumentart || '';
  beleg.rechnungsnummer = x.rechnungsnummer || '';
  beleg.belegdatum = alsDatum(x.belegdatum) || '';
  beleg.beschreibung = x.beschreibung || '';
  beleg.netto = x.netto === null ? '' : x.netto;
  beleg.ust_satz = x.ust_satz === null ? '' : x.ust_satz;
  beleg.ust_betrag = x.ust_betrag === null ? '' : x.ust_betrag;
  beleg.brutto = x.brutto === null ? '' : x.brutto;
  beleg.waehrung = (x.waehrung || 'EUR').toUpperCase();
  beleg.reverse_charge = x.reverse_charge ? 'ja' : '';
  beleg.zahlungsart = x.zahlungsart || '';
  beleg.bezahlt = x.bezahlt || '';
  beleg.leistungszeitraum = x.leistungszeitraum || '';
  var hinweise = [];
  if (beleg.richtung === 'Ausgang') {
    // Erlöskategorie nach Kunde: ohne USt oder ausländische USt-IdNr. heißt Ausland / steuerfrei
    var erloes = erloesKategorie(beleg);
    if (!x.kategorie || /^Erlöse/.test(x.kategorie)) beleg.kategorie = erloes;
    else beleg.kategorie = x.kategorie;
    if (erloes !== 'Erlöse 19 %') hinweise.push('Erlöse prüfen');
  } else {
    beleg.kategorie = x.kategorie || '';
  }
  beleg.bereich = x.bereich_vorschlag === 'Privat' ? 'Privat' : 'Geschäftlich';
  beleg.vertrauen = typeof x.vertrauen === 'number' ? Math.round(x.vertrauen * 100) / 100 : '';
  if (x.hinweis) hinweise.push(x.hinweis);
  if (x.bereich_vorschlag === 'Unklar') hinweise.push('Privat oder geschäftlich prüfen');
  if (!x.ist_beleg) { beleg.status = STATUS.AUSGESCHLOSSEN; hinweise.push('Kein Beleg'); }
  beleg.grund = hinweise.join('; ');
  return beleg;
}

// ===== Currency.gs =====

/**
 * Umrechnung in Euro mit dem EZB-Referenzkurs des Belegdatums (Frankfurter-API, Daten der EZB).
 * Der Kurs wird pro Datum und Währung 6 Stunden zwischengespeichert.
 */
function eurKurs(waehrung, datum) {
  waehrung = String(waehrung || 'EUR').toUpperCase();
  if (waehrung === 'EUR') return 1;
  var tag = isoDatum(datum) || isoDatum(new Date());
  var cacheKey = 'kurs_' + waehrung + '_' + tag;
  var cache = CacheService.getScriptCache();
  var gemerkt = cache.get(cacheKey);
  if (gemerkt) return Number(gemerkt);

  var res = UrlFetchApp.fetch('https://api.frankfurter.app/' + tag + '?from=EUR&to=' + encodeURIComponent(waehrung),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var daten = JSON.parse(res.getContentText());
  var proEuro = daten.rates && daten.rates[waehrung];
  if (!proEuro) return null;
  // Kurs = Wert einer Fremdwährungseinheit in EUR
  var kurs = Math.round((1 / proEuro) * 1000000) / 1000000;
  cache.put(cacheKey, String(kurs), 21600);
  return kurs;
}

function inEuroUmrechnen(beleg) {
  var brutto = zahl(beleg.brutto);
  if (brutto === null) return beleg;
  var kurs = null;
  try {
    kurs = eurKurs(beleg.waehrung, beleg.belegdatum);
  } catch (e) {
    protokoll('Kurs nicht abrufbar', beleg.waehrung + ' ' + e.message);
  }
  var grund = String(beleg.grund || '').split('; ').filter(function (g) { return g && g !== 'Kurs fehlt'; });
  if (kurs) {
    beleg.kurs = kurs;
    beleg.brutto_eur = Math.round(brutto * kurs * 100) / 100;
  } else {
    // Ohne Kurs fehlt der Beleg in allen Euro-Summen, deshalb sichtbar auf Prüfen
    beleg.kurs = '';
    beleg.brutto_eur = '';
    grund.push('Kurs fehlt');
    if (beleg.status === STATUS.NEU) beleg.status = STATUS.PRUEFEN;
  }
  beleg.grund = grund.join('; ');
  return beleg;
}

// ===== Store.gs =====

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

// ===== Gmail.gs =====

/**
 * Durchsucht das Postfach nach Belegen. Läuft stündlich per Zeitauslöser
 * und lässt sich in der App über "Postfach scannen" sofort starten.
 */

var BELEG_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
var LAUFZEIT_MS = 4.5 * 60 * 1000;

function postfachScannen() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { meldung: 'Ein Scan läuft bereits.' };
  var start = Date.now();
  var zaehler = { mails: 0, belege: 0, uebersprungen: 0, fehler: 0 };
  var vollstaendig = true;
  try {
    var props = PropertiesService.getScriptProperties();
    var letzter = props.getProperty('SCAN_LETZTER');
    var ab = letzter ? new Date(Number(letzter) - 2 * 86400000) : (alsDatum(einstellung('SCAN_AB')) || new Date(Date.now() - 30 * 86400000));
    var suche = einstellung('GMAIL_SUCHE') + ' after:' + Utilities.formatDate(ab, 'Europe/Berlin', 'yyyy/MM/dd');
    var maxMails = Number(einstellung('MAX_MAILS_PRO_LAUF')) || 25;
    var erledigt = verarbeiteteMails();
    var label = GmailApp.getUserLabelByName('Belege/erfasst') || GmailApp.createLabel('Belege/erfasst');
    var scanBeginn = new Date();

    var seite = 0;
    seiten:
    while (true) {
      var threads = GmailApp.search(suche, seite * 50, 50);
      if (!threads.length) break;
      for (var t = 0; t < threads.length; t++) {
        if (Date.now() - start > LAUFZEIT_MS) { vollstaendig = false; break seiten; }
        var nachrichten = threads[t].getMessages();
        var neuImThread = false;
        for (var m = 0; m < nachrichten.length; m++) {
          var msg = nachrichten[m];
          if (erledigt[msg.getId()] || msg.getDate() < ab || msg.isInTrash()) continue;
          if (zaehler.mails >= maxMails || Date.now() - start > LAUFZEIT_MS) { vollstaendig = false; break seiten; }
          zaehler.mails++;
          var ergebnis = mailVerarbeiten(msg, zaehler);
          mailAlsVerarbeitetMerken(msg.getId(), ergebnis);
          erledigt[msg.getId()] = true;
          neuImThread = true;
        }
        if (neuImThread) threads[t].addLabel(label);
      }
      seite++;
    }
    if (vollstaendig) props.setProperty('SCAN_LETZTER', String(scanBeginn.getTime()));
    var text = zaehler.mails + ' Mails geprüft, ' + zaehler.belege + ' Dateien erfasst, ' + zaehler.uebersprungen +
      ' übersprungen, ' + zaehler.fehler + ' Fehler' + (vollstaendig ? '' : '. Weitere Mails folgen im nächsten Lauf.');
    if (zaehler.mails) protokoll('Scan: ' + text);
    return { meldung: text, zaehler: zaehler, vollstaendig: vollstaendig };
  } finally {
    lock.releaseLock();
  }
}

function mailVerarbeiten(msg, zaehler) {
  var meta = {
    quelle: 'Gmail',
    absender: msg.getFrom(),
    betreff: msg.getSubject(),
    eingang: msg.getDate(),
    mail_id: msg.getId(),
    text: msg.getPlainBody()
  };
  var ergebnisse = [];
  try {
    var markiert = hatBelegLabel(msg);
    var belegBetreff = BELEG_BETREFF.test(msg.getSubject() || '');
    var alle = msg.getAttachments({ includeInlineImages: false, includeAttachments: true }).filter(istBelegAnhang);
    // Fotos nur aus Mails, die nach Beleg aussehen oder das Label "Belege" tragen.
    // Sonst landen Baustellenfotos aus Projektmails in der Auslesung.
    if (!markiert && !belegBetreff) {
      alle = alle.filter(function (a) { return a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName()); });
      // Antworten/Weiterleitungen mit vielen Anhängen sind Schriftverkehr, keine Belege
      if (/^\s*(aw|re|wg|fw|fwd)\s*:/i.test(msg.getSubject() || '') && alle.length > 3) alle = [];
    }
    var anhaenge = alle
      .map(function (a) {
        var blob = a.copyBlob().setName(a.getName());
        // Manche Absender schicken PDFs als application/octet-stream
        if (/\.pdf$/i.test(a.getName()) && blob.getContentType() !== 'application/pdf') blob.setContentType('application/pdf');
        return blob;
      });
    if (!anhaenge.length && einstellung('HTML_ALS_PDF') === 'true' && wirktWieQuittung(msg)) {
      anhaenge = [mailAlsPdf(msg)];
    }
    if (!anhaenge.length) { zaehler.uebersprungen++; return 'Kein Beleg-Anhang'; }
    anhaenge.forEach(function (a) {
      try {
        var r = dateiVerarbeiten(a, meta);
        zaehler.belege++;
        ergebnisse.push(r.id + ': ' + r.ergebnis);
      } catch (e) {
        zaehler.fehler++;
        ergebnisse.push(a.getName() + ': Fehler ' + e.message);
        protokoll('Fehler bei Anhang', a.getName() + ': ' + e.message);
      }
    });
  } catch (e) {
    zaehler.fehler++;
    protokoll('Fehler bei Mail', meta.betreff + ': ' + e.message);
    return 'Fehler: ' + e.message;
  }
  return ergebnisse.join(' | ');
}

var BELEG_BETREFF = /(rechnung|invoice|receipt|quittung|beleg|zahlungsbest|payment|gutschrift|credit note|bill|abrechnung)/i;

function hatBelegLabel(msg) {
  return msg.getThread().getLabels().some(function (l) { return /^belege$/i.test(l.getName()); });
}

function istBelegAnhang(a) {
  var mime = a.getContentType();
  if (BELEG_MIMES.indexOf(mime) < 0) return /\.pdf$/i.test(a.getName());
  if (mime.indexOf('image/') === 0) {
    // Logos und Signaturbilder auslassen
    if (a.getSize() < 30000) return false;
    if (/^(image\d*|logo|signature|outlook)/i.test(a.getName())) return false;
  }
  if (/^(agb|terms|datenschutz|privacy|widerruf)/i.test(a.getName())) return false;
  return true;
}

function wirktWieQuittung(msg) {
  var text = (msg.getSubject() + ' ' + msg.getPlainBody().slice(0, 3000)).toLowerCase();
  var hatSchlagwort = /(rechnung|invoice|receipt|quittung|zahlungsbest|payment|beleg|bestellbest|order confirmation)/.test(text);
  var hatBetrag = /(€|eur|usd|\$)\s?\d|\d[\d.,]*\s?(€|eur|usd)/.test(text);
  return hatSchlagwort && hatBetrag;
}

function mailAlsPdf(msg) {
  var kopf = '<div style="font:12px Arial;color:#444;border-bottom:1px solid #ccc;margin-bottom:12px;padding-bottom:8px">' +
    'Von: ' + htmlEsc(msg.getFrom()) + '<br>An: ' + htmlEsc(msg.getTo()) + '<br>Datum: ' +
    Utilities.formatDate(msg.getDate(), 'Europe/Berlin', 'dd.MM.yyyy HH:mm') + '<br>Betreff: ' + htmlEsc(msg.getSubject()) + '</div>';
  var html = '<html><head><meta charset="utf-8"></head><body>' + kopf + msg.getBody() + '</body></html>';
  var name = sauber(msg.getSubject() || 'mail', 60) + '.pdf';
  return Utilities.newBlob(html, 'text/html', 'mail.html').getAs('application/pdf').setName(name);
}

function htmlEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function verarbeiteteMails() {
  var b = blatt('Verarbeitet');
  var n = b.getLastRow();
  var karte = {};
  if (n < 2) return karte;
  b.getRange(2, 1, n - 1, 1).getValues().forEach(function (z) { if (z[0]) karte[z[0]] = true; });
  return karte;
}

function mailAlsVerarbeitetMerken(id, ergebnis) {
  blatt('Verarbeitet').appendRow([id, new Date(), String(ergebnis || '').slice(0, 1000)]);
}

/** Setzt den Scan zurück, sodass ab SCAN_AB erneut gesucht wird. Bereits erfasste Mails bleiben ausgelassen. */
function scanZuruecksetzen() {
  PropertiesService.getScriptProperties().deleteProperty('SCAN_LETZTER');
}

// ===== Export.gs =====

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

// ===== WebApp.gs =====

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
