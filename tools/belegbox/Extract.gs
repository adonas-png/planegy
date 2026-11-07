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
