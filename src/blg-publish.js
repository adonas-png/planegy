// BabyLoveGrowth → PLANEGY Blog Auto-Publisher (Cloudflare Worker)
// Portiert von netlify/functions/blg-publish.js. Die HTML-Generatoren sind
// unverändert übernommen – der Blog ist LOCKED, die Ausgabe muss identisch bleiben.
//
// Secrets (wrangler secret put): GITHUB_TOKEN, BLG_WEBHOOK_SECRET
// Vars (wrangler.jsonc):         GITHUB_REPO, GITHUB_BRANCH

import { Buffer } from "node:buffer";

// ── GitHub API helpers ──────────────────────────────────────────────────────

async function githubRequest(env, method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "PLANEGY-Blog-Webhook",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

async function getFile(env, filePath) {
  const res = await githubRequest(env, "GET", `/contents/${filePath}?ref=${env.GITHUB_BRANCH}`, null);
  if (res.status === 200) {
    return {
      content: Buffer.from(res.data.content, "base64").toString("utf-8"),
      sha: res.data.sha,
    };
  }
  return null;
}

// Commit multiple files in a single atomic commit, so a single push (and a
// single GitHub Actions deploy) carries all the changes for one article.
//
// buildFiles() is called fresh on every attempt so a retry re-reads blog.html
// from the latest commit instead of overwriting a concurrent change with a
// stale copy — needed if two articles get published within moments of each
// other and both try to move the branch ref at once.
async function commitFilesAtomic(env, buildFiles, message, maxAttempts = 3) {
  const branch = env.GITHUB_BRANCH;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const refRes = await githubRequest(env, "GET", `/git/ref/heads/${branch}`, null);
    if (refRes.status !== 200) throw new Error("Cannot read branch ref: " + JSON.stringify(refRes.data));
    const latestCommitSha = refRes.data.object.sha;

    const commitRes = await githubRequest(env, "GET", `/git/commits/${latestCommitSha}`, null);
    if (commitRes.status !== 200) throw new Error("Cannot read latest commit: " + JSON.stringify(commitRes.data));
    const baseTreeSha = commitRes.data.tree.sha;

    const files = await buildFiles();

    const treeRes = await githubRequest(env, "POST", "/git/trees", {
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

    const newCommitRes = await githubRequest(env, "POST", "/git/commits", {
      message,
      tree: treeRes.data.sha,
      parents: [latestCommitSha],
    });
    if (newCommitRes.status !== 200 && newCommitRes.status !== 201) {
      throw new Error("Cannot create commit: " + JSON.stringify(newCommitRes.data));
    }

    const updateRefRes = await githubRequest(env, "PATCH", `/git/refs/heads/${branch}`, {
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
  <link rel="canonical" href="https://planegy.de/blog-${slug}" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${title.replace(/"/g, '\\"')}",
    "author": { "@type": "Person", "name": "Alexios Donas" },
    "publisher": { "@type": "Organization", "name": "PLANEGY", "url": "https://planegy.de" },
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
  <a href="/" class="nav-logo">PLAN<span>EGY</span></a>
  <a href="/blog" class="nav-back">← Zurück zum Blog</a>
</nav>

<div class="article-hero">
  <div class="hero-inner">
    <div class="breadcrumb">
      <a href="/">Startseite</a>
      <span>/</span>
      <a href="/blog">Blog</a>
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
      <h3>Sie haben ein Energieprojekt?</h3>
      <p>Beschreiben Sie uns kurz Ihre Ausgangssituation. Wir prüfen gemeinsam, ob und wie PLANEGY unterstützen kann.</p>
      <a href="/kontakt">Projekt besprechen →</a>
    </div>
  </article>
  <aside class="sidebar">
    <div class="sidebar-card author-card">
      <div class="author-avatar"><img src="alexios-donas.jpg" alt="Alexios Donas" style="width:100%;height:100%;border-radius:50%;object-fit:cover"></div>
      <div class="author-name">Alexios Donas</div>
      <div class="author-role">Energieberater & Gründer PLANEGY<br/>Zertifizierter Kommunaler Wärmemanager & European Energy Manager (EUREM)</div>
      <a href="/kontakt" class="author-cta">Projekt besprechen</a>
    </div>
    <div class="sidebar-card">
      <h3>📌 Leistungen</h3>
      <a href="/leistungen" style="display:block;margin-top:.5rem;color:var(--blue);font-size:.85rem;font-weight:700;text-decoration:none">→ Alle Leistungen</a>
      <a href="/kommunen" style="display:block;margin-top:.5rem;color:var(--blue);font-size:.85rem;font-weight:700;text-decoration:none">→ Für Kommunen</a>
      <a href="/stadtwerke" style="display:block;margin-top:.5rem;color:var(--blue);font-size:.85rem;font-weight:700;text-decoration:none">→ Für Stadtwerke</a>
      <a href="/industrie" style="display:block;margin-top:.5rem;color:var(--blue);font-size:.85rem;font-weight:700;text-decoration:none">→ Für Industrie &amp; Gewerbe</a>
    </div>
    <div class="sidebar-card">
      <h3>📚 Mehr entdecken</h3>
      <p style="font-size:.82rem;color:var(--slate);line-height:1.6">Weitere Fachartikel zu Energie, Wärmeplanung und Nachhaltigkeit im PLANEGY Blog.</p>
      <a href="/blog" style="display:block;margin-top:.8rem;color:var(--blue);font-size:.85rem;font-weight:700;text-decoration:none">→ Alle Artikel</a>
    </div>
  </aside>
</div>

<footer>
  <p>
    <a href="/">Startseite</a>
    <a href="/leistungen">Leistungen</a>
    <a href="/projekte">Projekte</a>
    <a href="/blog">Blog</a>
    <a href="/impressum">Impressum</a>
    <a href="/datenschutz">Datenschutz</a>
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

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleBlgPublish(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Anders als bei Netlify ist das Secret Pflicht: ohne Secret wäre der
  // Endpunkt offen und jeder könnte Artikel ins Repo committen.
  if (!env.BLG_WEBHOOK_SECRET) {
    console.error("BLG_WEBHOOK_SECRET is not configured");
    return json(500, { error: "Webhook secret not configured" });
  }
  const authHeader = request.headers.get("x-blg-secret") || request.headers.get("authorization") || "";
  if (authHeader.replace("Bearer ", "") !== env.BLG_WEBHOOK_SECRET) {
    return json(401, { error: "Unauthorized" });
  }

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return json(400, { error: "Invalid JSON" });
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
    return json(400, { error: "Missing title or content_html" });
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

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    console.warn("GitHub credentials not configured — skipping commit. Set GITHUB_TOKEN and GITHUB_REPO.");
    return json(200, { success: true, file: articleFileName, slug, warning: "GitHub not configured" });
  }

  try {
    // Re-read blog.html on every attempt so a retry (see commitFilesAtomic)
    // injects the card into the latest content instead of a stale copy.
    const buildFiles = async () => {
      const filesToCommit = { [articleFileName]: articleHtml };

      const [blogFile, sitemapFile] = await Promise.all([
        getFile(env, "blog.html"),
        getFile(env, "sitemap.xml"),
      ]);

      if (blogFile) {
        const newCard = generateArticleCard({ title, slug, excerpt, category, catStyle, dateStr, readTime });
        const marker = "<!-- BLOG_ARTICLES_START -->";
        if (blogFile.content.includes(marker)) {
          filesToCommit["blog.html"] = blogFile.content.replace(marker, marker + newCard);
        }
      }

      if (sitemapFile) {
        const articleUrl = `https://planegy.de/blog-${slug}`;
        if (!sitemapFile.content.includes(articleUrl)) {
          const isoDate = new Date(dateStr).toISOString().slice(0, 10);
          const newEntry = `  <url>\n    <loc>${articleUrl}</loc>\n    <lastmod>${isoDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n  `;
          filesToCommit["sitemap.xml"] = sitemapFile.content.replace(
            "<!-- SITEMAP_ARTICLES_END -->",
            newEntry + "<!-- SITEMAP_ARTICLES_END -->"
          );
        }
      }

      return filesToCommit;
    };

    // Single atomic commit for article + blog.html → one push → one deploy.
    await commitFilesAtomic(env, buildFiles, `blog: add article "${title}"`);

    console.log(`Article "${title}" committed to GitHub — Cloudflare deploy follows via GitHub Actions`);
    return json(200, { success: true, file: articleFileName, slug });
  } catch (err) {
    console.error("Publish error:", err.message);
    return json(502, { success: false, error: err.message });
  }
};
