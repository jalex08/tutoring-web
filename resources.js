/**
 * Resources on the public site (default service). Routes, all GET/HEAD:
 *
 *   /resources/, /es/recursos/                the library (lang=es cookie: / -> /es/ rule, see server.js)
 *   /resources/<slug>/, /es/recursos/<slug>/  a resource page. Old slug -> 301 to the current one;
 *                                             unpublished -> 410 (404 template, noindex); unknown -> 404.
 *                                             /resources/<slug> (no slash) -> 301 to the slash URL.
 *   /resources/<slug-en>/files/<name>         a PDF attached to a live resource (lib/resources/files.js): streamed
 *                                             from the bucket, noindex, ETag/304, HEAD, Range. Old EN slug -> 301
 *                                             to the current one; anything else (draft, unpublished, unknown name,
 *                                             not uploaded yet, the ES path) -> 404. The name keeps its case
 *                                             (server.js doesn't lowercase this last segment).
 *   /frame/<id>/v<N>                          the uploaded tool, sandboxed (lib/resources/frame.js). Only
 *                                             live resources, current or previous version; else 404.
 *   /resources/og/<id>-<lang>-<hash>.png      preview cards (made by the admin on publish)
 *   /sitemap.xml                              www/sitemap.xml + the library and live resources
 *
 * Data: lib/resources/store.js (Firestore + Cloud Storage in production; RESOURCES_DIR locally).
 * Every CACHE_TTL (15 s) at most, one Firestore read checks the change marker (meta/resources.rev); the
 * full list is re-read only when it changed, so a publish is live within ~15-30 s on every instance
 * with no deploy. If the store fails, the last good list keeps being used.
 *
 * Nothing here writes; the admin service (admin/) does.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const M = require("./lib/resources/model.js");
const render = require("./lib/resources/render.js");
const frame = require("./lib/resources/frame.js");
const storeLib = require("./lib/resources/store.js");
const pdfs = require("./lib/resources/files.js");

const CACHE_TTL = 15e3;
const SITEMAP_TTL = 5 * 60e3;
const HOME_WAIT = 1500; // the home page never waits longer than this for a cold cache
const PAGE_CACHE = { "Cache-Control": "private, max-age=30" };
const OG_RE = /^\/resources\/og\/([a-z0-9]{10}-(?:en|es)-[a-f0-9]{8})\.png$/;
const FRAME_RE = /^\/frame\/([a-z0-9]{10})\/v([1-9][0-9]{0,5})$/;
const FILE_RE = /^\/resources\/([a-z0-9-]{1,100})\/files\/([^/]*)$/;
// KaTeX's stylesheet and fonts, from node_modules (no third-party request for the math on the pages)
// URLs are all lowercase (server.js 301s uppercase paths), so the fonts are served under lowercased names
// and the stylesheet's url(fonts/KaTeX_...) references are rewritten to match.
const KATEX_RE = /^\/resources\/katex\/([0-9.]+)\/(katex\.min\.css|fonts\/katex_[a-z0-9_-]+\.(?:woff2|woff|ttf))$/;
const KATEX_DIR = path.join(path.dirname(require.resolve("katex/package.json")), "dist");
const KATEX_TYPES = { css: "text/css; charset=utf-8", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf" };

let store = null;
const getStore = () => (store ??= storeLib.fromEnv());
let shell = null;
const getShell = () => (shell ??= JSON.parse(fs.readFileSync(path.join(__dirname, "www/resources-shell.json"), "utf8")));

// --- cache ---------------------------------------------------------------------------------------
let cache = null; // { rev, docs, bySlug: { en: Map, es: Map }, at }
let checkedAt = 0;
let loading = null;

function index(docs) {
  const bySlug = { en: new Map(), es: new Map() };
  for (const d of docs) {
    for (const lang of M.LANGS) {
      for (const old of M.historyOf(d, lang)) if (!bySlug[lang].has(old)) bySlug[lang].set(old, { doc: d, old: true });
    }
  }
  for (const d of docs) for (const lang of M.LANGS) { const s = M.slugOf(d, lang); if (s) bySlug[lang].set(s, { doc: d, old: false }); }
  return bySlug;
}

async function refresh() {
  const s = getStore();
  const rev = await s.rev();
  if (cache && cache.rev === rev) return cache;
  const docs = (await s.list()).map(M.normalize);
  if (!cache || cache.rev !== rev) console.log(JSON.stringify({ event: "resources_loaded", count: docs.length, live: docs.filter(M.isLive).length }));
  cache = { rev, docs, bySlug: index(docs) };
  return cache;
}

/** The current data: fresh within CACHE_TTL; on a store error, the last good data (or throws if none). */
async function current() {
  if (cache && Date.now() - checkedAt < CACHE_TTL) return cache;
  loading ??= refresh()
    .then((c) => { checkedAt = Date.now(); return c; })
    .catch((err) => {
      if (!cache) throw err;
      console.error(`Resources: refresh failed, using the last good data: ${err.message}`);
      checkedAt = Date.now();
      return cache;
    })
    .finally(() => (loading = null));
  return loading;
}

// immutable files (tool versions, cards): a small in-memory cache, by size
const files = new Map();
const FILES_MAX = 24 * 1048576;
let filesBytes = 0;
async function object(p) {
  if (files.has(p)) { const v = files.get(p); files.delete(p); files.set(p, v); return v; }
  const buf = await getStore().readObject(p);
  if (!buf) return null;
  files.set(p, buf);
  filesBytes += buf.length;
  for (const [k, v] of files) { if (filesBytes <= FILES_MAX) break; files.delete(k); filesBytes -= v.length; }
  return buf;
}

// --- helpers from server.js (set by init) ------------------------------------------------------------
let H = null;
function init(helpers) { H = helpers; }

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...H.SECURITY_HEADERS, ...headers });
  res.end(req.method === "HEAD" ? undefined : body);
}
const redirect = (req, res, to, search = "") =>
  send(req, res, 301, { Location: to + search, "Cache-Control": "public, max-age=3600" });
function unavailable(req, res, err) {
  console.error("Resources: store unavailable:", err.message);
  send(req, res, 503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" }, "Temporarily unavailable. Please try again in a minute.");
}

/** Is this a resources URL (so server.js hands it over)? */
function matches(pathname) {
  return pathname === "/sitemap.xml" || pathname.startsWith("/resources/") || pathname.startsWith("/es/recursos/") || pathname.startsWith("/frame/");
}

async function handle(req, res, pathname, search) {
  if (pathname === "/sitemap.xml") return sitemap(req, res);
  let m;
  if ((m = pathname.match(FRAME_RE))) return toolFrame(req, res, m[1], Number(m[2]));
  if ((m = pathname.match(OG_RE))) return ogCard(req, res, m[1]);
  if ((m = pathname.match(KATEX_RE))) return katexFile(req, res, m[1], m[2]);
  if ((m = pathname.match(FILE_RE))) return attachedFile(req, res, m[1], m[2], search);
  for (const lang of M.LANGS) {
    const base = M.BASE[lang];
    if (!pathname.startsWith(base)) continue;
    const rest = pathname.slice(base.length);
    if (rest === "") return library(req, res, lang);
    const mm = rest.match(/^([a-z0-9-]{1,100})(\/?)(index\.html)?$/);
    if (!mm) return H.notFoundPage(req, res);
    if (!mm[2] || mm[3]) return redirect(req, res, `${base}${mm[1]}/`, search);
    return resourcePage(req, res, lang, mm[1], search);
  }
  return H.notFoundPage(req, res);
}

async function library(req, res, lang) {
  let c;
  try { c = await current(); } catch (err) { return unavailable(req, res, err); }
  const body = render.libraryPage({ docs: c.docs, lang, shell: getShell()[lang] });
  // /resources/ acts on the lang cookie (private, no-cache, Vary: Cookie, from server.js); /es/recursos/: 30 s
  send(req, res, 200, { "Content-Type": "text/html; charset=utf-8", ...(lang === "es" ? PAGE_CACHE : {}), ...H.htmlHeaders(req, M.BASE[lang]), ...(lang === "es" ? PAGE_CACHE : {}) }, body);
}

async function resourcePage(req, res, lang, slug, search) {
  let c;
  try { c = await current(); } catch (err) { return unavailable(req, res, err); }
  const hit = c.bySlug[lang].get(slug);
  if (!hit || hit.doc.visibility !== "public" || hit.doc.status === "draft") return H.notFoundPage(req, res);
  const doc = hit.doc;
  if (doc.status !== "published") return H.notFoundPage(req, res, 410);
  if (hit.old) return redirect(req, res, M.pathOf(doc, lang), search);
  if (!doc.file) return H.notFoundPage(req, res);
  const body = render.resourcePage({ doc, lang, shell: getShell()[lang], all: c.docs });
  send(req, res, 200, { "Content-Type": "text/html; charset=utf-8", ...H.htmlHeaders(req, null), ...PAGE_CACHE }, body);
}

async function attachedFile(req, res, slug, name, search) {
  if (!M.validFileName(name)) return H.notFoundPage(req, res); // also anything %-encoded (..%2F etc.)
  let c;
  try { c = await current(); } catch (err) { return unavailable(req, res, err); }
  const hit = c.bySlug.en.get(slug);
  const doc = hit && hit.doc;
  const file = doc && M.isLive(doc) && M.uploadedFiles(doc).find((f) => f.name === name);
  if (!file) return H.notFoundPage(req, res);
  if (hit.old) return redirect(req, res, M.fileUrl(doc, name), search);
  try {
    await pdfs.send(req, res, {
      file, baseHeaders: H.SECURITY_HEADERS,
      open: (range) => getStore().readStream(file.path, range),
      onMissing: () => H.notFoundPage(req, res),
    });
  } catch (err) { if (!res.headersSent) return unavailable(req, res, err); res.destroy(); }
}

async function toolFrame(req, res, id, version) {
  let c;
  try { c = await current(); } catch (err) { return unavailable(req, res, err); }
  const doc = c.docs.find((d) => d.id === id);
  if (!doc || !M.isLive(doc) || !doc.file || (version !== doc.file.version && version !== doc.file.version - 1)) return frameMissing(req, res);
  let buf;
  try { buf = await object(M.filePath(id, version)); } catch (err) { return unavailable(req, res, err); }
  if (!buf) return frameMissing(req, res);
  send(req, res, 200, frame.FRAME_HEADERS, frame.inject(buf.toString("utf8")));
}
function frameMissing(req, res) {
  send(req, res, 404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Robots-Tag": "noindex, nofollow" }, "Not found");
}

async function ogCard(req, res, name) {
  let buf;
  try { buf = await object(`og/${name}.png`); } catch (err) { return unavailable(req, res, err); }
  if (!buf) return send(req, res, 404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" }, "Not found");
  send(req, res, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" }, buf);
}

let katexFiles = null; // lowercase published path -> Buffer
function katexAssets() {
  if (katexFiles) return katexFiles;
  katexFiles = new Map();
  for (const f of fs.readdirSync(path.join(KATEX_DIR, "fonts"))) katexFiles.set(`fonts/${f.toLowerCase()}`, () => fs.readFileSync(path.join(KATEX_DIR, "fonts", f)));
  const css = fs.readFileSync(path.join(KATEX_DIR, "katex.min.css"), "utf8").replace(/url\((["']?)fonts\/([^)"']+)\1\)/g, (_, q, f) => `url(${q}fonts/${f.toLowerCase()}${q})`);
  katexFiles.set("katex.min.css", () => Buffer.from(css));
  return katexFiles;
}
function katexFile(req, res, version, file) {
  const get = version === require("katex/package.json").version && katexAssets().get(file);
  if (!get) return frameMissing(req, res);
  send(req, res, 200, { "Content-Type": KATEX_TYPES[file.split(".").pop()], "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" }, get());
}

// --- sitemap: the built file + resources ------------------------------------------------------------
let sitemapCache = null; // { body, at }
async function sitemap(req, res) {
  if (!sitemapCache || Date.now() - sitemapCache.at > SITEMAP_TTL) {
    const built = fs.readFileSync(path.join(__dirname, "www/sitemap.xml"), "utf8");
    let body = built;
    try {
      const c = await current();
      const extra = render.sitemapEntries(c.docs);
      body = extra ? built.replace("</urlset>", `${extra}\n</urlset>`) : built;
      sitemapCache = { body, at: Date.now() };
    } catch (err) {
      console.error("Resources: sitemap without resources:", err.message);
    }
    if (!sitemapCache) return send(req, res, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60" }, body);
  }
  send(req, res, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" }, sitemapCache.body);
}

// --- home page: the "Free interactive tools" section -------------------------------------------------
/** Shows the home page's tools section with the 3 newest cards, or leaves it hidden. Never throws. */
async function fillHome(html, lang) {
  if (!html.includes("<!--resources:cards-->")) return html;
  let c = cache;
  try {
    if (!c || Date.now() - checkedAt >= CACHE_TTL) c = await Promise.race([current(), new Promise((r) => setTimeout(() => r(cache), HOME_WAIT))]);
  } catch (err) {
    console.error("Resources: home page without tools:", err.message);
  }
  const cards = c ? render.homeCards(c.docs, lang) : "";
  if (!cards) return html;
  return html
    .replace('<section id="tools" class="tools-home" hidden>', '<section id="tools" class="tools-home">')
    .replace("<!--resources:cards-->", cards);
}

module.exports = {
  init, matches, handle, fillHome, current,
  _setStore: (s) => { store = s; cache = null; checkedAt = 0; sitemapCache = null; files.clear(); filesBytes = 0; },
  _clearCache: () => { checkedAt = 0; sitemapCache = null; },
};
