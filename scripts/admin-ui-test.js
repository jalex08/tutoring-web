#!/usr/bin/env node
/**
 * Admin editor in a real browser (Chromium via Playwright): a tool's .html + .json fill the whole form.
 * Uses test/fixtures/trigonometry-playground.{html,json}. Runs the admin in-process with an in-memory
 * store (no Google sign-in, no Cloud). Skipped, with a message, when Playwright or the admin's
 * dependencies aren't installed.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const FIX = path.join(ROOT, "test/fixtures");
const HTML = path.join(FIX, "trigonometry-playground.html");
const JSONF = path.join(FIX, "trigonometry-playground.json");

let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("admin UI: SKIPPED (Playwright isn't installed)"); process.exit(0); }
if (!fs.existsSync(path.join(ROOT, "admin/node_modules/satori"))) { console.log("admin UI: SKIPPED (run `npm install --prefix admin`)"); process.exit(0); }

const CFG = JSON.parse(fs.readFileSync(JSONF, "utf8"));
const storeLib = require("../lib/resources/store.js");
const M = require("../lib/resources/model.js");
const admin = require("../admin/server.js");

let failures = 0;
const out = (s) => process.stdout.write(s + "\n");
async function check(name, fn) {
  try { await fn(); out(`  ok   ${name}`); }
  catch (e) { failures++; out(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 5).join("\n       ")}`); }
}

(async () => {
  out("admin UI (tool .html + .json)");
  const store = storeLib.memoryStore();
  admin._setStore(store);
  admin._setAuth(async () => "me@school.test");
  admin._setCards({ renderCard: async () => Buffer.from("png"), cardPath: (id, lang) => `og/${id}-${lang}-00000000.png` });
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  await new Promise((r) => admin.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${admin.server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let dialogs = [];
  let dialogAnswer = true;
  // "Update the page text from the config?" -> dialogAnswer; anything else ("This resource is live…",
  // leaving with unsaved edits) -> yes
  page.on("dialog", (d) => { dialogs.push(d.message()); /Update the page text/.test(d.message()) && !dialogAnswer ? d.dismiss() : d.accept(); });

  const newResource = async () => {
    await page.goto(base + "/");
    await page.click("#new-resource");
    await page.waitForURL(/\/edit\//);
    return page.url().split("/").pop();
  };
  const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(150); };
  // the editor's form as data (the same fields collect() sends)
  const form = () => page.evaluate(() => {
    const v = (id) => document.getElementById(id).value;
    const lines = (id) => v(id).split("\n").map((s) => s.trim()).filter(Boolean);
    const out = { subject: v("subject"), courseTags: v("courseTags").split(",").map((s) => s.trim()).filter(Boolean),
      levels: [...document.querySelectorAll('input[name="levels"]:checked')].map((c) => c.value), slugEn: v("en-slug"), slugEs: v("es-slug") };
    for (const l of ["en", "es"]) {
      out[l] = { title: v(`${l}-title`), description: v(`${l}-description`), intro: v(`${l}-intro`), howTo: lines(`${l}-howTo`), keyIdeas: lines(`${l}-keyIdeas`),
        keywords: v(`${l}-keywords`).split(",").map((s) => s.trim()).filter(Boolean),
        faq: [...document.querySelectorAll(`.faq-list[data-lang="${l}"] .faq-item`)].map((it) => ({ q: it.querySelector(".faq-q").value, a: it.querySelector(".faq-a").value })).filter((x) => x.q || x.a) };
    }
    return out;
  });
  const expectFull = async (cfg = CFG) => {
    const f = await form();
    assert.equal(f.subject, cfg.subject);
    assert.deepEqual(f.levels, cfg.levels);
    assert.deepEqual(f.courseTags, cfg.courseTags);
    assert.equal(f.slugEn, cfg.en.slug);
    assert.equal(f.slugEs, cfg.es.slug);
    for (const l of ["en", "es"]) for (const k of ["title", "description", "intro", "howTo", "keyIdeas", "faq", "keywords"]) assert.deepEqual(f[l][k], cfg[l][k], `${l}.${k}`);
  };
  // drag-and-drop with files in a given order (a real DataTransfer, like a drop from Finder)
  const dropFiles = async (files) => {
    const payload = files.map((f) => ({ name: f.name, type: f.type, b64: Buffer.from(f.body).toString("base64") }));
    await page.evaluate((payload) => {
      const dt = new DataTransfer();
      for (const p of payload) dt.items.add(new File([Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0))], p.name, { type: p.type }));
      document.getElementById("drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, payload);
    await settle();
  };
  const html = { name: "trigonometry-playground.html", type: "text/html", body: fs.readFileSync(HTML) };
  const json = (obj = CFG, name = "trigonometry-playground.json") => ({ name, type: "application/json", body: Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)) });
  const bannerText = () => page.textContent("#cfg-banner");
  const errsFor = (field) => page.$$eval(`[data-cfg-err="${field}"]`, (els) => els.map((e) => e.textContent));

  try {
    let id;
    await check("both files at once (file picker): every EN and ES field, subject, levels and course tags filled", async () => {
      id = await newResource();
      await page.setInputFiles("#file-input", [HTML, JSONF]);
      await settle();
      await expectFull();
      assert.equal((await bannerText()).trim().split("\n")[0].trim(), "Filled from trigonometry-playground.json. Review it, tick the check, then publish.");
      assert.equal(await page.$$eval("[data-cfg-err]", (e) => e.length), 0);
      assert.equal(dialogs.length, 0, "no question on a new resource");
      // the check stays required
      assert.equal(await page.isChecked("#checked"), false);
      assert.equal(await page.isDisabled("#publish"), true);
      await page.check("#checked");
      assert.equal(await page.isDisabled("#publish"), false);
      assert.match(await page.textContent("#file-info"), /Version 1 · trigonometry-playground\.html/);
    });
    await check("the .json only fills the form: nothing is stored until Save (the server is the source of truth)", async () => {
      const doc = M.normalize(await store.get(id));
      assert.equal(doc.configs.length, 0);
      assert.equal(doc.en.title, "", "the text is saved by Save / Publish, not by reading the file");
      assert.ok(![...store._objects.keys()].some((k) => /config-\d+\.json$/.test(k)));
      assert.equal(await page.isHidden("#configs"), true);
    });
    await check("publish with the filled text: what's saved equals the config (keywords included)", async () => {
      await page.click("#publish");
      await page.waitForFunction(() => /Published/.test(document.getElementById("msg").textContent));
      const doc = M.normalize(await store.get(id));
      assert.equal(doc.status, "published");
      for (const l of ["en", "es"]) for (const k of ["title", "description", "intro", "howTo", "keyIdeas", "faq", "keywords"]) assert.deepEqual(doc[l][k], CFG[l][k], `${l}.${k}`);
      assert.deepEqual([doc.slugEn, doc.slugEs, doc.subject, doc.levels, doc.courseTags], [CFG.en.slug, CFG.es.slug, CFG.subject, CFG.levels, CFG.courseTags]);
    });

    await check("dropped in reverse order (.json first, drag-and-drop): same result", async () => {
      await newResource();
      await dropFiles([json({ ...CFG, en: { ...CFG.en, slug: "trig-reverse" }, es: { ...CFG.es, slug: "trig-al-reves" } }), html]);
      const f = await form();
      assert.equal(f.slugEn, "trig-reverse");
      assert.deepEqual(f.es.faq, CFG.es.faq);
      assert.deepEqual(f.en.keyIdeas, CFG.en.keyIdeas);
      assert.match(await bannerText(), /Filled from trigonometry-playground\.json/);
      assert.match(await page.textContent("#file-info"), /trigonometry-playground\.html/);
    });

    await check("one at a time: .json first fills the text (asks for the .html); the .html later doesn't touch the text", async () => {
      await newResource();
      const cfg = { ...CFG, en: { ...CFG.en, slug: "trig-one" }, es: { ...CFG.es, slug: "trig-uno" } };
      await dropFiles([json(cfg)]);
      await expectFull(cfg);
      assert.match(await bannerText(), /Then drop the tool's \.html too\./);
      await page.fill("#en-title", "Edited by hand");
      await dropFiles([html]);
      assert.equal(await page.inputValue("#en-title"), "Edited by hand");
      assert.match(await page.textContent("#file-info"), /Version 1 · trigonometry-playground\.html/);
      assert.equal(await page.$$eval("#cfg-file-problems li", (e) => e.length), 0);
    });

    await check("HTML only: the tool is uploaded and the form stays empty for manual entry", async () => {
      await newResource();
      await dropFiles([html]);
      const f = await form();
      for (const l of ["en", "es"]) for (const k of ["title", "description", "intro"]) assert.equal(f[l][k], "", `${l}.${k}`);
      assert.equal(await page.isHidden("#cfg-banner"), true);
      assert.match(await page.textContent("#file-info"), /Version 1/);
    });

    await check("mismatched `file`: flagged next to the file box, the text still fills", async () => {
      await newResource();
      await dropFiles([html, json({ ...CFG, file: "unit-circle.html", en: { ...CFG.en, slug: "trig-mismatch" }, es: { ...CFG.es, slug: "trig-distinto" } })]);
      const e = await errsFor("file");
      assert.equal(e.length, 1);
      assert.match(e[0], /file is "unit-circle\.html", but the tool file uploaded with it is "trigonometry-playground\.html"/);
      assert.equal(await page.inputValue("#en-title"), CFG.en.title);
      assert.match(await bannerText(), /1 problem marked in red below/);
    });

    await check("invalid JSON: a plain error with the line, nothing filled, nothing stored", async () => {
      const id2 = await newResource();
      await dropFiles([json('{\n  "version": 1,\n  "en": { "title": "x", }\n}')]);
      const e = await errsFor("json");
      assert.equal(e.length, 1);
      assert.match(e[0], /isn't valid JSON \(line 3/);
      assert.equal(await page.inputValue("#en-title"), "");
      assert.match(await bannerText(), /Couldn't use trigonometry-playground\.json/);
      assert.equal(M.normalize(await store.get(id2)).configs.length, 0);
    });

    await check("description over 155 characters: marked on that field, the full text kept", async () => {
      await newResource();
      const long = "x".repeat(170);
      await dropFiles([json({ ...CFG, en: { ...CFG.en, description: long, slug: "trig-long" }, es: { ...CFG.es, slug: "trig-largo" } })]);
      assert.equal(await page.inputValue("#en-description"), long);
      const e = await errsFor("en.description");
      assert.match(e[0], /^en\.description is 170 characters; max 155\.$/);
      assert.equal(await page.$eval("#en-description", (el) => el.classList.contains("cfg-invalid")), true);
      assert.equal(await page.$eval(".count[data-for='en-description']", (el) => el.classList.contains("over")), true);
    });

    await check("duplicate slug: highlighted, slug-2 suggested, one click applies it", async () => {
      // trigonometry-playground (EN) and laboratorio-de-trigonometria (ES) belong to the first resource
      await newResource();
      await dropFiles([html, json()]);
      const en = await errsFor("en.slug"), es = await errsFor("es.slug");
      assert.match(en[0], /en\.slug "trigonometry-playground" is already used by "Trigonometry playground/);
      assert.match(es[0], /es\.slug "laboratorio-de-trigonometria" is already used/);
      assert.equal(await page.$eval("#en-slug", (el) => el.classList.contains("cfg-invalid")), true);
      assert.equal(await page.inputValue("#en-slug"), "trigonometry-playground"); // the config's value stays visible
      await page.click('[data-cfg-err="en.slug"] .use-suggestion');
      assert.equal(await page.inputValue("#en-slug"), "trigonometry-playground-2");
      assert.equal((await errsFor("en.slug")).length, 0);
    });

    await check("invalid subject and level: named in place, valid levels kept, nothing invented", async () => {
      await newResource();
      await dropFiles([json({ ...CFG, subject: "trig", levels: ["college", "middle-school"], en: { ...CFG.en, slug: "trig-bad" }, es: { ...CFG.es, slug: "trig-malo" } })]);
      assert.match((await errsFor("subject"))[0], /^subject is "trig"; use one of: algebra,/);
      assert.match((await errsFor("levels"))[0], /^levels\[1\] is "middle-school"; use one of: high-school, college, engineering\.$/);
      assert.deepEqual((await form()).levels, ["college"]);
    });

    await check("missing fields and an unknown version", async () => {
      await newResource();
      const { intro, ...enNoIntro } = CFG.en;
      await dropFiles([json({ ...CFG, en: { ...enNoIntro, slug: "trig-missing" }, es: { ...CFG.es, slug: "trig-falta", howTo: [] } })]);
      assert.match((await errsFor("en.intro"))[0], /^en\.intro is missing\.$/);
      assert.match((await errsFor("es.howTo"))[0], /^es\.howTo has 0 items; it needs 3 to 6 items\.$/);
      await newResource();
      await dropFiles([json({ ...CFG, version: 2 })]);
      assert.match((await errsFor("version"))[0], /^version must be 1/);
      assert.equal(await page.inputValue("#en-title"), "");
      assert.match(await bannerText(), /Didn't fill the form/);
    });

    await check("Replace file on an existing resource: asks 'Update the page text from the config?' (yes fills, no keeps the text)", async () => {
      await page.goto(`${base}/edit/${id}`);
      await page.fill("#en-title", "Kept title");
      dialogs = []; dialogAnswer = false;
      await dropFiles([html, json()]);
      assert.ok(dialogs.some((d) => /Update the page text from the config\?/.test(d)), dialogs.join(" | "));
      assert.equal(await page.inputValue("#en-title"), "Kept title");
      assert.match(await page.textContent("#file-info"), /Version 2/);
      assert.match(await bannerText(), /The page text wasn't changed/);
      dialogs = []; dialogAnswer = true;
      await dropFiles([html, json()]);
      assert.ok(dialogs.some((d) => /Update the page text from the config\?/.test(d)));
      assert.equal(await page.inputValue("#en-title"), CFG.en.title);
      assert.match(await page.textContent("#file-info"), /Version 3/);
      // a JSON alone on an existing resource: into the Config (.json) tab, not saved; the unsaved form
      // edit is discarded only after asking
      await page.check("#checked"); await page.click("#save");
      await page.waitForFunction(() => /Saved/.test(document.getElementById("msg").textContent));
      dialogs = [];
      await page.fill("#en-title", "Again by hand");
      const other = { ...CFG, en: { ...CFG.en, title: "From a .json alone" } };
      await dropFiles([json(other)]);
      await page.waitForFunction(() => /Loaded trigonometry-playground\.json/.test(document.getElementById("json-status").textContent));
      assert.ok(dialogs.some((d) => /The form has unsaved changes/.test(d)), dialogs.join(" | "));
      assert.equal(await page.isVisible("#json-panel"), true);
      assert.equal(await page.isHidden("#edit"), true);
      assert.match(await page.textContent("#json-editor"), /From a \.json alone/);
      assert.equal(M.normalize(await store.get(id)).en.title, CFG.en.title, "not saved");
      assert.match(await page.textContent("#file-info"), /Version 3/);
      // back to the form: asks (the JSON has changes), and the form shows the saved text
      dialogs = [];
      await page.click("#tab-form");
      assert.ok(dialogs.some((d) => /The JSON has unsaved changes/.test(d)));
      assert.equal(await page.inputValue("#en-title"), CFG.en.title);
    });

    await check("Config (.json) tab: edit, live validation with jump-to-line, Save shows the EN/ES diff and asks for the check, History restores", async () => {
      const SHOTS = process.env.SHOTS_DIR;
      await page.goto(`${base}/`);
      await page.goto(`${base}/edit/${id}`);
      await page.click("#tab-json");
      await page.waitForFunction(() => /^Valid\. No changes yet\.$/.test(document.getElementById("json-status").textContent));
      const text = await page.evaluate(() => fetch(location.pathname.replace("/edit/", "/api/resources/") + "/config.json", { headers: { "X-JDT-Admin": "1" } }).then((r) => r.json()).then((j) => j.text));
      assert.equal(JSON.parse(text).en.title, CFG.en.title);
      assert.equal(await page.isDisabled("#json-save"), true, "nothing to save yet");
      const typeAll = async (t) => { await page.click("#json-editor .cm-content"); await page.keyboard.press("Control+A"); await page.keyboard.insertText(t); };
      // an error: listed with its line; a click puts the cursor there; Save stays off
      const cfg = JSON.parse(text);
      await typeAll(JSON.stringify({ ...cfg, es: { ...cfg.es, description: "y".repeat(171) } }, null, 2));
      await page.waitForFunction(() => /error/.test(document.getElementById("json-status").textContent));
      assert.match(await page.textContent("#json-problems"), /es\.description is 171 characters; max 155\./);
      assert.equal(await page.isDisabled("#json-save"), true);
      await page.click("#json-problems .jp-err .jp-btn");
      assert.match(await page.textContent("#json-editor .cm-activeLine"), /"description": "yyyy/);
      // a valid change: Save -> the diff (ES title, highlighted) -> the check is required on a live page
      const v2 = JSON.stringify({ ...cfg, es: { ...cfg.es, title: cfg.es.title + " v2" } }, null, 2) + "\n";
      await typeAll(v2);
      await page.waitForFunction(() => /^Valid\.$/.test(document.getElementById("json-status").textContent));
      await page.click("#json-save");
      await page.waitForSelector("#json-dialog[open]");
      assert.match(await page.textContent("#json-diff ins"), /v2/);
      assert.match(await page.textContent("#json-diff .jd-grid"), /Title/);
      assert.equal(await page.isDisabled("#json-dialog-ok"), true);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "json-diff.png") });
      await page.check("#json-dialog-check");
      await page.click("#json-dialog-ok");
      await page.waitForFunction(() => /^Saved\./.test(document.getElementById("json-status").textContent));
      assert.equal(M.normalize(await store.get(id)).es.title, cfg.es.title + " v2");
      assert.equal(await page.isVisible("#json-panel"), true, "back in the JSON tab after the reload");
      const pv = await (await page.request.get(`${base}/preview/${id}/es`)).text();
      assert.match(pv, new RegExp(`<h1>${(cfg.es.title + " v2").replace(/[()]/g, "\\$&")}</h1>`));
      // History: the newest entry is the config before this save; Restore -> validate -> diff -> save
      await page.waitForSelector("#json-history .jh");
      assert.match(await page.textContent("#json-history .jh"), /Before the JSON tab save of .* by me@school\.test/);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "json-tab.png"), fullPage: true });
      await page.click("#json-history .jh button:text('Restore')");
      await page.waitForFunction(() => /Loaded #\d+ into the editor/.test(document.getElementById("json-status").textContent));
      await page.click("#json-save");
      await page.waitForSelector("#json-dialog[open]");
      assert.match(await page.textContent("#json-diff del"), /v2/);
      await page.check("#json-dialog-check");
      await page.click("#json-dialog-ok");
      await page.waitForFunction(() => /^Saved\./.test(document.getElementById("json-status").textContent));
      assert.equal(M.normalize(await store.get(id)).es.title, cfg.es.title);
      assert.match(await page.textContent("#json-history .jh"), /a restore of #/);
      // Download .json = the current config
      const d = await page.request.get(`${base}/download/${id}/config.json`);
      assert.equal(JSON.parse(await d.text()).es.title, cfg.es.title);
    });
    await check("files of two different tools are refused", async () => {
      await newResource();
      await dropFiles([html, json(CFG, "other-tool.json")]);
      assert.match(await page.textContent("#msg"), /Drop one tool at a time/);
      assert.match(await page.textContent("#file-info"), /No file yet/);
    });
    await check("html + json + PDFs in one drop: listed files uploaded in order, checklist (found / missing / extra), related filled", async () => {
      const pid = await newResource();
      const pdf = (name, n) => ({ name, type: "application/pdf", body: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(n, 0x41)]) });
      const cfg = { ...CFG, en: { ...CFG.en, slug: "trig-pdfs" }, es: { ...CFG.es, slug: "trig-pdfs-es" },
        files: [{ file: "Trig_B.pdf", en: "Part B", es: "Parte B" }, { file: "Trig_A.pdf", en: "Part A", es: "Parte A" }, { file: "Trig_C.pdf", en: "Part C", es: "Parte C" }],
        related: ["trigonometry-playground"] };
      dialogs = [];
      await dropFiles([pdf("Trig_A.pdf", 2000), html, pdf("Extra_Notes.pdf", 500), json(cfg), pdf("Trig_B.pdf", 300000)]);
      await page.waitForFunction(() => !document.getElementById("files-check").hidden);
      let doc = M.normalize(await store.get(pid));
      assert.deepEqual(doc.files.map((f) => [f.name, !!f.path, f.labelEs]), [["Trig_B.pdf", true, "Parte B"], ["Trig_A.pdf", true, "Parte A"], ["Trig_C.pdf", false, "Parte C"]]);
      const check_ = await page.textContent("#files-check");
      assert.match(check_, /PDFs: 2 uploaded, 1 listed but not dropped, 1 not in trigonometry-playground\.json\./);
      assert.match(check_, /✓ Trig_B\.pdf: uploaded/);
      assert.match(check_, /✗ Trig_C\.pdf: listed in trigonometry-playground\.json but not dropped/);
      assert.match(check_, /\+ Extra_Notes\.pdf: not in trigonometry-playground\.json/);
      // publish is blocked while Trig_C is missing
      assert.match(await page.textContent("#problems"), /PDF Trig_C\.pdf is listed but not uploaded/);
      // related picker filled from the config (that slug is published by the first check)
      assert.deepEqual(await page.$$eval("#related-list li", (l) => l.map((x) => x.getAttribute("data-slug"))), ["trigonometry-playground"]);
      // add the extra one with edited labels
      await page.fill('[aria-label="EN label for Extra_Notes.pdf"]', "Extra notes");
      await page.fill('[aria-label="ES label for Extra_Notes.pdf"]', "Notas extra");
      await page.click('[data-check="Extra_Notes.pdf"] button');
      await page.waitForFunction(() => /added/.test(document.querySelector('[data-check="Extra_Notes.pdf"]').textContent));
      // remove the missing one, reorder (A first), relabel, save
      await page.click('.file-row[data-name="Trig_C.pdf"] .btn-quiet');
      await settle();
      await page.click('.file-row[data-name="Trig_A.pdf"] button:text("↑")');
      await page.fill('.file-row[data-name="Trig_A.pdf"] input[data-label="En"]', "Part A (angles)");
      await page.click("#files-save");
      await settle();
      doc = M.normalize(await store.get(pid));
      assert.deepEqual(doc.files.map((f) => [f.name, f.labelEn]), [["Trig_A.pdf", "Part A (angles)"], ["Trig_B.pdf", "Part B"], ["Extra_Notes.pdf", "Extra notes"]]);
      assert.doesNotMatch(await page.textContent("#problems"), /PDF/);
      // publish, then the preview pages list them (EN + ES) with sizes, linking to the admin's copy
      await page.check("#checked");
      await page.click("#publish");
      await page.waitForFunction(() => /Published/.test(document.getElementById("msg").textContent));
      for (const [l, head, label] of [["en", "Printable PDFs", "Part A (angles)"], ["es", "PDF para imprimir", "Parte A"]]) {
        const pv = await (await page.request.get(`${base}/preview/${pid}/${l}`)).text();
        assert.match(pv, new RegExp(`<h2>${head}</h2>`));
        assert.match(pv, new RegExp(`/resources/trig-pdfs/files/Trig_A\\.pdf" target="_blank" rel="noopener" data-file="Trig_A\\.pdf">${label.replace(/[()]/g, "\\$&")}</a> <span class="res-file-size">· 2 KB`));
        assert.match(pv, /Trig_B\.pdf[^<]*<\/a> <span class="res-file-size">· 293 KB/);
      }
      // Replace (row button) keeps the URL; the live page is asked about first
      const before = doc.files[0].sha256;
      dialogs = [];
      await page.click('.file-row[data-name="Trig_A.pdf"] button:text("Replace…")');
      await page.setInputFiles("#pdf-input", { name: "renamed-on-disk.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 new") });
      await settle();
      assert.ok(dialogs.some((d) => /Replace Trig_A\.pdf on the live page\? Its URL stays the same/.test(d)));
      doc = M.normalize(await store.get(pid));
      assert.equal(doc.files[0].name, "Trig_A.pdf");
      assert.notEqual(doc.files[0].sha256, before);
      const g = await page.request.get(`${base}/resources/trig-pdfs/files/Trig_A.pdf`);
      assert.equal(await g.text(), "%PDF-1.7 new");
    });
    await check("PDFs alone, a bad name and a non-PDF: refused with plain messages, nothing stored", async () => {
      const pid = await newResource();
      await dropFiles([{ name: "my notes.pdf", type: "application/pdf", body: Buffer.from("%PDF-1.4") }, { name: "fake.pdf", type: "application/pdf", body: Buffer.from("<html>") }]);
      await page.waitForFunction(() => !document.getElementById("files-check").hidden);
      const t = await page.textContent("#files-check");
      assert.match(t, /my notes\.pdf: not in the list\. my notes\.pdf: use only letters, numbers, dots, hyphens and underscores/);
      await page.click('[data-check="fake.pdf"] button');
      await page.waitForFunction(() => /isn't a PDF/.test(document.getElementById("msg").textContent));
      assert.deepEqual(M.normalize(await store.get(pid)).files, []);
    });
    assert.deepEqual(errors, []);
  } finally {
    console.log = log; console.warn = warn;
    await browser.close();
    admin.server.close();
    admin.server.closeAllConnections && admin.server.closeAllConnections();
  }
  out(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
