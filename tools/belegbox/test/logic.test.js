// Tests für Logic.gs. Ausführen: node tools/belegbox/test/logic.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const L = require(path.join(__dirname, '..', 'Logic.gs'));
const firma = { name: 'PLANEGY', ustid: 'DE275026433' };
const kategorien = { 'Software & Abos': '4964', 'Miete & Raumkosten': '4210' };
const regeln = L.STANDARD_REGELN.map(z => ({ aktiv: z[0], feld: z[1], bedingung: z[2], wert: z[3], aktion: z[4], parameter: z[5], beschreibung: z[6] }));

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('Zahlen in deutschem und englischem Format', () => {
  assert.strictEqual(L.zahl('1.234,56'), 1234.56);
  assert.strictEqual(L.zahl('1,234.56'), 1234.56);
  assert.strictEqual(L.zahl('11,90 €'), 11.9);
  assert.strictEqual(L.zahl(''), null);
});

test('Eigene Firma als Aussteller ergibt Ausgangsbeleg mit Kunde als Partner', () => {
  const r = L.bestimmeRichtung({ aussteller_name: 'PLANEGY GmbH', aussteller_ustid: 'DE 275 026 433', empfaenger_name: 'Stadtwerke Waiblingen', empfaenger_ustid: '', richtung: 'Eingang' }, firma);
  assert.strictEqual(r.richtung, 'Ausgang');
  assert.strictEqual(r.partner, 'Stadtwerke Waiblingen');
});

test('Eigene Firma als Empfänger ergibt Eingangsbeleg', () => {
  const r = L.bestimmeRichtung({ aussteller_name: 'Calendly LLC', aussteller_ustid: '', empfaenger_name: 'Planegy', empfaenger_ustid: '', richtung: 'Unklar' }, firma);
  assert.strictEqual(r.richtung, 'Eingang');
  assert.strictEqual(r.partner, 'Calendly LLC');
});

test('Angebot und Auftragsbestätigung werden ausgeschlossen', () => {
  const angebot = L.wendeRegelnAn({ status: 'Neu', dokumentart: 'Angebot', partner: 'Kunde', brutto: 8800.04, belegdatum: new Date(), richtung: 'Ausgang', vertrauen: 0.9 }, regeln, kategorien);
  assert.strictEqual(angebot.status, 'Ausgeschlossen');
  const ab = L.wendeRegelnAn({ status: 'Neu', dokumentart: 'Auftragsbestätigung', partner: 'Demag Cranes', brutto: 7395, belegdatum: new Date(), richtung: 'Eingang', vertrauen: 0.9 }, regeln, kategorien);
  assert.strictEqual(ab.status, 'Ausgeschlossen');
});

test('Regel setzt Kategorie und Kontovorschlag', () => {
  const b = L.wendeRegelnAn({ status: 'Neu', dokumentart: 'Rechnung', partner: 'Anthropic, PBC', brutto: 21.42, belegdatum: new Date(), richtung: 'Eingang', vertrauen: 0.95 }, regeln, kategorien);
  assert.strictEqual(b.kategorie, 'Software & Abos');
  assert.strictEqual(b.konto, '4964');
  assert.strictEqual(b.status, 'Neu');
});

test('Unsichere Auslesung landet auf Prüfen', () => {
  const b = L.wendeRegelnAn({ status: 'Neu', dokumentart: 'Rechnung', partner: 'X', brutto: '', belegdatum: '', richtung: 'Eingang', vertrauen: 0.4 }, regeln, kategorien);
  assert.strictEqual(b.status, 'Prüfen');
});

test('Quittung nach Rechnung wird Dublette, Rechnung bleibt', () => {
  const rechnung = { id: 'B1', status: 'Neu', partner: 'Calendly LLC', brutto: 12, waehrung: 'EUR', belegdatum: '2026-10-03', dokumentart: 'Rechnung', richtung: 'Eingang' };
  const quittung = { id: 'B2', status: 'Neu', partner: 'Calendly', brutto: 12, waehrung: 'EUR', belegdatum: '2026-10-04', dokumentart: 'Quittung', richtung: 'Eingang' };
  const d = L.findeDublette(quittung, [rechnung]);
  assert.ok(d);
  assert.strictEqual(d.beleg.id, 'B1');
  assert.strictEqual(d.behalteNeu, false);
});

test('Rechnung nach Quittung ersetzt die Quittung', () => {
  const quittung = { id: 'B1', status: 'Neu', partner: 'Netlify, Inc.', brutto: 9, waehrung: 'USD', belegdatum: '2026-10-01', dokumentart: 'Quittung', richtung: 'Eingang' };
  const rechnung = { id: 'B2', status: 'Neu', partner: 'Netlify', brutto: 9, waehrung: 'USD', belegdatum: '2026-10-01', dokumentart: 'Rechnung', richtung: 'Eingang' };
  const d = L.findeDublette(rechnung, [quittung]);
  assert.ok(d && d.behalteNeu);
});

test('Caya zweimal am selben Tag mit gleichem Betrag ist Dublette', () => {
  const a = { id: 'B1', status: 'Neu', partner: 'Caya GmbH', brutto: 34.74, waehrung: 'EUR', belegdatum: '2026-10-31', dokumentart: 'Rechnung', richtung: 'Eingang' };
  const b = { id: 'B2', status: 'Neu', partner: 'Caya GmbH', brutto: 34.74, waehrung: 'EUR', belegdatum: '2026-10-31', dokumentart: 'Rechnung', richtung: 'Eingang' };
  assert.ok(L.findeDublette(b, [a]));
});

test('Zwei Monatsrechnungen desselben Anbieters sind keine Dublette', () => {
  const okt = { id: 'B1', status: 'Neu', partner: 'GAMMA', brutto: 10, waehrung: 'EUR', belegdatum: '2026-10-02', dokumentart: 'Rechnung', richtung: 'Eingang', rechnungsnummer: 'G-100' };
  const nov = { id: 'B2', status: 'Neu', partner: 'GAMMA', brutto: 10, waehrung: 'EUR', belegdatum: '2026-11-02', dokumentart: 'Rechnung', richtung: 'Eingang', rechnungsnummer: 'G-101' };
  assert.strictEqual(L.findeDublette(nov, [okt]), null);
});

test('Gleiche Datei wird über den Hash erkannt', () => {
  assert.ok(L.findeDublette({ id: 'B2', hash: 'abc' }, [{ id: 'B1', hash: 'abc', status: 'Neu' }]));
});

test('Dateiname und CSV', () => {
  const b = { id: 'B2026-00001', richtung: 'Eingang', belegdatum: new Date(2026, 9, 3), partner: 'Anthropic, PBC', rechnungsnummer: 'INV 12/34', brutto: 21.42, waehrung: 'EUR', netto: 18, ust_satz: 19, ust_betrag: 3.42, notiz: 'Abo; Oktober' };
  assert.strictEqual(L.dateiname(b, 'pdf'), '2026-10-03_ER_Anthropic-PBC_INV-12-34_21,42EUR.pdf');
  const csv = L.baueCsv([b]);
  assert.ok(csv.startsWith('﻿Beleg-ID;'));
  assert.ok(csv.includes('03.10.2026'));
  assert.ok(csv.includes(';21,42;'));
  assert.ok(csv.includes('"Abo; Oktober"'));
});

test('Summen trennen Eingang und Ausgang', () => {
  const s = L.summen([
    { richtung: 'Eingang', brutto: 12, waehrung: 'EUR', brutto_eur: '' },
    { richtung: 'Eingang', brutto: 9, waehrung: 'USD', brutto_eur: 8.31 },
    { richtung: 'Ausgang', brutto: 2677.5, waehrung: 'EUR', brutto_eur: 2677.5 },
    { richtung: 'Eingang', brutto: 5, waehrung: 'USD', brutto_eur: '' }
  ]);
  assert.strictEqual(s.eingang, 20.31);
  assert.strictEqual(s.ausgang, 2677.5);
  assert.strictEqual(s.ohneEur, 1);
});

test('Alle .gs-Dateien lassen sich gemeinsam laden', () => {
  const dir = path.join(__dirname, '..');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const ctx = { console, module: undefined };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'projekt.gs' });
  ['einrichten', 'postfachScannen', 'monatspaketAutomatisch', 'doGet', 'appDaten', 'belegHochladen', 'dateiVerarbeiten'].forEach(f => {
    assert.strictEqual(typeof ctx[f], 'function', f + ' fehlt');
  });
  // Schema ist gültiges JSON und alle Pflichtfelder existieren
  Object.keys(ctx.AUSLESE_SCHEMA.properties).forEach(k => assert.ok(ctx.AUSLESE_SCHEMA.required.includes(k), k + ' nicht in required'));
});

test('dist ist aktuell (sonst: node tools/belegbox/build.js)', () => {
  const dir = path.join(__dirname, '..');
  const { baue } = require(path.join(dir, 'build.js'));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'dist', 'Code.gs'), 'utf8'), baue());
  assert.strictEqual(fs.readFileSync(path.join(dir, 'dist', 'Index.html'), 'utf8'), fs.readFileSync(path.join(dir, 'Index.html'), 'utf8'));
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'dist', 'Code.gs'), 'utf8'), ctx);
  assert.strictEqual(typeof ctx.einrichten, 'function');
  assert.strictEqual(ctx.STANDARD_EINSTELLUNGEN.MODELL, 'claude-haiku-5-5');
});

test('Liste bereinigen mit Daten wie in der echten Belegliste', () => {
  const dir = path.join(__dirname, '..');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const R = (id, status, dok, datum, rn, partner, brutto, hash, grund) => ({ id, status, richtung: 'Eingang', dokumentart: dok, belegdatum: datum, rechnungsnummer: rn, partner, brutto, waehrung: 'EUR', hash, grund: grund || '' });
  let daten = [
    R('B2026-00006', 'Neu', 'Rechnung', '2026-11-03', '3DZNYTMS-0010', 'Calendly LLC', 12, 'h6'),
    R('B2026-00007', 'Dublette', 'Quittung', '2026-11-03', '3DZNYTMS-0010', 'Calendly LLC', 12, 'h7'),
    R('B2026-00008', 'Neu', 'Rechnung', '2026-10-31', '5722810789', 'Google Cloud EMEA Limited', 25.3, 'h8'),
    R('B2026-00009', 'Neu', 'Rechnung', '2026-10-31', '5722810789', 'Google Cloud EMEA Limited', 25.3, 'h8'),
    R('B2026-00010', 'Neu', 'Rechnung', '2026-11-02', '202610314', 'Jan Fricke Consulting', 1487.5, 'h10'),
    R('B2026-00011', 'Neu', 'Rechnung', '2026-11-02', '202610314', 'Jan Fricke Consulting', 1487.5, 'h10'),
    R('B2026-00012', 'Neu', 'Rechnung', '2026-08-01', 'CAY441002120', 'Caya GmbH', 29.74, 'h12'),
    R('B2026-00013', 'Neu', 'Rechnung', '2026-09-01', 'CAY441012175', 'Caya GmbH', 34.74, 'h13'),
    R('B2026-00014', 'Neu', 'Rechnung', '2026-09-01', 'CAY441012175', 'Caya GmbH', 34.74, 'h13'),
    R('B2026-00015', 'Neu', 'Rechnung', '2026-10-01', 'CAY441024134', 'Caya GmbH', 34.74, 'h15'),
    R('B2026-00016', 'Dublette', 'Rechnung', '2026-10-01', 'CAY441024134', 'Caya GmbH', 34.74, 'h16'),
    R('B2026-00022', 'Ausgeschlossen', 'Sonstiges', '', '', 'Max Weishaupt SE', '', 'h22'),
    R('B2026-00023', 'Ausgeschlossen', 'Sonstiges', '', '', 'Max Weishaupt SE', '', 'h22'),
    R('B2026-00039', 'Neu', 'Rechnung', '2026-10-25', '847914815', 'HubSpot Germany GmbH', 11.9, 'h39'),
    R('B2026-00001', 'Prüfen', '', '', '', '', '', 'h1', 'Nicht ausgelesen: ANTHROPIC_API_KEY fehlt')
  ];
  const gespeichert = [];
  const nachgelesen = [];
  const ctx = {
    console, module: undefined,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.alleBelege = () => daten.map(b => b);
  ctx.belegSpeichern = b => gespeichert.push(b.id);
  ctx.dateiEinordnen = () => {};
  ctx.protokoll = () => {};
  ctx.belegNeuAuslesen = id => { nachgelesen.push(id); };
  ctx.kopfzeileSicherstellen = () => {};
  ctx.standardregelnErgaenzen = () => 0;
  ctx.inEuroUmrechnen = b => b;
  const r = ctx.listeBereinigen();
  const st = Object.fromEntries(daten.map(b => [b.id, b.status]));
  assert.deepStrictEqual(nachgelesen, ['B2026-00001']);
  ['B2026-00009', 'B2026-00011', 'B2026-00014', 'B2026-00023'].forEach(id => assert.strictEqual(st[id], 'Dublette', id));
  ['B2026-00006', 'B2026-00008', 'B2026-00010', 'B2026-00012', 'B2026-00013', 'B2026-00015', 'B2026-00039'].forEach(id => assert.notStrictEqual(st[id], 'Dublette', id));
  assert.strictEqual(r.dubletten, 4);
});

test('Jahresübersicht und laufende Kosten', () => {
  const B = (partner, datum, netto, brutto, extra) => Object.assign({ status: 'Neu', richtung: 'Eingang', dokumentart: 'Rechnung', partner, belegdatum: datum, netto, brutto, waehrung: 'EUR', kategorie: 'Software & Abos', bereich: 'Geschäftlich' }, extra || {});
  const belege = [
    B('Calendly LLC', '2026-09-03', 12, 12), B('Calendly LLC', '2026-10-03', 12, 12), B('Calendly LLC', '2026-11-03', 12, 12),
    B('Calendly LLC', '2026-11-03', 12, 12, { status: 'Dublette', dokumentart: 'Quittung' }),
    B('Caya GmbH', '2026-08-01', 24.99, 29.74, { kategorie: 'Miete & Raumkosten' }), B('Caya GmbH', '2026-09-01', 24.99, 29.74, { kategorie: 'Miete & Raumkosten' }),
    B('Jan Fricke Consulting', '2026-11-02', 1250, 1487.5, { kategorie: 'Fortbildung' }),
    B('HubSpot Germany GmbH', '2026-10-25', 10, 11.9, { waehrung: 'USD', kurs: 0.9, brutto_eur: 10.71 }),
    B('Kunde AG', '2026-10-22', 2250, 2677.5, { richtung: 'Ausgang', kategorie: 'Erlöse 19 %' }),
    B('Kunde', '2026-10-20', 8000, 8800, { richtung: 'Ausgang', dokumentart: 'Angebot', status: 'Ausgeschlossen' }),
    B('Saily', '2026-10-10', 5, 5, { bereich: 'Privat' }),
    B('Altes Abo', '2026-01-05', 10, 10), B('Altes Abo', '2026-02-05', 10, 10),
    B('Nächstes Jahr', '2027-01-05', 99, 99)
  ];
  const u = L.jahresUebersicht(belege, 2026, { stichtag: new Date(2026, 10, 6) });
  // 36 Calendly + 49,98 Caya + 1250 Fricke + 9 HubSpot + 20 altes Abo
  assert.strictEqual(u.ausgaben.netto, 1364.98);
  assert.strictEqual(u.ausgaben.brutto, 36 + 59.48 + 1487.5 + 10.71 + 20);
  assert.strictEqual(u.einnahmen.netto, 2250);
  assert.strictEqual(u.monate[10].ausgaben, 12 + 1487.5);
  assert.strictEqual(u.kategorien[0].name, 'Fortbildung');
  const mitPrivat = L.jahresUebersicht(belege, 2026, { stichtag: new Date(2026, 10, 6), mitPrivat: true });
  assert.strictEqual(mitPrivat.ausgaben.netto, 1369.98);

  const l = L.laufendeKosten(belege, { stichtag: new Date(2026, 10, 6) });
  const namen = l.posten.map(p => p.name);
  assert.ok(namen.includes('Calendly LLC') && namen.includes('Caya GmbH') && namen.includes('Altes Abo'));
  assert.ok(!namen.includes('Jan Fricke Consulting') && !namen.includes('HubSpot Germany GmbH'));
  const cal = l.posten.find(p => p.name === 'Calendly LLC');
  assert.strictEqual(cal.rhythmus, 'monatlich'); assert.strictEqual(cal.proJahrNetto, 144); assert.ok(cal.aktiv);
  assert.strictEqual(l.posten.find(p => p.name === 'Altes Abo').aktiv, false);
  // Caya: letzte Zahlung 01.09., Abstand 31 Tage -> am 06.11. überfällig, gilt als beendet
  assert.strictEqual(l.summeNetto, 144 + (l.posten.find(p => p.name === 'Caya GmbH').aktiv ? 299.88 : 0));
});

test('Monatspaket nur mit freigegebenen Belegen', () => {
  assert.strictEqual(L.exportierbar({ status: 'Neu' }), false);
  assert.strictEqual(L.exportierbar({ status: 'Prüfen' }), false);
  assert.strictEqual(L.exportierbar({ status: 'Freigegeben' }), true);
  assert.strictEqual(L.exportierbar({ status: 'Übermittelt' }), true);
  assert.strictEqual(L.nochNichtFreigegeben({ status: 'Neu' }), true);
});

test('Reverse Charge nach EU und Drittland', () => {
  const google = { reverse_charge: 'ja', partner_ustid: 'IE3668997OH', netto: 25.3, waehrung: 'EUR' };
  const calendly = { reverse_charge: 'ja', partner_ustid: 'EU372082401', netto: 12, waehrung: 'EUR' };
  const hubspotUsd = { reverse_charge: 'ja', partner_ustid: '', netto: 10, waehrung: 'USD', kurs: 0.9 };
  assert.strictEqual(L.rcArt(google), 'EU §13b Abs. 1');
  assert.strictEqual(L.rcArt(calendly), 'Drittland §13b Abs. 2');
  assert.strictEqual(L.rcArt({ reverse_charge: '' }), '');
  assert.strictEqual(L.ustParagraf13b(google), 4.81);
  assert.strictEqual(L.ustParagraf13b(hubspotUsd), 1.71);
  const csv = L.baueCsv([Object.assign({ id: 'B1', belegdatum: '2026-10-31', brutto: 25.3 }, google)]);
  assert.ok(csv.includes('EU §13b Abs. 1;4,81;'));
});

test('Erlöskategorie nach Kunde', () => {
  assert.strictEqual(L.erloesKategorie({ ust_satz: 19, partner_ustid: 'DE123456789' }), 'Erlöse 19 %');
  assert.strictEqual(L.erloesKategorie({ ust_satz: 19, partner_ustid: '' }), 'Erlöse 19 %');
  assert.strictEqual(L.erloesKategorie({ ust_satz: 0, partner_ustid: '' }), 'Erlöse Ausland / steuerfrei');
  assert.strictEqual(L.erloesKategorie({ ust_satz: 19, partner_ustid: 'ATU12345678' }), 'Erlöse Ausland / steuerfrei');
});

test('Eigene Firma über Merkmale erkennen', () => {
  const f = { name: 'PLANEGY', ustid: 'DE275026433', merkmale: ['Alexios Donas', 'Im Raisger 22'] };
  assert.ok(L.istEigeneFirma('Alexios Donas', '', f));
  assert.ok(L.istEigeneFirma('Planegy Alexios Donas', '', f));
  assert.ok(!L.istEigeneFirma('Caya GmbH', '', f));
  const r = L.bestimmeRichtung({ aussteller_name: 'Caya GmbH', aussteller_ustid: 'DE311355906', empfaenger_name: 'Alexios Donas', empfaenger_ustid: '', richtung: 'Unklar' }, f);
  assert.strictEqual(r.richtung, 'Eingang');
});

test('Zweite Auslesung bei unsicheren Belegen und fehlender Kurs', () => {
  const dir = path.join(__dirname, '..');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const einst = { MODELL: 'claude-haiku-5-5', GENAU_MODELL: 'claude-opus-5-5', ZWEITE_RUNDE: 'true' };
  ctx.einstellung = k => einst[k] || '';
  ctx.protokoll = () => {};
  const aufrufe = [];
  let antwort = {};
  ctx.belegAuslesen = (blob, meta, modell) => { aufrufe.push(modell || 'standard'); return Object.assign({ ist_beleg: true }, antwort, modell ? { vertrauen: 0.97 } : {}); };
  const blob = { getName: () => 'x.pdf' };
  antwort = { reverse_charge: false, waehrung: 'EUR', vertrauen: 0.95 };
  ctx.auslesenMitZweiterRunde(blob, {});
  assert.deepStrictEqual(aufrufe, ['standard']);
  aufrufe.length = 0; antwort = { reverse_charge: true, waehrung: 'EUR', vertrauen: 0.95 };
  const x = ctx.auslesenMitZweiterRunde(blob, {});
  assert.deepStrictEqual(aufrufe, ['standard', 'claude-opus-5-5']);
  assert.strictEqual(x._zweiteRunde, 'claude-opus-5-5');
  aufrufe.length = 0; antwort = { reverse_charge: false, waehrung: 'USD', vertrauen: 0.95 };
  ctx.auslesenMitZweiterRunde(blob, {});
  assert.strictEqual(aufrufe.length, 2);
  aufrufe.length = 0; antwort = { ist_beleg: false, vertrauen: 0.3 };
  ctx.auslesenMitZweiterRunde(blob, {});
  assert.strictEqual(aufrufe.length, 1);

  ctx.eurKurs = () => null;
  const b = ctx.inEuroUmrechnen({ status: 'Neu', brutto: 9, waehrung: 'USD', grund: 'x' });
  assert.strictEqual(b.status, 'Prüfen'); assert.strictEqual(b.grund, 'x; Kurs fehlt');
  ctx.eurKurs = () => 0.9;
  const c = ctx.inEuroUmrechnen(b);
  assert.strictEqual(c.brutto_eur, 8.1); assert.strictEqual(c.grund, 'x');
});

test('Seite enthält gültige Rechenregeln für den Browser', () => {
  const dir = path.join(__dirname, '..');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const browser = { };
  vm.createContext(browser);
  vm.runInContext('var STATUS = ' + JSON.stringify(ctx.STATUS) + ';\n' + ctx.gemeinsameFunktionen(), browser);
  assert.strictEqual(browser.bruttoEur({ brutto: 12, waehrung: 'EUR', dokumentart: 'Gutschrift' }), -12);
  assert.strictEqual(browser.zaehltFuerAuswertung({ status: 'Prüfen', dokumentart: 'Rechnung' }), true);
  assert.strictEqual(browser.zaehltFuerAuswertung({ status: 'Dublette', dokumentart: 'Rechnung' }), false);
});

console.log(n + ' Tests bestanden');
