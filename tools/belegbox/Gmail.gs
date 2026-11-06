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
