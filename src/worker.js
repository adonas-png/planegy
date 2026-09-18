// PLANEGY Website – Cloudflare Worker
//
// Statische Seiten liefert Cloudflare direkt aus (assets). Der Worker läuft nur
// für die Pfade aus "run_worker_first" in wrangler.jsonc:
//   /.netlify/functions/blg-publish  BabyLoveGrowth-Webhook (alter Pfad bleibt,
//                                    damit in BabyLoveGrowth nichts umzustellen ist)
//   /api/blg-publish                 derselbe Webhook unter neuem Pfad
//   /danke  (POST)                   Kontaktformular (ersetzt Netlify Forms)
//   /blog   (POST)                   Newsletter-Formular (ersetzt Netlify Forms)
//
// Formular-Mails gehen über die Brevo-API (Secret BREVO_API_KEY) von FORM_FROM an FORM_TO.

import { handleBlgPublish } from "./blg-publish.js";

// Entspricht den Sicherheits-Headern aus _headers. _headers gilt nur für
// ausgelieferte Dateien, nicht für Antworten, die der Worker selbst erzeugt.
const SECURITY_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const BLG_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://app.babylovegrowth.ai",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-BLG-Secret",
};

const MAX_FIELD_LENGTH = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/.netlify/functions/blg-publish" || url.pathname === "/api/blg-publish") {
      if (request.method === "OPTIONS") {
        return withHeaders(new Response(null, { status: 204 }), BLG_CORS_HEADERS);
      }
      return withHeaders(await handleBlgPublish(request, env), BLG_CORS_HEADERS);
    }

    if (request.method === "POST") {
      return withHeaders(await handleForm(request, env), SECURITY_HEADERS);
    }

    return env.ASSETS.fetch(request);
  },
};

function withHeaders(response, headers) {
  const res = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
  return res;
}

// ── Formulare ───────────────────────────────────────────────────────────────

async function handleForm(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const field = (name) => String(form.get(name) ?? "").trim().slice(0, MAX_FIELD_LENGTH);
  const thankYou = Response.redirect(new URL("/danke", request.url).toString(), 303);

  // Honeypot wie bei Netlify: Bots füllen das versteckte Feld aus. Stillschweigend
  // "erfolgreich" antworten, damit sie nicht weiterprobieren.
  if (field("bot-field")) return thankYou;

  const formName = field("form-name");
  let mail;

  if (formName === "kontakt") {
    const data = {
      Organisation: field("organisation"),
      Name: field("name"),
      "E-Mail": field("email"),
      Telefon: field("telefon"),
      Thema: field("thema"),
      Nachricht: field("nachricht"),
    };
    if (!data.Organisation || !data.Name || !isEmail(data["E-Mail"]) || !data.Thema || !data.Nachricht) {
      return errorPage(400, "Bitte füllen Sie alle Pflichtfelder aus und geben Sie eine gültige E-Mail-Adresse an.");
    }
    mail = {
      subject: `Kontaktformular: ${data.Thema} – ${data.Organisation}`,
      replyTo: data["E-Mail"],
      data,
    };
  } else if (formName === "newsletter") {
    const email = field("email");
    if (!isEmail(email)) {
      return errorPage(400, "Bitte geben Sie eine gültige E-Mail-Adresse an.");
    }
    mail = {
      subject: "Newsletter-Anmeldung",
      replyTo: email,
      data: { "E-Mail": email },
    };
  } else {
    return new Response("Not Found", { status: 404 });
  }

  const rows = Object.entries(mail.data);
  const text = rows.map(([k, v]) => `${k}: ${v || "–"}`).join("\n\n");
  const html =
    `<h2>${escapeHtml(mail.subject)}</h2><table cellpadding="6">` +
    rows
      .map(([k, v]) => `<tr><th align="left" valign="top">${escapeHtml(k)}</th><td>${escapeHtml(v || "–").replace(/\n/g, "<br>")}</td></tr>`)
      .join("") +
    `</table>`;

  try {
    await sendMail(env, { subject: mail.subject, replyTo: mail.replyTo, text, html });
  } catch (err) {
    console.error("Form mail failed:", formName, err.code, err.message);
    return errorPage(
      502,
      `Ihre Nachricht konnte leider nicht übermittelt werden. Bitte schreiben Sie uns direkt an <a href="mailto:${env.FORM_TO}">${env.FORM_TO}</a>.`
    );
  }

  return thankYou;
}

// Versand über Brevo (Transaktions-API). Absender-Domain planegy.de ist in Brevo authentifiziert.
async function sendMail(env, { subject, replyTo, text, html }) {
  if (!env.BREVO_API_KEY) throw Object.assign(new Error("BREVO_API_KEY fehlt"), { code: "config" });
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "PLANEGY Website", email: env.FORM_FROM },
      to: [{ email: env.FORM_TO }],
      replyTo: { email: replyTo },
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`Brevo ${res.status}: ${body.slice(0, 300)}`), { code: res.status });
  }
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorPage(status, message) {
  const body = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Nachricht nicht gesendet | PLANEGY</title>
  <style>body{font-family:Inter,system-ui,sans-serif;color:#0d2b5e;max-width:560px;margin:15vh auto;padding:0 5%;line-height:1.6}a{color:#1a7fd4}</style>
</head>
<body>
  <h1>Nachricht nicht gesendet</h1>
  <p>${message}</p>
  <p><a href="javascript:history.back()">← Zurück zum Formular</a></p>
</body>
</html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
