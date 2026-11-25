/**
 * Admin for josediaztutoring.com resources (App Engine service `admin`, behind IAP; see admin.yaml and
 * ../docs/resources-setup.md). Upload a tool's HTML file, write the EN/ES text, preview, publish.
 * Publishing writes Firestore + Cloud Storage and bumps the change marker; the public site picks it up
 * within ~15-30 s (../resources.js). No deploy.
 *
 * Every request: signed in with Google (auth.js: the app's own "Sign in with Google", session cookie) and
 * the email must be in ADMIN_EMAILS. (App Engine can't put IAP in front of one service only.)
 * Every /api/ call also needs the header X-JDT-Admin: 1 and a same-origin Origin, so neither another site
 * nor an uploaded tool (sandboxed, opaque origin) can make one; every state-changing call also needs the
 * CSRF token (X-CSRF-Token, from <meta name="csrf-token">; auth.js). The session cookie is SameSite=Lax.
 *
 * Saves: every write to a resource bumps its `rev`. Saves from the editor carry the rev they were loaded
 * at; a stale one is refused (409) with the diff against the current version. Every save that changes the
 * config (form, Config (.json) tab, .json upload, tool upload, PDFs) first stores the previous config in
 * resources/<id>/revisions (savedAt, savedBy, source, config).
 *
 * Local: from the repo root, `npm run admin:dev` (folder store .dev-data/resources, no IAP).
 *
 * Pages:  GET /  (list) · GET /edit/<id> · GET /preview/<id>/<en|es> · GET /frame/<id>/v<N> (any version)
 * API:    POST /api/resources · PUT /api/resources/<id> · POST /api/resources/<id>/file (raw HTML body)
 *         POST /api/resources/<id>/publish · POST /api/resources/<id>/unpublish · DELETE /api/resources/<id>
 *         POST /api/resources/<id>/config (a tool pair's .json: checked against the schema, mapped to the form;
 *         nothing saved) · POST /api/math (KaTeX preview) · GET /download/<id>/config/<n> (an old uploaded config)
 *         Config (.json) tab: GET /api/resources/<id>/config.json (current config + rev)
 *         POST /api/resources/<id>/config/check {text} (errors, warnings, diff) · PUT /api/resources/<id>/config.json
 *         {text, rev, checked, source, restoredFrom?} · GET /api/resources/<id>/revisions (last 20)
 *         GET /api/resources/<id>/revisions/<n> (its config + diff to now) · GET /download/<id>/config.json
 *         PDFs (../lib/resources/files.js), one request per file so no request nears App Engine's 32 MB limit:
 *         POST /api/resources/<id>/files/<name> (raw PDF body; X-Label-En / X-Label-Es for a new one)
 *         DELETE /api/resources/<id>/files/<name> · PUT /api/resources/<id>/files {files:[{name,labelEn,labelEs}]}
 *         (order + labels; a name not uploaded yet is "listed", and blocks Publish until it is)
 *         GET /resources/<slug-en>/files/<name>: any status (the preview and the tool inside it link there)
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const M = require("./lib/resources/model.js");
const render = require("./lib/resources/render.js");
const frame = require("./lib/resources/frame.js");
const math = require("./lib/resources/math.js");
const storeLib = require("./lib/resources/store.js");
const toolconfig = require("./lib/resources/toolconfig.js");
const configcheck = require("./lib/resources/configcheck.js");
const configdiff = require("./lib/resources/configdiff.js");
const pdfs = require("./lib/resources/files.js");
const iap = require("./iap.js");
const authLib = require("./auth.js");

const PORT = Number(process.env.PORT) || 8081;
const MAX_UPLOAD = Math.round((Number(process.env.MAX_UPLOAD_MB) || 2) * 1048576);
const MAX_FILE = Math.round((Number(process.env.MAX_FILE_MB) || 10) * 1048576); // each PDF
const SHELL = JSON.parse(fs.readFileSync(path.join(__dirname, "lib/resources-shell.json"), "utf8"));
const UI = path.join(__dirname, "ui");
const KATEX_DIST = path.join(path.dirname(require.resolve("katex/package.json")), "dist");

let store = null;
const getStore = () => (store ??= storeLib.fromEnv());
let cards = () => require("./cards.js"); // tests can stub it
let auth = (req) => authLib.sessionEmail(req); // email, or null = not signed in
const csrf = (req, email) => authLib.csrfToken(req, email);
const CONFIG_MAX = toolconfig.MAX_BYTES; // 256 KB: a config save request, whole

const esc = math.escapeHtml;
const now = () => new Date().toISOString();
const SECURITY = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
};
// admin pages: no framing by anyone; scripts and styles only from here (+ KaTeX's CSS/fonts and Google Fonts)
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https://josediaztutoring.com data:; frame-src 'self'; " +
  "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY, "Cache-Control": "no-store", ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(obj));
const page = (res, html, status = 200) => send(res, status, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_CSP, "X-Frame-Options": "DENY" }, html);

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) tooBig = true; else chunks.push(c); });
    req.on("end", () => (tooBig ? reject(Object.assign(new Error(`Too large (limit ${(max / 1048576).toFixed(1)} MB).`), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 512 * 1024);
  try { return JSON.parse(buf.toString("utf8") || "{}"); } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });

/** /api/ calls: custom header + same-origin (blocks other sites and the sandboxed tools) + CSRF token. */
async function checkApi(req, email) {
  if (req.headers["x-jdt-admin"] !== "1") throw fail(403, "Missing X-JDT-Admin header.");
  const origin = req.headers.origin;
  if (origin) {
    const proto = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
    if (origin !== `${proto}://${req.headers.host}`) throw fail(403, "Cross-origin request refused.");
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin") throw fail(403, "Cross-site request refused.");
  if (req.method !== "GET" && req.method !== "HEAD" && !authLib.equal(req.headers["x-csrf-token"] || "", await csrf(req, email))) {
    throw fail(403, "Missing or expired security token. Reload the page (your edits stay in the form until you do).");
  }
}

// --- data helpers ---------------------------------------------------------------------------------------
async function all() { return (await getStore().list()).map(M.normalize); }
async function getDoc(id) {
  if (!M.ID_RE.test(id)) throw fail(404, "No such resource.");
  const d = await getStore().get(id);
  if (!d) throw fail(404, "No such resource.");
  return M.normalize(d);
}
const subline = (doc, lang) => [M.SUBJECTS[doc.subject][lang], ...doc.levels.map((l) => M.LEVELS[l][lang])].join(" · ");

/** Fields the editor may change (everything else is set by the server). */
function edited(doc, body) {
  const f = body && typeof body === "object" ? body : {};
  const next = M.normalize({
    ...doc,
    slugEn: f.slugEn ?? doc.slugEn, slugEs: f.slugEs ?? doc.slugEs,
    en: f.en ?? doc.en, es: f.es ?? doc.es,
    subject: f.subject ?? doc.subject, levels: f.levels ?? doc.levels,
    courseTags: f.courseTags ?? doc.courseTags, relatedExamPage: f.relatedExamPage ?? doc.relatedExamPage,
    related: f.related ?? doc.related,
  });
  next.related = next.related.filter((s) => s !== next.slugEn);
  next.slugEn = next.slugEn.toLowerCase();
  next.slugEs = next.slugEs.toLowerCase();
  return M.applySlugChange(doc, next);
}

/** Every formula KaTeX can't parse, in plain words. */
function mathProblems(doc) {
  const out = [];
  for (const lang of M.LANGS) {
    const t = doc[lang];
    for (const s of [t.title, t.description, t.intro, ...t.howTo, ...t.keyIdeas, ...t.faq.flatMap((x) => [x.q, x.a])]) {
      for (const e of math.mathErrors(s)) out.push(`${lang.toUpperCase()}: formula "${e.math}" doesn't render (${e.error}).`);
    }
  }
  return out;
}
/**
 * Everything that blocks Publish (or saving a live page): the basics first; once those pass, the config
 * schema and its cross-checks, so a live page's config always validates.
 */
function publishProblems(doc, others) {
  const basic = [...M.problems(doc, others), ...mathProblems(doc)];
  if (basic.length) return basic;
  return configcheck.validate(toolconfig.toConfig(doc), { doc, others, mode: "json" }).errors.map((e) => `${e.message}`);
}

async function makeCards(doc) {
  const og = {};
  for (const lang of M.LANGS) {
    const png = await cards().renderCard({ title: math.plain(doc[lang].title), subline: subline(doc, lang), lang });
    const p = cards().cardPath(doc.id, lang, png);
    if (doc.og[lang] !== p) await getStore().writeObject(p, png, "image/png");
    og[lang] = p;
  }
  return og;
}
const cardInputs = (d) => JSON.stringify(M.LANGS.map((l) => [math.plain(d[l].title), subline(d, l)]));

// --- saving --------------------------------------------------------------------------------------------
const configOf = (doc) => toolconfig.toConfig(doc);
/**
 * Saves `next` over `prev`: rev + 1, atomically (refused if someone saved in between), and, when the
 * config changes and a `source` is given, the previous config goes into the revisions first.
 */
async function commit(prev, next, { email, source = "", restoredFrom } = {}) {
  const s = getStore();
  next.rev = prev.rev + 1;
  const before = toolconfig.configText(prev);
  if (source && before !== toolconfig.configText(next)) {
    const r = { n: prev.rev, savedAt: now(), savedBy: email, source, config: before };
    if (restoredFrom) r.restoredFrom = restoredFrom;
    await s.addRevision(prev.id, r); // the config as it was at rev n (the same n again = the same data)
  }
  try { await s.putIf(next, prev.rev); }
  catch (e) { if (e.code === "stale") throw await staleError(prev.id, configOf(next)); throw e; }
  return next;
}
/** 409: the resource changed since the editor loaded it. Carries the current config and what this save would change. */
async function staleError(id, wanted) {
  const cur = await getDoc(id);
  const current = configOf(cur);
  return fail(409, "This resource changed since you loaded it (another tab or device saved). Nothing was saved. Below: what your version would change compared with the current one.", {
    stale: true, rev: cur.rev, current: toolconfig.configText(cur), diff: wanted ? configdiff.diff(current, wanted) : null,
  });
}
function needRev(body, doc, wanted) {
  if (typeof body.rev !== "number") throw fail(400, "The save didn't say which version it started from. Reload the page.");
  if (body.rev !== doc.rev) return staleError(doc.id, wanted).then((e) => { throw e; });
  return Promise.resolve();
}
/** validate() problems -> the form's { field, message, level, line, suggestion? } */
function formProblems(r) {
  const field = (p) => (p === "config" ? "json" : p.replace(/\[\d+\].*$/, "").replace(/^(en|es)\.(\w+).*$/, "$1.$2"));
  const one = (level) => (e) => {
    const out = { field: field(e.path), path: e.path, message: e.message, level, line: e.line };
    const m = e.message.match(/Try "([a-z0-9-]+)"/);
    if (m) out.suggestion = m[1];
    return out;
  };
  return [...r.errors.map(one("error")), ...r.warnings.map(one("warning"))];
}
async function readText(req) {
  const body = await readBody(req, CONFIG_MAX).catch((e) => { throw fail(413, `The request is over ${CONFIG_MAX / 1024} KB.`); });
  let j;
  try { j = JSON.parse(body.toString("utf8") || "{}"); } catch { throw fail(400, "Invalid JSON request."); }
  if (typeof j.text !== "string") throw fail(400, 'Send {"text": "<the config>"}.');
  return j;
}

// --- API --------------------------------------------------------------------------------------------
async function api(req, res, pathname, email) {
  await checkApi(req, email);
  const s = getStore();
  if (pathname === "/api/math" && req.method === "POST") {
    const { text } = await readJson(req);
    const t = String(text || "").slice(0, 20000);
    return json(res, 200, { ok: true, html: math.paragraphs(t), errors: math.mathErrors(t) });
  }
  if (pathname === "/api/resources" && req.method === "POST") {
    const doc = M.normalize({ id: M.newId(), status: "draft", visibility: "public", createdAt: now(), updatedAt: now() });
    await s.put(doc);
    log("resource_created", email, doc.id);
    return json(res, 200, { ok: true, id: doc.id });
  }
  const fm = pathname.match(/^\/api\/resources\/([a-z0-9]{10})\/files(?:\/([^/]+))?$/);
  if (fm) return filesApi(req, res, fm[1], fm[2], email);
  const cm = pathname.match(/^\/api\/resources\/([a-z0-9]{10})\/(config\.json|config\/check|revisions(?:\/([0-9]{1,8}))?)$/);
  if (cm) return configApi(req, res, cm[1], cm[2], cm[3] === undefined ? null : Number(cm[3]), email);
  const m = pathname.match(/^\/api\/resources\/([a-z0-9]{10})(?:\/(file|config|publish|unpublish))?$/);
  if (!m) throw fail(404, "Not found.");
  const [, id, action] = m;
  const doc = await getDoc(id);
  const others = (await all()).filter((d) => d.id !== id);

  if (!action && req.method === "GET") return json(res, 200, { ok: true, doc, problems: publishProblems(doc, others) });

  if (!action && req.method === "PUT") {
    const body = await readJson(req);
    let next = edited(doc, body.doc);
    await needRev(body, doc, configOf(next));
    const slugErr = M.slugProblems(next, others).filter((p) => !/slug is required/.test(p) || doc.status !== "draft");
    if (slugErr.length) throw fail(400, slugErr.join(" "), { problems: slugErr });
    if (doc.status === "published") {
      // the page is live: a save updates it, so it needs the same checks as Publish
      const probs = publishProblems(next, others);
      if (probs.length) throw fail(400, "This resource is live, so the changes must be complete before saving.", { problems: probs });
      if (body.checked !== true) throw fail(400, 'Tick "I checked the formulas and the Spanish" to update the live page.');
      next.checkedAt = now();
      if (cardInputs(next) !== cardInputs(doc) || !next.og.en || !next.og.es) next.og = await makeCards(next);
    }
    next.updatedAt = now();
    next = await commit(doc, next, { email, source: "form" });
    if (doc.status !== "draft") await s.bump();
    log("resource_saved", email, id, { status: next.status, source: "form" });
    return json(res, 200, { ok: true, doc: next, problems: publishProblems(next, others) });
  }

  if (action === "file" && req.method === "POST") {
    let text;
    try { text = frame.validateUpload(await readBody(req, MAX_UPLOAD), MAX_UPLOAD); }
    catch (err) { throw fail(err.status || 400, err.message); }
    const buf = Buffer.from(text, "utf8");
    const version = ((doc.file && doc.file.version) || 0) + 1;
    const warnings = frame.analyze(text, { size: buf.length });
    const name = fileName(req);
    await s.writeObject(M.filePath(id, version), buf, "text/html; charset=utf-8");
    let next = M.normalize({
      ...doc,
      file: { path: M.filePath(id, version), version, sizeBytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), uploadedAt: now(), warnings, name },
      updatedAt: now(),
    });
    next = await commit(doc, next, { email, source: "upload" });
    if (doc.status === "published") await s.bump();
    log("resource_file", email, id, { version, bytes: buf.length, name });
    return json(res, 200, { ok: true, doc: next, warnings, scriptHosts: frame.scriptHostsOf(text), problems: publishProblems(next, others), configProblems: [] });
  }

  if (action === "config" && req.method === "POST") {
    // a tool pair's config JSON: checked against the schema (+ cross-checks) and mapped onto the form's
    // fields. Nothing is saved here: the form is filled, and Save / Publish save it (with a revision).
    const raw = await readBody(req, CONFIG_MAX + 1);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
    catch { throw fail(400, "The config isn't UTF-8 text.", { problems: [{ field: "json", level: "error", message: "The config isn't UTF-8 text." }] }); }
    const header = (h) => { try { return decodeURIComponent(String(req.headers[h] || "")); } catch { return ""; } };
    const htmlName = header("x-html-name").slice(0, 200) || (doc.file && doc.file.name) || "";
    const pendingPdfs = header("x-pdf-names").split("/").map((x) => x.trim()).filter(Boolean).slice(0, M.MAX_FILES);
    const r = toolconfig.readConfig(text, { htmlName, others, selfId: id });
    if (!r.ok && r.problems.some((p) => p.field === "json")) throw fail(400, r.problems[0].message, { problems: r.problems });
    const v = configcheck.validate(text, { doc, others, mode: "upload", htmlName, pendingPdfs });
    log("resource_config_read", email, id, { name: fileName(req), errors: v.errors.length, warnings: v.warnings.length });
    return json(res, 200, { ok: true, doc, fields: r.fields, problems: formProblems(v), valid: v.ok });
  }

  if (action === "publish" && req.method === "POST") {
    const body = await readJson(req);
    let next = body.doc ? edited(doc, body.doc) : M.normalize({ ...doc });
    if (body.doc) await needRev(body, doc, configOf(next));
    const probs = publishProblems(next, others);
    if (probs.length) throw fail(400, "Not ready to publish.", { problems: probs });
    if (body.checked !== true) throw fail(400, 'Tick "I checked the formulas and the Spanish" first.');
    next.og = await makeCards(next);
    next.status = "published";
    next.publishedAt = doc.publishedAt || now();
    next.updatedAt = now();
    next.checkedAt = now();
    next = await commit(doc, next, { email, source: "form" });
    await s.bump();
    log("resource_published", email, id, { slugEn: next.slugEn, slugEs: next.slugEs });
    return json(res, 200, { ok: true, doc: next, problems: [] });
  }

  if (action === "unpublish" && req.method === "POST") {
    if (doc.status !== "published") throw fail(400, "It isn't published.");
    const next = await commit(doc, M.normalize({ ...doc, status: "unpublished", updatedAt: now() }), { email });
    await s.bump();
    log("resource_unpublished", email, id);
    return json(res, 200, { ok: true, doc: next, problems: publishProblems(next, others) });
  }

  if (!action && req.method === "DELETE") {
    if (doc.publishedAt) throw fail(400, "It was published once, so its URLs may be shared or indexed. Unpublish it instead (visitors get a 410).");
    for (let v = 1; v <= ((doc.file && doc.file.version) || 0); v++) await s.deleteObject(M.filePath(id, v));
    for (const l of M.LANGS) if (doc.og[l]) await s.deleteObject(doc.og[l]);
    for (const f of doc.files) if (f.path) await s.deleteObject(f.path);
    await s.remove(id);
    log("resource_deleted", email, id);
    return json(res, 200, { ok: true });
  }
  throw fail(405, "Method not allowed.");
}

/** The Config (.json) tab: read, check, save, history. */
async function configApi(req, res, id, what, n, email) {
  const s = getStore();
  const doc = await getDoc(id);
  const others = (await all()).filter((d) => d.id !== id);
  const ctx = { doc, others, mode: "json" };

  if (what === "config.json" && req.method === "GET") {
    return json(res, 200, { ok: true, text: toolconfig.configText(doc), rev: doc.rev, status: doc.status });
  }
  if (what === "config/check" && req.method === "POST") {
    const { text } = await readText(req);
    const v = configcheck.validate(text, ctx);
    const parsed = v.config && typeof v.config === "object" && !Array.isArray(v.config) ? v.config : null;
    return json(res, 200, { ok: true, valid: v.ok, errors: v.errors, warnings: v.warnings, diff: parsed ? configdiff.diff(configOf(doc), parsed) : null, rev: doc.rev });
  }
  if (what === "config.json" && req.method === "PUT") {
    const body = await readText(req);
    const source = ["json", "upload"].includes(body.source) ? body.source : "json";
    const restoredFrom = Number.isInteger(body.restoredFrom) ? body.restoredFrom : undefined;
    let parsed = null;
    try { parsed = JSON.parse(body.text); } catch {}
    await needRev(body, doc, parsed);
    const v = configcheck.validate(body.text, ctx);
    if (!v.ok) throw fail(400, `The config has ${v.errors.length} error${v.errors.length === 1 ? "" : "s"}. Nothing was saved.`, { errors: v.errors, warnings: v.warnings });
    let next = configcheck.apply(doc, v.config);
    if (toolconfig.configText(next) === toolconfig.configText(doc)) return json(res, 200, { ok: true, unchanged: true, doc, text: toolconfig.configText(doc), rev: doc.rev });
    if (doc.status === "published") {
      const probs = publishProblems(next, others);
      if (probs.length) throw fail(400, "This resource is live, so the changes must be complete before saving.", { problems: probs });
      if (body.checked !== true) throw fail(400, 'Tick "I checked the formulas and the Spanish" to update the live page.');
      next.checkedAt = now();
      if (cardInputs(next) !== cardInputs(doc) || !next.og.en || !next.og.es) next.og = await makeCards(next);
    }
    next.updatedAt = now();
    next = await commit(doc, next, { email, source, restoredFrom });
    if (doc.status !== "draft") await s.bump();
    log("resource_saved", email, id, { status: next.status, source, restoredFrom });
    return json(res, 200, { ok: true, doc: next, text: toolconfig.configText(next), rev: next.rev, warnings: v.warnings });
  }
  if (what === "revisions" && req.method === "GET") {
    const list = await s.listRevisions(id, 20);
    return json(res, 200, { ok: true, revisions: list.map((r) => ({ n: r.n, savedAt: r.savedAt, savedBy: r.savedBy, source: r.source, restoredFrom: r.restoredFrom })) });
  }
  if (what.startsWith("revisions/") && req.method === "GET") {
    const r = await s.getRevision(id, n);
    if (!r) throw fail(404, "No such revision.");
    let cfg = null;
    try { cfg = JSON.parse(r.config); } catch {}
    return json(res, 200, { ok: true, revision: r, diff: cfg ? configdiff.diff(cfg, configOf(doc)) : null });
  }
  throw fail(405, "Method not allowed.");
}

/** PDFs: upload / replace one, delete one, or set the list (order, labels, files still to upload). */
async function filesApi(req, res, id, name, email) {
  const s = getStore();
  const doc = await getDoc(id);
  const others = (await all()).filter((d) => d.id !== id);
  const save = async (files, event, extra) => {
    const next = await commit(doc, M.normalize({ ...doc, files, updatedAt: now() }), { email, source: "form" });
    if (doc.status === "published") await s.bump();
    log(event, email, id, extra);
    return json(res, 200, { ok: true, doc: next, problems: publishProblems(next, others) });
  };
  const header = (h) => { let v = String(req.headers[h] || ""); try { v = decodeURIComponent(v); } catch {} return v.trim().slice(0, 200); };

  if (name === undefined && req.method === "PUT") {
    const body = await readJson(req);
    const list = Array.isArray(body.files) ? body.files : null;
    if (!list) throw fail(400, 'Send {"files": [...]}.');
    if (list.length > M.MAX_FILES) throw fail(400, `At most ${M.MAX_FILES} files.`);
    const seen = new Set(), out = [];
    for (const f of list) {
      const n = f && typeof f.name === "string" ? f.name : "";
      if (!M.validFileName(n)) throw fail(400, M.fileNameProblem(n));
      if (seen.has(n.toLowerCase())) throw fail(400, `"${n}" is listed twice (names can't differ only in upper/lower case).`);
      seen.add(n.toLowerCase());
      const have = doc.files.find((x) => x.name === n);
      if (!have && doc.files.some((x) => x.name.toLowerCase() === n.toLowerCase())) throw fail(400, `"${n}" differs only in upper/lower case from a file already here.`);
      out.push({ ...(have || { name: n }), labelEn: String(f.labelEn ?? (have && have.labelEn) ?? ""), labelEs: String(f.labelEs ?? (have && have.labelEs) ?? "") });
    }
    // an uploaded file is never removed by a list: it stays, at the end (Delete removes it)
    for (const f of doc.files) if (f.path && !seen.has(f.name.toLowerCase())) out.push(f);
    if (out.length > M.MAX_FILES) throw fail(400, `That makes more than ${M.MAX_FILES} files. Delete some first.`);
    return save(out, "resource_files_set", { files: out.length });
  }
  if (name === undefined || !M.validFileName(name)) throw fail(400, M.fileNameProblem(name || ""));
  const i = doc.files.findIndex((f) => f.name === name);

  if (req.method === "POST") {
    const clash = doc.files.find((f) => f.name !== name && f.name.toLowerCase() === name.toLowerCase());
    if (clash) throw fail(400, `"${name}" differs only in upper/lower case from "${clash.name}". Rename one of them.`);
    if (i < 0 && doc.files.length >= M.MAX_FILES) throw fail(400, `A resource can have at most ${M.MAX_FILES} files.`);
    const buf = await readBody(req, MAX_FILE);
    try { pdfs.validatePdf(name, buf, MAX_FILE); } catch (err) { throw fail(400, err.message); }
    const p = M.pdfPath(id, name);
    await s.writeObject(p, buf, "application/pdf");
    const prev = i >= 0 ? doc.files[i] : { name, labelEn: "", labelEs: "" };
    const entry = {
      ...prev,
      labelEn: header("x-label-en") || prev.labelEn, labelEs: header("x-label-es") || prev.labelEs,
      path: p, sizeBytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), uploadedAt: now(),
    };
    const files = i >= 0 ? doc.files.map((f, k) => (k === i ? entry : f)) : [...doc.files, entry];
    return save(files, "resource_pdf", { name, bytes: buf.length, replaced: !!(prev.path) });
  }
  if (req.method === "DELETE") {
    if (i < 0) throw fail(404, `No file "${name}".`);
    if (doc.files[i].path) await s.deleteObject(doc.files[i].path);
    return save(doc.files.filter((_, k) => k !== i), "resource_pdf_deleted", { name });
  }
  throw fail(405, "Method not allowed.");
}

/** GET /resources/<slug-en>/files/<name>: an attached PDF of any resource (drafts too), for the preview. */
async function adminPdf(req, res, slug, name) {
  if (!M.validFileName(name)) throw fail(404, "No such file.");
  const docs = await all();
  const doc = docs.find((d) => d.slugEn === slug && M.uploadedFiles(d).some((f) => f.name === name));
  const file = doc && M.uploadedFiles(doc).find((f) => f.name === name);
  if (!file) throw fail(404, `No uploaded file "${name}" for the EN slug "${slug}". (Save the EN slug first if you just changed it.)`);
  await pdfs.send(req, res, {
    file, baseHeaders: SECURITY, cacheControl: "no-store",
    open: (range) => getStore().readStream(file.path, range),
    onMissing: () => send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "File missing in storage."),
  });
}

/** The uploaded file's own name (header X-File-Name, URI-encoded), just the base name. */
function fileName(req) {
  let v = String(req.headers["x-file-name"] || "");
  try { v = decodeURIComponent(v); } catch {}
  return toolconfig.baseName(v).replace(/[\u0000-\u001f]/g, "").slice(0, 200);
}

const log = (event, email, id, extra = {}) => console.log(JSON.stringify({ event, admin: email, id, ...extra }));

// --- pages ----------------------------------------------------------------------------------------
const layout = (title, body, { script = true, token = "", scripts = [] } = {}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Resources admin</title>
${token ? `<meta name="csrf-token" content="${esc(token)}">\n` : ""}
<link rel="icon" href="data:,">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/ui/katex/katex.min.css">
<link rel="stylesheet" href="/ui/admin.css">
</head>
<body>
<header class="top"><a href="/" class="brand">Resources admin</a><span class="top-links"><a href="https://josediaztutoring.com/resources/" target="_blank" rel="noopener">Live library ↗</a> <a href="/auth/logout">Sign out</a></span></header>
<main>
${body}
</main>
${scripts.map((src) => `<script src="${src}"></script>`).join("\n")}${scripts.length ? "\n" : ""}${script ? '<script src="/ui/admin.js"></script>' : ""}
</body>
</html>
`;

const STATUS_LABEL = { draft: "Draft", published: "Published", unpublished: "Unpublished" };
const live = (p) => `https://josediaztutoring.com${p}`;

async function listPage(res, token) {
  const docs = render.newest(await all()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows = docs.map((d) => `<li class="row">
    <div class="row-main">
      <a class="row-title" href="/edit/${d.id}">${esc(d.en.title || d.es.title || "(untitled)")}</a>
      <span class="badge badge-${d.status}">${STATUS_LABEL[d.status]}</span>
    </div>
    <div class="row-meta">
      <span>EN <code>${esc(d.slugEn || "—")}</code></span>
      <span>ES <code>${esc(d.slugEs || "—")}</code></span>
      <span>Updated ${esc(d.updatedAt.slice(0, 16).replace("T", " "))} UTC</span>
    </div>
    <div class="row-links">
      ${d.status === "published" ? `<a href="${live(M.pathOf(d, "en"))}" target="_blank" rel="noopener">Live EN ↗</a> <a href="${live(M.pathOf(d, "es"))}" target="_blank" rel="noopener">Live ES ↗</a>` : ""}
      ${d.file ? `<a href="/preview/${d.id}/en" target="_blank" rel="noopener">Preview EN</a> <a href="/preview/${d.id}/es" target="_blank" rel="noopener">Preview ES</a>` : ""}
    </div>
  </li>`).join("\n");
  page(res, layout("Resources", `<div class="head-row"><h1>Resources</h1><button type="button" class="btn btn-primary" id="new-resource">New resource</button></div>
<p class="msg" id="msg" role="status" aria-live="polite"></p>
${docs.length ? `<ul class="rows">\n${rows}\n</ul>` : '<p class="empty">No resources yet. Click <b>New resource</b> and drop an HTML file.</p>'}`, { token }));
}

function field(lang, key, label, value, { textarea = false, rows = 3, hint = "", counter = 0, math: hasMath = false } = {}) {
  const id = `${lang}-${key}`;
  return `<div class="field">
    <label for="${id}">${label}${counter ? ` <span class="count" data-for="${id}" data-max="${counter}"></span>` : ""}</label>
    ${textarea ? `<textarea id="${id}" name="${lang}.${key}" rows="${rows}"${hasMath ? " data-math" : ""}>${esc(value)}</textarea>` : `<input id="${id}" name="${lang}.${key}" value="${esc(value)}"${counter ? ` maxlength="400"` : ""}>`}
    ${hint ? `<p class="hint">${hint}</p>` : ""}
    ${hasMath ? `<div class="math-preview" data-for="${id}" aria-live="polite"></div>` : ""}
  </div>`;
}

function langColumn(doc, lang) {
  const t = doc[lang], L = lang === "en" ? "English" : "Español";
  const faq = (t.faq.length ? t.faq : [{ q: "", a: "" }]).map((f) => faqItem(lang, f)).join("");
  return `<fieldset class="col" data-lang="${lang}">
    <legend>${L}</legend>
    ${field(lang, "title", "Title", t.title, { hint: "What the tool is + the topic, the way a student would search." })}
    <div class="field">
      <label for="${lang}-slug">Slug</label>
      <div class="slug"><span>${M.BASE[lang]}</span><input id="${lang}-slug" name="slug${lang === "en" ? "En" : "Es"}" value="${esc(lang === "en" ? doc.slugEn : doc.slugEs)}" pattern="[a-z0-9]+(-[a-z0-9]+)*" data-auto="${(lang === "en" ? doc.slugEn : doc.slugEs) ? "0" : "1"}" autocapitalize="off" spellcheck="false"><span>/</span></div>
      <p class="hint">Lowercase letters, numbers and hyphens.${doc.publishedAt ? " Changing it adds a 301 from the old one." : " Filled from the title until you edit it."}</p>
    </div>
    ${field(lang, "description", "Description (search results)", t.description, { textarea: true, rows: 3, counter: M.DESC_MAX })}
    ${field(lang, "intro", "Intro", t.intro, { textarea: true, rows: 4, hint: "Blank line = new paragraph. $x^2$ = math.", math: true })}
    ${field(lang, "howTo", "How to use it (one step per line)", t.howTo.join("\n"), { textarea: true, rows: 4, math: true })}
    ${field(lang, "keyIdeas", "Key ideas (one per line, $...$ for math)", t.keyIdeas.join("\n"), { textarea: true, rows: 4, math: true })}
    <div class="field">
      <span class="label">FAQ</span>
      <div class="faq-list" data-lang="${lang}">${faq}</div>
      <button type="button" class="btn btn-small add-faq" data-lang="${lang}">Add a question</button>
    </div>
    ${field(lang, "keywords", "Keywords (comma-separated)", t.keywords.join(", "))}
  </fieldset>`;
}
const faqItem = (lang, f) => `<div class="faq-item">
        <input aria-label="Question" placeholder="Question" class="faq-q" value="${esc(f.q)}">
        <textarea aria-label="Answer" placeholder="Answer" class="faq-a" rows="2">${esc(f.a)}</textarea>
        <button type="button" class="btn btn-small btn-quiet remove-faq">Remove</button>
      </div>`;

async function editPage(res, id, token) {
  const doc = await getDoc(id);
  const others = (await all()).filter((d) => d.id !== id);
  const probs = publishProblems(doc, others);
  const subjects = Object.entries(M.SUBJECTS).map(([k, v]) => `<option value="${k}"${doc.subject === k ? " selected" : ""}>${esc(v.en)}</option>`).join("");
  const levels = Object.entries(M.LEVELS).map(([k, v]) => `<label class="check"><input type="checkbox" name="levels" value="${k}"${doc.levels.includes(k) ? " checked" : ""}> ${esc(v.en)}</label>`).join("");
  const exams = [`<option value="">None</option>`, ...M.EXAM_LINKS.map((x) => `<option value="${x.en}"${doc.relatedExamPage === x.en ? " selected" : ""}>${esc(x.label.en)}</option>`)].join("");
  const f = doc.file;
  // for the Related picker: every published resource but this one
  const published = render.newest(others.filter(M.isLive)).map((d) => ({ slugEn: d.slugEn, title: math.plain(d.en.title) }));
  const body = `<p class="crumb"><a href="/">← All resources</a></p>
<div class="head-row">
  <h1>${esc(doc.en.title || "New resource")}</h1>
  <span class="badge badge-${doc.status}" id="status-badge">${STATUS_LABEL[doc.status]}</span>
</div>
<script type="application/json" id="doc-data">${JSON.stringify({ doc, problems: probs, maxBytes: MAX_UPLOAD, maxFileBytes: MAX_FILE, maxFiles: M.MAX_FILES, published }).replace(/</g, "\\u003c")}</script>

<section class="card" aria-labelledby="file-h">
  <h2 id="file-h">Tool file</h2>
  <div class="drop" id="drop" tabindex="0" role="button" aria-describedby="drop-hint">
    <p><b>Drop the tool here: <code>name.html</code>, <code>name.json</code> and its PDFs</b> or <label class="link" for="file-input">choose files</label></p>
    <p class="hint" id="drop-hint">The .html is the tool (up to ${(MAX_UPLOAD / 1048576).toFixed(1)} MB); the .json with the same name fills the page text, and its <code>files</code> list names the PDFs (up to ${M.MAX_FILES}, ${(MAX_FILE / 1048576).toFixed(0)} MB each). All at once, in any order, or one at a time. Replacing the .html makes a new version; the page URL stays the same${doc.status === "published" ? " and the live page switches to it right away" : ""}.</p>
    <input type="file" id="file-input" accept=".html,.htm,.json,.pdf,text/html,application/json,application/pdf" multiple hidden>
  </div>
  <p class="file-info" id="file-info">${f ? `Version ${f.version} · ${(f.sizeBytes / 1024).toFixed(0)} KB · uploaded ${esc(f.uploadedAt.slice(0, 16).replace("T", " "))} UTC` : "No file yet."}</p>
  <ul class="warnings" id="warnings">${f ? f.warnings.map((w) => `<li>${esc(w)}</li>`).join("") : ""}</ul>
  <ul class="cfg-problems" id="cfg-file-problems"></ul>
  <div class="configs" id="configs"${doc.configs.length ? "" : " hidden"}>
    <span class="label">Config files uploaded before the editor (read-only)</span>
    <ul id="config-list">${[...doc.configs].reverse().map((c) => configItem(doc.id, c)).join("")}</ul>
  </div>
  <div class="tool-preview" id="tool-preview"${f ? "" : " hidden"}>
    <div class="tp-bar"><span>Live preview (same sandbox as the site)</span>
      <span><button type="button" class="btn btn-small" data-preview-lang="en" aria-pressed="true">EN</button><button type="button" class="btn btn-small" data-preview-lang="es" aria-pressed="false">ES</button></span></div>
    <iframe id="tool-frame" title="Tool preview" sandbox="${frame.SANDBOX}" allow="fullscreen"${f ? ` src="/frame/${doc.id}/v${f.version}"` : ""}></iframe>
  </div>
</section>

<div class="tabs" role="tablist" aria-label="Edit as">
  <button type="button" role="tab" class="tab" id="tab-form" aria-selected="true" aria-controls="files-card edit">Form</button>
  <button type="button" role="tab" class="tab" id="tab-json" aria-selected="false" aria-controls="json-panel">Config (.json)</button>
</div>

<section class="card" id="json-panel" role="tabpanel" aria-labelledby="tab-json" hidden>
  <h2>Config (.json)</h2>
  <p class="hint">Everything on this resource's page except the tool and the PDF files, in the upload format (<code>docs/resources-tool-guide.md</code>). Generated from the live data each time you open this tab. <code>file</code> and <code>version</code> are read-only; PDFs are added and removed in the Form tab (here: labels and order).</p>
  <div class="json-bar">
    <button type="button" class="btn" id="json-validate">Validate</button>
    <button type="button" class="btn btn-primary" id="json-save" disabled>Save…</button>
    <a class="btn" id="json-download" href="/download/${doc.id}/config.json" download>Download .json</a>
    <button type="button" class="btn" id="json-load">Upload .json</button>
    <button type="button" class="btn btn-quiet" id="json-reload">Discard changes</button>
    <input type="file" id="json-file" accept=".json,application/json" hidden>
  </div>
  <p class="json-status" id="json-status" role="status" aria-live="polite"></p>
  <div class="json-editor" id="json-editor"></div>
  <ul class="json-problems" id="json-problems"></ul>
  <h3 class="json-h3">History</h3>
  <p class="hint">Each save keeps the config as it was before it (last 20). Restore loads one into the editor; you then validate, check the diff and save.</p>
  <ol class="json-history" id="json-history"></ol>
</section>

<dialog class="json-dialog" id="json-dialog" aria-labelledby="json-dialog-h">
  <form method="dialog" class="json-dialog-in">
    <h2 id="json-dialog-h">Review the changes</h2>
    <p class="json-dialog-note" id="json-dialog-note"></p>
    <div class="json-diff" id="json-diff"></div>
    <label class="check big" id="json-dialog-check-row"><input type="checkbox" id="json-dialog-check"> I checked the formulas and the Spanish</label>
    <div class="buttons">
      <button type="button" class="btn btn-primary" id="json-dialog-ok">Save</button>
      <button type="submit" class="btn" value="cancel">Cancel</button>
    </div>
  </form>
</dialog>

<section class="card" aria-labelledby="files-h" id="files-card" role="tabpanel">
  <h2 id="files-h">Files (printable PDFs)</h2>
  <p class="hint">Shown on the page under “How to use it”, in this order, and linked at <code>/resources/&lt;EN slug&gt;/files/&lt;name&gt;</code> (the Spanish page links there too). Replacing a file keeps its URL. Drop PDFs in the box above, or use Replace on a row.</p>
  <div class="files-check" id="files-check" role="status" aria-live="polite" hidden></div>
  <p class="empty" id="files-empty"${doc.files.length ? " hidden" : ""}>No files.</p>
  <ol class="files-list" id="files-list"></ol>
  <div class="buttons"><button type="button" class="btn" id="files-save" disabled>Save order and labels</button></div>
  <input type="file" id="pdf-input" accept=".pdf,application/pdf" hidden>
</section>

<div class="banner" id="cfg-banner" role="status" aria-live="polite" hidden></div>

<form id="edit" class="card" novalidate role="tabpanel" aria-labelledby="tab-form">
  <h2>Page text</h2>
  <!-- phase2:draft-with-claude (button + "Notes for Claude" go here) -->
  <div class="cols">
    ${langColumn(doc, "en")}
    ${langColumn(doc, "es")}
  </div>
  <div class="meta-grid">
    <div class="field"><label for="subject">Subject</label><select id="subject" name="subject">${subjects}</select></div>
    <div class="field"><span class="label">Levels</span><div class="checks">${levels}</div></div>
    <div class="field"><label for="courseTags">Course tags (comma-separated)</label><input id="courseTags" name="courseTags" value="${esc(doc.courseTags.join(", "))}" placeholder="AP Physics 1, Algebra 1 EOC"></div>
    <div class="field"><label for="relatedExamPage">Related exam page</label><select id="relatedExamPage" name="relatedExamPage">${exams}</select></div>
    <div class="field field-wide" id="related-field">
      <label for="related-add">Related resources (shown first, in this order)</label>
      <ol class="related-list" id="related-list"></ol>
      <select id="related-add"><option value="">Add a published resource…</option></select>
      <p class="hint">After these: resources sharing a course tag, then the same subject. 3 on the page.</p>
    </div>
  </div>
</form>

<section class="card actions" aria-labelledby="pub-h">
  <h2 id="pub-h">Publish</h2>
  <ul class="problems" id="problems"></ul>
  <label class="check big"><input type="checkbox" id="checked"> I checked the formulas and the Spanish</label>
  <div class="buttons">
    <button type="button" class="btn" id="save">${doc.status === "published" ? "Update live page" : "Save draft"}</button>
    <a class="btn" id="preview-en" href="/preview/${doc.id}/en" target="_blank" rel="noopener"${f ? "" : " hidden"}>Preview page EN</a>
    <a class="btn" id="preview-es" href="/preview/${doc.id}/es" target="_blank" rel="noopener"${f ? "" : " hidden"}>Preview page ES</a>
    <button type="button" class="btn btn-primary" id="publish"${doc.status === "published" ? " hidden" : ""}>Publish</button>
    <button type="button" class="btn" id="unpublish"${doc.status === "published" ? "" : " hidden"}>Unpublish</button>
    <button type="button" class="btn btn-danger" id="delete"${doc.publishedAt ? " hidden" : ""}>Delete</button>
  </div>
  <p class="msg" id="msg" role="status" aria-live="polite"></p>
  <p class="live-links" id="live-links">${doc.status === "published" ? `Live: <a href="${live(M.pathOf(doc, "en"))}" target="_blank" rel="noopener">${esc(M.pathOf(doc, "en"))}</a> · <a href="${live(M.pathOf(doc, "es"))}" target="_blank" rel="noopener">${esc(M.pathOf(doc, "es"))}</a>` : ""}</p>
</section>`;
  page(res, layout(doc.en.title || "New resource", body, { token, scripts: ["/ui/codemirror.js", "/ui/config-editor.js"] }));
}

const configItem = (id, c) => `<li><a href="/download/${id}/config/${c.n}" download>${esc(c.name || `config-${c.n}.json`)}</a> <span class="hint">· for ${esc(c.file || "?")} · tool v${c.fileVersion || "–"} · ${esc(c.uploadedAt.slice(0, 16).replace("T", " "))} UTC</span></li>`;

/** The current config, as a .json file (so a local copy can match the live one). */
async function downloadCurrentConfig(res, id) {
  const doc = await getDoc(id);
  const name = `${doc.slugEn || doc.id}.json`.replace(/[^\w.-]/g, "_");
  send(res, 200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }, toolconfig.configText(doc));
}

async function downloadConfig(res, id, n) {
  const doc = await getDoc(id);
  const c = doc.configs.find((x) => x.n === n);
  if (!c) throw fail(404, "No such config file.");
  const buf = await getStore().readObject(c.path);
  if (!buf) throw fail(404, "Config file missing.");
  const name = (c.name || `config-${n}.json`).replace(/[^\w.-]/g, "_");
  send(res, 200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }, buf);
}

async function previewPage(req, res, id, lang) {
  const doc = await getDoc(id);
  if (!doc.file) throw fail(404, "Upload a file first.");
  const proto = req.headers["x-forwarded-proto"] || "http";
  const origin = `${proto}://${req.headers.host}`;
  const html = render.resourcePage({ doc, lang, shell: SHELL[lang], all: await all(), preview: true, frameBase: `${origin}/frame`, filesBase: origin });
  // the public template: its inline scripts and styles need a looser policy than the admin pages
  send(res, 200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'; base-uri https://josediaztutoring.com" }, html);
}

async function adminFrame(res, id, version) {
  const doc = await getDoc(id);
  if (!doc.file || version < 1 || version > doc.file.version) throw fail(404, "No such version.");
  const buf = await getStore().readObject(M.filePath(id, version));
  if (!buf) throw fail(404, "File missing.");
  // same headers as the public frame, but never cached (drafts change)
  send(res, 200, { ...frame.FRAME_HEADERS, "Cache-Control": "no-store" }, frame.inject(buf.toString("utf8")));
}

const STATIC = {
  "/ui/admin.css": "text/css; charset=utf-8", "/ui/admin.js": "text/javascript; charset=utf-8",
  "/ui/config-editor.js": "text/javascript; charset=utf-8", "/ui/codemirror.js": "text/javascript; charset=utf-8",
};

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  try {
    if (await authLib.route(req, res, url, send)) return;
  } catch (err) {
    console.error("Admin: sign-in error:", err.message);
    return send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, `Sign-in isn't set up correctly: ${err.message}`);
  }
  let email;
  try { email = await auth(req); }
  catch (err) {
    console.warn(`Admin: refused ${req.method} ${p}: ${err.message}`);
    return send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden.");
  }
  if (!email) {
    if (p.startsWith("/api/")) return json(res, 401, { ok: false, error: "You're signed out. Reload the page to sign in again (your edits stay in the form)." });
    if (req.method === "GET" || req.method === "HEAD") return send(res, 302, { Location: `/auth/login?next=${encodeURIComponent(authLib.safeNext(p + url.search))}` }, "");
    return send(res, 401, { "Content-Type": "text/plain; charset=utf-8" }, "Sign in first.");
  }
  try {
    if (p.startsWith("/api/")) return await api(req, res, p, email);
    if (req.method !== "GET" && req.method !== "HEAD") throw fail(405, "Method not allowed.");
    let m0;
    if ((m0 = p.match(/^\/ui\/katex\/(katex\.min\.css|fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2|woff|ttf))$/))) {
      const type = { css: "text/css; charset=utf-8", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf" }[m0[1].split(".").pop()];
      return send(res, 200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" }, fs.readFileSync(path.join(KATEX_DIST, m0[1])));
    }
    if (STATIC[p]) return send(res, 200, { "Content-Type": STATIC[p], "Cache-Control": "no-cache" }, fs.readFileSync(path.join(UI, path.basename(p))));
    if (p === "/") return await listPage(res, await csrf(req, email));
    let m;
    if ((m = p.match(/^\/edit\/([a-z0-9]{10})$/))) return await editPage(res, m[1], await csrf(req, email));
    if ((m = p.match(/^\/download\/([a-z0-9]{10})\/config\.json$/))) return await downloadCurrentConfig(res, m[1]);
    if ((m = p.match(/^\/preview\/([a-z0-9]{10})\/(en|es)$/))) return await previewPage(req, res, m[1], m[2]);
    if ((m = p.match(/^\/frame\/([a-z0-9]{10})\/v([0-9]{1,6})$/))) return await adminFrame(res, m[1], Number(m[2]));
    if ((m = p.match(/^\/download\/([a-z0-9]{10})\/config\/([0-9]{1,4})$/))) return await downloadConfig(res, m[1], Number(m[2]));
    if ((m = p.match(/^\/resources\/([a-z0-9-]{1,100})\/files\/([^/]+)$/))) return await adminPdf(req, res, m[1], m[2]);
    throw fail(404, "Not found.");
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Admin error:", err);
    if (p.startsWith("/api/")) return json(res, status, { ok: false, error: status >= 500 ? `Something went wrong: ${err.message}` : err.message, ...(err.extra || {}) });
    return page(res, layout("Error", `<h1>${status === 404 ? "Not found" : "Error"}</h1><p>${esc(err.message)}</p><p><a href="/">Back to the list</a></p>`, { script: false }), status);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => { console.error(err); if (!res.headersSent) send(res, 500, { "Content-Type": "text/plain" }, "Error"); });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Admin listening on ${PORT}; store: ${getStore().kind}${process.env.DEV_NO_IAP === "1" ? " (DEV_NO_IAP: no sign-in check)" : ""}`);
    if (!process.env.DEV_NO_IAP && !iap.allowedEmails().length) console.error("ADMIN_EMAILS is not set (admin.yaml): every request will be refused.");
  });
}

module.exports = {
  server,
  _setStore: (s) => { store = s; },
  _setCards: (c) => { cards = () => c; },
  _setAuth: (fn) => { auth = fn; },
  _csrfToken: (email) => csrf({ headers: {} }, email), // tests: the token for a stubbed sign-in
};
