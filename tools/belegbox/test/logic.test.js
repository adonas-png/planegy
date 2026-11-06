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
  const r = ctx.listeBereinigen();
  const st = Object.fromEntries(daten.map(b => [b.id, b.status]));
  assert.deepStrictEqual(nachgelesen, ['B2026-00001']);
  ['B2026-00009', 'B2026-00011', 'B2026-00014', 'B2026-00023'].forEach(id => assert.strictEqual(st[id], 'Dublette', id));
  ['B2026-00006', 'B2026-00008', 'B2026-00010', 'B2026-00012', 'B2026-00013', 'B2026-00015', 'B2026-00039'].forEach(id => assert.notStrictEqual(st[id], 'Dublette', id));
  assert.strictEqual(r.dubletten, 4);
});

console.log(n + ' Tests bestanden');
