/**
 * Validates a resource config (the .json format) the same way everywhere: the upload of a tool pair,
 * a .json-only upload, and the admin's Config (.json) editor. Two steps:
 *   1. the JSON Schema (schemas/resource-config.schema.json, Ajv, draft 2020-12);
 *   2. once that passes, the cross-checks that need the other resources, the bucket or KaTeX.
 * Every problem has a field path ("es.description", "en.faq[2].q"), a message in plain words and, when
 * the text is given, the line it's on (so the editor can jump there).
 *
 * Admin only (the public site never validates configs). scripts/build.js copies this file to
 * admin/lib/resources/ and the schema to admin/lib/resource-config.schema.json.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;
const katex = require("katex");
const M = require("./model.js");
const math = require("./math.js");
const toolconfig = require("./toolconfig.js");

const SCHEMA = JSON.parse(fs.readFileSync([
  path.join(__dirname, "../resource-config.schema.json"), // admin/lib/ (deployed copy)
  path.join(__dirname, "../../schemas/resource-config.schema.json"), // the source, in the repo
].find((f) => fs.existsSync(f)), "utf8"));
const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: true });
const schemaCheck = ajv.compile(SCHEMA);
const MAX_BYTES = toolconfig.MAX_BYTES;
const LANG_KEYS = ["title", "slug", "description", "intro", "howTo", "keyIdeas", "faq", "keywords"];

// --- paths and lines ----------------------------------------------------------------------------
/** JSON pointer "/en/faq/2/q" -> "en.faq[2].q" ("" -> "config"). */
function fieldPath(pointer) {
  const parts = String(pointer || "").split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let out = "";
  for (const p of parts) out += /^\d+$/.test(p) ? `[${p}]` : (out ? `.${p}` : p);
  return out || "config";
}
const pointerOf = (...keys) => keys.map((k) => `/${String(k).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");

/**
 * The line (1-based) where each value starts, by JSON pointer, and where each key is written
 * ({ values: Map, keys: Map }). Expects text JSON.parse accepts.
 */
function locate(text) {
  const s = String(text).replace(/^﻿/, "");
  const values = new Map(), keys = new Map();
  let i = 0, line = 1;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) { if (s[i] === "\n") line++; i++; } };
  const str = () => { i++; let out = ""; while (i < s.length && s[i] !== '"') { if (s[i] === "\\") { out += s[i] + s[i + 1]; i += 2; } else out += s[i++]; } i++; return JSON.parse(`"${out}"`); };
  function value(ptr) {
    ws();
    values.set(ptr, line);
    const c = s[i];
    if (c === "{") {
      i++; ws();
      if (s[i] === "}") { i++; return; }
      for (;;) {
        ws(); const kLine = line; const k = str(); const p = `${ptr}${pointerOf(k)}`;
        keys.set(p, kLine);
        ws(); i++; // :
        value(p); ws();
        if (s[i] === ",") { i++; continue; }
        i++; return; // }
      }
    }
    if (c === "[") {
      i++; ws();
      if (s[i] === "]") { i++; return; }
      for (let n = 0; ; n++) {
        value(`${ptr}/${n}`); ws();
        if (s[i] === ",") { i++; continue; }
        i++; return; // ]
      }
    }
    if (c === '"') { str(); return; }
    while (i < s.length && !/[\s,\]}]/.test(s[i])) i++; // number, true, false, null
  }
  try { value(""); } catch { /* best effort: lines are a convenience */ }
  return { values, keys };
}
/** The line to show for a pointer: the key's line if it has one, else the value's, else the parent's. */
function lineFor(loc, pointer) {
  if (!loc) return 0;
  for (let p = pointer; ; p = p.slice(0, p.lastIndexOf("/"))) {
    if (loc.keys.has(p)) return loc.keys.get(p);
    if (loc.values.has(p)) return loc.values.get(p);
    if (!p) return 1;
  }
}

// --- step 1: schema -----------------------------------------------------------------------------
const show = (v) => { const t = JSON.stringify(v); return t && t.length > 60 ? `${t.slice(0, 57)}…"` : t; };
const TYPE_WORD = { string: "text", array: "a list", object: "an object ({ ... })", integer: "a whole number", number: "a number", boolean: "true or false" };
const range = (sch, lo, hi, unit) => (sch[lo] !== undefined && sch[hi] !== undefined ? `${sch[lo]} to ${sch[hi]} ${unit}` : sch[lo] !== undefined ? `at least ${sch[lo]} ${unit}` : `at most ${sch[hi]} ${unit}`);

/** One Ajv error -> { pointer, message } in plain words. */
function plain(e) {
  const at = fieldPath(e.instancePath), sch = e.parentSchema || {}, v = e.data;
  switch (e.keyword) {
    case "required": {
      const p = `${e.instancePath}${pointerOf(e.params.missingProperty)}`;
      return { pointer: p, at: e.instancePath, message: `${fieldPath(p)} is missing.` };
    }
    case "additionalProperties": {
      const p = `${e.instancePath}${pointerOf(e.params.additionalProperty)}`;
      return { pointer: p, message: `${fieldPath(p)} is not a field of the config format. Check the spelling (fields are case-sensitive).` };
    }
    case "type": return { pointer: e.instancePath, message: `${at} must be ${TYPE_WORD[e.params.type] || e.params.type}, not ${show(v)}.` };
    case "const": return { pointer: e.instancePath, message: at === "version" ? `version must be ${e.params.allowedValue} (it's read-only: the config format this admin reads).` : `${at} must be ${show(e.params.allowedValue)}.` };
    case "enum": return { pointer: e.instancePath, message: `${at} is ${show(v)}; use one of: ${e.params.allowedValues.join(", ")}.` };
    case "maxLength": return { pointer: e.instancePath, message: `${at} is ${v.length} characters; max ${e.params.limit}.` };
    case "minLength": return { pointer: e.instancePath, message: `${at} is empty.` };
    case "minItems": case "maxItems": {
      const n = Array.isArray(v) ? v.length : 0;
      return { pointer: e.instancePath, message: `${at} has ${n} item${n === 1 ? "" : "s"}; it needs ${range(sch, "minItems", "maxItems", "items")}.` };
    }
    case "uniqueItems": return { pointer: `${e.instancePath}/${e.params.i}`, message: `${at} lists ${show(v[e.params.i])} twice.` };
    case "pattern":
      if (at === "file") return { pointer: e.instancePath, message: `file is ${show(v)}; it must be the tool's .html file name.` };
      return { pointer: e.instancePath, message: `${at} is ${show(v)}: it must be ${sch.description || `in the form ${e.params.pattern}`}.` };
    default: return { pointer: e.instancePath, message: `${at}: ${e.message}.` };
  }
}

// --- the whole check ----------------------------------------------------------------------------
/**
 * validate(input, ctx) -> { ok, errors, warnings, config }
 *   input   the config's text (preferred: gives line numbers) or an already parsed object
 *   ctx.doc        the resource as stored (normalized), or null for a brand-new one
 *   ctx.others     every other resource (normalized)
 *   ctx.mode       "json": the editor, a .json-only upload, a restore (file and version are read-only;
 *                  `files` must list exactly the uploaded PDFs)
 *                  "upload": a tool pair being uploaded (file = ctx.htmlName; PDFs named in
 *                  ctx.pendingPdfs are being uploaded with it and count as present)
 *   errors / warnings: [{ path, message, line }]
 */
function validate(input, { doc = null, others = [], mode = "json", htmlName = "", pendingPdfs = [] } = {}) {
  const errors = [], warnings = [];
  let text = null, config = input;
  if (typeof input === "string" || Buffer.isBuffer(input)) {
    text = String(input).replace(/^﻿/, "");
    if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, errors: [{ path: "config", message: `The config is ${Math.ceil(Buffer.byteLength(text) / 1024)} KB; max ${MAX_BYTES / 1024} KB.`, line: 1 }], warnings, config: null };
    try { config = toolconfig.parseJson(text); }
    catch (e) {
      const m = e.message.match(/line (\d+)/);
      return { ok: false, errors: [{ path: "config", message: e.message, line: m ? Number(m[1]) : 1 }], warnings, config: null };
    }
  }
  const loc = text !== null ? locate(text) : null;
  const add = (list, pointer, message) => list.push({ path: fieldPath(pointer), message, line: lineFor(loc, pointer) });

  // 1. schema
  if (!schemaCheck(config)) {
    const seen = new Set();
    for (const e of schemaCheck.errors) {
      const p = plain(e);
      const key = `${p.pointer}|${p.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({ path: fieldPath(p.pointer), message: p.message, line: lineFor(loc, p.at !== undefined ? p.at : p.pointer) });
    }
    return { ok: false, errors, warnings, config };
  }

  // 2. cross-checks
  const c = config, selfId = doc ? doc.id : "";
  const rest = others.filter((o) => o.id !== selfId);

  // file and version are read-only (the schema already pins version)
  if (mode === "upload") {
    if (htmlName && toolconfig.baseName(c.file) !== toolconfig.baseName(htmlName)) add(errors, "/file", `file is "${c.file}", but the tool file uploaded with it is "${toolconfig.baseName(htmlName)}". Check that they belong together.`);
  } else {
    const current = (doc && doc.file && doc.file.name) || "";
    const legacy = doc && doc.file && !doc.file.name; // uploaded before file names were kept: can't compare
    if (!legacy && c.file !== current) add(errors, "/file", `file is read-only: it's "${current}" for this resource${c.file ? `, not "${c.file}"` : ""}. To replace the HTML, use Replace file.`);
  }

  // slugs: reserved names, and unique across every other resource's current and old slugs
  for (const lang of M.LANGS) {
    const s = c[lang].slug;
    if (M.RESERVED_SLUGS.has(s)) { add(errors, pointerOf(lang, "slug"), `${lang}.slug "${s}" is reserved by the site; pick another.`); continue; }
    const taken = rest.find((o) => M.slugOf(o, lang) === s || M.historyOf(o, lang).includes(s));
    if (taken) add(errors, pointerOf(lang, "slug"), `${lang}.slug "${s}" is already used by "${taken[lang].title || taken.id}"${M.slugOf(taken, lang) === s ? "" : " (as an old slug that redirects)"}. Try "${toolconfig.freeSlug(s, lang, rest)}".`);
  }

  // related: never itself (error); every slug should resolve to a resource (warning)
  const own = new Set([c.en.slug, ...(doc ? [doc.slugEn, ...M.historyOf(doc, "en")] : [])].filter(Boolean));
  (c.related || []).forEach((s, i) => {
    const p = pointerOf("related", i);
    if (own.has(s)) { add(errors, p, `related[${i}] is "${s}", this resource itself. Remove it.`); return; }
    const o = rest.find((d) => d.slugEn === s) || rest.find((d) => M.historyOf(d, "en").includes(s));
    if (!o) add(warnings, p, `related[${i}]: no resource has the EN slug "${s}" (current or old). It's kept, and shows once a resource with that slug is published.`);
    else if (!M.isLive(o)) add(warnings, p, `related[${i}]: "${s}" isn't published, so the page skips it until it is.`);
    else if (o.slugEn !== s) add(warnings, p, `related[${i}]: "${s}" is an old slug of "${o.slugEn}". It still works; you can update it.`);
  });

  // files: every listed PDF must be uploaded for this resource; in the editor, every uploaded one listed
  const uploaded = new Set(doc ? M.uploadedFiles(doc).map((f) => f.name) : []);
  const pending = new Set(pendingPdfs);
  (c.files || []).forEach((f, i) => {
    if (!uploaded.has(f.file) && !pending.has(f.file)) {
      add(errors, pointerOf("files", i, "file"), mode === "upload"
        ? `files[${i}].file "${f.file}" isn't uploaded for this resource. Drop the PDF with the tool.`
        : `files[${i}].file "${f.file}" isn't uploaded for this resource. Upload it in Files first (this editor changes labels and order only).`);
    }
  });
  const names = (c.files || []).map((f) => f.file.toLowerCase());
  names.forEach((n, i) => { if (names.indexOf(n) !== i) add(errors, pointerOf("files", i, "file"), `files[${i}].file "${c.files[i].file}" is listed twice (names can't differ only in upper/lower case).`); });
  if (mode === "json") {
    const listed = new Set((c.files || []).map((f) => f.file));
    const missing = [...uploaded].filter((n) => !listed.has(n));
    if (missing.length) add(errors, c.files ? "/files" : "", `files must list every uploaded PDF; missing: ${missing.join(", ")}. (To remove a PDF, delete it in Files.)`);
  }

  // every $...$ in keyIdeas renders with KaTeX
  for (const lang of M.LANGS) {
    c[lang].keyIdeas.forEach((s, i) => {
      for (const part of math.parts(s)) {
        if (part.math === undefined) continue;
        try { katex.renderToString(part.math, { displayMode: part.display, throwOnError: true, trust: false, strict: "ignore" }); }
        catch (e) { add(errors, pointerOf(lang, "keyIdeas", i), `${lang}.keyIdeas[${i}]: the formula "${part.math}" doesn't render: ${String(e.message || e).replace(/^KaTeX parse error: /, "")}`); }
      }
    });
  }

  // EN and ES: same keys and the same number of steps, ideas and questions
  const ek = Object.keys(c.en).sort().join(), sk = Object.keys(c.es).sort().join();
  if (ek !== sk) add(warnings, "/es", `en and es don't have the same fields (en: ${ek}; es: ${sk}).`);
  for (const k of ["howTo", "keyIdeas", "faq"]) {
    if (c.en[k].length !== c.es[k].length) add(warnings, pointerOf("es", k), `en.${k} has ${c.en[k].length} items but es.${k} has ${c.es[k].length}. Usually they match one to one.`);
  }

  return { ok: errors.length === 0, errors, warnings, config };
}

/**
 * The stored resource after a config is applied: the config's fields replace the doc's, PDFs keep
 * their uploads (only order and labels come from the config), and a slug change on a resource that
 * was ever published goes into the slug history (-> 301). Call only with a config validate() passed.
 */
function apply(doc, c) {
  const byName = new Map(doc.files.map((f) => [f.name, f]));
  const files = (c.files || []).map((f) => ({ ...(byName.get(f.file) || { name: f.file }), labelEn: f.en, labelEs: f.es }));
  for (const f of doc.files) if (!files.some((x) => x.name === f.name)) files.push(f); // (upload mode: not listed, kept at the end)
  const text = (t) => ({ title: t.title, description: t.description, intro: t.intro, howTo: t.howTo, keyIdeas: t.keyIdeas, faq: t.faq, keywords: t.keywords });
  const next = M.normalize({
    ...doc,
    slugEn: c.en.slug, slugEs: c.es.slug, en: text(c.en), es: text(c.es),
    subject: c.subject, levels: c.levels, courseTags: c.courseTags,
    relatedExamPage: c.relatedExamPage || "", related: c.related || [], files,
  });
  return M.applySlugChange(doc, next);
}

module.exports = { SCHEMA, LANG_KEYS, validate, apply, locate, fieldPath, pointerOf };
