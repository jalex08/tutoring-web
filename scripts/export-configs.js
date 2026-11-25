#!/usr/bin/env node
/**
 * Exports every resource's config from Firestore, in exactly the upload format (toolconfig.toConfig),
 * one <en-slug>.json per resource. READ-ONLY: it only lists the `resources` collection; it never writes
 * to Firestore or Cloud Storage. Run from your own machine, signed in with gcloud
 * (it uses `gcloud auth print-access-token`). Project jalex-hub only.
 *
 *   node scripts/export-configs.js                 every resource -> test/fixtures/live-configs/
 *   node scripts/export-configs.js --out <dir>     somewhere else
 *   node scripts/export-configs.js --published     published resources only
 *
 * The folder is a snapshot for the tests, not a master copy: the server is the source of truth. Re-run
 * it to refresh. Files for resources that no longer exist are removed from the folder (only *.json files
 * this script wrote, listed in _export.json). Also writes _export.json: when, which project, and each
 * file's resource id, status and last update.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fromFields } = require("../lib/resources/store.js");
const M = require("../lib/resources/model.js");
const toolconfig = require("../lib/resources/toolconfig.js");

const PROJECT = "jalex-hub";
const DATABASE = "(default)";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents`;

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = path.resolve(arg("--out") || path.join(__dirname, "..", "test", "fixtures", "live-configs"));
const ONLY_PUBLISHED = args.includes("--published");
for (const a of args) if (a.startsWith("--") && !["--out", "--published"].includes(a)) { console.error(`Unknown option ${a}`); process.exit(2); }

(async () => {
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const get = async (url) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`GET ${url.replace(/\?.*/, "")}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.json();
  };

  const docs = [];
  let pageToken = "";
  do {
    const j = await get(`${DOCS}/resources?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    for (const d of j.documents || []) docs.push(M.normalize({ ...fromFields(d.fields), id: d.name.split("/").pop() }));
    pageToken = j.nextPageToken || "";
  } while (pageToken);

  const picked = M.newest(docs.filter((d) => !ONLY_PUBLISHED || d.status === "published"));
  fs.mkdirSync(OUT, { recursive: true });

  // files from the previous export that this one won't rewrite
  const indexPath = path.join(OUT, "_export.json");
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(indexPath, "utf8")).resources.map((r) => r.file); } catch {}

  const index = [], written = new Set();
  for (const d of picked) {
    const name = `${d.slugEn || d.id}.json`; // a draft without a slug yet: its id
    if (written.has(name)) throw new Error(`Two resources would both be ${name}. Fix the slugs first.`);
    written.add(name);
    fs.writeFileSync(path.join(OUT, name), toolconfig.configText(d));
    index.push({ file: name, id: d.id, status: d.status, slugEn: d.slugEn, slugEs: d.slugEs, updatedAt: d.updatedAt, publishedAt: d.publishedAt });
    console.log(`${d.status.padEnd(11)} ${name}  (${d.id})`);
  }
  for (const f of previous) {
    if (!written.has(f) && /^[a-z0-9-]+\.json$/.test(f) && fs.existsSync(path.join(OUT, f))) {
      fs.unlinkSync(path.join(OUT, f));
      console.log(`removed     ${f}  (no longer in Firestore${ONLY_PUBLISHED ? " or not published" : ""})`);
    }
  }
  fs.writeFileSync(indexPath, `${JSON.stringify({
    note: "Snapshot of the live configs for the tests. The server is the source of truth; re-run scripts/export-configs.js to refresh.",
    exportedAt: new Date().toISOString(), project: PROJECT, resources: index,
  }, null, 2)}\n`);
  console.log(`\n${index.length} config(s) from ${PROJECT} -> ${path.relative(process.cwd(), OUT) || "."}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
