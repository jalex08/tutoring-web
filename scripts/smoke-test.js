#!/usr/bin/env node
/**
 * Local checks for routing, the booking form (email stubbed), the Spanish page,
 * the legal pages, links and the structured data. Run: npm test
 */
"use strict";

const assert = require("node:assert/strict");
const { createDevServer } = require("./dev-server.js");

let sent = [];
const srv = createDevServer({ onSend: (m) => sent.push(m) });
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").join("\n       ")}`);
  }
}

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const visible = (html) =>
  decode(
    html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
  ).replace(/\s+/g, " ");

srv.listen(0, async () => {
  const base = `http://localhost:${srv.address().port}`;
  const get = (p, opts = {}) => fetch(base + p, { redirect: "manual", ...opts });

  console.log("routes");
  const ok = {
    "/": "text/html", "/es/": "text/html", "/robots.txt": "text/plain", "/sitemap.xml": "application/xml",
    "/llms.txt": "text/plain", "/og-image.png": "image/png", "/favicon.ico": "image/x-icon",
    "/favicon.svg": "image/svg+xml", "/apple-touch-icon.png": "image/png",
    "/privacy/": "text/html", "/terms/": "text/html", "/accessibility/": "text/html",
    "/es/privacidad/": "text/html", "/es/terminos/": "text/html", "/es/accesibilidad/": "text/html",
  };
  for (const [p, type] of Object.entries(ok)) {
    await check(`${p} -> 200 ${type}`, async () => {
      const r = await get(p);
      assert.equal(r.status, 200);
      assert.ok(r.headers.get("content-type").startsWith(type), r.headers.get("content-type"));
      assert.ok(r.headers.get("strict-transport-security"));
    });
  }
  for (const p of ["/foo", "/.well-known/ard.json", "/es/foo", "/index.htm", "/api", "/privacy/foo", "/es/privacy/", "/privacidad/"]) {
    await check(`${p} -> 404 html, noindex`, async () => {
      const r = await get(p);
      assert.equal(r.status, 404);
      assert.match(r.headers.get("content-type"), /text\/html/);
      assert.equal(r.headers.get("x-robots-tag"), "noindex");
      assert.match(await r.text(), /This page doesn't exist[\s\S]*Esta página no existe/);
    });
  }
  const redirects = { "/index.html": "/", "/es": "/es/", "/es/index.html": "/es/", "/index.html?lang=es": "/es/" };
  for (const p of ["/privacy", "/terms", "/accessibility", "/es/privacidad", "/es/terminos", "/es/accesibilidad"]) {
    redirects[p] = redirects[`${p}.html`] = redirects[`${p}/index.html`] = `${p}/`;
  }
  for (const [p, to] of Object.entries(redirects)) {
    await check(`${p} -> 301 ${to}`, async () => {
      const r = await get(p);
      assert.equal(r.status, 301);
      assert.equal(r.headers.get("location"), to);
    });
  }
  await check("/?lang=es -> /es/ (static page: redirect script at the top of <head>)", async () => {
    const html = await (await get("/?lang=es")).text();
    assert.match(html.slice(0, 600), /<script id="legacy-lang">[^<]*get\("lang"\) === "es"\) location\.replace\("\/es\/"/);
  });

  console.log("booking form (email stubbed)");
  await check("GET /api/contact -> 405", async () => {
    const r = await get("/api/contact");
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("allow"), "POST");
  });
  await check("GET /api/nope -> JSON 404", async () => {
    const r = await get("/api/nope");
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, error: "not_found" });
  });
  const post = (body) =>
    get("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const form = { name: "Test Student", email: "student@example.test", level: "Universidad", course: "Cálculo II", message: "hola", lang: "es", website: "" };
  await check("valid POST -> 200, two emails (stub)", async () => {
    sent = [];
    const r = await post(form);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].length, 2);
    assert.equal(sent[0][1].subject, "Recibí tu solicitud de tutoría");
    const body = sent[0][1].text;
    assert.ok(body.includes("Recibes este correo porque enviaste una solicitud en josediaztutoring.com."), "email footer missing");
    assert.ok(body.includes("https://josediaztutoring.com/es/privacidad/") && body.includes("https://josediaztutoring.com/es/terminos/"));
  });
  await check("English confirmation has the English footer", async () => {
    sent = [];
    await post({ ...form, email: "student2@example.test", lang: "en" });
    const body = sent[0][1].text;
    assert.ok(body.includes("You're receiving this because you sent a request on josediaztutoring.com."));
    assert.ok(body.includes("Privacy Policy: https://josediaztutoring.com/privacy/") && body.includes("Terms: https://josediaztutoring.com/terms/"));
  });
  await check("honeypot filled -> 200 but nothing sent", async () => {
    sent = [];
    const r = await post({ ...form, website: "http://spam.example" });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 0);
  });
  await check("missing email -> 400", async () => {
    const r = await post({ ...form, email: "" });
    assert.equal(r.status, 400);
  });

  console.log("pages");
  const pages = { en: await (await get("/")).text(), es: await (await get("/es/")).text() };
  const url = { en: "https://josediaztutoring.com/", es: "https://josediaztutoring.com/es/" };
  for (const lang of ["en", "es"]) {
    const html = pages[lang];
    const other = lang === "en" ? "es" : "en";
    await check(`${lang}: lang, canonical, hreflang, og`, () => {
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.ok(html.includes(`<link rel="canonical" href="${url[lang]}">`));
      for (const [hl, u] of [["en", url.en], ["es", url.es], ["x-default", url.en]])
        assert.ok(html.includes(`<link rel="alternate" hreflang="${hl}" href="${u}">`), hl);
      assert.ok(html.includes(`<meta property="og:url" content="${url[lang]}">`));
      assert.ok(html.includes(`<meta property="og:locale" content="${lang}_US">`));
      assert.ok(html.includes(`<meta property="og:locale:alternate" content="${other}_US">`));
      assert.ok(html.includes('<meta property="og:site_name" content="Jose Diaz Tutoring">'));
      assert.ok(!html.includes("data:image/svg+xml"), "favicon data: URI still present");
      assert.equal((html.match(/<a [^>]*aria-current="page"/g) || []).length, 1);
      assert.match(html, new RegExp(`data-lang="${lang}"[^>]*aria-current="page"`));
    });
    await check(`${lang}: Google Tag Manager in <head> and right after <body>`, () => {
      const head = html.slice(0, html.indexOf("</head>"));
      assert.ok(head.includes("'dataLayer','GTM-TG7DX6ZB')"), "GTM head snippet missing");
      assert.ok(head.indexOf("GTM-TG7DX6ZB") < head.indexOf("<title>"), "GTM snippet should be high in <head>");
      assert.match(html, /<body>\n<!-- Google Tag Manager \(noscript\) -->\n<noscript><iframe src="https:\/\/www\.googletagmanager\.com\/ns\.html\?id=GTM-TG7DX6ZB"/);
      assert.ok(html.includes('track("generate_lead"'), "booking-form lead event missing");
    });
    await check(`${lang}: title and description`, () => {
      const title = decode(html.match(/<title>([^<]*)<\/title>/)[1]);
      const desc = decode(html.match(/<meta name="description" content="([^"]*)"/)[1]);
      const ogTitle = decode(html.match(/<meta property="og:title" content="([^"]*)"/)[1]);
      assert.equal(title, lang === "en" ? "Math, Physics & Engineering Tutor in Miami & Broward" : "Tutor de matemáticas, física e ingeniería en Miami y Broward");
      assert.equal(ogTitle, title);
      assert.ok(desc.length <= 155, `description is ${desc.length} chars`);
    });
    await check(`${lang}: brand, footer, testimonials hidden`, () => {
      assert.match(html, /<a class="mark" href="#top">Jose Diaz Tutoring<small/);
      assert.match(html, /© <span id="yr">\d+<\/span> Jose Diaz Tutoring\./);
      assert.ok(html.includes('<a href="tel:+17868329107">+1 (786) 832-9107</a>'));
      assert.match(html, /<section id="reviews" hidden>/);
      assert.ok(!/\[(University|Parent|First name)/.test(visible(html)), "placeholder testimonial text is visible");
    });
    await check(`${lang}: JSON-LD parses and matches the page`, () => {
      const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      assert.equal(blocks.length, 1);
      const ld = JSON.parse(blocks[0][1]);
      const types = ld["@graph"].map((n) => n["@type"]);
      assert.deepEqual(types, ["WebSite", "ProfessionalService", "Person", "FAQPage"]);
      assert.ok(!/"(Review|AggregateRating|PostalAddress)"|streetAddress/.test(blocks[0][1]));
      const page = visible(html);
      // every human-readable string must be on the page (URLs, ids, codes and a few known facts aside)
      const allowed = new Set(["Jalex Diaz", "Universidad Tecnológica de La Habana José Antonio Echeverría", "$40–$110",
        "Broward County, FL", "Miami-Dade County, FL", "USD", "HOUR", "MONTH", "HUR", "MON", "en", "es", "degree",
        "students", "estudiantes", "Math, physics and engineering tutor", "Tutor de matemáticas, física e ingeniería"]);
      const walk = (v, key) => {
        if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
        if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, k));
        if (typeof v !== "string" || key.startsWith("@") || /^(https?:|\+1-)/.test(v) || allowed.has(v)) return;
        const metaDesc = decode(html.match(/<meta name="description" content="([^"]*)"/)[1]);
        assert.ok(page.includes(v) || v === metaDesc, `not on the page: ${key} = ${JSON.stringify(v)}`);
      };
      walk(ld, "");
      const biz = ld["@graph"][1];
      const prices = biz.hasOfferCatalog.itemListElement.map((o) => o.price);
      assert.deepEqual(prices, [65, 90, 110, 40, 480, 970]);
      for (const p of prices) assert.ok(page.includes(`$${p}`), `$${p} not visible`);
      assert.ok(page.includes("+1 (786) 832-9107") && biz.telephone === "+1-786-832-9107");
      const faq = ld["@graph"][3].mainEntity;
      assert.equal(faq.length, 6);
      for (const q of faq) {
        assert.ok(page.includes(q.name), q.name);
        assert.ok(page.includes(q.acceptedAnswer.text), q.acceptedAnswer.text);
      }
      assert.equal(ld["@graph"][0].inLanguage, lang);
    });
  }
  await check("es: every translated element is Spanish", () => {
    const en = visible(pages.en), es = visible(pages.es);
    for (const s of ["How it works", "Book your free intro", "What I teach", "Send request", "Questions"])
      assert.ok(en.includes(s) && !es.includes(s), s);
    assert.match(pages.es, /placeholder="p\. ej\., Calculus II en FIU"/);
    assert.match(pages.es, /aria-label="Escríbele a Jose por WhatsApp"/);
  });
  await check("home: privacy notice under the form, in the page's language", () => {
    assert.match(pages.en, /<p class="form-note"[^>]*>By sending this form, you agree to the <a href="\/privacy\/">Privacy Policy<\/a>/);
    assert.match(pages.es, /<p class="form-note"[^>]*>Al enviar este formulario, aceptas la <a href="\/es\/privacidad\/">Política de privacidad<\/a>/);
  });

  console.log("legal pages");
  const LEGAL = [
    { en: "/privacy/", es: "/es/privacidad/", title: ["Privacy Policy", "Política de privacidad"], strict: true },
    { en: "/terms/", es: "/es/terminos/", title: ["Terms of Service", "Términos del servicio"], strict: true, noPrices: true },
    { en: "/accessibility/", es: "/es/accesibilidad/", title: ["Accessibility Statement", "Declaración de accesibilidad"] },
  ];
  const main = (h) => h.slice(h.indexOf('<main id="main">'), h.indexOf("</main>"));
  const sections = (h) => [...h.matchAll(/<section class="sec"[^>]*>\s*<h2 id="[^"]+">/g)].length;
  const all = { "/": pages.en, "/es/": pages.es };
  for (const page of LEGAL) {
    const html = { en: await (await get(page.en)).text(), es: await (await get(page.es)).text() };
    Object.assign(all, { [page.en]: html.en, [page.es]: html.es });
    for (const [i, lang] of ["en", "es"].entries()) {
      const h = html[lang], p = page[lang];
      await check(`${p}: head, toggle, footer`, () => {
        assert.match(h, new RegExp(`<html lang="${lang}">`));
        assert.ok(h.includes(`<title>${page.title[i]} | Jose Diaz Tutoring</title>`));
        assert.ok(h.includes(`<link rel="canonical" href="https://josediaztutoring.com${p}">`));
        for (const [hl, u] of [["en", page.en], ["es", page.es], ["x-default", page.en]])
          assert.ok(h.includes(`<link rel="alternate" hreflang="${hl}" href="https://josediaztutoring.com${u}">`), hl);
        assert.ok(decode(h.match(/<meta name="description" content="([^"]*)"/)[1]).length <= 155);
        assert.ok(h.slice(0, h.indexOf("<title>")).includes("'dataLayer','GTM-TG7DX6ZB')"), "GTM missing");
        assert.ok(h.includes(`<a href="${page.en}" hreflang="en"`) && h.includes(`<a href="${page.es}" hreflang="es"`), "EN/ES toggle");
        assert.ok(h.includes(`<a href="${p}" aria-current="page"`), "footer aria-current");
        assert.match(h, /<a class="wa-float wa-link" id="wa-float"[^>]*aria-label="[^"]+"/);
        assert.match(h, /<nav class="toc"[\s\S]*?<ol>\s*<li><a href="#/);
        assert.ok(!h.includes("data:image") && !/Kalam/.test(h.slice(0, h.indexOf("</head>")).replace(/--hand:[^;]*;/, "")), "Kalam/base64 on legal page");
      });
      await check(`${p}: content rules`, () => {
        const text = visible(main(h));
        assert.ok(!/\[[^\]]*\]/.test(text) && !h.includes('class="confirm"'), "placeholder left");
        // phone: no tel: link and no number in the text (the floating WhatsApp button's wa.me URL is fine)
        if (page.strict) assert.ok(!/tel:/.test(main(h)) && !/786|832-?9107/.test(text), "phone number on page");
        if (page.noPrices) assert.ok(!/\$|\d+\s+(sessions|sesiones)\b/.test(text), "price or package size on page");
      });
    }
    await check(`${page.en} and ${page.es}: same sections in the same order`, () => {
      assert.ok(sections(html.en) > 0);
      assert.equal(sections(html.en), sections(html.es));
      const keys = (h) => [...h.matchAll(/<section class="sec" data-i18n="(\w+)"/g)].map((m) => m[1]).join();
      assert.equal(keys(html.en), keys(html.es));
    });
  }
  await check("404 has the footer with policy links in both languages", async () => {
    const h = await (await get("/nope")).text();
    for (const p of ["/privacy/", "/terms/", "/accessibility/", "/es/privacidad/", "/es/terminos/", "/es/accesibilidad/"])
      assert.ok(h.includes(`<a href="${p}"`), p);
    assert.ok(h.includes("Independent tutoring service.") && h.includes("Servicio independiente de tutorías."));
  });
  await check("every internal link and #anchor resolves", async () => {
    const seen = new Map();
    const ids = (h) => new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [from, h] of Object.entries(all)) {
      for (const [, href] of h.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) {
        if (/^(https?:|mailto:|tel:)/.test(href) || href === "#") continue;
        const [p, hash] = href.split("#");
        const target = p || from;
        if (!seen.has(target)) {
          const r = await get(target);
          seen.set(target, r.status === 200 ? await r.text() : r.status);
        }
        const t = seen.get(target);
        assert.equal(typeof t, "string", `${from}: ${href} -> ${t}`);
        if (hash) assert.ok(ids(t).has(hash), `${from}: ${href} -> no #${hash}`);
      }
    }
  });
  await check("sitemap lists all 8 pages with hreflang", async () => {
    const xml = await (await get("/sitemap.xml")).text();
    assert.equal((xml.match(/<loc>/g) || []).length, 8);
    assert.equal((xml.match(/hreflang=/g) || []).length, 24);
    assert.ok(xml.includes("<loc>https://josediaztutoring.com/es/terminos/</loc>"));
  });
  await check("robots.txt disallows /api/ and keeps the sitemap", async () => {
    const t = await (await get("/robots.txt")).text();
    assert.match(t, /^Disallow: \/api\/$/m);
    assert.match(t, /^Sitemap: https:\/\/josediaztutoring\.com\/sitemap\.xml$/m);
  });

  srv.close();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
});
