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
  try {
    var kurs = eurKurs(beleg.waehrung, beleg.belegdatum);
    if (kurs) {
      beleg.kurs = kurs;
      beleg.brutto_eur = Math.round(brutto * kurs * 100) / 100;
    }
  } catch (e) {
    protokoll('Kurs nicht abrufbar', beleg.waehrung + ' ' + e.message);
  }
  return beleg;
}
