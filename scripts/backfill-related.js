#!/usr/bin/env node
/**
 * One-off: sets `related` on the four live tools so they link as a chain. Run from your own machine,
 * signed in with gcloud (it uses `gcloud auth print-access-token`). Project jalex-hub only.
 *
 *   node scripts/backfill-related.js            dry run: shows each resource's current and new value
 *   node scripts/backfill-related.js --write    writes them (only the `related` field), then bumps the
 *                                               change marker so the site picks it up in ~30 s
 *
 * Refuses to write anything unless all four sources and every target exist and are published.
 * Run it again any time: it only changes what differs. Undo: the same with RELATED values of [].
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { toFields, fromFields } = require("../lib/resources/store.js");

const PROJECT = "jalex-hub";
const DATABASE = "(default)";
const RELATED = {
  "trigonometry-playground": ["projectile-motion-lab"],
  "projectile-motion-lab": ["motion-graphs-lab", "trigonometry-playground"],
  "motion-graphs-lab": ["projectile-motion-lab", "rc-circuit-lab"],
  "rc-circuit-lab": ["motion-graphs-lab"],
};

const write = process.argv.includes("--write");
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents`;
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
async function call(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${url.replace(/\?.*/, "")}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

(async () => {
  const docs = [];
  let pageToken = "";
  do {
    const j = await call(`${DOCS}/resources?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    for (const d of j.documents || []) docs.push({ ...fromFields(d.fields), id: d.name.split("/").pop() });
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  const bySlug = new Map(docs.map((d) => [d.slugEn, d]));
  const live = (d) => d && d.status === "published" && (d.visibility || "public") === "public";

  const problems = [];
  for (const [slug, targets] of Object.entries(RELATED)) {
    if (!live(bySlug.get(slug))) problems.push(`${slug}: ${bySlug.has(slug) ? `status ${bySlug.get(slug).status}` : "no resource with this EN slug"}`);
    for (const t of targets) if (!live(bySlug.get(t))) problems.push(`${slug} -> ${t}: ${bySlug.has(t) ? `status ${bySlug.get(t).status}` : "no resource with this EN slug"}`);
  }
  console.log(`project ${PROJECT}, ${docs.length} resources\n`);
  if (problems.length) {
    console.log(`Not writing anything. Fix these first:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  let changed = 0;
  for (const [slug, targets] of Object.entries(RELATED)) {
    const d = bySlug.get(slug);
    const now = JSON.stringify(d.related || []), next = JSON.stringify(targets);
    console.log(`${slug} (${d.id})\n  now: ${now}\n  new: ${next}${now === next ? "  (same, skipped)" : ""}`);
    if (now === next || !write) continue;
    // only the `related` field; the document must exist
    await call(`${DOCS}/resources/${d.id}?updateMask.fieldPaths=related&currentDocument.exists=true`, { method: "PATCH", body: JSON.stringify({ fields: toFields({ related: targets }) }) });
    changed++;
  }
  if (write && changed) {
    await call(`${DOCS}/meta/resources`, { method: "PATCH", body: JSON.stringify({ fields: toFields({ rev: `${Date.now()}-backfill-related`, updatedAt: new Date().toISOString() }) }) });
    console.log(`\nWrote ${changed} resource(s) and bumped meta/resources. Live within ~30 s.`);
  } else console.log(write ? "\nNothing to change." : "\nDry run. Add --write to apply.");
})().catch((e) => { console.error(e.message); process.exit(1); });
