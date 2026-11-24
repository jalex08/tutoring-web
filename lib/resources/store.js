/**
 * Where resources live. Three stores with the same interface:
 *   gcpStore   Firestore (REST) for the metadata + a private Cloud Storage bucket (REST) for files.
 *              Auth: the App Engine service account's token from the metadata server. No client
 *              libraries (same pattern as server.js's Secret Manager calls).
 *   dirStore   a local folder (npm run dev / npm run admin:dev): docs/<id>.json, meta.json, objects/...
 *   memoryStore  tests.
 *
 * Interface (all async):
 *   list() -> [doc]           every resource (any status)
 *   get(id) -> doc | null
 *   put(doc)                  create or replace (admin)
 *   remove(id)                (admin)
 *   rev() -> string           changes on every bump(); the public cache reloads list() only when it changes
 *   bump()                    (admin, after any change the public site must see)
 *   readObject(path) -> Buffer | null
 *   readStream(path, { start, end }) -> Readable | null   bytes start..end (inclusive; both optional),
 *                             streamed (PDFs: no whole-file buffering, Range requests)
 *   writeObject(path, buf, contentType)   (admin)
 *   deleteObject(path)        (admin)
 *
 * Firestore layout: collection `resources` (doc id = resource id), document `meta/resources`
 * { rev, updatedAt }. Dates are ISO strings.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const rangeHeader = ({ start, end } = {}) => (start === undefined && end === undefined ? "" : `bytes=${start || 0}-${end === undefined ? "" : end}`);

// --- Firestore REST value encoding -----------------------------------------------------------------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(toValue) } : {} };
  if (typeof v === "object") return { mapValue: { fields: toFields(v) } };
  throw new Error(`can't store ${typeof v}`);
}
function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f[k] = toValue(v);
  return f;
}
function fromValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = fromValue(v);
  return o;
}

// --- metadata-server token (cached until shortly before it expires) -------------------------------
let tok = null;
async function token() {
  if (tok && Date.now() < tok.until) return tok.value;
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`metadata token: HTTP ${r.status}`);
  const j = await r.json();
  tok = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 300) - 120) * 1000 };
  return tok.value;
}

async function call(url, opts = {}, { okMissing = false } = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${await token()}`, ...(opts.headers || {}) } });
  if (okMissing && r.status === 404) return null;
  if (!r.ok) {
    let msg = "";
    try { msg = (await r.text()).replace(/\s+/g, " ").slice(0, 400); } catch {} // one log line
    throw new Error(`${opts.method || "GET"} ${url.replace(/\?.*/, "")}: HTTP ${r.status} ${msg}`);
  }
  return r;
}

function gcpStore({ project, database = "(default)", bucket }) {
  if (!project) throw new Error("resources store: GOOGLE_CLOUD_PROJECT is not set");
  if (!bucket) throw new Error("resources store: RESOURCES_BUCKET is not set");
  const docs = `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}/documents`;
  const obj = (p) => `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(p)}`;
  const json = (body) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    kind: `firestore:${database} + gs://${bucket}`,
    async list() {
      const out = [];
      let pageToken = "";
      do {
        const r = await call(`${docs}/resources?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
        const j = await r.json();
        for (const d of j.documents || []) out.push({ ...fromFields(d.fields), id: d.name.split("/").pop() });
        pageToken = j.nextPageToken || "";
      } while (pageToken);
      return out;
    },
    async get(id) {
      const r = await call(`${docs}/resources/${encodeURIComponent(id)}`, {}, { okMissing: true });
      if (!r) return null;
      const d = await r.json();
      return { ...fromFields(d.fields), id };
    },
    async put(doc) {
      const { id, ...rest } = doc;
      await call(`${docs}/resources/${encodeURIComponent(id)}`, { method: "PATCH", ...json({ fields: toFields(rest) }) });
    },
    async remove(id) {
      await call(`${docs}/resources/${encodeURIComponent(id)}`, { method: "DELETE" }, { okMissing: true });
    },
    async rev() {
      const r = await call(`${docs}/meta/resources`, {}, { okMissing: true });
      if (!r) return "0";
      return String(fromFields((await r.json()).fields).rev || "0");
    },
    async bump() {
      const now = new Date().toISOString();
      await call(`${docs}/meta/resources`, { method: "PATCH", ...json({ fields: toFields({ rev: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, updatedAt: now }) }) });
    },
    async readObject(p) {
      const r = await call(`${obj(p)}?alt=media`, {}, { okMissing: true });
      return r ? Buffer.from(await r.arrayBuffer()) : null;
    },
    async readStream(p, opts = {}) {
      const range = rangeHeader(opts);
      const r = await call(`${obj(p)}?alt=media`, range ? { headers: { Range: range } } : {}, { okMissing: true });
      return r ? Readable.fromWeb(r.body) : null;
    },
    async writeObject(p, buf, contentType) {
      await call(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(p)}`, {
        method: "POST", headers: { "Content-Type": contentType }, body: buf,
      });
    },
    async deleteObject(p) {
      await call(obj(p), { method: "DELETE" }, { okMissing: true });
    },
  };
}

// --- local folder ------------------------------------------------------------------------------------
function dirStore(dir) {
  const root = path.resolve(dir);
  const docFile = (id) => path.join(root, "docs", `${id}.json`);
  const objFile = (p) => {
    const f = path.resolve(root, "objects", p);
    if (!f.startsWith(path.join(root, "objects") + path.sep)) throw new Error("bad object path");
    return f;
  };
  const write = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
  return {
    kind: `folder ${root}`,
    async list() {
      const d = path.join(root, "docs");
      if (!fs.existsSync(d)) return [];
      return fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(d, f), "utf8")), id: f.slice(0, -5) }));
    },
    async get(id) { const f = docFile(id); return fs.existsSync(f) ? { ...JSON.parse(fs.readFileSync(f, "utf8")), id } : null; },
    async put(doc) { write(docFile(doc.id), JSON.stringify(doc, null, 2)); },
    async remove(id) { fs.rmSync(docFile(id), { force: true }); },
    async rev() {
      const f = path.join(root, "meta.json");
      return fs.existsSync(f) ? String(JSON.parse(fs.readFileSync(f, "utf8")).rev) : "0";
    },
    async bump() { write(path.join(root, "meta.json"), JSON.stringify({ rev: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, updatedAt: new Date().toISOString() })); },
    async readObject(p) { const f = objFile(p); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
    async readStream(p, { start, end } = {}) { const f = objFile(p); return fs.existsSync(f) ? fs.createReadStream(f, { start, end }) : null; },
    async writeObject(p, buf) { write(objFile(p), buf); },
    async deleteObject(p) { fs.rmSync(objFile(p), { force: true }); },
  };
}

// --- memory (tests) ---------------------------------------------------------------------------------
function memoryStore() {
  const docs = new Map(), objects = new Map();
  let rev = 0;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    kind: "memory",
    calls: { list: 0, rev: 0, readObject: 0, readStream: 0 },
    async list() { this.calls.list++; return [...docs.values()].map(clone); },
    async get(id) { return docs.has(id) ? clone(docs.get(id)) : null; },
    async put(doc) { docs.set(doc.id, clone(doc)); },
    async remove(id) { docs.delete(id); },
    async rev() { this.calls.rev++; return String(rev); },
    async bump() { rev++; },
    async readObject(p) { this.calls.readObject++; return objects.has(p) ? Buffer.from(objects.get(p)) : null; },
    async readStream(p, { start = 0, end } = {}) {
      this.calls.readStream++;
      if (!objects.has(p)) return null;
      const b = objects.get(p);
      return Readable.from([Buffer.from(b.subarray(start, end === undefined ? b.length : end + 1))]);
    },
    async writeObject(p, buf) { objects.set(p, Buffer.from(buf)); },
    async deleteObject(p) { objects.delete(p); },
    _objects: objects,
  };
}

/** The store for this process: RESOURCES_DIR (local folder) if set, else Firestore + Cloud Storage. */
function fromEnv(env = process.env) {
  if (env.RESOURCES_DIR) return dirStore(env.RESOURCES_DIR);
  return gcpStore({ project: env.GOOGLE_CLOUD_PROJECT, database: env.FIRESTORE_DATABASE || "(default)", bucket: env.RESOURCES_BUCKET });
}

module.exports = { gcpStore, dirStore, memoryStore, fromEnv, toFields, fromFields, toValue, fromValue };
