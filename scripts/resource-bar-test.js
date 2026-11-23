#!/usr/bin/env node
/**
 * The top bar on resource pages, in a real browser (Chromium via Playwright): the three layouts, Share,
 * the ⋯ menu, EN/ES keeping the tool's #hash, full screen only where supported. Skipped without Playwright.
 */
"use strict";

const assert = require("node:assert/strict");
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("resource bar: SKIPPED (Playwright isn't installed)"); process.exit(0); }
const M = require("../lib/resources/model.js");
const storeLib = require("../lib/resources/store.js");
const { createDevServer } = require("./dev-server.js");

let failures = 0;
const out = (s) => process.stdout.write(s + "\n");
async function check(name, fn) {
  try { await fn(); out(`  ok   ${name}`); }
  catch (e) { failures++; out(`  FAIL ${name}\n       ${String(e.stack || e.message).split("\n").slice(0, 4).join("\n       ")}`); }
}

(async () => {
  out("resource bar");
  const log = console.log; console.log = () => {};
  const store = storeLib.memoryStore();
  const now = new Date().toISOString();
  const T = { title: "Unit circle explorer", description: "d", intro: "i", howTo: ["h"], keyIdeas: ["k"], faq: [], keywords: [] };
  await store.put(M.normalize({ id: "abcde12345", status: "published", visibility: "public", slugEn: "unit-circle", slugEs: "circulo-unitario",
    en: T, es: { ...T, title: "Círculo unitario" }, subject: "geometry-trig", levels: ["high-school"],
    file: { path: M.filePath("abcde12345", 1), version: 1, sizeBytes: 10, uploadedAt: now }, createdAt: now, publishedAt: now, updatedAt: now }));
  await store.writeObject(M.filePath("abcde12345", 1), Buffer.from("<!doctype html><html><head></head><body><input id=a type=range><script>a.oninput=()=>history.replaceState(null,'','#angle='+a.value)</script></body></html>"), "text/html");
  await store.bump();
  const srv = createDevServer({ onSend: () => {}, pricingFile: "", resourcesStore: store });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const B = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const page = async (w, path, { lang = "en", init } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 600 } });
    await ctx.addCookies([{ name: "lang", value: lang, url: B }]);
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: B });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    await p.goto(B + path, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(300);
    return p;
  };
  const visible = (p) => p.$$eval(".res-back,.res-mark,.res-title,.res-all,.res-bar .lang,#res-share,#res-fs,.res-cta,#res-more",
    (els) => els.filter((e) => e.getClientRects().length).map((e) => e.id || e.className.split(" ").pop()));
  const layout = (p) => p.evaluate(() => {
    const bar = document.querySelector(".res-bar"), els = [...bar.querySelectorAll(".res-back,.res-mark,.res-title,.res-all,.lang,#res-share,#res-fs,.res-cta,#res-more")].filter((e) => e.getClientRects().length);
    const r = els.map((e) => e.getBoundingClientRect());
    return { h: bar.getBoundingClientRect().height, overflow: bar.scrollWidth > bar.clientWidth || document.documentElement.scrollWidth > innerWidth,
      minGap: Math.min(...r.slice(1).map((x, i) => x.left - r[i].right)), oneLine: els.every((e) => e.getClientRects().length === 1),
      targets: els.filter((e) => !e.classList.contains("res-title") && !e.classList.contains("lang")).every((e) => e.getBoundingClientRect().height >= 40 && e.getBoundingClientRect().width >= 44),
      lastRight: innerWidth - r[r.length - 1].right };
  });

  try {
    await check("layouts: <600 back · share · CTA · ⋯; 600–1099 wordmark, icons, no title; 1100+ full bar", async () => {
      assert.deepEqual(await visible(await page(390, "/resources/unit-circle/")), ["res-back", "res-share", "res-cta", "res-more"]);
      assert.deepEqual(await visible(await page(768, "/resources/unit-circle/")), ["res-mark", "res-all", "lang", "res-share", "res-fs", "res-cta"]);
      assert.deepEqual(await visible(await page(1100, "/resources/unit-circle/")), ["res-mark", "res-title", "res-all", "lang", "res-share", "res-fs", "res-cta"]);
    });
    await check("every width, both languages: 48px, one line, no overflow, ≥8px gaps, 44px targets, edge padding", async () => {
      for (const [lang, path] of [["en", "/resources/unit-circle/"], ["es", "/es/recursos/circulo-unitario/"]]) {
        for (const w of [360, 390, 430, 600, 768, 1024, 1100, 1440]) {
          const l = await layout(await page(w, path, { lang }));
          const at = `${lang} ${w}px`;
          assert.equal(l.h, 48, at); assert.equal(l.overflow, false, at); assert.equal(l.oneLine, true, at);
          assert.ok(l.minGap >= 8, `${at}: gap ${l.minGap}`); assert.ok(l.targets, `${at}: targets`); assert.ok(l.lastRight >= 8, `${at}: right edge ${l.lastRight}`);
        }
      }
    });
    await check("CTA wording: EN Free intro / Book a free intro; ES Llamada gratis / Agenda una llamada gratis (as on /es/)", async () => {
      assert.equal((await (await page(390, "/resources/unit-circle/")).innerText(".res-cta")).trim(), "Free intro");
      assert.equal((await (await page(768, "/resources/unit-circle/")).innerText(".res-cta")).trim(), "Book a free intro");
      assert.equal((await (await page(390, "/es/recursos/circulo-unitario/", { lang: "es" })).innerText(".res-cta")).trim(), "Llamada gratis");
      assert.equal((await (await page(768, "/es/recursos/circulo-unitario/", { lang: "es" })).innerText(".res-cta")).trim(), "Agenda una llamada gratis");
    });
    await check("icon-only buttons keep aria-label and tooltip", async () => {
      const p = await page(768, "/es/recursos/circulo-unitario/", { lang: "es" });
      for (const [sel, t] of [["#res-share", "Compartir"], ["#res-fs", "Pantalla completa"], [".res-all", "Todos los recursos"]]) {
        assert.equal(await p.getAttribute(sel, "aria-label"), t); assert.equal(await p.getAttribute(sel, "title"), t);
      }
      const q = await page(390, "/resources/unit-circle/");
      assert.equal(await q.getAttribute("#res-more", "aria-label"), "More options");
    });
    await check("Share without navigator.share: copies the URL with the #hash, shows Copied, event method=copy", async () => {
      const p = await page(1440, "/resources/unit-circle/#angle=150", { init: () => { delete Navigator.prototype.share; } });
      await p.click("#res-share");
      await p.waitForTimeout(200);
      assert.equal(await p.evaluate(() => navigator.clipboard.readText()), `${B}/resources/unit-circle/#angle=150`);
      assert.equal((await p.innerText("#res-share")).trim(), "Copied");
      assert.equal(await p.isVisible("#res-toast"), true);
      const ev = await p.evaluate(() => dataLayer.filter((e) => e.event === "resource_link_copy"));
      assert.equal(ev.length, 1); assert.equal(ev[0].method, "copy"); assert.equal(ev[0].has_state, true);
      const es = await page(390, "/es/recursos/circulo-unitario/", { lang: "es", init: () => { delete Navigator.prototype.share; } });
      await es.click("#res-share"); await es.waitForTimeout(200);
      assert.equal((await es.innerText("#res-toast")).trim(), "Copiado");
    });
    await check("Share with navigator.share: the share sheet gets the title and URL with #hash, event method=share", async () => {
      const p = await page(390, "/resources/unit-circle/#angle=60", { init: () => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; } });
      await p.click("#res-share"); await p.waitForTimeout(200);
      const d = await p.evaluate(() => window.__shared);
      assert.equal(d.url, `${B}/resources/unit-circle/#angle=60`); assert.match(d.title, /Unit circle explorer/);
      const ev = await p.evaluate(() => dataLayer.filter((e) => e.event === "resource_link_copy"));
      assert.equal(ev.length, 1); assert.equal(ev[0].method, "share");
      // the visitor closes the sheet: no copy, no event
      const q = await page(390, "/resources/unit-circle/", { init: () => { navigator.share = () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })); } });
      await q.click("#res-share"); await q.waitForTimeout(200);
      assert.equal(await q.evaluate(() => dataLayer.filter((e) => e.event === "resource_link_copy").length), 0);
    });
    await check("⋯ menu: aria-expanded, focus to the first item, arrows, Esc returns focus, tap outside and a choice close it", async () => {
      const p = await page(390, "/resources/unit-circle/#angle=30");
      assert.equal(await p.getAttribute("#res-more", "aria-expanded"), "false");
      await p.click("#res-more");
      assert.equal(await p.getAttribute("#res-more", "aria-expanded"), "true");
      assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), "Home");
      await p.keyboard.press("ArrowDown");
      assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), "Español");
      await p.keyboard.press("ArrowUp"); await p.keyboard.press("ArrowUp");
      assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), "Full screen"); // wraps
      await p.keyboard.press("Escape");
      assert.equal(await p.isHidden("#res-menu"), true, "Esc closes");
      assert.equal(await p.evaluate(() => document.activeElement.id), "res-more");
      await p.keyboard.press("Enter"); // keyboard opens it too
      assert.equal(await p.isVisible("#res-menu"), true, "Enter opens");
      await p.mouse.click(30, 400);
      assert.equal(await p.isHidden("#res-menu"), true, "tap outside closes");
      assert.equal(await p.getAttribute("#res-more", "aria-expanded"), "false");
      await p.click("#res-more"); await p.click("#res-menu-fs");
      assert.equal(await p.isHidden("#res-menu"), true, "a choice closes");
    });
    await check("menu language link keeps the tool's #hash (and saves the choice)", async () => {
      const p = await page(390, "/resources/unit-circle/");
      await p.frameLocator("#res-frame").locator("#a").fill("77");
      await p.waitForTimeout(200);
      await p.click("#res-more");
      await Promise.all([p.waitForURL(/circulo-unitario/), p.click("#res-menu a[data-lang='es']")]);
      assert.equal(new URL(p.url()).pathname + new URL(p.url()).hash, "/es/recursos/circulo-unitario/#angle=77");
      assert.ok((await p.context().cookies()).some((c) => c.name === "lang" && c.value === "es"));
    });
    await check("full screen hidden where the Fullscreen API doesn't work (e.g. iPhone Safari)", async () => {
      const noFs = () => { Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false }); Object.defineProperty(Document.prototype, "webkitFullscreenEnabled", { get: () => false }); };
      const p = await page(768, "/resources/unit-circle/", { init: noFs });
      assert.equal(await p.isHidden("#res-fs"), true);
      const q = await page(390, "/resources/unit-circle/", { init: noFs });
      await q.click("#res-more");
      assert.deepEqual(await q.$$eval("#res-menu a, #res-menu button", (e) => e.filter((x) => !x.hidden).map((x) => x.textContent.trim())), ["Home", "Español"]);
      const r = await page(390, "/resources/unit-circle/");
      await r.click("#res-more");
      assert.equal(await r.isVisible("#res-menu-fs"), true);
    });
  } finally {
    console.log = log;
    await browser.close();
    srv.close(); srv.closeAllConnections && srv.closeAllConnections();
  }
  out(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
