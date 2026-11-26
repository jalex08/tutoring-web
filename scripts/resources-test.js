#!/usr/bin/env node
/**
 * Resources checks (npm test): the shared library (slugs, math, the frame prelude, the Firestore
 * encoding), the public routes (with an in-memory store) and the admin service (IAP check, API,
 * publish flow). The admin part needs its dependencies: `npm install --prefix admin`.
 */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const ROOT = path.join(__dirname, "..");
const M = require("../lib/resources/model.js");
const math = require("../lib/resources/math.js");
const frame = require("../lib/resources/frame.js");
const storeLib = require("../lib/resources/store.js");
const render = require("../lib/resources/render.js");
const pdfs = require("../lib/resources/files.js");
const toolconfig = require("../lib/resources/toolconfig.js");
const PDF = (n = 3000, tag = "a") => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${tag}\n`), Buffer.alloc(n, 0x41)]);
const { createDevServer } = require("./dev-server.js");

let failures = 0;
async function check(name, fn) {
  const out = (s) => process.stdout.write(s + "\n"); // not console.log: some checks silence it
  try { await fn(); out(`  ok   ${name}`); }
  catch (e) { failures++; out(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 4).join("\n       ")}`); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const quiet = (fn) => async () => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

const NOW = "2026-11-20T15:00:00.000Z";
const TOOL = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><title>T</title></head><body><script>history.replaceState(null,"","#a=1");location.hash</script></body></html>';
function sample(over = {}) {
  return M.normalize({
    id: "abcde12345", status: "published", visibility: "public",
    slugEn: "unit-circle", slugEs: "circulo-unitario", slugHistoryEn: ["old-unit-circle"], slugHistoryEs: [],
    en: { title: "Unit circle explorer", description: "Drag the angle.", intro: "The $x$ coordinate is $\\cos\\theta$.", howTo: ["Drag it."], keyIdeas: ["$\\sin^2\\theta+\\cos^2\\theta=1$"], faq: [{ q: "Why 1?", a: "So $x=\\cos\\theta$." }], keywords: ["unit circle"] },
    es: { title: "Círculo unitario", description: "Mueve el ángulo.", intro: "Intro.", howTo: ["Muévelo."], keyIdeas: ["Idea."], faq: [], keywords: [] },
    subject: "geometry-trig", levels: ["high-school"],
    file: { path: M.filePath("abcde12345", 2), version: 2, sizeBytes: 100, sha256: "x", uploadedAt: NOW },
    og: { en: "og/abcde12345-en-0123abcd.png", es: "" },
    createdAt: NOW, publishedAt: NOW, updatedAt: NOW,
    ...over,
  });
}

(async () => {
  console.log("resources: library");
  await check("slugify: lowercase ASCII, accents and ñ, symbols, length", () => {
    assert.equal(M.slugify("Círculo Unitario: Seno y Coseno"), "circulo-unitario-seno-y-coseno");
    assert.equal(M.slugify("  Año & Niño -- RC/RLC!  "), "ano-and-nino-rc-rlc");
    assert.equal(M.slugify("x".repeat(100)).length, 80);
    assert.equal(M.slugify("¿¡!?"), "");
    assert.ok(M.validSlug("unit-circle") && !M.validSlug("Unit") && !M.validSlug("a--b") && !M.validSlug("-a") && !M.validSlug("og") && !M.validSlug("katex"));
  });
  await check("slug uniqueness covers current and old slugs, per language", () => {
    const a = sample(), b = sample({ id: "zzzzz00000", slugEn: "old-unit-circle", slugEs: "otro", slugHistoryEn: [] });
    assert.match(M.slugProblems(b, [a]).join(), /EN: slug "old-unit-circle" is already used/);
    assert.deepEqual(M.slugProblems(sample({ id: "zzzzz00000", slugEn: "circulo-unitario", slugEs: "unit-circle" }), [a]), []); // other language: fine
    assert.match(M.slugProblems(sample({ slugEn: "Bad Slug" })).join(), /lowercase/);
  });
  await check("a slug change after the first publish keeps the old slug (301); before it, not", () => {
    const before = sample({ slugHistoryEn: [] });
    assert.deepEqual(M.applySlugChange(before, { ...before, slugEn: "new" }).slugHistoryEn, ["unit-circle"]);
    assert.deepEqual(M.applySlugChange({ ...before, publishedAt: "" }, { ...before, slugEn: "new" }).slugHistoryEn, []);
    // going back to an old slug takes it out of the history
    assert.deepEqual(M.applySlugChange(sample(), { ...sample(), slugEn: "old-unit-circle" }).slugHistoryEn, ["unit-circle"]);
  });
  await check("publish problems: every required EN and ES field, the file, levels, 155-char description", () => {
    const p = M.problems(M.normalize({ id: "x" }));
    for (const re of [/Upload/, /EN: title/, /ES: title/, /EN: description/, /EN: intro/, /how to use/, /key idea/, /level/, /EN: slug is required/]) assert.ok(p.some((x) => re.test(x)), re);
    assert.match(M.problems(sample({ en: { ...sample().en, description: "x".repeat(156) } })).join(), /156 characters/);
    assert.deepEqual(M.problems(sample()), []);
  });
  await check("PDF names: letters, digits, . _ -, ending .pdf, case kept; no paths, no leading dot", () => {
    for (const n of ["PHY2053_Newtons_Laws_Formula_Cards.pdf", "a.pdf", "v1.2-final.pdf", "A_B-c.pdf"]) assert.ok(M.validFileName(n), n);
    for (const n of ["", "a.PDF", "a.pdf.html", "../a.pdf", "..pdf", ".hidden.pdf", "a b.pdf", "a/b.pdf", "a%2Fb.pdf", "ñ.pdf", "a.pdf ", `${"x".repeat(117)}.pdf`, 5])
      assert.ok(!M.validFileName(n), JSON.stringify(n));
    assert.match(M.fileNameProblem("a b.pdf"), /letters, numbers, dots, hyphens and underscores/);
  });
  await check("PDF upload check: starts with %PDF-, not empty, size limit (plain messages)", () => {
    pdfs.validatePdf("a.pdf", PDF(), 10 * 1048576);
    assert.throws(() => pdfs.validatePdf("a.pdf", Buffer.from("<html>"), 1e6), /isn't a PDF \(it doesn't start with %PDF-\)/);
    assert.throws(() => pdfs.validatePdf("a.pdf", Buffer.alloc(0), 1e6), /is empty/);
    assert.throws(() => pdfs.validatePdf("a.pdf", PDF(2000), 1000), /a\.pdf is 0\.0 MB; the limit is 0 MB/);
    assert.throws(() => pdfs.validatePdf("a.pdf", PDF(11 * 1048576), 10 * 1048576), /is 11\.0 MB; the limit is 10 MB/);
    assert.throws(() => pdfs.validatePdf("../a.pdf", PDF(), 1e6), /isn't a usable PDF name/);
  });
  await check("files in the doc: no migration, max 20, unique ignoring case, listed vs uploaded", () => {
    assert.deepEqual(sample().files, []);
    assert.deepEqual(sample().related, []);
    const d = M.normalize({ files: [{ name: "A.pdf", path: "p", sizeBytes: 9, sha256: "h", labelEn: "a", labelEs: "a" }, { name: "a.pdf" }, { name: "bad name.pdf" }, { name: "B.pdf", sizeBytes: 5 }] });
    assert.deepEqual(d.files.map((f) => [f.name, f.path, f.sizeBytes]), [["A.pdf", "p", 9], ["B.pdf", "", 0]]);
    assert.deepEqual(M.uploadedFiles(d).map((f) => f.name), ["A.pdf"]);
    assert.equal(M.normalize({ files: Array.from({ length: 25 }, (_, i) => ({ name: `f${i}.pdf` })) }).files.length, 20);
    // publish waits for every listed file and both labels
    const p = M.problems(sample({ files: [{ name: "B.pdf", labelEn: "b", labelEs: "b" }, { name: "C.pdf", path: "x", labelEn: "c" }] }));
    assert.deepEqual(p, ["PDF B.pdf is listed but not uploaded. Drop it, or remove it from Files.", "PDF C.pdf needs an EN and an ES label."]);
    assert.equal(M.fileUrl(sample(), "PHY_A.pdf"), "/resources/unit-circle/files/PHY_A.pdf");
    assert.equal(pdfs.sizeLabel(239616), "234 KB"); assert.equal(pdfs.sizeLabel(2737890), "2.6 MB"); assert.equal(pdfs.sizeLabel(2737890, "es"), "2,6 MB"); assert.equal(pdfs.sizeLabel(10), "1 KB");
  });
  await check("toConfig: a stored resource -> its config in the upload format; round-trips through readConfig", () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"), "utf8"));
    const full = { ...fx, relatedExamPage: "/exams/", related: ["projectile-motion-lab"], files: [{ file: "Unit_Circle.pdf", en: "Unit circle", es: "Círculo unitario" }] };
    const r = toolconfig.readConfig(JSON.stringify(full));
    assert.ok(r.ok, JSON.stringify(r.problems.filter((p) => p.level === "error")));
    const f = r.fields;
    const doc = M.normalize({
      id: "abcdefghij", status: "published", slugEn: f.slugEn, slugEs: f.slugEs, en: f.en, es: f.es, subject: f.subject, levels: f.levels,
      courseTags: f.courseTags, relatedExamPage: f.relatedExamPage, related: f.related,
      files: f.files.map((x) => ({ ...x, path: "resources/abcdefghij/files/x.pdf" })),
      file: { path: "p", version: 3, name: "trigonometry-playground.html" },
    });
    const out = toolconfig.toConfig(doc);
    const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
    assert.deepEqual(sortKeys(out), sortKeys(full));
    assert.deepEqual(Object.keys(out), ["version", "file", "subject", "levels", "courseTags", "relatedExamPage", "related", "files", "en", "es"]);
    assert.ok(toolconfig.configText(doc).endsWith("}\n"));
    // optional keys left out when empty; a resource with no tool file yet has file ""
    const bare = toolconfig.toConfig(M.normalize({ id: "x", slugEn: "a", slugEs: "b" }));
    assert.deepEqual(Object.keys(bare), ["version", "file", "subject", "levels", "courseTags", "en", "es"]);
    assert.equal(bare.file, "");
    // an exam page that isn't one of the site's is named, not kept
    assert.match(toolconfig.readConfig(JSON.stringify({ ...fx, relatedExamPage: "/nope/" })).problems.map((p) => p.message).join(), /relatedExamPage "\/nope\/" isn't one of/);
  });
  // ---- the config schema (schemas/resource-config.schema.json) and its cross-checks ----------------
  const configcheck = require("../lib/resources/configcheck.js");
  const configdiff = require("../lib/resources/configdiff.js");
  const LIVE_DIR = path.join(ROOT, "test/fixtures/live-configs");
  const liveConfigs = fs.readdirSync(LIVE_DIR).filter((f) => f.endsWith(".json") && f !== "_export.json").sort()
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(LIVE_DIR, f), "utf8") }));
  // the live resources as stored: each config applied to a published doc whose PDFs are uploaded
  const liveDocs = () => liveConfigs.map(({ text }, i) => {
    const c = JSON.parse(text);
    return configcheck.apply(M.normalize({
      id: `live${String(i).padStart(6, "0")}`, status: "published", publishedAt: `2026-11-2${i}T00:00:00Z`,
      file: { path: "p", version: 1, name: c.file }, files: (c.files || []).map((f) => ({ name: f.file, path: `resources/x/files/${f.file}`, sizeBytes: 1 })),
    }), c);
  });
  await check("schema: its subjects, levels and exam pages are the model's", () => {
    const P = configcheck.SCHEMA.properties;
    assert.deepEqual(P.subject.enum, Object.keys(M.SUBJECTS));
    assert.deepEqual(P.levels.items.enum, Object.keys(M.LEVELS));
    assert.deepEqual(P.relatedExamPage.enum, M.EXAM_LINKS.map((x) => x.en));
    assert.equal(configcheck.SCHEMA.$defs.text.properties.description.maxLength, M.DESC_MAX);
    assert.equal(P.related.maxItems, M.RELATED_MAX);
    assert.equal(P.files.maxItems, M.MAX_FILES);
  });
  await check(`schema + cross-checks accept the ${liveConfigs.length} live configs as stored (test/fixtures/live-configs), and toConfig gives them back byte for byte`, () => {
    assert.equal(liveConfigs.length, 5);
    const docs = liveDocs();
    liveConfigs.forEach(({ name, text }, i) => {
      const r = configcheck.validate(text, { doc: docs[i], others: docs, mode: "json" });
      assert.deepEqual(r.errors, [], name);
      assert.deepEqual(r.warnings, [], name);
      assert.equal(toolconfig.configText(docs[i]), text, `${name}: export -> apply -> export is stable`);
    });
  });
  await check("schema errors: plain words, field path, line", () => {
    const docs = liveDocs(), doc = docs.find((d) => d.slugEn === "rc-circuit-lab"), base = toolconfig.toConfig(doc);
    const errs = (c, ctx = {}) => configcheck.validate(typeof c === "string" ? c : JSON.stringify(c, null, 2), { doc, others: docs, ...ctx }).errors;
    const one = (mut) => { const c = JSON.parse(JSON.stringify(base)); mut(c); return errs(c).map((e) => `${e.path}: ${e.message}`); };
    assert.deepEqual(one((c) => { c.es.description = "x".repeat(171); }), ["es.description: es.description is 171 characters; max 155."]);
    assert.deepEqual(one((c) => { c.en.howTo = c.en.howTo.slice(0, 2); }), ["en.howTo: en.howTo has 2 items; it needs 3 to 6 items."]);
    assert.deepEqual(one((c) => { c.es.keyIdeas.push("a", "b"); }), ["es.keyIdeas: es.keyIdeas has 7 items; it needs 3 to 5 items."]);
    assert.deepEqual(one((c) => { c.en.faq = c.en.faq.slice(0, 2); }), ["en.faq: en.faq has 2 items; it needs 3 to 5 items."]);
    assert.deepEqual(one((c) => { c.en.keywords = c.en.keywords.slice(0, 4); }), ["en.keywords: en.keywords has 4 items; it needs 5 to 8 items."]);
    assert.deepEqual(one((c) => { c.en.keyIdea = []; }), ["en.keyIdea: en.keyIdea is not a field of the config format. Check the spelling (fields are case-sensitive)."]);
    assert.deepEqual(one((c) => { delete c.es.intro; }), ["es.intro: es.intro is missing."]);
    assert.deepEqual(one((c) => { c.subject = "biology"; }), [`subject: subject is "biology"; use one of: ${Object.keys(M.SUBJECTS).join(", ")}.`]);
    assert.deepEqual(one((c) => { c.version = 2; }), ["version: version must be 1 (it's read-only: the config format this admin reads)."]);
    assert.deepEqual(one((c) => { c.en.slug = "RC Lab"; }), ['en.slug: en.slug is "RC Lab": it must be lowercase letters, numbers and single hyphens.']);
    assert.deepEqual(one((c) => { c.en.faq[0].a = ""; }), ["en.faq[0].a: en.faq[0].a is empty."]);
    // lines point at the field
    const text = JSON.stringify({ ...base, es: { ...base.es, description: "x".repeat(171) } }, null, 2);
    const e = errs(text)[0];
    assert.equal(text.split("\n")[e.line - 1].trim().slice(0, 15), '"description": ');
    // not JSON / too big
    assert.match(errs('{\n  "version": 1,\n  oops\n}')[0].message, /isn't valid JSON \(line 3/);
    assert.equal(errs('{\n  "version": 1,\n  oops\n}')[0].line, 3);
    assert.match(errs(" ".repeat(256 * 1024 + 1))[0].message, /max 256 KB/);
  });
  await check("cross-checks: one failing case each", () => {
    const docs = liveDocs(), doc = docs.find((d) => d.slugEn === "rc-circuit-lab"), base = toolconfig.toConfig(doc);
    const run = (mut, ctx = {}) => { const c = JSON.parse(JSON.stringify(base)); mut(c); return configcheck.validate(JSON.stringify(c, null, 2), { doc, others: docs, ...ctx }); };
    const msgs = (r, k = "errors") => r[k].map((e) => `${e.path}: ${e.message}`);
    // slug unique across resources (current) ...
    assert.match(msgs(run((c) => { c.en.slug = "motion-graphs-lab"; })).join(), /en\.slug: en\.slug "motion-graphs-lab" is already used by "/);
    // ... and slug history
    const renamed = docs.map((d) => (d.slugEn === "motion-graphs-lab" ? { ...d, slugEn: "motion-graphs", slugHistoryEn: ["motion-graphs-lab"] } : d));
    const r1 = configcheck.validate(JSON.stringify({ ...base, en: { ...base.en, slug: "motion-graphs-lab" } }), { doc, others: renamed });
    assert.match(msgs(r1).join(), /already used by .*as an old slug that redirects/);
    // reserved slug
    assert.match(msgs(run((c) => { c.es.slug = "og"; })).join(), /es\.slug "og" is reserved/);
    // related: unresolved -> warning (not an error); itself -> error; old slug -> warning
    let r = run((c) => { c.related = ["no-such-tool"]; });
    assert.ok(r.ok); assert.match(msgs(r, "warnings").join(), /related\[0\]: no resource has the EN slug "no-such-tool"/);
    r = run((c) => { c.related = ["rc-circuit-lab"]; });
    assert.deepEqual(msgs(r), ['related[0]: related[0] is "rc-circuit-lab", this resource itself. Remove it.']);
    r = configcheck.validate(JSON.stringify({ ...base, related: ["motion-graphs-lab"] }), { doc, others: renamed });
    assert.ok(r.ok); assert.match(msgs(r, "warnings").join(), /old slug of "motion-graphs"/);
    // files: listed but not uploaded -> error; uploaded but not listed (editor) -> error; pending in an upload -> fine
    const cards = docs.find((d) => d.slugEn === "phy-2053-formula-cards"), cb = toolconfig.toConfig(cards);
    r = configcheck.validate(JSON.stringify({ ...cb, files: [...cb.files, { file: "New.pdf", en: "n", es: "n" }] }), { doc: cards, others: docs });
    assert.deepEqual(msgs(r), [`files[11].file: files[11].file "New.pdf" isn't uploaded for this resource. Upload it in Files first (this editor changes labels and order only).`]);
    r = configcheck.validate(JSON.stringify({ ...cb, files: cb.files.slice(1) }), { doc: cards, others: docs });
    assert.match(msgs(r).join(), /files must list every uploaded PDF; missing: PHY2053_Vectors_Kinematics_Formula_Cards\.pdf/);
    r = configcheck.validate(JSON.stringify({ ...cb, files: [...cb.files, { file: "New.pdf", en: "n", es: "n" }] }), { doc: cards, others: docs, mode: "upload", htmlName: cb.file, pendingPdfs: ["New.pdf"] });
    assert.ok(r.ok, JSON.stringify(r.errors));
    // reordering and relabelling uploaded PDFs is fine
    r = configcheck.validate(JSON.stringify({ ...cb, files: [...cb.files].reverse().map((f) => ({ ...f, en: f.en + "!" })) }), { doc: cards, others: docs });
    assert.ok(r.ok, JSON.stringify(r.errors));
    // KaTeX in keyIdeas (throwOnError, trust false)
    r = run((c) => { c.es.keyIdeas[1] = "Mal: $\\frac{1}$"; });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /^es\.keyIdeas\[1\]: the formula "\\frac\{1\}" doesn't render: Unexpected end of input/);
    // trust: false: \href / \url never become links, on the page or in the check
    const hrefOut = math.inline("$\\href{javascript:alert(1)}{x}$");
    assert.doesNotMatch(hrefOut, /<a\b|\shref="/); assert.match(hrefOut, /color:#cc0000/); // shown as an error, not a link
    // EN / ES item counts -> warning
    r = run((c) => { c.es.howTo = c.es.howTo.slice(0, 3); });
    assert.ok(r.ok); assert.match(msgs(r, "warnings").join(), /en\.howTo has 6 items but es\.howTo has 3/);
    // file is read-only (and, for an upload, must be the uploaded tool)
    assert.deepEqual(msgs(run((c) => { c.file = "other.html"; })), ['file: file is read-only: it\'s "rc-circuit-lab.html" for this resource, not "other.html". To replace the HTML, use Replace file.']);
    assert.match(msgs(run(() => {}, { mode: "upload", htmlName: "other.html" })).join(), /but the tool file uploaded with it is "other\.html"/);
    assert.ok(run(() => {}, { mode: "upload", htmlName: "rc-circuit-lab.html" }).ok);
  });
  await check("apply: config fields replace the doc's; PDFs keep their uploads; a published slug change goes into the history", () => {
    const docs = liveDocs(), cards = docs.find((d) => d.slugEn === "phy-2053-formula-cards"), c = toolconfig.toConfig(cards);
    const next = configcheck.apply(cards, { ...c, en: { ...c.en, slug: "phy-2053-cards" }, files: [...c.files].reverse(), related: ["rc-circuit-lab"], relatedExamPage: "/exams/" });
    assert.equal(next.slugEn, "phy-2053-cards"); assert.deepEqual(next.slugHistoryEn, ["phy-2053-formula-cards"]);
    assert.deepEqual(next.files.map((f) => f.name), [...cards.files].reverse().map((f) => f.name));
    assert.ok(next.files.every((f) => f.path)); assert.equal(next.file.version, cards.file.version);
    assert.deepEqual(next.related, ["rc-circuit-lab"]); assert.equal(next.relatedExamPage, "/exams/");
    // optional keys left out = cleared
    assert.deepEqual(configcheck.apply(next, c).related, []); assert.equal(configcheck.apply(next, c).relatedExamPage, "");
  });
  await check("related resources: own order, reverse links (current and old slug), tags, subject; published only, never itself, no repeats, up to 3", () => {
    const mk = (id, over = {}) => M.normalize({ id, status: "published", slugEn: id, slugEs: `${id}-es`, subject: "physics", publishedAt: "2026-01-01T00:00:00Z", ...over });
    const self = mk("self", { slugHistoryEn: ["self-old"], related: ["own-b", "own-a", "self", "own-a", "gone"], courseTags: ["AP Physics 1"] });
    const all = [
      self,
      mk("own-a", { publishedAt: "2026-01-01T00:00:00Z" }), mk("own-b", { publishedAt: "2026-01-02T00:00:00Z" }),
      mk("rev-new", { related: ["self"], subject: "algebra", publishedAt: "2026-05-01T00:00:00Z" }),
      mk("rev-old-slug", { related: ["self-old"], subject: "algebra", publishedAt: "2026-04-01T00:00:00Z" }),
      mk("rev-draft", { related: ["self"], status: "draft", publishedAt: "2026-06-01T00:00:00Z" }),
      mk("tagged", { subject: "calculus", courseTags: ["ap physics 1"], publishedAt: "2026-03-01T00:00:00Z" }),
      mk("same-subject", { publishedAt: "2026-02-01T00:00:00Z" }),
    ];
    const ids = (d, n = 3) => M.relatedFor(d, all, n).map((x) => x.id);
    assert.deepEqual(ids(self), ["own-b", "own-a", "rev-new"], "own order first, then reverse links");
    assert.deepEqual(ids(self, 9), ["own-b", "own-a", "rev-new", "rev-old-slug", "tagged", "same-subject"]);
    // no own list: reverse links (current slug and an old one), newest first, then tags, then subject
    assert.deepEqual(ids({ ...self, related: [] }, 4), ["rev-new", "rev-old-slug", "tagged", "same-subject"]);
    // a reverse link to an old slug only
    assert.deepEqual(ids({ ...self, related: [], slugEn: "self-renamed", slugHistoryEn: ["self-old"] }, 1), ["rev-old-slug"]);
    // a target found by its old slug; an own link that is also a reverse link appears once
    const renamed = all.map((d) => (d.id === "own-a" ? { ...d, slugEn: "own-a-2", slugHistoryEn: ["own-a"], related: ["self"] } : d));
    assert.deepEqual(M.relatedFor({ ...self, related: ["own-a"] }, renamed, 3).map((x) => x.id), ["own-a", "rev-new", "rev-old-slug"]);
    // fills to 3 from the later steps when the own list is short
    assert.equal(M.relatedFor({ ...self, related: ["own-a"], courseTags: [] }, all, 3).length, 3);
    // never itself, never a draft, no duplicates, max respected
    for (const n of [1, 2, 3, 9]) { const r = ids(self, n); assert.ok(!r.includes("self") && !r.includes("rev-draft") && new Set(r).size === r.length && r.length <= n); }
  });
  await check("config diff: changed fields only, EN/ES side by side, word segments, slug changes", () => {
    const a = JSON.parse(liveConfigs[0].text), b = JSON.parse(liveConfigs[0].text);
    b.es.title = `${a.es.title} (nuevo)`; b.en.slug = "new-slug"; b.related = ["rc-circuit-lab"]; b.en.howTo[0] = "Changed step.";
    const d = configdiff.diff(a, b);
    assert.equal(d.changed, 4);
    assert.deepEqual(d.shared, [{ field: "related", label: "Related resources", before: "", after: "rc-circuit-lab" }]);
    assert.deepEqual(d.text.map((r) => [r.field, !!r.en, !!r.es]), [["title", false, true], ["slug", true, false], ["howTo", true, false]]);
    assert.deepEqual(d.text[0].es.segments, [{ op: "=", text: a.es.title }, { op: "+", text: " (nuevo)" }]);
    assert.deepEqual(d.slugChanges, [{ lang: "en", from: a.en.slug, to: "new-slug" }]);
    assert.deepEqual(configdiff.segments("The quick fox", "The slow fox"), [{ op: "=", text: "The " }, { op: "-", text: "quick" }, { op: "+", text: "slow" }, { op: "=", text: " fox" }]);
    assert.equal(configdiff.diff(a, a).changed, 0);
  });
  await check('public page: "<script>" in every text field is shown as text (HTML, meta, JSON-LD)', () => {
    const X = '<script>alert("x")</script>';
    const t = (L) => ({ title: `${L} ${X}`, description: `${L} d ${X}`, intro: `${L} i ${X}\n\n${X} $x^2$`, howTo: [`${L} h ${X}`, X, X], keyIdeas: [`${L} k ${X}`, `${X} $\\frac{1}{2}$`, X],
      faq: [{ q: `${L} q ${X}`, a: `${L} a ${X}` }, { q: X, a: X }, { q: X, a: X }], keywords: [`${L} kw ${X}`, "b", "c", "d", "e"] });
    const doc = sample({ en: t("EN"), es: t("ES"), courseTags: [X], files: [{ name: "A.pdf", path: "p", labelEn: `PDF ${X}`, labelEs: `PDF ${X}`, sizeBytes: 9 }] });
    const shell = JSON.parse(fs.readFileSync(path.join(ROOT, "www/resources-shell.json"), "utf8"));
    for (const lang of ["en", "es"]) {
      const h = render.resourcePage({ doc, lang, shell: shell[lang], all: [doc, sample({ id: "other00000", slugEn: "o", slugEs: "o", en: t("EN"), es: t("ES") })] });
      assert.ok(!h.includes(X) && !/<script>alert/.test(h), `${lang}: raw <script> in the page`);
      const L = lang.toUpperCase();
      for (const s of [`${L} ${X}`, `${L} d ${X}`, `${L} i ${X}`, `${L} h ${X}`, `${L} k ${X}`, `${L} q ${X}`, `${L} a ${X}`, `PDF ${X}`]) {
        assert.ok(h.includes(math.escapeHtml(s)), `${lang}: "${s.slice(0, 8)}" not shown escaped`);
      }
      for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        assert.ok(!m[1].includes("<"), "JSON-LD: < is escaped"); JSON.parse(m[1]);
      }
      assert.ok(h.includes(`${L} kw \\u003cscript>alert`), "keywords (JSON-LD only) escaped");
    }
    // the library card too
    assert.ok(!render.card(doc, "en").includes(X));
  });
  await check("config `files`: labels and order from the JSON; bad, duplicate and unlabeled entries named", () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"), "utf8"));
    assert.equal(toolconfig.readConfig(JSON.stringify(fx)).fields.files, undefined, "no files key: list left alone");
    const r = toolconfig.readConfig(JSON.stringify({ ...fx, files: [
      { file: "PHY_B.pdf", en: "Newton's laws", es: "Leyes de Newton" }, { file: "PHY_A.pdf", en: "Kinematics", es: "Cinemática" },
      { file: "phy_a.pdf", en: "x", es: "x" }, { file: "notes.docx", en: "x", es: "x" }, { file: "PHY_C.pdf", en: "Only EN" }, "PHY_D.pdf",
    ] }));
    assert.deepEqual(r.fields.files, [{ name: "PHY_B.pdf", labelEn: "Newton's laws", labelEs: "Leyes de Newton" }, { name: "PHY_A.pdf", labelEn: "Kinematics", labelEs: "Cinemática" }, { name: "PHY_C.pdf", labelEn: "Only EN", labelEs: "" }]);
    const msgs = r.problems.filter((x) => x.field === "files").map((x) => x.message).join("\n");
    assert.match(msgs, /"phy_a\.pdf" is listed twice \(as "PHY_A\.pdf" too/);
    assert.match(msgs, /"notes\.docx" isn't a usable PDF name/);
    assert.match(msgs, /"PHY_C\.pdf" needs an "en" and an "es" label/);
    assert.match(msgs, /File 6 needs a "file"/);
    assert.ok(!r.problems.some((x) => /Unknown key "files"/.test(x.message)));
    assert.match(toolconfig.readConfig(JSON.stringify({ ...fx, files: "x.pdf" })).problems.map((x) => x.message).join(), /"files" must be a list/);
  });
  await check("dropped PDFs vs the JSON list: found / missing / extra, exact names", () => {
    assert.deepEqual(toolconfig.matchFiles([{ name: "A.pdf" }, { name: "B.pdf" }, { name: "C.pdf" }], ["C.pdf", "A.pdf", "X.pdf", "b.pdf"]),
      { found: ["A.pdf", "C.pdf"], missing: ["B.pdf"], extra: ["X.pdf", "b.pdf"] });
    assert.deepEqual(toolconfig.matchFiles([], ["A.pdf"]), { found: [], missing: [], extra: ["A.pdf"] });
  });
  await check("config `related`: EN slugs kept in order; self, unknown and unpublished noted", () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"), "utf8"));
    const others = [sample({ id: "o1", slugEn: "projectile-motion-lab" }), sample({ id: "o2", slugEn: "rc-circuit-lab", status: "draft" })];
    const r = toolconfig.readConfig(JSON.stringify({ ...fx, related: ["Projectile-Motion-Lab", fx.en.slug, "rc-circuit-lab", "nope-lab", "bad slug!"] }), { others });
    assert.deepEqual(r.fields.related, ["projectile-motion-lab", "rc-circuit-lab", "nope-lab"]);
    const m = r.problems.filter((x) => x.field === "related").map((x) => `${x.level}: ${x.message}`).join("\n");
    assert.match(m, /warning: Related: ".*" is this resource itself/);
    assert.match(m, /warning: Related: "rc-circuit-lab" isn't published/);
    assert.match(m, /warning: Related: no resource has the EN slug "nope-lab"/);
    assert.match(m, /error: Related: "bad slug!" isn't a slug/);
  });
  await check("related resources: own list first (live only), then shared course tags (most, then newest), then subject; max 3", () => {
    const mk = (id, over) => sample({ id, slugEn: id, slugEs: `${id}-es`, slugHistoryEn: [], courseTags: [], subject: "physics", ...over });
    const self = mk("self", { courseTags: ["AP Physics 1", "PHY 2053"], related: ["pick-b", "draft-x", "self", "pick-a"] });
    const all = [
      self,
      mk("pick-a", { subject: "circuits", publishedAt: "2026-01-01T00:00:00Z" }),
      mk("pick-b", { subject: "algebra", publishedAt: "2026-01-02T00:00:00Z" }),
      mk("draft-x", { status: "draft" }),
      mk("tag1-old", { subject: "calculus", courseTags: ["ap physics 1"], publishedAt: "2026-02-01T00:00:00Z" }),
      mk("tag1-new", { subject: "calculus", courseTags: ["PHY 2053"], publishedAt: "2026-03-01T00:00:00Z" }),
      mk("tag2", { subject: "calculus", courseTags: ["PHY 2053", "AP Physics 1"], publishedAt: "2026-01-15T00:00:00Z" }),
      mk("subj-new", { publishedAt: "2026-05-01T00:00:00Z" }),
      mk("subj-old", { publishedAt: "2026-04-01T00:00:00Z" }),
      mk("other", { subject: "algebra", publishedAt: "2026-06-01T00:00:00Z" }),
    ];
    const ids = (d, n) => M.relatedFor(d, all, n).map((x) => x.id);
    assert.deepEqual(ids(self, 3), ["pick-b", "pick-a", "tag2"]);
    assert.deepEqual(ids(self, 9), ["pick-b", "pick-a", "tag2", "tag1-new", "tag1-old", "subj-new", "subj-old"]);
    assert.deepEqual(ids({ ...self, related: [] }, 3), ["tag2", "tag1-new", "tag1-old"]);
    assert.deepEqual(ids({ ...self, related: [], courseTags: [] }, 3), ["subj-new", "subj-old"]);
    // an old slug in `related` still finds the resource
    const renamed = all.map((d) => (d.id === "pick-a" ? { ...d, slugEn: "new-a", slugHistoryEn: ["pick-a"] } : d));
    assert.deepEqual(M.relatedFor({ ...self, related: ["pick-a"] }, renamed, 1).map((x) => x.id), ["pick-a"]);
  });
  await check("Range header parsing: one range, suffix, open end, clamped; several or malformed ignored; past the end 416", () => {
    assert.deepEqual(pdfs.parseRange("bytes=0-4", 100), { start: 0, end: 4 });
    assert.deepEqual(pdfs.parseRange("bytes=90-", 100), { start: 90, end: 99 });
    assert.deepEqual(pdfs.parseRange("bytes=-10", 100), { start: 90, end: 99 });
    assert.deepEqual(pdfs.parseRange("bytes=-500", 100), { start: 0, end: 99 });
    assert.deepEqual(pdfs.parseRange("bytes=50-5000", 100), { start: 50, end: 99 });
    for (const h of ["", "items=0-1", "bytes=0-1,5-6", "bytes=5-2", "bytes=-", "bytes=a-b"]) assert.equal(pdfs.parseRange(h, 100), null, h);
    for (const h of ["bytes=100-", "bytes=-0", "bytes=200-300"]) assert.equal(pdfs.parseRange(h, 100), "unsatisfiable", h);
    assert.ok(pdfs.etagMatches('W/"abc", "def"', '"abc"') && pdfs.etagMatches("*", '"x"') && !pdfs.etagMatches('"abcd"', '"abc"'));
  });
  await check("ids are 10 lowercase a-z0-9", () => { for (let i = 0; i < 50; i++) assert.match(M.newId(), M.ID_RE); });
  await check("math: $..$ inline, $$..$$ display, \\$ literal, text escaped, plain text for meta, errors listed", () => {
    const h = math.inline("Cost \\$5 <b> and $x^2$");
    assert.match(h, /Cost \$5 &lt;b&gt; and <span class="katex">/);
    assert.match(math.inline("$$\\frac{a}{b}$$"), /katex-display/);
    assert.equal(math.plain("Angle $\\theta$ here"), "Angle \\theta here");
    assert.equal(math.hasMath("no math, \\$3"), false);
    assert.equal(math.mathErrors("$\\frac{1}$").length, 1);
    assert.equal(math.mathErrors("$\\frac{1}{2}$").length, 0);
    assert.equal(math.paragraphs("a\n\nb\nc"), "<p>a</p>\n<p>b<br>c</p>");
  });
  await check("prelude goes first: after <head>, or <html>, or the doctype, or at the start; BOM stripped; <header> isn't <head>", () => {
    const P = `<script>${frame.PRELUDE}</script>`;
    assert.equal(frame.inject("<!DOCTYPE html><html><head><title>x</title></head></html>"), `<!DOCTYPE html><html><head>${P}<title>x</title></head></html>`);
    assert.equal(frame.inject("<!doctype html><HTML LANG=en><HEAD class=a><TITLE>x</TITLE>"), `<!doctype html><HTML LANG=en><HEAD class=a>${P}<TITLE>x</TITLE>`);
    assert.equal(frame.inject("﻿<html><body>x"), `<html>${P}<body>x`);
    assert.equal(frame.inject("<!DOCTYPE html><header>x</header>"), `<!DOCTYPE html>${P}<header>x</header>`);
    assert.equal(frame.inject("<!-- <head> --><!doctype html><p>x"), `<!-- <head> --><!doctype html>${P}<p>x`);
    assert.equal(frame.inject("<script>go()</script>"), `${P}<script>go()</script>`);
  });
  await check("frame headers: CSP sandbox without allow-same-origin, frame-ancestors 'self', noindex, immutable", () => {
    const csp = frame.FRAME_HEADERS["Content-Security-Policy"];
    assert.match(csp, /^sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock; frame-ancestors 'self'$/);
    assert.doesNotMatch(csp + frame.SANDBOX, /allow-same-origin|allow-top-navigation/);
    assert.equal(frame.FRAME_HEADERS["X-Robots-Tag"], "noindex, nofollow");
    assert.match(frame.FRAME_HEADERS["Cache-Control"], /immutable/);
  });
  await check("upload checks: UTF-8, looks like HTML, size; warnings in plain words", () => {
    assert.throws(() => frame.validateUpload(Buffer.from([0xff, 0xfe, 0x00]), 1e6), /UTF-8/);
    assert.throws(() => frame.validateUpload(Buffer.from("just text"), 1e6), /doesn't look like an HTML/);
    assert.throws(() => frame.validateUpload(Buffer.from("<html>" + "x".repeat(100)), 50), /limit/);
    assert.equal(frame.validateUpload(Buffer.from("﻿<html>"), 1e6), "<html>");
    const w = frame.analyze('<html><script src="https://evil.example/x.js"></script><script>fetch("https://api.example.org/q");localStorage.x=1</script><form action="https://forms.example.net/p"></form></html>');
    for (const re of [/api\.example\.org/, /evil\.example/, /forms\.example\.net/, /localStorage/, /viewport/, /#hash/]) assert.ok(w.some((x) => re.test(x)), re);
    assert.deepEqual(frame.analyze(TOOL), []);
  });
  await check("tool config (fixture): reads cleanly, every EN and ES field mapped, nothing lost", () => {
    const T = require("../lib/resources/toolconfig.js");
    const text = fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"), "utf8"), cfg = JSON.parse(text);
    const r = T.readConfig(text, { htmlName: "trigonometry-playground.html" });
    assert.equal(r.ok, true); assert.deepEqual(r.problems, []);
    assert.deepEqual([r.fields.slugEn, r.fields.slugEs, r.fields.subject, r.fields.levels, r.fields.courseTags], [cfg.en.slug, cfg.es.slug, cfg.subject, cfg.levels, cfg.courseTags]);
    for (const l of ["en", "es"]) for (const k of ["title", "description", "intro", "howTo", "keyIdeas", "faq", "keywords"]) assert.deepEqual(r.fields[l][k], cfg[l][k], `${l}.${k}`);
    // the filled form passes the publish checks (formulas included)
    const doc = M.normalize({ id: "x", ...r.fields, file: { version: 1 } });
    assert.deepEqual(M.problems(doc), []);
    for (const l of ["en", "es"]) for (const k of doc[l].keyIdeas) assert.deepEqual(math.mathErrors(k), [], k);
  });
  await check("tool config problems: file, version, JSON, types, subject/levels, length, slug clash with -2 suggestion, unknown keys", () => {
    const T = require("../lib/resources/toolconfig.js");
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"), "utf8"));
    const read = (c, o = {}) => T.readConfig(typeof c === "string" ? c : JSON.stringify(c), o);
    const fieldsOf = (r) => r.problems.map((p) => p.field);
    assert.match(read(cfg, { htmlName: "other.html" }).problems[0].message, /is for "trigonometry-playground\.html", but the tool file is "other\.html"/);
    assert.equal(read({ ...cfg, version: 2 }).fields, null);
    assert.match(read({ ...cfg, version: 2 }).problems[0].message, /Unknown config version 2/);
    assert.match(read({ ...cfg, version: undefined }).problems[0].message, /no "version"/);
    assert.match(read("{ nope").problems[0].message, /isn't valid JSON \(line 1/);
    assert.match(read("[1]").problems[0].message, /must be a JSON object/);
    let r = read({ ...cfg, subject: "trig", levels: ["college", "kindergarten"], extra: 1, en: { ...cfg.en, description: "y".repeat(160), howTo: "one", bonus: true }, es: { ...cfg.es, faq: [{ q: "only q" }] } });
    assert.deepEqual(fieldsOf(r).sort(), ["en", "en.description", "en.howTo", "es.faq", "json", "levels", "subject"].sort());
    assert.deepEqual(r.fields.levels, ["college"]);
    assert.equal(r.fields.en.description.length, 160); // kept, flagged
    assert.equal(r.problems.find((p) => p.field === "json").level, "warning");
    const other = sample({ id: "zzzzz11111", slugEn: "trigonometry-playground", slugEs: "otra", slugHistoryEn: [] });
    const other2 = sample({ id: "zzzzz22222", slugEn: "x", slugEs: "y", slugHistoryEn: ["trigonometry-playground-2"] });
    r = read(cfg, { others: [other, other2] });
    const clash = r.problems.find((p) => p.field === "en.slug");
    assert.match(clash.message, /already used/); assert.equal(clash.suggestion, "trigonometry-playground-3");
    assert.equal(r.fields.slugEn, "trigonometry-playground");
    assert.equal(read({ ...cfg, en: { ...cfg.en, slug: "Bad Slug" } }).problems[0].suggestion, "bad-slug");
    const { en, ...noEn } = cfg;
    assert.match(read(noEn).problems.find((p) => p.field === "en").message, /Missing the "en" section/);
  });
  await check("Firestore value encoding round-trips", () => {
    const d = { a: "x", n: 3, f: 1.5, b: true, z: null, arr: ["p", 2], empty: [], m: { k: [{ q: "a" }] } };
    assert.deepEqual(storeLib.fromFields(storeLib.toFields(d)), d);
  });

  console.log("resources: public routes");
  const mem = storeLib.memoryStore();
  const srv = createDevServer({ onSend: () => {}, pricingFile: "", resourcesStore: mem });
  const base = await listen(srv);
  const app = require("../server.js");
  const get = (p, h = {}) => fetch(base + p, { redirect: "manual", headers: h });
  const fresh = () => app.resources._clearCache();

  await check("no resources: library empty state, home section hidden, sitemap unchanged", quiet(async () => {
    const r = await get("/resources/");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /The first tools are on their way/);
    const home = await (await get("/")).text();
    assert.match(home, /<section id="tools" class="tools-home" hidden>/);
    assert.doesNotMatch(await (await get("/sitemap.xml")).text(), /resources/);
  }));

  const doc = sample();
  const unpub = sample({ id: "bbbbb22222", status: "unpublished", slugEn: "gone-tool", slugEs: "herramienta-retirada", slugHistoryEn: [] });
  const draft = sample({ id: "ccccc33333", status: "draft", publishedAt: "", slugEn: "draft-tool", slugEs: "borrador", slugHistoryEn: [] });
  const hidden = sample({ id: "ddddd44444", visibility: "private", slugEn: "private-tool", slugEs: "privada", slugHistoryEn: [] });
  for (const d of [doc, unpub, draft, hidden]) await mem.put(d);
  await mem.writeObject(M.filePath(doc.id, 1), Buffer.from("<html><head></head>v1"), "text/html");
  await mem.writeObject(M.filePath(doc.id, 2), Buffer.from(TOOL), "text/html");
  await mem.writeObject(M.filePath(draft.id, 2), Buffer.from(TOOL), "text/html");
  await mem.writeObject(doc.og.en, Buffer.from("PNG"), "image/png");
  await mem.bump();
  fresh();

  await check("resource page: 200, title, H1, canonical, hreflang, JSON-LD, sandboxed iframe, frame URL", quiet(async () => {
    const r = await get("/resources/unit-circle/");
    assert.equal(r.status, 200);
    const h = await r.text();
    assert.match(h, /<title>Unit circle explorer — free interactive tool \| Jose Diaz Tutoring<\/title>/);
    assert.match(h, /<link rel="canonical" href="https:\/\/josediaztutoring\.com\/resources\/unit-circle\/">/);
    assert.match(h, /hreflang="es" href="https:\/\/josediaztutoring\.com\/es\/recursos\/circulo-unitario\/"/);
    assert.match(h, /hreflang="x-default" href="https:\/\/josediaztutoring\.com\/resources\/unit-circle\/"/);
    assert.match(h, /<iframe id="res-frame"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock"/);
    assert.doesNotMatch(h, /allow-top-navigation/);
    assert.doesNotMatch(h, /allow-same-origin/);
    assert.match(h, /"\/frame\/abcde12345\/v2"/);
    assert.match(h, /og:image" content="https:\/\/josediaztutoring\.com\/resources\/og\/abcde12345-en-0123abcd\.png"/);
    assert.match(h, /GTM-TG7DX6ZB/);
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(lds.map((x) => x["@type"]), ["LearningResource", "BreadcrumbList", "FAQPage"]);
    assert.equal(lds[0].isAccessibleForFree, true);
    assert.equal(lds[0].learningResourceType, "interactive tool");
    assert.match(h, /class="katex"/); // math rendered on the server
    assert.match(h, /href="\/resources\/katex\/[\d.]+\/katex\.min\.css"/);
    assert.match(h, /href="\/book\/" data-loc="bar"/);
    assert.match(h, /resource_book_click/);
  }));
  await check("Spanish page: lang, ?lang=es on the frame, Spanish CTA, link to the English twin", quiet(async () => {
    const h = await (await get("/es/recursos/circulo-unitario/")).text();
    assert.match(h, /<html lang="es">/);
    assert.match(h, /"\/frame\/abcde12345\/v2\?lang=es"/);
    assert.match(h, /herramienta interactiva gratis \| Jose Diaz Tutoring/);
    assert.match(h, /href="\/es\/reservar\/" data-loc="bar"/);
    assert.match(h, /<a href="\/resources\/unit-circle\/" hreflang="en"/);
  }));
  await check("old slug 301 (query kept), no slash 301, unpublished 410, draft / private / unknown 404", quiet(async () => {
    let r = await get("/resources/old-unit-circle/?utm_source=x");
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/resources/unit-circle/?utm_source=x");
    r = await get("/resources/unit-circle");
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/resources/unit-circle/");
    r = await get("/resources/gone-tool/");
    assert.equal(r.status, 410); assert.equal(r.headers.get("x-robots-tag"), "noindex");
    for (const p of ["/resources/draft-tool/", "/resources/private-tool/", "/resources/nope/", "/es/recursos/unit-circle/", "/resources/a/b/"]) assert.equal((await get(p)).status, 404, p);
    r = await get("/resources");
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/resources/");
    r = await get("/resources/", { cookie: "lang=es" });
    assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/es/recursos/");
  }));
  await check("frame: current and previous version only, live resources only, sandbox headers, prelude first", quiet(async () => {
    const r = await get("/frame/abcde12345/v2");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-security-policy"), /^sandbox allow-scripts[^;]*; frame-ancestors 'self'$/);
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(await r.text(), /<head><script>\(function\(\)\{\n\/\* jdt prelude/);
    assert.equal((await get("/frame/abcde12345/v1")).status, 200);
    for (const p of ["/frame/abcde12345/v3", "/frame/abcde12345/v0", "/frame/ccccc33333/v2", "/frame/bbbbb22222/v2", "/frame/zzzzz99999/v1"]) assert.equal((await get(p)).status, 404, p);
  }));
  const PA = PDF(3000, "A"), PB = PDF(250000, "B");
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  const fileEntry = (id, name, buf, labelEn, labelEs) => ({ name, labelEn, labelEs, path: M.pdfPath(id, name), sizeBytes: buf.length, sha256: sha(buf), uploadedAt: NOW });
  await check("resource page without files: no PDF section", quiet(async () => {
    assert.doesNotMatch(await (await get("/resources/unit-circle/")).text(), /id="files"|Printable PDFs/);
  }));
  await mem.put({ ...doc, files: [
    fileEntry(doc.id, "Cards_B.pdf", PB, "Newton's laws", "Leyes de Newton"),
    fileEntry(doc.id, "Cards_A.pdf", PA, "Kinematics & vectors", "Cinemática"),
    { name: "Cards_C.pdf", labelEn: "Pending", labelEs: "Pendiente" }, // listed, not uploaded
  ] });
  await mem.put({ ...unpub, files: [fileEntry(unpub.id, "Gone.pdf", PA, "g", "g")] });
  await mem.put({ ...draft, files: [fileEntry(draft.id, "Draft.pdf", PA, "d", "d")] });
  for (const [id, n, b] of [[doc.id, "Cards_A.pdf", PA], [doc.id, "Cards_B.pdf", PB], [unpub.id, "Gone.pdf", PA], [draft.id, "Draft.pdf", PA]]) await mem.writeObject(M.pdfPath(id, n), b, "application/pdf");
  await mem.bump(); fresh();

  await check("PDF route: 200, PDF headers (inline, nosniff, noindex, 1 h cache, ETag = sha256), the bytes, streamed", quiet(async () => {
    const before = mem.calls.readStream;
    const r = await get("/resources/unit-circle/files/Cards_A.pdf");
    assert.equal(r.status, 200);
    const H_ = Object.fromEntries(r.headers);
    assert.equal(H_["content-type"], "application/pdf");
    assert.equal(H_["content-disposition"], 'inline; filename="Cards_A.pdf"');
    assert.equal(H_["x-content-type-options"], "nosniff");
    assert.equal(H_["x-robots-tag"], "noindex");
    assert.equal(H_["cache-control"], "public, max-age=3600");
    assert.equal(H_.etag, `"${sha(PA)}"`);
    assert.equal(H_["accept-ranges"], "bytes");
    assert.equal(H_["content-length"], String(PA.length));
    assert.match(H_["strict-transport-security"], /max-age/);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(PA));
    assert.equal(mem.calls.readStream, before + 1);
  }));
  await check("PDF route: HEAD, If-None-Match -> 304, Range -> 206, past the end -> 416, stale If-Range -> 200", quiet(async () => {
    let r = await fetch(base + "/resources/unit-circle/files/Cards_B.pdf", { method: "HEAD" });
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-length"), String(PB.length)); assert.equal((await r.arrayBuffer()).byteLength, 0);
    const etag = `"${sha(PB)}"`;
    r = await get("/resources/unit-circle/files/Cards_B.pdf", { "If-None-Match": etag });
    assert.equal(r.status, 304); assert.equal(r.headers.get("etag"), etag); assert.equal((await r.arrayBuffer()).byteLength, 0);
    r = await get("/resources/unit-circle/files/Cards_B.pdf", { Range: "bytes=0-4" });
    assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), `bytes 0-4/${PB.length}`); assert.equal(await r.text(), "%PDF-");
    r = await get("/resources/unit-circle/files/Cards_B.pdf", { Range: "bytes=-10" });
    assert.equal(r.status, 206); assert.ok(Buffer.from(await r.arrayBuffer()).equals(PB.subarray(PB.length - 10)));
    r = await fetch(base + "/resources/unit-circle/files/Cards_B.pdf", { method: "HEAD", headers: { Range: "bytes=100-199" } });
    assert.equal(r.status, 206); assert.equal(r.headers.get("content-length"), "100");
    r = await get("/resources/unit-circle/files/Cards_B.pdf", { Range: `bytes=${PB.length}-` });
    assert.equal(r.status, 416); assert.equal(r.headers.get("content-range"), `bytes */${PB.length}`);
    r = await get("/resources/unit-circle/files/Cards_B.pdf", { Range: "bytes=0-4", "If-Range": '"old"' });
    assert.equal(r.status, 200); assert.equal((await r.arrayBuffer()).byteLength, PB.length);
  }));
  await check("PDF route: old slug and uppercase slug 301 (file name's case kept); 404 for everything else", quiet(async () => {
    let r = await get("/resources/old-unit-circle/files/Cards_A.pdf?utm_source=x");
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/resources/unit-circle/files/Cards_A.pdf?utm_source=x");
    r = await get("/RESOURCES/Unit-Circle/files/Cards_A.pdf");
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/resources/unit-circle/files/Cards_A.pdf");
    r = await get("/en/resources/unit-circle/FILES/Cards_A.pdf");
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/resources/unit-circle/files/Cards_A.pdf");
    for (const p of [
      "/resources/unit-circle/files/cards_a.pdf",        // the name is case-sensitive
      "/resources/unit-circle/files/Cards_C.pdf",        // listed, not uploaded
      "/resources/unit-circle/files/Nope.pdf",
      "/resources/unit-circle/files/",
      "/resources/unit-circle/files/Cards_A.pdf/",
      "/resources/gone-tool/files/Gone.pdf",             // unpublished
      "/resources/draft-tool/files/Draft.pdf",           // draft
      "/resources/private-tool/files/Cards_A.pdf",
      "/es/recursos/circulo-unitario/files/Cards_A.pdf", // no ES file URL
      "/resources/unit-circle/files/..%2F..%2Fv2.html",
      "/resources/unit-circle/files/%2e%2e%2fCards_A.pdf",
      "/resources/unit-circle/files/..%2Fcards_a.pdf",
      "/resources/unit-circle/files/Cards_A%2Epdf",
    ]) assert.equal((await fetch(base + p)).status, 404, p); // following any redirect
    // raw dot segments (fetch would resolve them before sending): server.js resolves them like a browser
    // (WHATWG URL), so they only ever reach the normal routes, never a bucket path
    const raw = (p) => new Promise((ok, no) => require("node:http").get(base + "/", { path: p }, (r) => { r.resume(); ok([r.statusCode, r.headers["content-type"]]); }).on("error", no));
    assert.deepEqual(await raw("/resources/unit-circle/files/.."), [200, "text/html; charset=utf-8"]); // = the page // = the page
    assert.deepEqual((await raw("/resources/unit-circle/files/../../../frame/x/../../og/../v2.html"))[0], 404);
    assert.equal((await fetch(base + "/resources/unit-circle/files/Cards_A.pdf", { method: "POST" })).status, 404);
  }));
  await check("page: 'Printable PDFs' after 'How to use it', label · size, new tab, uploaded only, in order; ES same URLs", quiet(async () => {
    const h = await (await get("/resources/unit-circle/")).text();
    const sec = h.match(/<section id="files"[\s\S]*?<\/section>/)[0];
    assert.ok(h.indexOf('id="how"') < h.indexOf('id="files"') && h.indexOf('id="files"') < h.indexOf('id="ideas"'));
    assert.match(sec, /<h2>Printable PDFs<\/h2>/);
    assert.match(sec, /data-resource-slug="unit-circle"/);
    const items = [...sec.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener" data-file="([^"]+)">([^<]+)<\/a> <span class="res-file-size">· ([^<]+)<\/span>/g)].map((m) => m.slice(1));
    assert.deepEqual(items, [
      ["/resources/unit-circle/files/Cards_B.pdf", "Cards_B.pdf", "Newton&#39;s laws", "244 KB"],
      ["/resources/unit-circle/files/Cards_A.pdf", "Cards_A.pdf", "Kinematics &amp; vectors", "3 KB"],
    ]);
    assert.doesNotMatch(sec, /Cards_C|Pending/);
    assert.match(h, /resource_file_open/);
    assert.match(h, /ids=\["main","tool","how","files",/);
    const e = await (await get("/es/recursos/circulo-unitario/")).text();
    const se = e.match(/<section id="files"[\s\S]*?<\/section>/)[0];
    assert.match(se, /<h2>PDF para imprimir<\/h2>/);
    assert.match(se, /href="\/resources\/unit-circle\/files\/Cards_B\.pdf"[^>]*>Leyes de Newton<\/a> <span class="res-file-size">· 244 KB/);
    // the sitemap never lists PDFs
    app.resources._clearCache();
    assert.doesNotMatch(await (await get("/sitemap.xml")).text(), /files\/|\.pdf/);
  }));
  await check("phone bar: back link reads '← Resources' / '← Recursos' and goes to the library", quiet(async () => {
    assert.match(await (await get("/resources/unit-circle/")).text(), /<a class="res-back" href="\/resources\/"><span aria-hidden="true">←<\/span> Resources<\/a>/);
    assert.match(await (await get("/es/recursos/circulo-unitario/")).text(), /<a class="res-back" href="\/es\/recursos\/"><span aria-hidden="true">←<\/span> Recursos<\/a>/);
  }));
  await check("preview cards and KaTeX assets: served, long cache; unknown 404", quiet(async () => {
    let r = await get("/resources/og/abcde12345-en-0123abcd.png");
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png"); assert.match(r.headers.get("cache-control"), /immutable/);
    assert.equal((await get("/resources/og/abcde12345-en-ffffffff.png")).status, 404);
    const v = require("katex/package.json").version;
    r = await get(`/resources/katex/${v}/katex.min.css`);
    assert.equal(r.status, 200);
    const css = await r.text();
    const font = css.match(/url\((fonts\/katex_main-regular\.woff2)\)/)[1];
    assert.equal((await get(`/resources/katex/${v}/${font}`)).status, 200);
    assert.equal((await get(`/resources/katex/0.0.1/katex.min.css`)).status, 404);
  }));
  await check("library: live resources only, newest first, filters, JSON-LD CollectionPage", quiet(async () => {
    await mem.put(sample({ id: "eeeee55555", slugEn: "newer", slugEs: "mas-nueva", slugHistoryEn: [], publishedAt: "2026-11-21T00:00:00Z", subject: "physics", en: { ...sample().en, title: "Newer tool" } }));
    await mem.bump(); fresh();
    const h = await (await get("/resources/")).text();
    const titles = [...h.matchAll(/class="tool-card-title">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(titles, ["Newer tool", "Unit circle explorer"]);
    assert.match(h, /data-group="subject"/);
    assert.match(h, /"@type": "CollectionPage"/);
    assert.match(h, /<a href="\/resources\/" data-i18n="navResources" aria-current="page">/);
  }));
  await check("home pages show the 3 newest tools", quiet(async () => {
    const h = await (await get("/es/")).text();
    assert.match(h, /<section id="tools" class="tools-home">/);
    assert.match(h, /href="\/es\/recursos\/mas-nueva\/"/);
    assert.doesNotMatch(h, /<!--resources:cards-->/);
  }));
  await check("sitemap: built pages + library + each live resource in both languages, nothing else", quiet(async () => {
    app.resources._clearCache();
    const x = await (await get("/sitemap.xml")).text();
    for (const p of ["/resources/", "/es/recursos/", "/resources/unit-circle/", "/es/recursos/circulo-unitario/", "/resources/newer/", "/privacy/"]) assert.ok(x.includes(`<loc>https://josediaztutoring.com${p}</loc>`), p);
    for (const p of ["gone-tool", "draft-tool", "private-tool", "old-unit-circle"]) assert.ok(!x.includes(p), p);
    assert.equal((x.match(/<loc>/g) || []).length, 14 + 2 + 4);
    assert.doesNotMatch(x, /xhtml|hreflang/);
  }));
  await check("publishing is picked up after the 15-second cache, without a restart", quiet(async () => {
    await mem.put(sample({ id: "fffff66666", slugEn: "brand-new", slugEs: "nuevecita", slugHistoryEn: [] }));
    await mem.bump();
    // still cached: not visible yet
    assert.equal((await get("/resources/brand-new/")).status, 404);
    app.resources._clearCache(); // = 15 s later
    assert.equal((await get("/resources/brand-new/")).status, 200);
  }));
  await check("the cache reads one marker per check and the list only when it changed", quiet(async () => {
    app.resources._clearCache();
    await get("/resources/");
    const before = { ...mem.calls };
    for (let i = 0; i < 3; i++) { app.resources._clearCache(); await get("/resources/"); }
    assert.equal(mem.calls.list, before.list);
    assert.equal(mem.calls.rev, before.rev + 3);
  }));
  await check("/admin and /admin/: 302 to ADMIN_URL, no-store, noindex; deeper paths and /es/admin 404", quiet(async () => {
    const saved = process.env.ADMIN_URL;
    process.env.ADMIN_URL = "https://admin-dot-jalex-hub.ue.r.appspot.com";
    try {
      for (const p of ["/admin", "/admin/"]) {
        const r = await get(p);
        assert.equal(r.status, 302, p);
        assert.equal(r.headers.get("location"), "https://admin-dot-jalex-hub.ue.r.appspot.com", p);
        assert.equal(r.headers.get("cache-control"), "no-store", p);
        assert.equal(r.headers.get("x-robots-tag"), "noindex", p);
      }
      assert.equal((await fetch(base + "/admin", { method: "HEAD", redirect: "manual" })).status, 302);
      for (const p of ["/admin/anything", "/admin/edit/abcde12345", "/es/admin", "/es/admin/", "/administrator"]) assert.equal((await get(p)).status, 404, p);
      assert.equal((await fetch(base + "/admin", { method: "POST", redirect: "manual" })).status, 404);
      // uppercase: one 301 to the lowercase path first (server.js normalization), then the 302
      const up = await get("/Admin");
      assert.equal(up.status, 301); assert.equal(up.headers.get("location"), "/admin");
      // not linked or listed anywhere public
      const home = await (await get("/")).text(), sm = await (await get("/sitemap.xml")).text();
      for (const [n, t] of [["home", home], ["sitemap", sm], ["llms.txt", await (await get("/llms.txt")).text()], ["robots.txt", await (await get("/robots.txt")).text()]]) {
        assert.doesNotMatch(t, /\/admin\b|admin-dot/, n);
      }
      for (const v of ["", "   ", "http://admin-dot-jalex-hub.ue.r.appspot.com", "not a url"]) {
        process.env.ADMIN_URL = v;
        const warn = console.warn; console.warn = () => {};
        try { assert.equal((await get("/admin")).status, 404, JSON.stringify(v)); } finally { console.warn = warn; }
      }
      delete process.env.ADMIN_URL;
      assert.equal((await get("/admin/")).status, 404);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_URL; else process.env.ADMIN_URL = saved;
    }
  }));
  await check("store down: the last good data keeps serving", quiet(async () => {
    const real = mem.rev;
    mem.rev = async () => { throw new Error("down"); };
    const err = console.error; console.error = () => {};
    try { app.resources._clearCache(); assert.equal((await get("/resources/unit-circle/")).status, 200); }
    finally { mem.rev = real; console.error = err; }
  }));
  await new Promise((r) => srv.close(r));
  srv.closeAllConnections && srv.closeAllConnections();

  // --- admin -------------------------------------------------------------------------------------------
  console.log("resources: admin");
  if (!fs.existsSync(path.join(ROOT, "admin/node_modules/satori"))) {
    console.log("  SKIPPED admin checks: run `npm install --prefix admin` first");
  } else {
    const iap = require("../admin/iap.js");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const sign = (payload, kid = "k1") => {
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const head = enc({ alg: "ES256", kid }), body = enc(payload);
      return `${head}.${body}.${crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    };
    const aud = "/projects/123/apps/jalex-hub";
    const t = Math.floor(Date.now() / 1000);
    const getKey = async (kid) => (kid === "k1" ? publicKey : null);
    const good = { iss: iap.ISSUER, aud, email: "me@school.test", iat: t, exp: t + 600 };

    await check("IAP JWT: valid passes; wrong audience, issuer, key, signature or expired fail", async () => {
      assert.equal((await iap.verifyJwt(sign(good), { aud, getKey })).email, "me@school.test");
      await assert.rejects(iap.verifyJwt(sign({ ...good, aud: "/projects/9/apps/x" }), { aud, getKey }), /audience/);
      await assert.rejects(iap.verifyJwt(sign({ ...good, iss: "https://evil" }), { aud, getKey }), /issuer/);
      await assert.rejects(iap.verifyJwt(sign(good, "k2"), { aud, getKey }), /unknown key/);
      await assert.rejects(iap.verifyJwt(sign({ ...good, exp: t - 3600 }), { aud, getKey }), /expired/);
      const tok = sign(good).split("."); tok[1] = Buffer.from(JSON.stringify({ ...good, email: "x@y.z" })).toString("base64url");
      await assert.rejects(iap.verifyJwt(tok.join("."), { aud, getKey }), /signature/);
    });
    await check("admin sign-in: ADMIN_EMAILS only; no header refused; DEV_NO_IAP refused on App Engine", async () => {
      await assert.rejects(iap.adminEmail({ headers: {} }, { ADMIN_EMAILS: "me@school.test", IAP_AUDIENCE: aud }), /no IAP header/);
      await assert.rejects(iap.adminEmail({ headers: {} }, { ADMIN_EMAILS: "set-your-google-account@example.com" }), /ADMIN_EMAILS is not set/);
      await assert.rejects(iap.adminEmail({ headers: {} }, { DEV_NO_IAP: "1", GAE_ENV: "standard" }), /not allowed on App Engine/);
      assert.deepEqual(iap.allowedEmails({ ADMIN_EMAILS: " A@x.com, b@y.com ,," }), ["a@x.com", "b@y.com"]);
    });

    await check("Google sign-in: login redirect, state/nonce checks, allowlist, signed 12-hour session, logout", async () => {
      const auth = require("../admin/auth.js");
      const env = { ADMIN_EMAILS: "me@school.test", OAUTH_CLIENT_ID: "cid.apps.googleusercontent.com", OAUTH_CLIENT_SECRET: "s3cret", ADMIN_BASE_URL: "https://admin.example" };
      const run = async (pathAndQuery, cookie = "") => {
        const out = {};
        const url = new URL(pathAndQuery, "https://admin.example");
        await auth.route({ headers: { cookie } }, {}, url, (res, status, headers, body) => Object.assign(out, { status, headers, body }), env);
        return out;
      };
      const jar = (setCookie) => [].concat(setCookie).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ");
      // login: Google URL with our client, exact redirect URI, state + nonce, login_hint; state cookie
      const login = await run("/auth/login?next=/edit/abcde12345");
      assert.equal(login.status, 302);
      const g = new URL(login.headers.Location);
      assert.equal(g.origin + g.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
      assert.equal(g.searchParams.get("client_id"), env.OAUTH_CLIENT_ID);
      assert.equal(g.searchParams.get("redirect_uri"), "https://admin.example/auth/callback");
      assert.equal(g.searchParams.get("login_hint"), "me@school.test");
      assert.match(login.headers["Set-Cookie"], /^__Host-jdt_oauth=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
      const stateCookie = jar(login.headers["Set-Cookie"]);
      const state = g.searchParams.get("state"), nonce = g.searchParams.get("nonce");
      // Google's token endpoint, mocked: returns an ID token with the given claims
      let claims = {};
      auth._setFetch(async (u, opts) => {
        assert.equal(u, "https://oauth2.googleapis.com/token");
        const b = new URLSearchParams(opts.body);
        assert.equal(b.get("client_secret"), "s3cret"); assert.equal(b.get("redirect_uri"), "https://admin.example/auth/callback");
        const tok = ["x", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
        return { ok: true, status: 200, json: async () => ({ id_token: tok }) };
      });
      const good = { aud: env.OAUTH_CLIENT_ID, iss: "https://accounts.google.com", exp: Date.now() / 1000 + 600, nonce, email: "Me@School.test", email_verified: true };
      // wrong state -> 400; other account -> 403; wrong nonce / audience -> 403
      assert.equal((await run(`/auth/callback?code=c&state=nope`, stateCookie)).status, 400);
      assert.equal((await run(`/auth/callback?code=c&state=${state}`)).status, 400); // no state cookie
      for (const bad of [{ email: "other@gmail.com" }, { nonce: "x" }, { aud: "other" }, { email_verified: false }, { exp: 1 }]) {
        claims = { ...good, ...bad };
        const warn = console.warn; console.warn = () => {};
        try { assert.equal((await run(`/auth/callback?code=c&state=${state}`, stateCookie)).status, 403, JSON.stringify(bad)); } finally { console.warn = warn; }
      }
      claims = good;
      const log = console.log; console.log = () => {};
      let ok; try { ok = await run(`/auth/callback?code=c&state=${state}`, stateCookie); } finally { console.log = log; }
      assert.equal(ok.status, 302);
      assert.equal(ok.headers.Location, "/edit/abcde12345");
      const session = jar(ok.headers["Set-Cookie"]);
      assert.match(session, /^__Host-jdt_admin=/);
      assert.ok(ok.headers["Set-Cookie"].some((c) => /^__Host-jdt_admin=.*Max-Age=43200; HttpOnly; Secure; SameSite=Lax$/.test(c)));
      // the session works; tampered, other-key or no cookie -> signed out; removed from ADMIN_EMAILS -> signed out
      assert.equal(await auth.sessionEmail({ headers: { cookie: session } }, env), "me@school.test");
      const [name, val] = session.split("=");
      const [body, sig] = val.split(".");
      const forged = Buffer.from(JSON.stringify({ email: "me@school.test", exp: 9e9 })).toString("base64url");
      assert.equal(await auth.sessionEmail({ headers: { cookie: `${name}=${forged}.${sig}` } }, env), null);
      assert.equal(await auth.sessionEmail({ headers: { cookie: session } }, { ...env, OAUTH_CLIENT_SECRET: "rotated" }), null);
      assert.equal(await auth.sessionEmail({ headers: { cookie: session } }, { ...env, ADMIN_EMAILS: "else@x.com" }), null);
      assert.equal(await auth.sessionEmail({ headers: {} }, env), null);
      // open-redirect guard on ?next=
      for (const n of ["//evil.example", "https://evil.example", "/\\evil", "/auth/logout", ""]) assert.equal(auth.safeNext(n), "/", n);
      assert.equal(auth.safeNext("/edit/abc?x=1"), "/edit/abc?x=1");
      // logout clears the cookie
      const out = await run("/auth/logout", session);
      assert.match(out.headers["Set-Cookie"], /^__Host-jdt_admin=; Path=\/; Max-Age=0/);
      // misconfiguration is loud
      await assert.rejects(auth.route({ headers: {} }, {}, new URL("https://a/auth/login"), () => {}, { ...env, ADMIN_BASE_URL: "" }), /ADMIN_BASE_URL/);
    });

    const admin = require("../admin/server.js");
    const astore = storeLib.memoryStore();
    admin._setStore(astore);
    const cardsCalls = [];
    admin._setCards({ renderCard: async (o) => { cardsCalls.push(o); return Buffer.from(`png-${o.lang}-${o.title}`); }, cardPath: (id, lang, png) => `og/${id}-${lang}-${crypto.createHash("sha256").update(png).digest("hex").slice(0, 8)}.png` });
    let user = "me@school.test";
    admin._setAuth(async () => user || null);
    const warn = console.warn; console.warn = () => {};
    const abase = await listen(admin.server);
    const token = await admin._csrfToken("me@school.test");
    // form saves carry the rev they were loaded at; the older checks here don't care, so the helper adds
    // the current one (the stale-save checks below send their own)
    const A = async (method, p, body, headers = {}) => {
      const save = body && !Buffer.isBuffer(body) && body.doc && body.rev === undefined && /^\/api\/resources\/[a-z0-9]{10}(\/publish)?$/.test(p);
      if (save) {
        const g = await fetch(abase + p.replace(/\/publish$/, ""), { headers: { "X-JDT-Admin": "1" } });
        if (g.ok) body = { ...body, rev: (await g.json()).doc.rev };
      }
      return fetch(abase + p, {
        method, redirect: "manual",
        headers: { "X-JDT-Admin": "1", "X-CSRF-Token": token, ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
      });
    };
    const logs = console.log; console.log = () => {};
    let id;
    try {
      await check("signed out: pages go to Google sign-in (302 /auth/login?next=...), the API answers 401", async () => {
        user = null;
        const r = await fetch(abase + "/edit/abcde12345?x=1", { redirect: "manual" });
        assert.equal(r.status, 302);
        assert.equal(r.headers.get("location"), "/auth/login?next=%2Fedit%2Fabcde12345%3Fx%3D1");
        assert.equal((await A("POST", "/api/resources", {})).status, 401);
        user = "me@school.test";
        assert.equal((await fetch(abase + "/")).status, 200);
      });
      await check("API needs X-JDT-Admin and a same-origin Origin (an uploaded tool has Origin: null)", async () => {
        assert.equal((await fetch(abase + "/api/resources", { method: "POST" })).status, 403);
        assert.equal((await A("POST", "/api/resources", {}, { Origin: "null" })).status, 403);
        assert.equal((await A("POST", "/api/resources", {}, { Origin: "https://evil.example" })).status, 403);
        assert.equal((await A("POST", "/api/resources", {}, { "Sec-Fetch-Site": "cross-site" })).status, 403);
      });
      await check("create a draft, upload a file (warnings back), versions count up", async () => {
        id = (await (await A("POST", "/api/resources", {})).json()).id;
        assert.match(id, M.ID_RE);
        let r = await A("POST", `/api/resources/${id}/file`, Buffer.from("not html"));
        assert.equal(r.status, 400); assert.match((await r.json()).error, /doesn't look like an HTML/);
        r = await A("POST", `/api/resources/${id}/file`, Buffer.from(TOOL.replace("<head>", "<head><script>localStorage.a=1</script>")));
        const j = await r.json();
        assert.equal(j.doc.file.version, 1);
        assert.ok(j.warnings.some((w) => /localStorage/.test(w)));
        assert.equal((await (await A("POST", `/api/resources/${id}/file`, Buffer.from(TOOL))).json()).doc.file.version, 2);
        assert.ok(astore._objects.has(M.filePath(id, 1)) && astore._objects.has(M.filePath(id, 2)));
        r = await A("POST", `/api/resources/${id}/file`, Buffer.alloc(2 * 1048576 + 10, 0x61));
        assert.equal(r.status, 413);
      });
      await check("admin frame serves any version of a draft, sandboxed, not cached", async () => {
        const r = await fetch(`${abase}/frame/${id}/v1`);
        assert.equal(r.status, 200);
        assert.match(r.headers.get("content-security-policy"), /^sandbox /);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.equal((await fetch(`${abase}/frame/${id}/v3`)).status, 404);
      });
      // complete page text (the config schema's counts: 3-6 steps, 3-5 ideas, 3-5 questions, 5-8 keywords)
      const fields = {
        slugEn: "projectile-motion", slugEs: "tiro-parabolico", subject: "physics", levels: ["high-school"], courseTags: ["AP Physics 1"], relatedExamPage: "",
        en: { title: "Projectile motion", description: "Range and height.", intro: "$R=\\frac{v^2\\sin2\\theta}{g}$", howTo: ["Set the angle.", "Set the speed.", "Fire."], keyIdeas: ["45 degrees.", "$g$ pulls down.", "No drag."],
          faq: [{ q: "Why 45?", a: "Max range." }, { q: "Drag?", a: "None." }, { q: "Units?", a: "SI." }], keywords: ["projectile", "range", "angle", "physics", "kinematics"] },
        es: { title: "Tiro parabólico", description: "Alcance y altura.", intro: "Intro.", howTo: ["Elige el ángulo.", "Elige la rapidez.", "Dispara."], keyIdeas: ["45 grados.", "$g$ hacia abajo.", "Sin arrastre."],
          faq: [{ q: "¿Por qué 45?", a: "Alcance máximo." }, { q: "¿Arrastre?", a: "No." }, { q: "¿Unidades?", a: "SI." }], keywords: ["proyectil", "alcance", "ángulo", "física", "cinemática"] },
      };
      await check("publish: refused without the checkbox, with problems, or with a broken formula", async () => {
        let r = await A("POST", `/api/resources/${id}/publish`, { doc: { ...fields, es: { ...fields.es, title: "" } }, checked: true });
        assert.equal(r.status, 400); assert.ok((await r.json()).problems.some((p) => /ES: title/.test(p)));
        r = await A("POST", `/api/resources/${id}/publish`, { doc: fields, checked: false });
        assert.equal(r.status, 400); assert.match((await r.json()).error, /Tick/);
        r = await A("POST", `/api/resources/${id}/publish`, { doc: { ...fields, en: { ...fields.en, intro: "$\\frac{1}$" } }, checked: true });
        assert.equal(r.status, 400); assert.ok((await r.json()).problems.some((p) => /doesn't render/.test(p)));
        assert.equal((await astore.get(id)).status, "draft");
      });
      await check("save draft: slug clash refused; draft saved without bumping the public marker", async () => {
        await astore.put(sample({ id: "taken00000", slugEn: "taken", slugEs: "ocupado", slugHistoryEn: [] }));
        let r = await A("PUT", `/api/resources/${id}`, { doc: { ...fields, slugEn: "taken" } });
        assert.equal(r.status, 400); assert.match((await r.json()).error, /already used/);
        const rev = await astore.rev();
        r = await A("PUT", `/api/resources/${id}`, { doc: fields });
        assert.equal(r.status, 200);
        assert.equal(await astore.rev(), rev);
      });
      await check("publish: cards made (EN + ES), status published, marker bumped", async () => {
        const rev = await astore.rev();
        const r = await A("POST", `/api/resources/${id}/publish`, { doc: fields, checked: true });
        const j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.equal(j.doc.status, "published");
        assert.ok(j.doc.publishedAt && j.doc.checkedAt);
        assert.match(j.doc.og.en, new RegExp(`^og/${id}-en-[a-f0-9]{8}\\.png$`));
        assert.ok(astore._objects.has(j.doc.og.es));
        assert.deepEqual(cardsCalls.map((c) => c.subline), ["Physics · High school", "Física · High school"]);
        assert.notEqual(await astore.rev(), rev);
      });
      await check("live page: a save needs the checkbox; a slug change keeps a 301 from the old slug; delete refused", async () => {
        let r = await A("PUT", `/api/resources/${id}`, { doc: { ...fields, slugEn: "projectile" } });
        assert.equal(r.status, 400);
        r = await A("PUT", `/api/resources/${id}`, { doc: { ...fields, slugEn: "projectile" }, checked: true });
        assert.equal(r.status, 200);
        assert.deepEqual((await r.json()).doc.slugHistoryEn, ["projectile-motion"]);
        r = await A("DELETE", `/api/resources/${id}`);
        assert.equal(r.status, 400);
      });
      await check("unpublish -> 'unpublished' (public 410); a never-published draft can be deleted with its files", async () => {
        let r = await A("POST", `/api/resources/${id}/unpublish`, {});
        assert.equal((await r.json()).doc.status, "unpublished");
        const id2 = (await (await A("POST", "/api/resources", {})).json()).id;
        await A("POST", `/api/resources/${id2}/file`, Buffer.from(TOOL));
        r = await A("DELETE", `/api/resources/${id2}`);
        assert.equal(r.status, 200);
        assert.equal(await astore.get(id2), null);
        assert.ok(!astore._objects.has(M.filePath(id2, 1)));
      });
      await check("admin pages: list, editor, preview (noindex, no GTM, admin frame), CSP and no framing", async () => {
        let r = await fetch(abase + "/");
        assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
        assert.match(await r.text(), /Projectile motion/);
        r = await fetch(`${abase}/edit/${id}`);
        const h = await r.text();
        assert.match(h, /I checked the formulas and the Spanish/);
        assert.match(h, /phase2:draft-with-claude/);
        r = await fetch(`${abase}/preview/${id}/es`);
        const p = await r.text();
        assert.match(p, /<meta name="robots" content="noindex, nofollow">/);
        assert.doesNotMatch(p, /googletagmanager/);
        assert.match(p, new RegExp(`"http://127\\.0\\.0\\.1:\\d+/frame/${id}/v2\\?lang=es"`));
        assert.equal(r.headers.get("x-frame-options"), "DENY");
        assert.equal((await fetch(`${abase}/edit/zzzzzzzzzz`)).status, 404);
      });
      await check("config endpoint (tool pair): schema-checked and mapped, nothing saved; bad JSON refused; old uploads still download", async () => {
        const text = fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"));
        const cid = (await (await A("POST", "/api/resources", {})).json()).id;
        const before = await astore.get(cid);
        let r = await A("POST", `/api/resources/${cid}/config`, text, { "X-File-Name": "trigonometry-playground.json", "X-Html-Name": "trigonometry-playground.html" });
        let j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.equal(j.fields.en.faq.length, 5);
        assert.deepEqual(j.problems, []);
        assert.equal(j.valid, true);
        assert.deepEqual(await astore.get(cid), before, "nothing saved");
        assert.ok(![...astore._objects.keys()].some((k) => k.startsWith(`resources/${cid}/config-`)), "no raw copy stored");
        // schema problems come back with the field, the path and the line
        const bad = JSON.parse(text); bad.es.description = "x".repeat(171); bad.en.howTo = ["one"];
        r = await A("POST", `/api/resources/${cid}/config`, Buffer.from(JSON.stringify(bad, null, 2)), { "X-Html-Name": "trigonometry-playground.html" });
        j = await r.json();
        assert.equal(j.valid, false);
        const desc = j.problems.find((p) => p.path === "es.description");
        assert.equal(desc.message, "es.description is 171 characters; max 155.");
        assert.equal(desc.field, "es.description"); assert.ok(desc.line > 1);
        assert.ok(j.problems.some((p) => p.field === "en.howTo" && /has 1 item; it needs 3 to 6/.test(p.message)));
        // the config is for another tool file than the one uploaded with it
        r = await A("POST", `/api/resources/${cid}/config`, text, { "X-Html-Name": "unit-circle.html" });
        assert.match((await r.json()).problems.map((p) => p.message).join(), /file is "trigonometry-playground\.html", but the tool file uploaded with it is "unit-circle\.html"/);
        r = await A("POST", `/api/resources/${cid}/config`, Buffer.from("{oops"), { "X-File-Name": "x.json" });
        j = await r.json();
        assert.equal(r.status, 400); assert.match(j.problems[0].message, /isn't valid JSON/);
        // a config uploaded before the editor existed still downloads, as it was
        await astore.writeObject(`resources/${cid}/config-1.json`, text);
        await astore.put({ ...(await astore.get(cid)), configs: [{ n: 1, path: `resources/${cid}/config-1.json`, name: "t.json" }] });
        const d = await fetch(`${abase}/download/${cid}/config/1`);
        assert.ok(Buffer.from(await d.arrayBuffer()).equals(text));
        assert.equal((await fetch(`${abase}/download/${cid}/config/2`)).status, 404);
      });
      // ---- Config (.json) tab: read, check, save, history, restore, stale saves, CSRF --------------------
      const trig = fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"), "utf8");
      const J = { id: "" };
      const getCfg = async () => (await (await A("GET", `/api/resources/${J.id}/config.json`)).json());
      // a public page as the site would serve it from the admin's data (the public test server reads `mem`)
      const pub = async (p) => {
        const srv2 = createDevServer({ onSend: () => {}, pricingFile: "", resourcesStore: astore });
        const b2 = await listen(srv2);
        try { return await (await fetch(b2 + p)).text(); } finally { srv2.close(); }
      };
      await check("JSON tab: a draft's config loads in the upload format; a valid edit saves and keeps the previous config as a revision", async () => {
        J.id = (await (await A("POST", "/api/resources", {})).json()).id;
        await A("POST", `/api/resources/${J.id}/file`, Buffer.from(TOOL), { "X-File-Name": "trigonometry-playground.html" });
        let c = await getCfg();
        assert.equal(c.text, toolconfig.configText(await astore.get(J.id)));
        assert.equal(JSON.parse(c.text).file, "trigonometry-playground.html");
        const draftText = c.text;
        let r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: trig, rev: c.rev, source: "upload" });
        let j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.equal(j.text, trig, "saved exactly as given");
        assert.equal(j.doc.en.title, JSON.parse(trig).en.title);
        assert.equal(j.doc.file.version, 1, "the tool is untouched");
        const revs = (await (await A("GET", `/api/resources/${J.id}/revisions`)).json()).revisions;
        assert.equal(revs[0].source, "upload"); assert.equal(revs[0].savedBy, "me@school.test"); assert.equal(revs[0].n, c.rev);
        assert.equal((await astore.getRevision(J.id, c.rev)).config, draftText);
        r = await A("POST", `/api/resources/${J.id}/publish`, { checked: true });
        assert.equal(r.status, 200, (await r.json()).error);
      });
      await check("JSON tab: CSRF token and the 256 KB limit on save requests", async () => {
        const c = await getCfg();
        const put = (headers) => fetch(`${abase}/api/resources/${J.id}/config.json`, { method: "PUT", headers: { "X-JDT-Admin": "1", "Content-Type": "application/json", ...headers }, body: JSON.stringify({ text: trig, rev: c.rev }) });
        assert.equal((await put({})).status, 403);
        assert.equal((await put({ "X-CSRF-Token": "x".repeat(43) })).status, 403);
        assert.equal((await A("POST", `/api/resources/${J.id}/config/check`, {}, { "X-CSRF-Token": "" })).status, 403);
        const r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: " ".repeat(256 * 1024), rev: c.rev });
        assert.equal(r.status, 413);
        // a GET needs no token
        assert.equal((await fetch(`${abase}/api/resources/${J.id}/config.json`, { headers: { "X-JDT-Admin": "1" } })).status, 200);
      });
      await check("JSON tab: Validate lists errors with paths and lines; Save refuses errors, needs the checkbox when live, updates EN and ES pages", async () => {
        const c = await getCfg(), cfg = JSON.parse(c.text);
        const bad = JSON.stringify({ ...cfg, es: { ...cfg.es, description: "x".repeat(171) } }, null, 2);
        let j = await (await A("POST", `/api/resources/${J.id}/config/check`, { text: bad })).json();
        assert.equal(j.valid, false); assert.equal(j.errors[0].message, "es.description is 171 characters; max 155."); assert.ok(j.errors[0].line > 1);
        let r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: bad, rev: c.rev, checked: true });
        assert.equal(r.status, 400); assert.equal((await r.json()).errors[0].path, "es.description");
        const good = JSON.stringify({ ...cfg, en: { ...cfg.en, title: "Trig playground v2" }, es: { ...cfg.es, title: "Laboratorio de trigonometría v2" } }, null, 2) + "\n";
        j = await (await A("POST", `/api/resources/${J.id}/config/check`, { text: good })).json();
        assert.equal(j.valid, true); assert.equal(j.diff.changed, 2); assert.equal(j.diff.text[0].field, "title");
        r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: good, rev: c.rev });
        assert.equal(r.status, 400); assert.match((await r.json()).error, /Tick/);
        const marker = await astore.rev();
        r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: good, rev: c.rev, checked: true });
        j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.notEqual(await astore.rev(), marker, "the public marker is bumped (live within the cache time)");
        // the public pages, EN and ES
        const en = await pub(`/resources/${cfg.en.slug}/`);
        const es = await pub(`/es/recursos/${cfg.es.slug}/`);
        assert.match(en, /<h1>Trig playground v2<\/h1>/); assert.match(es, /<h1>Laboratorio de trigonometría v2<\/h1>/);
        // the download is the current config
        assert.equal(await (await fetch(`${abase}/download/${J.id}/config.json`)).text(), good);
      });
      await check("stale saves are refused (409) with the diff against the current version: JSON tab and form", async () => {
        const c = await getCfg(), cfg = JSON.parse(c.text);
        // another tab saves first
        let r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: JSON.stringify({ ...cfg, courseTags: [...cfg.courseTags, "Trig"] }, null, 2), rev: c.rev, checked: true });
        assert.equal(r.status, 200);
        const mine = JSON.stringify({ ...cfg, en: { ...cfg.en, title: "Mine" } }, null, 2);
        r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: mine, rev: c.rev, checked: true });
        let j = await r.json();
        assert.equal(r.status, 409); assert.equal(j.stale, true); assert.equal(j.rev, c.rev + 1);
        assert.match(j.current, /"Trig"/);
        assert.deepEqual(j.diff.shared.map((x) => x.field), ["courseTags"], "mine lacks the other tab's tag");
        assert.deepEqual(j.diff.text.map((x) => x.field), ["title"]);
        assert.notEqual((await astore.get(J.id)).en.title, "Mine");
        // the form, too
        const d = await astore.get(J.id);
        r = await A("PUT", `/api/resources/${J.id}`, { doc: { ...d, en: { ...d.en, title: "Form" } }, checked: true, rev: d.rev - 1 });
        j = await r.json();
        assert.equal(r.status, 409); assert.equal(j.stale, true);
        r = await A("PUT", `/api/resources/${J.id}`, { doc: { ...d, en: { ...d.en, title: "From the form" } }, checked: true, rev: d.rev });
        assert.equal(r.status, 200);
        assert.equal((await (await A("GET", `/api/resources/${J.id}/revisions`)).json()).revisions[0].source, "form");
        // the store's own check (a save that raced past the rev check)
        await assert.rejects(astore.putIf({ ...(await astore.get(J.id)) }, 0), (e) => e.code === "stale");
      });
      await check("history: the last saves, View diff, Restore through the same validate -> save path", async () => {
        const list = (await (await A("GET", `/api/resources/${J.id}/revisions`)).json()).revisions;
        assert.ok(list.length >= 4 && list.length <= 20);
        assert.deepEqual(list.map((x) => x.n), [...list.map((x) => x.n)].sort((a, b) => b - a), "newest first");
        assert.deepEqual(list.map((x) => x.source).slice(0, 3), ["form", "json", "json"]);
        // newest first: the form save, the tag save, then the "v2" save (whose previous config is the fixture)
        const target = list[2];
        let j = await (await A("GET", `/api/resources/${J.id}/revisions/${target.n}`)).json();
        const old = JSON.parse(j.revision.config);
        assert.equal(old.en.title, JSON.parse(trig).en.title);
        assert.ok(j.diff.changed >= 2);
        const c = await getCfg();
        let r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: j.revision.config, rev: c.rev, checked: true, source: "json", restoredFrom: target.n });
        j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.equal(j.doc.en.title, JSON.parse(trig).en.title);
        const top = (await (await A("GET", `/api/resources/${J.id}/revisions`)).json()).revisions[0];
        assert.equal(top.restoredFrom, target.n);
        assert.equal((await A("GET", `/api/resources/${J.id}/revisions/99999`)).status, 404);
      });
      await check(".json upload on a live resource: only config fields change (tool and PDFs kept); `related` gives a reverse link on the other page", async () => {
        // a PDF on the resource; the upload must list it (labels and order are the config's)
        let r = await A("POST", `/api/resources/${J.id}/files/Trig_Sheet.pdf`, PDF(2000), { "X-Label-En": "Sheet", "X-Label-Es": "Hoja" });
        assert.equal(r.status, 200, (await r.json()).error);
        const other = sample({ id: "circuit000", slugEn: "rc-lab-test", slugEs: "lab-rc-prueba", slugHistoryEn: [], subject: "circuits", courseTags: [], related: [], publishedAt: "2026-01-05T00:00:00Z" });
        await astore.put(other); await astore.bump();
        const before = await astore.get(J.id), c = await getCfg(), cfg = JSON.parse(c.text);
        assert.deepEqual(cfg.files, [{ file: "Trig_Sheet.pdf", en: "Sheet", es: "Hoja" }]);
        const upload = JSON.stringify({ ...cfg, related: ["rc-lab-test"], files: [{ file: "Trig_Sheet.pdf", en: "Worksheet", es: "Hoja de trabajo" }] }, null, 2);
        r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: upload, rev: c.rev, checked: true, source: "upload" });
        const j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.deepEqual(j.doc.file, before.file);
        assert.equal(j.doc.files[0].path, before.files[0].path); assert.equal(j.doc.files[0].sha256, before.files[0].sha256);
        assert.equal(j.doc.files[0].labelEn, "Worksheet");
        assert.deepEqual(j.doc.related, ["rc-lab-test"]);
        // a .json that would add or drop a PDF is refused (PDFs are uploaded and deleted in Files)
        r = await A("PUT", `/api/resources/${J.id}/config.json`, { text: JSON.stringify({ ...JSON.parse(upload), files: [] }), rev: j.doc.rev, checked: true });
        assert.equal(r.status, 400); assert.match((await r.json()).errors[0].message, /must list every uploaded PDF/);
        // the reverse link: the circuits page (no tags, nothing of its own) now shows the trig tool, EN and ES
        const en = await pub("/resources/rc-lab-test/");
        const es = await pub("/es/recursos/lab-rc-prueba/");
        const rel = (h) => (h.match(/<section id="related"[\s\S]*?<\/section>/) || [""])[0];
        assert.match(rel(en), new RegExp(`href="/resources/${cfg.en.slug}/"`));
        assert.match(rel(es), new RegExp(`href="/es/recursos/${cfg.es.slug}/"`));
        assert.match(rel(es), /Laboratorio|Trigonometr/i);
      });
      await check("PDFs: list from a config, upload one request each, name / %PDF- / size / case checks, max 20", async () => {
        const pid = (await (await A("POST", "/api/resources", {})).json()).id;
        let r = await A("PUT", `/api/resources/${pid}/files`, { files: [{ name: "U_A.pdf", labelEn: "A", labelEs: "A es" }, { name: "U_B.pdf", labelEn: "B", labelEs: "B es" }, { name: "U_C.pdf", labelEn: "C", labelEs: "C es" }] });
        let j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.deepEqual(j.doc.files.map((f) => [f.name, f.path]), [["U_A.pdf", ""], ["U_B.pdf", ""], ["U_C.pdf", ""]]);
        assert.ok(j.problems.includes("PDF U_A.pdf is listed but not uploaded. Drop it, or remove it from Files."));
        // uploads
        r = await A("POST", `/api/resources/${pid}/files/U_B.pdf`, PDF(5000, "B1"));
        j = await r.json();
        assert.equal(r.status, 200, j.error);
        const b = j.doc.files.find((f) => f.name === "U_B.pdf");
        assert.deepEqual([b.path, b.sizeBytes, b.labelEn], [M.pdfPath(pid, "U_B.pdf"), PDF(5000, "B1").length, "B"]);
        assert.equal(b.sha256, sha(PDF(5000, "B1")));
        assert.ok(astore._objects.get(M.pdfPath(pid, "U_B.pdf")).equals(PDF(5000, "B1")));
        // checks
        r = await A("POST", `/api/resources/${pid}/files/U_A.pdf`, Buffer.from("<html>not a pdf"));
        assert.equal(r.status, 400); assert.match((await r.json()).error, /isn't a PDF/);
        r = await A("POST", `/api/resources/${pid}/files/${encodeURIComponent("bad name.pdf")}`, PDF());
        assert.equal(r.status, 400); assert.match((await r.json()).error, /isn't a usable PDF name/);
        r = await A("POST", `/api/resources/${pid}/files/u_b.pdf`, PDF());
        assert.equal(r.status, 400); assert.match((await r.json()).error, /differs only in upper\/lower case from "U_B\.pdf"/);
        r = await A("POST", `/api/resources/${pid}/files/U_A.pdf`, PDF(10 * 1048576));
        assert.equal(r.status, 413);
        r = await A("PUT", `/api/resources/${pid}/files`, { files: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.pdf` })) });
        assert.equal(r.status, 400); assert.match((await r.json()).error, /At most 20/);
        r = await A("PUT", `/api/resources/${pid}/files`, { files: [{ name: "X.pdf" }, { name: "x.pdf" }] });
        assert.equal(r.status, 400); assert.match((await r.json()).error, /listed twice/);
        // a new name (not listed) gets its labels from the headers, at the end
        r = await A("POST", `/api/resources/${pid}/files/U_Extra.pdf`, PDF(), { "X-Label-En": encodeURIComponent("Extra"), "X-Label-Es": encodeURIComponent("Más") });
        j = await r.json();
        assert.deepEqual(j.doc.files.map((f) => f.name), ["U_A.pdf", "U_B.pdf", "U_C.pdf", "U_Extra.pdf"]);
        assert.equal(j.doc.files[3].labelEs, "Más");
        // a list never drops an uploaded file (it goes to the end); pending ones not listed are dropped
        r = await A("PUT", `/api/resources/${pid}/files`, { files: [{ name: "U_C.pdf", labelEn: "C2", labelEs: "C2" }] });
        j = await r.json();
        assert.deepEqual(j.doc.files.map((f) => [f.name, f.labelEn]), [["U_C.pdf", "C2"], ["U_B.pdf", "B"], ["U_Extra.pdf", "Extra"]]);
      });
      await check("PDFs: replace keeps the URL (new ETag); delete removes the object; publish waits for listed files", async () => {
        const pid = (await (await A("POST", "/api/resources", {})).json()).id;
        await A("POST", `/api/resources/${pid}/file`, Buffer.from(TOOL));
        await A("PUT", `/api/resources/${pid}/files`, { files: [{ name: "Deck_1.pdf", labelEn: "One", labelEs: "Uno" }, { name: "Deck_2.pdf", labelEn: "Two", labelEs: "Dos" }] });
        await A("POST", `/api/resources/${pid}/files/Deck_1.pdf`, PDF(100, "v1"));
        const f2 = { ...fields, slugEn: "pdf-deck", slugEs: "mazo-pdf" };
        let r = await A("POST", `/api/resources/${pid}/publish`, { doc: f2, checked: true });
        assert.equal(r.status, 400);
        assert.ok((await r.json()).problems.includes("PDF Deck_2.pdf is listed but not uploaded. Drop it, or remove it from Files."));
        await A("POST", `/api/resources/${pid}/files/Deck_2.pdf`, PDF(200, "two"));
        r = await A("POST", `/api/resources/${pid}/publish`, { doc: f2, checked: true });
        assert.equal(r.status, 200, (await r.clone().json()).error);
        // admin route (any status) serves it; replace: same path, new bytes and sha, marker bumped (live)
        let g = await fetch(`${abase}/resources/pdf-deck/files/Deck_1.pdf`);
        assert.equal(g.status, 200); assert.equal(g.headers.get("cache-control"), "no-store"); assert.equal(g.headers.get("etag"), `"${sha(PDF(100, "v1"))}"`);
        const rev = await astore.rev();
        r = await A("POST", `/api/resources/${pid}/files/Deck_1.pdf`, PDF(300, "v2"));
        const d = (await r.json()).doc.files[0];
        assert.equal(d.path, M.pdfPath(pid, "Deck_1.pdf"));
        assert.equal(d.sha256, sha(PDF(300, "v2")));
        assert.notEqual(await astore.rev(), rev);
        g = await fetch(`${abase}/resources/pdf-deck/files/Deck_1.pdf`);
        assert.ok(Buffer.from(await g.arrayBuffer()).equals(PDF(300, "v2")));
        // preview: the PDF list links to the admin's own copy (drafts too)
        const pv = await (await fetch(`${abase}/preview/${pid}/es`)).text();
        assert.match(pv, new RegExp(`href="http://127\\.0\\.0\\.1:\\d+/resources/pdf-deck/files/Deck_1\\.pdf" target="_blank"[^>]*>Uno</a>`));
        // delete
        r = await A("DELETE", `/api/resources/${pid}/files/Deck_2.pdf`);
        assert.deepEqual((await r.json()).doc.files.map((f) => f.name), ["Deck_1.pdf"]);
        assert.ok(!astore._objects.has(M.pdfPath(pid, "Deck_2.pdf")));
        assert.equal((await fetch(`${abase}/resources/pdf-deck/files/Deck_2.pdf`)).status, 404);
        assert.equal((await A("DELETE", `/api/resources/${pid}/files/Deck_2.pdf`)).status, 404);
        // a normal page save keeps the files (they're not part of the form)
        r = await A("PUT", `/api/resources/${pid}`, { doc: { ...f2, related: ["projectile", "pdf-deck", "unit-circle"] }, checked: true });
        const saved = (await r.json()).doc;
        assert.deepEqual(saved.files.map((f) => f.name), ["Deck_1.pdf"]);
        assert.deepEqual(saved.related, ["projectile", "unit-circle"], "itself dropped");
        // a deleted draft takes its PDFs with it
        const did = (await (await A("POST", "/api/resources", {})).json()).id;
        await A("POST", `/api/resources/${did}/files/Z.pdf`, PDF());
        await A("DELETE", `/api/resources/${did}`);
        assert.ok(!astore._objects.has(M.pdfPath(did, "Z.pdf")));
      });
      await check("math preview endpoint", async () => {
        const j = await (await A("POST", "/api/math", { text: "$x^2$ and $\\frac{1}$" })).json();
        assert.match(j.html, /katex/);
        assert.equal(j.errors.length, 1);
      });
    } finally {
      console.log = logs; console.warn = warn;
    }
    await check("a real preview card renders (satori + resvg): 1200x630 PNG", async () => {
      const png = await require("../admin/cards.js").renderCard({ title: "Explorador del círculo unitario: ñ ¿¡", subline: "Física · Universidad", lang: "es" });
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), 630);
    });
    admin.server.close();
    admin.server.closeAllConnections && admin.server.closeAllConnections();
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
