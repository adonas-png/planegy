// BabyLoveGrowth → PLANEGY Blog Auto-Publisher
// Receives article from BabyLoveGrowth, generates HTML,
// commits to GitHub (source control) AND deploys directly to Netlify (goes live immediately).
//
// Required Netlify Environment Variables:
//   GITHUB_TOKEN       – GitHub Personal Access Token (repo scope)
//   GITHUB_REPO        – e.g. "adonas-png/planegy" (owner/repo)
//   GITHUB_BRANCH      – e.g. "main"
//   BLG_WEBHOOK_SECRET – A secret string you also enter in BabyLoveGrowth settings
//   NETLIFY_API_TOKEN  – Netlify personal access token
//   NETLIFY_SITE_ID    – Netlify site ID (d1e13ef4-cc11-46e7-9f71-54ee1a9255a7)

const https = require("https");
const crypto = require("crypto");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const WEBHOOK_SECRET = process.env.BLG_WEBHOOK_SECRET;
const NETLIFY_TOKEN = process.env.NETLIFY_API_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;

// ── GitHub API helpers ──────────────────────────────────────────────────────

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const options = {
      hostname: "api.github.com",
      path: `/repos/${GITHUB_REPO}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "PLANEGY-Blog-Webhook",
      },
    };
    if (payload) options.headers["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getFile(filePath) {
  const res = await githubRequest("GET", `/contents/${filePath}?ref=${GITHUB_BRANCH}`, null);
  if (res.status === 200) {
    return {
      content: Buffer.from(res.data.content, "base64").toString("utf-8"),
      sha: res.data.sha,
    };
  }
  return null;
}

async function putFile(filePath, content, message, sha) {
  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  return githubRequest("PUT", `/contents/${filePath}`, body);
}

// Commit multiple files in a single atomic commit, so a single push (and a
// single GitHub Actions deploy) carries all the changes for one article.
// Two separate commits (article + blog.html) each trigger their own deploy;
// out-of-order CI runs can then let the older deploy overwrite the newer one.
//
// buildFiles() is called fresh on every attempt so a retry re-reads blog.html
// from the latest commit instead of overwriting a concurrent change with a
// stale copy — needed if two articles get published within moments of each
// other and both try to move the branch ref at once.
async function commitFilesAtomic(buildFiles, message, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const refRes = await githubRequest("GET", `/git/ref/heads/${GITHUB_BRANCH}`, null);
    if (refRes.status !== 200) throw new Error("Cannot read branch ref: " + JSON.stringify(refRes.data));
    const latestCommitSha = refRes.data.object.sha;

    const commitRes = await githubRequest("GET", `/git/commits/${latestCommitSha}`, null);
    if (commitRes.status !== 200) throw new Error("Cannot read latest commit: " + JSON.stringify(commitRes.data));
    const baseTreeSha = commitRes.data.tree.sha;

    const files = await buildFiles();

    const treeRes = await githubRequest("POST", "/git/trees", {
      base_tree: baseTreeSha,
      tree: Object.entries(files).map(([path, content]) => ({
        path,
        mode: "100644",
        type: "blob",
        content,
      })),
    });
    if (treeRes.status !== 200 && treeRes.status !== 201) {
      throw new Error("Cannot create tree: " + JSON.stringify(treeRes.data));
    }

    const newCommitRes = await githubRequest("POST", "/git/commits", {
      message,
      tree: treeRes.data.sha,
      parents: [latestCommitSha],
    });
    if (newCommitRes.status !== 200 && newCommitRes.status !== 201) {
      throw new Error("Cannot create commit: " + JSON.stringify(newCommitRes.data));
    }

    const updateRefRes = await githubRequest("PATCH", `/git/refs/heads/${GITHUB_BRANCH}`, {
      sha: newCommitRes.data.sha,
    });
    if (updateRefRes.status === 200) {
      return newCommitRes.data.sha;
    }

    if (attempt === maxAttempts) {
      throw new Error(`Cannot update branch ref after ${maxAttempts} attempts: ` + JSON.stringify(updateRefRes.data));
    }
    console.warn(`Ref moved concurrently, retrying commit (attempt ${attempt + 1}/${maxAttempts})`);
  }
}

// ── Netlify Deploy API ──────────────────────────────────────────────────────

function netlifyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const options = {
      hostname: "api.netlify.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "PLANEGY-Blog-Webhook",
      },
    };
    if (payload) options.headers["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function netlifyUploadFile(deployId, filePath, content) {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.from(content, "utf-8");
    const options = {
      hostname: "api.netlify.com",
      path: `/api/v1/deploys/${deployId}/files${filePath}`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": buffer.length,
        "User-Agent": "PLANEGY-Blog-Webhook",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

async function deployToNetlify(changedFiles) {
  // changedFiles = { "blog-slug.html": "html content", "blog.html": "html content" }

  // 1. Get the currently PUBLISHED deploy (not just the latest — failed deploys have 0 files)
  const siteRes = await netlifyRequest("GET", `/api/v1/sites/${NETLIFY_SITE_ID}`);
  if (siteRes.status !== 200 || !siteRes.data.published_deploy) {
    throw new Error("Cannot get site info: " + JSON.stringify(siteRes.data));
  }
  const currentDeployId = siteRes.data.published_deploy.id;
  console.log("Using published deploy:", currentDeployId);

  const filesRes = await netlifyRequest("GET", `/api/v1/deploys/${currentDeployId}/files`);

  // 2. Build file map from existing deploy, then override with new/changed files
  const fileMap = {};
  if (filesRes.status === 200 && Array.isArray(filesRes.data)) {
    for (const f of filesRes.data) {
      fileMap[f.id] = f.sha; // id is like "/index.html"
    }
  }

  const newFileShas = {};
  for (const [name, content] of Object.entries(changedFiles)) {
    const sha1 = crypto.createHash("sha1").update(Buffer.from(content, "utf-8")).digest("hex");
    fileMap["/" + name] = sha1;
    newFileShas[sha1] = { name, content };
  }

  // 3. Create new deploy with full file map
  const newDeployRes = await netlifyRequest("POST", `/api/v1/sites/${NETLIFY_SITE_ID}/deploys`, { files: fileMap });
  if (newDeployRes.status !== 200 && newDeployRes.status !== 201) {
    throw new Error("Cannot create Netlify deploy: " + JSON.stringify(newDeployRes.data));
  }

  const newDeployId = newDeployRes.data.id;
  const required = newDeployRes.data.required || [];
  console.log(`Netlify deploy ${newDeployId} created, uploading ${required.length} file(s)`);

  // 4. Upload only files Netlify doesn't already have cached
  for (const sha of required) {
    if (newFileShas[sha]) {
      const { name, content } = newFileShas[sha];
      const upRes = await netlifyUploadFile(newDeployId, "/" + name, content);
      console.log(`Uploaded /${name} → status ${upRes.status}`);
    }
  }

  console.log("Netlify deploy complete — site will be live within seconds");
}

// ── HTML generators ─────────────────────────────────────────────────────────

const CAT_STYLE = {
  waerme:     { emoji: "🌡️", grad: "linear-gradient(135deg,#0d2b5e,#1a7fd4)", color: "#1a7fd4", label: "Wärmeplanung" },
  foerderung: { emoji: "💶", grad: "linear-gradient(135deg,#1e3a5f,#1a7fd4)", color: "#1a7fd4", label: "Förderung" },
  esg:        { emoji: "📊", grad: "linear-gradient(135deg,#3b0764,#7c3aed)", color: "#7c3aed", label: "ESG / CSRD" },
  compliance: { emoji: "🛡️", grad: "linear-gradient(135deg,#7f1d1d,#dc2626)", color: "#dc2626", label: "Compliance" },
  biolpg:     { emoji: "🌿", grad: "linear-gradient(135deg,#064e3b,#059669)", color: "#059669", label: "BioLPG" },
  default:    { emoji: "⚡", grad: "linear-gradient(135deg,#0d2b5e,#1a7fd4)", color: "#1a7fd4", label: "Energie" },
};

function detectCategory(title = "", tags = []) {
  const text = (title + " " + tags.join(" ")).toLowerCase();
  if (text.includes("wärme") || text.includes("waerme") || text.includes("bhkw") || text.includes("heiz")) return "waerme";
  if (text.includes("förder") || text.includes("bew") || text.includes("kfw") || text.includes("bafa")) return "foerderung";
  if (text.includes("esg") || text.includes("csrd") || text.includes("iso 50001") || text.includes("nachhaltig")) return "esg";
  if (text.includes("explosion") || text.includes("bimsch") || text.includes("compliance") || text.includes("sicherheit")) return "compliance";
  if (text.includes("biolpg") || text.includes("bio-lpg") || text.includes("biopropa") || text.includes("flüssiggas")) return "biolpg";
  return "default";
}

function estimateReadTime(html = "") {
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(words / 200));
}

function removeBranding(html = "") {
  return html
    .replace(/<(div|section|p|blockquote)[^>]*>(?:(?!<\/\1>)[\s\S])*?babylovegrowth[\s\S]*?<\/\1>/gi, "")
    .replace(/[^<]*?Artikel erstellt mit BabyLoveGrowth[^<]*/gi, "")
    .replace(/[^<]*?erstellt mit BabyLoveGrowth[^<]*/gi, "")
    .replace(/[^<]*?BabyLoveGrowth[^<]*/gi, "")
    .replace(/<(p|div|span)[^>]*>\s*<\/\1>/gi, "")
    .trim();
}

function toSlug(str = "") {
  return str
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function generateArticleHtml({ title, slug, content_html, metaDescription, category, catStyle, readTime, dateStr }) {
  const schemaDate = new Date(dateStr || Date.now()).toISOString().split("T")[0];
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} – PLANEGY</title>
  <meta name="description" content="${(metaDescription || "").replace(/"/g, "&quot;")}" />
  <meta name="author" content="Alexios Donas, PLANEGY" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${(metaDescription || "").replace(/"/g, "&quot;")}" />
  <link rel="canonical" href="https://www.planegy.de/blog-${slug}" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${title.replace(/"/g, '\\"')}",
    "author": { "@type": "Person", "name": "Alexios Donas" },
    "publisher": { "@type": "Organization", "name": "PLANEGY", "url": "https://www.planegy.de" },
    "datePublished": "${schemaDate}",
    "description": "${(metaDescription || "").replace(/"/g, '\\"')}"
  }
  <\/script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=DM+Sans:wght@700;800&display=swap" rel="stylesheet" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%231a7fd4'/><text y='.9em' font-size='75' x='12'>⚡</text></svg>" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --blue:#1a7fd4; --blue-l:#3b9ae1; --blue-d:#1565b0; --navy:#0d2b5e; --slate:#64748b; --border:#e2e8f0; --off:#f8fafc; }
    html { scroll-behavior: smooth; }
    body { font-family:'Inter',sans-serif; color:var(--navy); background:#fff; -webkit-font-smoothing:antialiased; }
    nav { background:var(--navy); padding:0 5%; display:flex; align-items:center; justify-content:space-between; height:70px; position:sticky; top:0; z-index:100; }
    .nav-logo { font-family:'DM Sans',sans-serif; font-size:1.4rem; font-weight:800; color:#fff; text-decoration:none; letter-spacing:-.5px; }
    .nav-logo span { color:var(--blue-l); }
    .nav-back { font-size:.85rem; color:rgba(255,255,255,.6); text-decoration:none; display:flex; align-items:center; gap:.4rem; transition:color .2s; }
    .nav-back:hover { color:#fff; }
    .article-hero { background:${catStyle.grad}; padding:70px 5% 60px; position:relative; overflow:hidden; }
    .article-hero::before { content:"${catStyle.emoji}"; position:absolute; right:8%; top:50%; transform:translateY(-50%); font-size:14rem; opacity:.07; line-height:1; pointer-events:none; }
    .hero-inner { max-width:860px; margin:0 auto; position:relative; z-index:1; }
    .breadcrumb { display:flex; align-items:center; gap:.5rem; margin-bottom:1.5rem; font-size:.8rem; }
    .breadcrumb a { color:rgba(255,255,255,.5); text-decoration:none; }
    .breadcrumb a:hover { color:rgba(255,255,255,.9); }
    .breadcrumb span { color:rgba(255,255,255,.3); }
    .article-cat { display:inline-block; background:${catStyle.color}; color:#fff; font-size:.72rem; font-weight:700; padding:.3rem .8rem; border-radius:4px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:1rem; }
    .article-hero h1 { font-family:'DM Sans',sans-serif; font-size:clamp(1.6rem,3.5vw,2.4rem); font-weight:800; color:#fff; line-height:1.15; letter-spacing:-.02em; margin-bottom:1rem; }
    .article-meta { display:flex; align-items:center; gap:1.5rem; flex-wrap:wrap; }
    .article-meta span { font-size:.82rem; color:rgba(255,255,255,.55); }
    .article-meta strong { color:rgba(255,255,255,.8); }
    .article-layout { max-width:1100px; margin:0 auto; padding:60px 5% 80px; display:grid; grid-template-columns:1fr 280px; gap:4rem; align-items:start; }
    .article-body { min-width:0; }
    .prose h2 { font-family:'DM Sans',sans-serif; font-size:1.4rem; font-weight:800; color:var(--navy); margin:2.5rem 0 .8rem; padding-bottom:.5rem; border-bottom:2px solid var(--blue); display:inline-block; }
    .prose h3 { font-size:1.05rem; font-weight:700; color:var(--navy); margin:1.5rem 0 .5rem; }
    .prose p { font-size:.97rem; color:#374151; line-height:1.85; margin-bottom:1rem; }
    .prose ul,.prose ol { padding-left:1.5rem; margin-bottom:1rem; }
    .prose li { font-size:.95rem; color:#374151; line-height:1.75; margin-bottom:.4rem; }
    .prose strong { color:var(--navy); font-weight:700; }
    .prose a { color:var(--blue); text-decoration:none; }
    .prose a:hover { text-decoration:underline; }
    .prose table { width:100%; border-collapse:collapse; margin:1.5rem 0; font-size:.88rem; }
    .prose th { background:var(--navy); color:#fff; padding:.75rem 1rem; text-align:left; font-weight:600; }
    .prose td { padding:.65rem 1rem; border-bottom:1px solid var(--border); color:#374151; }
    .prose tr:nth-child(even) td { background:var(--off); }
    .sidebar { position:sticky; top:90px; }
    .sidebar-card { background:var(--off); border:1px solid var(--border); border-radius:14px; padding:1.5rem; margin-bottom:1.2rem; }
    .sidebar-card h3 { font-family:'DM Sans',sans-serif; font-size:.95rem; font-weight:800; color:var(--navy); margin-bottom:1rem; }
    .author-card { text-align:center; }
    .author-avatar { width:70px; height:70px; border-radius:50%; background:linear-gradient(135deg,var(--navy),var(--blue)); display:flex; align-items:center; justify-content:center; font-size:2rem; margin:0 auto 1rem; }
    .author-name { font-weight:700; font-size:.92rem; color:var(--navy); }
    .author-role { font-size:.78rem; color:var(--slate); margin-top:.2rem; }
    .author-cta { display:block; margin-top:1rem; background:var(--blue); color:#fff; text-decoration:none; padding:.6rem; border-radius:8px; font-size:.82rem; font-weight:700; text-align:center; transition:background .2s; }
    .author-cta:hover { background:var(--blue-d); }
    .cta-banner { background:linear-gradient(135deg,var(--navy),#1a4a8a); border-radius:16px; padding:2.5rem; margin-top:3rem; text-align:center; }
    .cta-banner h3 { font-family:'DM Sans',sans-serif; font-size:1.2rem; font-weight:800; color:#fff; margin-bottom:.5rem; }
    .cta-banner p { color:rgba(255,255,255,.6); font-size:.88rem; margin-bottom:1.2rem; }
    .cta-banner a { background:var(--blue); color:#fff; text-decoration:none; padding:.75rem 1.5rem; border-radius:10px; font-weight:700; font-size:.9rem; display:inline-block; transition:background .2s; }
    .cta-banner a:hover { background:var(--blue-d); }
    footer { background:var(--navy); padding:30px 5%; text-align:center; }
    footer p { font-size:.82rem; color:rgba(255,255,255,.4); }
    footer a { color:rgba(255,255,255,.5); text-decoration:none; margin:0 .7rem; }
    footer a:hover { color:var(--blue-l); }
    @media(max-width:900px) { .article-layout { grid-template-columns:1fr; } .sidebar { position:static; } }
  </style>
</head>
<body>

<nav>
  <a href="index.html" class="nav-logo">PLAN<span>EGY</span></a>
  <a href="blog.html" class="nav-back">← Zurück zum Blog</a>
</nav>

<div class="article-hero">
  <div class="hero-inner">
    <div class="breadcrumb">
      <a href="index.html">Startseite</a>
      <span>/</span>
      <a href="blog.html">Blog</a>
      <span>/</span>
      <span style="color:rgba(255,255,255,.7)">${title}</span>
    </div>
    <div class="article-cat">${catStyle.label}</div>
    <h1>${title}</h1>
    <div class="article-meta">
      <span>📅 <strong>${formatDate(dateStr)}</strong></span>
      <span>⏱ <strong>${readTime} Min. Lesezeit</strong></span>
      <span>👤 <strong>Alexios Donas</strong>, PLANEGY</span>
    </div>
  </div>
</div>

<div class="article-layout">
  <article class="article-body">
    <div class="prose">
      ${content_html}
    </div>
    <div class="cta-banner">
      <h3>⚡ Kostenlose Erstberatung anfragen</h3>
      <p>Wir analysieren Ihre spezifische Situation und zeigen konkrete Handlungsoptionen.</p>
      <a href="index.html#kontakt">Jetzt Termin vereinbaren →</a>
    </div>
  </article>
  <aside class="sidebar">
    <div class="sidebar-card author-card">
      <div class="author-avatar">👨‍💼</div>
      <div class="author-name">Alexios Donas</div>
      <div class="author-role">Energieberater & Gründer PLANEGY<br/>Zertifiziert: BAFA, dena, BEG, WP</div>
      <a href="index.html#kontakt" class="author-cta">Beratung anfragen</a>
    </div>
    <div class="sidebar-card">
      <h3>📌 Mehr entdecken</h3>
      <p style="font-size:.82rem;color:var(--slate);line-height:1.6">Weitere Fachartikel zu Energie, Wärmeplanung und Nachhaltigkeit im PLANEGY Blog.</p>
      <a href="blog.html" style="display:block;margin-top:.8rem;color:var(--blue);font-size:.85rem;font-weight:700;text-decoration:none">→ Alle Artikel</a>
    </div>
  </aside>
</div>

<footer>
  <p>
    <a href="index.html">Startseite</a>
    <a href="blog.html">Blog</a>
    <a href="impressum.html">Impressum</a>
    <a href="datenschutz.html">Datenschutz</a>
  </p>
  <p style="margin-top:.8rem">© ${new Date().getFullYear()} PLANEGY – Alexios Donas · Waiblingen</p>
</footer>

</body>
</html>`;
}

function generateArticleCard({ title, slug, excerpt, category, catStyle, dateStr, readTime }) {
  return `
    <a href="blog-${slug}.html" class="article-card" data-cat="${category}">
      <div class="article-thumb" style="background:${catStyle.grad}">${catStyle.emoji}</div>
      <div class="article-body">
        <div class="article-cat">${catStyle.label}</div>
        <div class="article-title">${title}</div>
        <p class="article-excerpt">${excerpt}</p>
        <div class="article-footer">
          <span class="article-meta">${formatDate(dateStr)} · ${readTime} Min.</span>
          <span class="article-read">Lesen →</span>
        </div>
      </div>
    </a>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const authHeader = event.headers["x-blg-secret"] || event.headers["authorization"] || "";
  if (WEBHOOK_SECRET && authHeader.replace("Bearer ", "") !== WEBHOOK_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const {
    title,
    slug: rawSlug,
    content_html = "",
    metaDescription = "",
    tags = [],
    published_at,
  } = payload;

  if (!title || !content_html) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing title or content_html" }) };
  }

  const cleanHtml = removeBranding(content_html);
  const slug = rawSlug || toSlug(title);
  const category = detectCategory(title, tags);
  const catStyle = CAT_STYLE[category] || CAT_STYLE.default;
  const readTime = estimateReadTime(cleanHtml);
  const dateStr = published_at || new Date().toISOString();

  const plainText = cleanHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const excerpt = metaDescription || plainText.slice(0, 160) + (plainText.length > 160 ? "…" : "");

  const articleFileName = `blog-${slug}.html`;
  const articleHtml = generateArticleHtml({ title, slug, content_html: cleanHtml, metaDescription: excerpt, category, catStyle, readTime, dateStr });

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("GitHub credentials not configured — skipping commit. Set GITHUB_TOKEN and GITHUB_REPO.");
    return { statusCode: 200, body: JSON.stringify({ success: true, file: articleFileName, slug, warning: "GitHub not configured" }) };
  }

  try {
    // Re-read blog.html on every attempt so a retry (see commitFilesAtomic)
    // injects the card into the latest content instead of a stale copy.
    const buildFiles = async () => {
      const filesToCommit = { [articleFileName]: articleHtml };
      const blogFile = await getFile("blog.html");
      if (blogFile) {
        const newCard = generateArticleCard({ title, slug, excerpt, category, catStyle, dateStr, readTime });
        const marker = "<!-- BLOG_ARTICLES_START -->";
        if (blogFile.content.includes(marker)) {
          filesToCommit["blog.html"] = blogFile.content.replace(marker, marker + newCard);
        }
      }
      return filesToCommit;
    };

    // Single atomic commit for article + blog.html → one push → one deploy.
    // (Two separate commits would each trigger their own GitHub Actions
    // deploy, and out-of-order CI runs could let the older deploy overwrite
    // the newer one, silently dropping the blog.html card.)
    await commitFilesAtomic(buildFiles, `blog: add article "${title}"`);

    console.log(`Article "${title}" committed to GitHub — Netlify deploy will start automatically via GitHub Actions`);
    return { statusCode: 200, body: JSON.stringify({ success: true, file: articleFileName, slug }) };
  } catch (err) {
    console.error("Publish error:", err.message);
    return { statusCode: 502, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
