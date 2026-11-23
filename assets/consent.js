/* PLANEGY – Einwilligung (Consent Mode v2) und Google Analytics 4
 *
 * Ablauf:
 * - Consent Mode v2 startet mit "denied" für alle Kategorien.
 * - gtag.js (googletagmanager.com) wird ERST nach Klick auf "Akzeptieren" geladen.
 *   Vorher geht keine Anfrage an Google.
 * - Die Auswahl liegt in localStorage ("planegy-consent"). Ohne gespeicherte
 *   Auswahl erscheint das Banner mit zwei gleichwertigen Schaltflächen.
 * - Jeder Link mit data-consent-settings (im Footer "Cookie-Einstellungen")
 *   öffnet das Banner erneut. Fehlt der Link, ergänzt ihn dieses Skript neben
 *   dem Datenschutz-Link im Footer.
 * - Widerruf: Analytics-Cookies werden gelöscht, die Seite neu geladen.
 */
(function () {
  'use strict';

  var GA_ID = 'G-L0BF5S01KH';
  var STORAGE_KEY = 'planegy-consent';
  var CONSENT_VERSION = 1; // erhöhen, wenn sich der Umfang ändert -> Banner erscheint neu

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted'
  });

  function readChoice() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && data.v === CONSENT_VERSION ? data.analytics : null;
    } catch (e) {
      return null;
    }
  }

  function saveChoice(analytics) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, analytics: analytics, date: new Date().toISOString() }));
    } catch (e) { /* ohne Speicher gilt die Auswahl nur für diese Seite */ }
  }

  var gaLoaded = false;
  function loadAnalytics() {
    if (gaLoaded) return;
    gaLoaded = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_ID);
  }

  function deleteAnalyticsCookies() {
    var host = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (name === '_ga' || name.indexOf('_ga_') === 0 || name === '_gid' || name === '_gat') {
        ['', '; domain=' + host, '; domain=.' + host].forEach(function (d) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d;
        });
      }
    });
  }

  /* --- Banner --- */
  var CSS =
    '#pl-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;' +
    'background:#fff;color:#0d2b5e;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 10px 40px rgba(13,43,94,.18);' +
    'padding:20px 22px;font:15px/1.55 Inter,system-ui,-apple-system,Segoe UI,sans-serif}' +
    '#pl-consent h2{font-size:1.05rem;font-weight:700;margin:0 0 .4rem;color:#0d2b5e;border:0;padding:0;display:block}' +
    '#pl-consent p{margin:0 0 1rem;color:#374151;font-size:.9rem}' +
    '#pl-consent a{color:#1a7fd4}' +
    '#pl-consent .pl-btns{display:flex;gap:10px;flex-wrap:wrap}' +
    '#pl-consent button{flex:1 1 160px;min-height:44px;padding:.65rem 1rem;border-radius:10px;font:inherit;font-weight:700;' +
    'cursor:pointer;background:#0d2b5e;color:#fff;border:2px solid #0d2b5e}' +
    '#pl-consent button:hover{background:#1a4a8a;border-color:#1a4a8a}' +
    '#pl-consent button:focus-visible{outline:3px solid #3b9ae1;outline-offset:2px}';

  function showBanner() {
    var existing = document.getElementById('pl-consent');
    if (existing) { existing.querySelector('button').focus(); return; }

    if (!document.getElementById('pl-consent-css')) {
      var style = document.createElement('style');
      style.id = 'pl-consent-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    var box = document.createElement('div');
    box.id = 'pl-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', 'pl-consent-title');
    box.setAttribute('aria-describedby', 'pl-consent-text');
    box.innerHTML =
      '<h2 id="pl-consent-title">Reichweitenmessung</h2>' +
      '<p id="pl-consent-text">Mit Ihrer Einwilligung messen wir mit Google Analytics, welche Seiten gelesen werden. ' +
      'Dabei setzt Google Cookies und erhält Ihre IP-Adresse; eine Übermittlung in die USA ist möglich. ' +
      'Ohne Einwilligung findet keine Messung statt. Sie können Ihre Auswahl jederzeit über ' +
      '„Cookie-Einstellungen“ im Footer ändern. Details in der <a href="/datenschutz#analytics">Datenschutzerklärung</a>.</p>' +
      '<div class="pl-btns">' +
      '<button type="button" data-choice="denied">Ablehnen</button>' +
      '<button type="button" data-choice="granted">Akzeptieren</button>' +
      '</div>';

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-choice]');
      if (!btn) return;
      var granted = btn.getAttribute('data-choice') === 'granted';
      var before = readChoice();
      saveChoice(granted);
      box.remove();
      if (granted) {
        loadAnalytics();
      } else if (before === true || gaLoaded) {
        gtag('consent', 'update', { analytics_storage: 'denied' });
        deleteAnalyticsCookies();
        location.reload(); // gtag.js ist geladen und lässt sich nur so vollständig stoppen
      }
    });

    document.body.appendChild(box);
  }

  /* --- Link "Cookie-Einstellungen" im Footer --- */
  function ensureSettingsLink() {
    if (document.querySelector('[data-consent-settings]')) return;
    var footer = document.querySelector('footer');
    if (!footer) return;
    var links = footer.querySelectorAll('a[href="/datenschutz"], a[href="datenschutz.html"], a[href="/datenschutz.html"]');
    if (!links.length) return;
    var ref = links[links.length - 1];
    var a = ref.cloneNode(false);
    a.setAttribute('href', '#cookie-einstellungen');
    a.setAttribute('data-consent-settings', '');
    a.textContent = 'Cookie-Einstellungen';
    var wrap = ref.parentElement && ref.parentElement.tagName === 'LI' ? ref.parentElement : null;
    if (wrap) {
      var li = document.createElement('li');
      li.appendChild(a);
      wrap.after(li);
    } else {
      ref.after(document.createTextNode(' '), a);
    }
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('[data-consent-settings]');
    if (!link) return;
    e.preventDefault();
    showBanner();
  });

  function init() {
    ensureSettingsLink();
    var choice = readChoice();
    if (choice === true) loadAnalytics();
    else if (choice === null) showBanner();
    if (location.hash === '#cookie-einstellungen') showBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
