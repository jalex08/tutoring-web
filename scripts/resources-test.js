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
    assert.match(csp, /^sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock; frame-ancestors 'self'$/);
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
    assert.match(h, /<iframe id="res-frame"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"/);
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
    assert.match(h, /href="\/#contact" data-loc="bar"/);
    assert.match(h, /resource_book_click/);
  }));
  await check("Spanish page: lang, ?lang=es on the frame, Spanish CTA, link to the English twin", quiet(async () => {
    const h = await (await get("/es/recursos/circulo-unitario/")).text();
    assert.match(h, /<html lang="es">/);
    assert.match(h, /"\/frame\/abcde12345\/v2\?lang=es"/);
    assert.match(h, /herramienta interactiva gratis \| Jose Diaz Tutoring/);
    assert.match(h, /href="\/es\/#contact" data-loc="bar"/);
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
    assert.equal((x.match(/<loc>/g) || []).length, 12 + 2 + 4);
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
    const A = (method, p, body, headers = {}) => fetch(abase + p, {
      method, redirect: "manual",
      headers: { "X-JDT-Admin": "1", ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
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
      const fields = {
        slugEn: "projectile-motion", slugEs: "tiro-parabolico", subject: "physics", levels: ["high-school"], courseTags: ["AP Physics 1"], relatedExamPage: "",
        en: { title: "Projectile motion", description: "Range and height.", intro: "$R=\\frac{v^2\\sin2\\theta}{g}$", howTo: ["Set the angle."], keyIdeas: ["45 degrees."], faq: [], keywords: [] },
        es: { title: "Tiro parabólico", description: "Alcance y altura.", intro: "Intro.", howTo: ["Elige el ángulo."], keyIdeas: ["45 grados."], faq: [], keywords: [] },
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
      await check("config endpoint: stored as uploaded, mapped, download; bad JSON refused and not stored", async () => {
        const text = fs.readFileSync(path.join(ROOT, "test/fixtures/trigonometry-playground.json"));
        const cid = (await (await A("POST", "/api/resources", {})).json()).id;
        let r = await A("POST", `/api/resources/${cid}/config`, text, { "X-File-Name": "trigonometry-playground.json", "X-Html-Name": "trigonometry-playground.html" });
        let j = await r.json();
        assert.equal(r.status, 200, j.error);
        assert.equal(j.fields.en.faq.length, 5);
        assert.deepEqual(j.problems, []);
        assert.equal(j.config.n, 1);
        const d = await fetch(`${abase}/download/${cid}/config/1`);
        assert.ok(Buffer.from(await d.arrayBuffer()).equals(text));
        r = await A("POST", `/api/resources/${cid}/config`, Buffer.from("{oops"), { "X-File-Name": "x.json" });
        j = await r.json();
        assert.equal(r.status, 400); assert.match(j.problems[0].message, /isn't valid JSON/);
        assert.equal((await astore.get(cid)).configs.length, 1);
        assert.equal((await fetch(`${abase}/download/${cid}/config/2`)).status, 404);
        // the .html uploaded after a config for another file name: flagged
        r = await A("POST", `/api/resources/${cid}/file`, Buffer.from(TOOL), { "X-File-Name": "unit-circle.html" });
        j = await r.json();
        assert.equal(j.doc.file.name, "unit-circle.html");
        assert.match(j.configProblems[0].message, /is for "trigonometry-playground\.html", but the tool file is "unit-circle\.html"/);
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
