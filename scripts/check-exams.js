#!/usr/bin/env node
/*
 * check-exams.js — validate an exam-calendar data file before building or deploying.
 *
 *   node scripts/check-exams.js data/exams/2026-27.json            # structure + freshness
 *   node scripts/check-exams.js data/exams/2026-27.json --links    # also checks every URL (Node 18+)
 *   node scripts/check-exams.js data/exams/2026-27.json --today=2027-06-01
 *
 * Exit code 1 on errors (bad structure, missing translations, unknown ids, broken links).
 * Warnings (dates to confirm, stale checks, year almost over) never fail the build.
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const LINKS = args.includes("--links");
const STALE_DAYS = Number((args.find((a) => a.startsWith("--stale=")) || "--stale=150").split("=")[1]);
const todayArg = (args.find((a) => a.startsWith("--today=")) || "").split("=")[1];
if (!file) { console.error("Usage: node scripts/check-exams.js <data.json> [--links] [--today=YYYY-MM-DD] [--stale=150]"); process.exit(2); }

const D = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const P = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const days = (a, b) => Math.round((a - b) / 864e5);
const now = new Date();
const TODAY = todayArg ? P(todayArg) : new Date(now.getFullYear(), now.getMonth(), now.getDate());

function bi(o, where) {
  if (!o || typeof o !== "object") return err(`${where}: missing text`);
  if (!o.en || !String(o.en).trim()) err(`${where}: missing English`);
  if (!o.es || !String(o.es).trim()) err(`${where}: missing Spanish`);
}
function date(s, where) { if (!ISO.test(s || "")) err(`${where}: bad date "${s}"`); }

// top level
["schoolYear", "range", "checked", "sources", "lanes", "exams", "events"].forEach((k) => { if (!D[k]) err(`missing top-level "${k}"`); });
if (!Number.isInteger(D.revision) || D.revision < 1) err("missing or bad \"revision\" (integer, +1 on every published change)");
date(D.range && D.range.start, "range.start"); date(D.range && D.range.end, "range.end"); date(D.checked, "checked");

const laneIds = new Set((D.lanes || []).map((l) => l.id));
(D.lanes || []).forEach((l) => bi(l, `lane ${l.id}`));

const examIds = new Set();
(D.exams || []).forEach((x) => {
  if (examIds.has(x.id)) err(`duplicate exam id ${x.id}`); examIds.add(x.id);
  if (!laneIds.has(x.lane)) err(`exam ${x.id}: unknown lane ${x.lane}`);
  bi(x.name, `exam ${x.id}.name`); bi(x.who, `exam ${x.id}.who`); bi(x.stakes, `exam ${x.id}.stakes`);
  (x.resources || []).forEach((k) => { if (!D.resources || !D.resources[k]) err(`exam ${x.id}: unknown resource ${k}`); });
  if (x.pageLive && (!x.page || !x.pageEs)) err(`exam ${x.id}: pageLive but page/pageEs missing`);
});

const evIds = new Set();
(D.events || []).forEach((e) => {
  const w = `event ${e.id}`;
  if (evIds.has(e.id)) err(`duplicate event id ${e.id}`); evIds.add(e.id);
  if (!examIds.has(e.exam)) err(`${w}: unknown exam ${e.exam}`);
  (e.also || []).forEach((a) => { if (!examIds.has(a)) err(`${w}: unknown "also" exam ${a}`); });
  if (!["test", "window", "reg", "late", "finals"].includes(e.type)) err(`${w}: unknown type ${e.type}`);
  date(e.start, `${w}.start`); if (e.end) { date(e.end, `${w}.end`); if (ISO.test(e.end) && ISO.test(e.start) && P(e.end) < P(e.start)) err(`${w}: end before start`); }
  if (ISO.test(e.start || "") && D.range && (P(e.start) < P(D.range.start) || P(e.start) > P(D.range.end))) warn(`${w}: outside the school-year range`);
  if (!D.sources[e.src]) err(`${w}: unknown source ${e.src}`);
  bi(e.label, `${w}.label`); if (e.note) bi(e.note, `${w}.note`); if (e.short) bi(e.short, `${w}.short`);
  date(e.checked, `${w}.checked`);
  if (ISO.test(e.checked || "") && days(TODAY, P(e.checked)) > STALE_DAYS && P(e.end || e.start) >= TODAY) warn(`${w}: last checked ${e.checked} (${days(TODAY, P(e.checked))} days ago)`);
  if (e.verify && P(e.end || e.start) >= TODAY) warn(`${w}: still marked "confirm with your school"`);
  if (e.for && !(D.events || []).some((x) => x.id === e.for)) err(`${w}: "for" points to unknown event ${e.for}`);
});

(D.exams || []).forEach((x) => (x.windows || []).forEach((id) => { if (!evIds.has(id)) err(`exam ${x.id}: unknown window ${id}`); }));
(D.audiences || []).forEach((a) => {
  bi(a.label, `audience ${a.id}.label`); bi(a.intro, `audience ${a.id}.intro`);
  a.items.forEach((it, i) => {
    if (!examIds.has(it.exam)) err(`audience ${a.id} item ${i}: unknown exam ${it.exam}`);
    bi(it.why, `audience ${a.id} item ${i}.why`); bi(it.todo, `audience ${a.id} item ${i}.todo`);
    if (it.src && !D.sources[it.src]) err(`audience ${a.id} item ${i}: unknown source ${it.src}`);
  });
});
Object.entries(D.resources || {}).forEach(([k, r]) => { bi(r.label, `resource ${k}`); if (!/^https:\/\//.test(r.url)) err(`resource ${k}: URL must be https`); });
Object.entries(D.sources || {}).forEach(([k, s]) => { if (!/^https:\/\//.test(s.url)) err(`source ${k}: URL must be https`); });

const bytes = Buffer.byteLength(JSON.stringify(D));
if (bytes > 60000) err(`minified size ${bytes} bytes: over the 60 KB limit for the site-exams secret`);
else if (bytes > 50000) warn(`minified size ${bytes} bytes: getting close to the 60 KB limit`);

// freshness of the whole file
const ends = (D.events || []).map((e) => P(e.end || e.start));
const last = new Date(Math.max.apply(null, ends));
const left = days(last, TODAY);
if (left < 0) warn(`every date has passed: publish the ${D.nextYear ? D.nextYear.label : "next"} file`);
else if (left < 75) warn(`only ${left} days of dates left: start the ${D.nextYear ? D.nextYear.label : "next"} file`);

async function checkLinks() {
  const urls = new Map();
  Object.entries(D.sources || {}).forEach(([k, s]) => urls.set(s.url, `source ${k}`));
  Object.entries(D.resources || {}).forEach(([k, r]) => urls.set(r.url, `resource ${k}`));
  const UA = "Mozilla/5.0 (compatible; josediaztutoring-linkcheck/1.0; +https://josediaztutoring.com)";
  for (const [url, who] of urls) {
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "user-agent": UA } });
      if (res.status === 405 || res.status === 403) res = await fetch(url, { method: "GET", redirect: "follow", headers: { "user-agent": UA } });
      if (res.status >= 400) {
        // Some sites block bots (403/429). Report as a warning so a person can open it.
        (res.status === 403 || res.status === 429 ? warn : err)(`${who}: ${res.status} ${url}`);
      } else process.stdout.write(".");
    } catch (e) { warn(`${who}: could not reach ${url} (${e.cause ? e.cause.code || e.message : e.message})`); }
  }
  process.stdout.write("\n");
}

(async () => {
  if (LINKS) await checkLinks();
  console.log(`\n${file} · school year ${D.schoolYear} · revision ${D.revision} · ${(D.events || []).length} dates · ${(D.exams || []).length} exams · checked ${D.checked}`);
  warnings.forEach((w) => console.log("  warning  " + w));
  errors.forEach((e) => console.log("  ERROR    " + e));
  console.log(errors.length ? `\n${errors.length} error(s).` : `\nOK${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`);
  process.exit(errors.length ? 1 : 0);
})();
