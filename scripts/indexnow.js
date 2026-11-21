#!/usr/bin/env node
/**
 * Tells IndexNow (Bing, Yandex, Seznam, Naver, Yep, Internet Archive, Amazon) which pages
 * changed, so they re-crawl them. Run it after a deploy has 100% of traffic. No dependencies.
 *
 *   npm run indexnow                          submit seo/pending-indexnow.json (from `npm run build`)
 *   npm run indexnow -- --urls / /es/         submit exactly these paths (e.g. after a change
 *                                             that doesn't alter the built HTML)
 *   npm run indexnow -- --dry-run             print the payload, send nothing
 *
 * On 200/202 the submitted pages' entries (content hash + lastmod, and for the exam pages the
 * content date + exam data revision) go into seo/published-pages.json and leave the pending list.
 * Commit seo/published-pages.json afterwards: the build reads the dates from it, so a fresh clone
 * builds the same dates. On any failure the pending list is kept for the next run.
 * It never retries and always exits 0 on a failed ping, so it can't break a deploy
 * (exit 1 only for bad --urls arguments).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HOST = "josediaztutoring.com";
const SITE = `https://${HOST}`;
const KEY = "0d95e31492514b3c9a3e7edb5eb12be5";
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const PUBLISHED = path.join(ROOT, "seo/published-pages.json");
const PENDING = path.join(ROOT, "seo/pending-indexnow.json");
const SITEMAP = path.join(ROOT, "www/sitemap.xml");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const readJson = (f, dflt) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : dflt);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const stop = (msg, code = 0) => { console.log(`IndexNow: ${msg}`); process.exit(code); };

const MEANING = {
  400: "bad request (invalid format)",
  403: "key not valid (key file not found or doesn't match)",
  422: "URLs don't belong to the host, or the key doesn't match",
  429: "too many requests (possible spam); try again later",
};

async function main() {
  const allowed = new Set([...fs.readFileSync(SITEMAP, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const pending = readJson(PENDING, []);

  let urls;
  const i = args.indexOf("--urls");
  if (i >= 0) {
    const paths = args.slice(i + 1).filter((a) => !a.startsWith("--"));
    if (!paths.length) stop("--urls needs at least one path, e.g. --urls / /es/", 1);
    urls = paths.map((p) => (p.startsWith("http") ? p : SITE + (p.startsWith("/") ? p : "/" + p)));
  } else {
    urls = pending.map((p) => p.url);
    if (!urls.length) stop("nothing changed");
  }

  // validate: our host only (never www.), one of the sitemap URLs, no duplicates
  const bad = urls.filter((u) => !u.startsWith(`${SITE}/`) || !allowed.has(u));
  if (bad.length) stop(`not sent: not one of the ${allowed.size} sitemap URLs: ${bad.join(", ")}`, 1);
  const dupes = urls.filter((u, n) => urls.indexOf(u) !== n);
  if (dupes.length) stop(`not sent: duplicate URLs: ${[...new Set(dupes)].join(", ")}`, 1);

  const payload = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls };

  // the live key file must be exactly the key, or every engine will reject the ping
  let keyOk = false, keyNote;
  try {
    const r = await fetch(KEY_LOCATION, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    keyOk = r.status === 200 && body === KEY;
    keyNote = keyOk ? "matches" : `HTTP ${r.status}, body ${JSON.stringify(body.slice(0, 60))}`;
  } catch (e) {
    keyNote = `couldn't fetch (${e.cause?.code || e.message})`;
  }

  if (DRY) {
    console.log(`IndexNow (dry run, nothing sent): POST ${ENDPOINT}`);
    console.log(JSON.stringify(payload, null, 2));
    console.log(`Key file ${KEY_LOCATION}: ${keyNote}`);
    return;
  }
  if (!keyOk) stop(`not sent: live key file ${KEY_LOCATION} doesn't match the key (${keyNote}). Deploy first; pending list kept.`);

  let status;
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    status = r.status;
  } catch (e) {
    stop(`not sent: network error (${e.cause?.code || e.message}). Pending list kept; run again later.`);
  }

  if (status !== 200 && status !== 202) {
    stop(`HTTP ${status}: ${MEANING[status] || "unexpected response"}. Pending list kept; not retried.`);
  }

  // success: record what was submitted, drop it from the pending list
  const sent = new Set(urls);
  const published = readJson(PUBLISHED, {});
  for (const { url, ...entry } of pending) if (sent.has(url)) published[url] = entry;
  const sorted = Object.fromEntries([...allowed].filter((u) => published[u]).map((u) => [u, published[u]]));
  writeJson(PUBLISHED, sorted);
  writeJson(PENDING, pending.filter((p) => !sent.has(p.url)));
  console.log(`IndexNow: HTTP ${status} ${status === 200 ? "OK" : "Accepted"}. Submitted ${urls.length} URL(s):`);
  for (const u of urls) console.log(`  ${u}`);
}

main().catch((e) => stop(`not sent: ${e.message}. Pending list kept.`));
