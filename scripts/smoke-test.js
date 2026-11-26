#!/usr/bin/env node
/**
 * Local checks for routing, the booking form (email stubbed), the Spanish page,
 * the legal pages, links and the structured data. Run: npm test
 */
"use strict";

const assert = require("node:assert/strict");
const { createDevServer } = require("./dev-server.js");
const app = require("../server.js");
const pricing = require("../pricing.js");

let sent = [];
const srv = createDevServer({ onSend: (m) => sent.push(m), pricingFile: "", resourcesStore: require("../lib/resources/store.js").memoryStore() });
srv.keepAliveTimeout = 120e3; // some checks run for several seconds between requests
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
    html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<\/?(span|a|strong|b|i|em)\b[^>]*>/g, "").replace(/<[^>]*>/g, " ") // inline tags add no space
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
  await check("/?lang=es&topic=calculus -> 301 /es/?topic=calculus", async () => {
    const r = await get("/?lang=es&topic=calculus");
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "/es/?topic=calculus");
  });
  await check("/?lang=es&src=card&utm_source=x -> 301 /es/ keeps src and utm_*", async () => {
    const r = await get("/?lang=es&src=card&utm_source=x&topic=calculus");
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "/es/?src=card&utm_source=x&topic=calculus");
  });

  console.log("path normalization (lowercase, no /en prefix): one 301, query kept");
  for (const [p, to] of [
    ["/en", "/"], ["/en/", "/"], ["/EN", "/"], ["/En/", "/"], ["/en/exams/?for=g10", "/exams/?for=g10"], ["/EN/Exams/", "/exams/"],
    ["/en/exams", "/exams/"], ["/ES", "/es/"], ["/Es/Examenes/", "/es/examenes/"], ["/Privacy", "/privacy/"], ["/PRIVACY/", "/privacy/"],
    ["/en/en/terms/", "/terms/"], ["/en?lang=es&topic=calculus", "/es/?topic=calculus"], ["/EN/?utm_campaign=Card&X=Y", "/?utm_campaign=Card&X=Y"],
    ["/OG-IMAGE.PNG", "/og-image.png"], ["/en/does-not-exist", "/does-not-exist"], ["/Caf%C3%A9", "/caf%C3%A9"],
  ]) {
    await check(`${p} -> 301 ${to}`, async () => {
      for (const method of ["GET", "HEAD"]) {
        const r = await get(p, { method });
        assert.equal(r.status, 301, method);
        assert.equal(r.headers.get("location"), to, method);
      }
      // one hop: the target never redirects again for a visitor without a lang cookie
      const next = await get(to);
      assert.ok(next.status === 200 || next.status === 404, `${to} -> ${next.status} ${next.headers.get("location") || ""}`);
    });
  }
  for (const p of ["/", "/es/", "/?utm_campaign=Card", "/exams/?for=g10", "/english/", "/es/en/", "/env"]) {
    await check(`${p}: not normalized`, async () => {
      const r = await get(p);
      assert.notEqual(r.status, 301);
    });
  }
  await check("POST /EN, POST /api/contact, GET /API/contact: no normalization redirect", async () => {
    assert.equal((await get("/EN", { method: "POST" })).status, 404);
    assert.equal((await get("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
    assert.notEqual((await get("/API/contact")).status, 301);
  });

  console.log("www.josediaztutoring.com -> josediaztutoring.com: one 301, path + query kept");
  const viaHost = (p, host, method = "GET") => new Promise((resolve, reject) => {
    const r = require("node:http").request(base + p, { method, headers: { host } }, (res) => { res.resume(); resolve(res); });
    r.on("error", reject);
    r.end();
  });
  for (const [p, to] of [
    ["/", "/"], ["/exams/?for=g10", "/exams/?for=g10"], ["/EN/Exams/", "/exams/"], ["/es/", "/es/"], ["/privacy", "/privacy/"],
    ["/?lang=es&topic=calculus", "/es/?topic=calculus"], ["/does-not-exist", "/does-not-exist"],
  ]) {
    await check(`www ${p} -> 301 https://josediaztutoring.com${to}`, async () => {
      for (const host of ["www.josediaztutoring.com", "WWW.JosediazTutoring.com:443"]) {
        for (const method of ["GET", "HEAD"]) {
          const r = await viaHost(p, host, method);
          assert.equal(r.statusCode, 301, `${host} ${method}`);
          assert.equal(r.headers.location, "https://josediaztutoring.com" + to, `${host} ${method}`);
        }
      }
    });
  }
  await check("www POST /api/contact and the main host: no www redirect", async () => {
    assert.notEqual((await viaHost("/api/contact", "www.josediaztutoring.com", "POST")).statusCode, 301);
    assert.equal((await viaHost("/exams/", "josediaztutoring.com")).statusCode, 200);
  });

  console.log("language preference (cookie lang)");
  const withLang = (v, opts = {}) => ({ ...opts, headers: { cookie: `_ga=GA1.1.1; lang=${v}; _ga_X=GS1.1` } });
  for (const [p, cookieVal, status, to] of [
    ["/", null, 200], ["/", "en", 200], ["/", "es", 302, "/es/"], ["/?src=card&utm_source=x", "es", 302, "/es/?src=card&utm_source=x"],
    ["/exams/", "es", 302, "/es/examenes/"], ["/exams/?for=hs9", "es", 302, "/es/examenes/?for=hs9"], ["/exams/", "en", 200], ["/exams/", null, 200],
    ["/es/", "es", 200], ["/es/", "en", 200], ["/es/examenes/", "es", 200], ["/exams/algebra-1-eoc/", "es", 200],
    ["/privacy/", "es", 200], ["/terms/", "es", 200], ["/?lang=es&topic=calculus", "en", 301, "/es/?topic=calculus"],
    ["/book/", "es", 302, "/es/reservar/"], ["/book/?utm_source=x", "es", 302, "/es/reservar/?utm_source=x"], ["/book/", "en", 200], ["/es/reservar/", "es", 200],
  ]) {
    await check(`${p} ${cookieVal ? "lang=" + cookieVal : "no cookie"} -> ${status}${to ? " " + to : ""}`, async () => {
      for (const method of ["GET", "HEAD"]) {
        const r = await get(p, cookieVal ? withLang(cookieVal, { method }) : { method });
        assert.equal(r.status, status, method);
        assert.equal(r.headers.get("location"), to || null, method);
        if (status === 302) {
          assert.equal(r.headers.get("cache-control"), "private, no-store");
          assert.equal(r.headers.get("vary"), "Cookie");
        }
      }
    });
  }
  // Fix for Safari's 7-day limit on JS-set cookies: every HTML page re-sends a valid lang cookie
  const html = ["/", "/es/", "/exams/", "/exams/algebra-1-eoc/", "/es/examenes/", "/es/examenes/eoc-algebra-1/",
    "/privacy/", "/terms/", "/accessibility/", "/es/privacidad/", "/es/terminos/", "/es/accesibilidad/", "/book/", "/es/reservar/", "/nope"];
  const SET = (v) => `lang=${v}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
  for (const p of html) {
    await check(`${p}: HTML private; Set-Cookie only echoes a valid lang cookie`, async () => {
      for (const [c, want] of [[null, null], ["en", SET("en")], ["es", SET("es")], ["fr", null]]) {
        if (c === "es" && (p === "/" || p === "/exams/" || p === "/book/")) continue; // those 302 (checked above)
        const r = await get(p, c ? withLang(c) : {});
        assert.match(r.headers.get("content-type"), /^text\/html/);
        assert.match(r.headers.get("cache-control"), /^private/, `${p} ${c}`);
        assert.equal(r.headers.get("set-cookie"), want, `${p} cookie ${c}`);
      }
    });
  }
  await check("non-HTML stays public and never sets the cookie", async () => {
    for (const p of ["/llms.txt", "/exams/data.json", "/robots.txt", "/og-image.png", "/favicon.svg"]) {
      const r = await get(p, withLang("es"));
      assert.equal(r.headers.get("set-cookie"), null, p);
      assert.ok(!/private/.test(r.headers.get("cache-control") || ""), p);
    }
  });
  await check("lang=es doesn't touch /api/contact", async () => {
    const r = await get("/api/contact", withLang("es", { method: "POST", headers: { cookie: "lang=es", "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(r.status, 400);
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
  for (const [source, label] of [["card", "business card"], ["share", "share link"], ["", "website"], ["evil\nBcc: x@y", "website"], [undefined, "website"]]) {
    await check(`source ${JSON.stringify(source)} -> owner email says "Source: ${label}", client email doesn't`, async () => {
      sent = [];
      await post({ ...form, email: `src-${label.replace(/\W/g, "")}-${sent.length}${Math.random().toString(36).slice(2, 7)}@example.test`, lang: "en", source });
      assert.equal(sent.length, 1);
      assert.ok(sent[0][0].text.includes(`\nSource: ${label}\n`), sent[0][0].text);
      assert.ok(!/Source:/i.test(sent[0][1].text), "source leaked into the client's confirmation");
    });
  }
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
    await check(`${lang}: compact header menu (button, panel, labels by state, no-JS row)`, () => {
      const t = lang === "es" ? { open: "Abrir menú", close: "Cerrar menú" } : { open: "Open menu", close: "Close menu" };
      const btn = (html.match(/<button class="menu-btn"[^>]*>[\s\S]*?<\/button>/) || [""])[0];
      assert.ok(btn.includes('aria-expanded="false"') && btn.includes('aria-controls="site-menu"'), "menu button: aria-expanded / aria-controls");
      assert.ok(btn.includes(`aria-label="${t.open}"`) && btn.includes(`data-open="${t.open}"`) && btn.includes(`data-close="${t.close}"`), "menu button: names by state");
      assert.ok(/<\/svg><\/button>$/.test(btn) && btn.includes('<svg viewBox="0 0 24 24" aria-hidden="true">'), "menu button: icon only (name from aria-label)");
      const panel = (html.match(/<div class="head-menu" id="site-menu">[\s\S]*?<\/div>/) || [""])[0];
      assert.equal((panel.match(/<a /g) || []).length, 8, "panel: six nav links + EN/ES");
      assert.ok(/<noscript><style>@media \(max-width:959px\)/.test(html), "no-JS fallback style");
    });
    await check(`${lang}: brand, footer, testimonials hidden`, () => {
      // " Tutoring" is its own span: the compact header (< 960px) shows "Jose Diaz" only
      assert.match(html, /<a class="mark" href="#top">Jose Diaz<span class="mark-x"> Tutoring<\/span><small/);
      assert.match(html, /© <span id="yr">\d+<\/span> Jose Diaz Tutoring\./);
      assert.match(html, /<a class="contact-row" href="tel:\+17868329107">[\s\S]*?<span class="contact-detail">\(786\) 832-9107<\/span>/);
      for (const id of ["foot-wa", "foot-tel", "foot-mail", "foot-li"]) assert.ok(html.includes(`<li id="${id}">`), `footer row ${id}`);
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
        "students", "estudiantes", "Math, physics and engineering tutor", "Tutor de matemáticas, física e ingeniería",
        "MCAT physics and math (Chem/Phys section)", "Física y matemáticas del MCAT (sección Chem/Phys)"]);
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
      assert.deepEqual(prices, [65, 90, 110, 40, 429, 899, 1099]);
      for (const p of prices) assert.ok(page.includes("$" + p.toLocaleString("en-US")), `$${p} not visible`);
      assert.equal(biz.priceRange, "$40–$110");
      assert.ok(page.includes("(786) 832-9107") && biz.telephone === "+1-786-832-9107");
      const faq = ld["@graph"][3].mainEntity;
      assert.equal(faq.length, 7);
      assert.equal((html.match(/<details><summary data-i18n="q\d+">/g) || []).length, 7, "7 questions on the page");
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
  await check("home: honeypot hidden from assistive tech and keyboard, still posted", () => {
    for (const h of [pages.en, pages.es]) {
      assert.match(h, /<div class="hp" aria-hidden="true"><label for="f-website">Website<\/label><input id="f-website" name="website" tabindex="-1" autocomplete="off"><\/div>/);
      assert.match(h, /website: f\.website\.value/);
    }
  });
  await check("home: privacy notice under the form, in the page's language", () => {
    assert.match(pages.en, /<p class="form-note"[^>]*>By sending this form, you agree to the <a href="\/privacy\/">Privacy Policy<\/a>/);
    assert.match(pages.es, /<p class="form-note"[^>]*>Al enviar este formulario, aceptas la <a href="\/es\/privacidad\/">Política de privacidad<\/a>/);
  });

  console.log("prices (site-pricing secret, filled by the server)");
  const rates = (h) => h.slice(h.indexOf('<section id="rates"'), h.indexOf("<!-- FAQ -->"));
  const OLD = /\b(From|Desde) \$|\$480|\$970|\$60\/|\$81|10%/;
  const shown = {
    en: ["$65", "$90", "$110", "$40", "Save about 17%", "$429", "about $54/hour, save $91", "$899", "about $75/hour, save $181", "$1,099", "about $92/hour, save $221"],
    es: ["$65", "$90", "$110", "$40", "Ahorra alrededor de un 17%", "$429", "unos $54/hora, ahorras $91", "$899", "unos $75/hora, ahorras $181", "$1,099", "unos $92/hora, ahorras $221"],
  };
  for (const lang of ["en", "es"]) {
    await check(`${lang}: rates show the computed prices, no "From"/"Desde", no old prices`, () => {
      const t = visible(rates(pages[lang]));
      for (const s of shown[lang]) assert.ok(t.includes(s), s);
      assert.ok(!OLD.test(t), String(t.match(OLD)));
      // every $ amount in the rates section is a filled value
      assert.ok(!/\$\d/.test(visible(rates(pages[lang]).replace(/<span data-price="[^"]+">[^<]*<\/span>/g, ""))), "hard-coded $ amount");
    });
    await check(`${lang}: one highlighter on the rates screen (the guarantee); form line has the check icon`, () => {
      const r = rates(pages[lang]);
      assert.equal((r.match(/<div class="guarantee">/g) || []).length, 1);
      assert.ok(!/\.rate\.featured \.price span\{background/.test(pages[lang]), "old featured-price highlighter CSS");
      assert.match(pages[lang], /\.guarantee strong\{[^}]*background:var\(--hi\)/);
      assert.match(pages[lang], /<p class="form-promise"><svg class="check" viewBox="0 0 24 24" aria-hidden="true">/);
    });
  }
  await check("/llms.txt public, max-age=600; /es/ private, max-age=600; / private, no-cache, Vary: Cookie", async () => {
    for (const p of ["/", "/es/", "/llms.txt"]) {
      const r = await get(p);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), { "/": "private, no-cache", "/es/": "private, max-age=600", "/llms.txt": "public, max-age=600" }[p]);
      assert.equal(r.headers.get("vary"), p === "/" ? "Cookie" : null);
      assert.ok(r.headers.get("strict-transport-security"));
    }
    assert.equal((await get("/", { method: "HEAD" })).status, 200);
  });
  await check("built files hold the fallback prices (filling them with the fallback changes nothing)", () => {
    const fs = require("node:fs");
    for (const f of ["www/index.html", "www/es/index.html"]) {
      const h = fs.readFileSync(f, "utf8");
      assert.equal(pricing.fillHtml(h, pricing.FALLBACK), h, f);
    }
    const l = fs.readFileSync("www/llms.txt", "utf8");
    assert.equal(pricing.fillLlms(l, pricing.FALLBACK), l);
  });
  await check("a changed secret shows up without a rebuild; invalid or missing -> fallback", async () => {
    const changed = JSON.parse(JSON.stringify(pricing.FALLBACK));
    changed.rates.college = 95;
    changed.plans[2].price = 1199;
    const quiet = console.warn, warnings = [];
    console.warn = (...a) => warnings.push(a.join(" "));
    try {
      app._setPricingSource(async () => JSON.stringify(changed));
      const en = await (await get("/")).text(), es = await (await get("/es/")).text(), llms = await (await get("/llms.txt")).text();
      assert.ok(visible(rates(en)).includes("$95") && visible(rates(en)).includes("$1,199"), "new prices not shown");
      assert.ok(visible(rates(en)).includes("about $100/hour, save $121"), "engineering plan per hour/save");
      assert.ok(visible(rates(es)).includes("unos $100/hora, ahorras $121"));
      assert.ok(visible(rates(en)).includes("Save about 16%"), String(visible(rates(en)).match(/Save about \d+%/)));
      const ld = JSON.parse(en.match(/<script type="application\/ld\+json" id="ld">([\s\S]*?)<\/script>/)[1]);
      const offers = ld["@graph"][1].hasOfferCatalog.itemListElement;
      assert.deepEqual(offers.map((o) => o.price), [65, 95, 110, 40, 429, 899, 1199]);
      assert.equal(offers[6].priceSpecification.price, 1199);
      assert.equal(ld["@graph"][1].priceRange, "$40–$110");
      assert.ok(llms.includes("College, one-on-one: $95 per hour") && llms.includes("$1,199 for 12"), "llms.txt not filled");
      // cached: the secret is read once, then not again within 10 minutes
      let reads = 0;
      const realSource = async () => { reads++; return JSON.stringify(changed); };
      app._setPricingSource(realSource);
      await get("/"); await get("/es/"); await get("/");
      assert.equal(reads, 1, "secret read more than once within the cache window");

      for (const [what, raw] of [["invalid JSON", "{nope"], ["a from flag", JSON.stringify({ ...changed, from: true })], ["missing", ""]]) {
        app._setPricingSource(async () => raw);
        const h = await (await get("/")).text();
        assert.ok(visible(rates(h)).includes("$90") && visible(rates(h)).includes("$1,099"), `${what}: fallback not served`);
      }
      assert.ok(warnings.some((w) => /invalid/.test(w)) && warnings.some((w) => /not set/.test(w)), "no warning logged");
    } finally {
      console.warn = quiet;
      app._setPricingSource(async () => "");
    }
  });

  console.log("legal pages");
  const LEGAL = [
    { en: "/privacy/", es: "/es/privacidad/", title: ["Privacy Policy", "Política de privacidad"], strict: true },
    { en: "/terms/", es: "/es/terminos/", title: ["Terms of Service", "Términos del servicio"], strict: true, noPrices: true },
    { en: "/accessibility/", es: "/es/accesibilidad/", title: ["Accessibility Statement", "Declaración de accesibilidad"] },
  ];
  const main = (h) => h.slice(h.indexOf('<main id="main">'), h.indexOf("</main>"));
  const sections = (h) => [...h.matchAll(/<section class="sec"[^>]*>\s*<h2 id="[^"]+"[^>]*>/g)].length;
  // each legal heading names its twin on the other-language page (the EN/ES toggle keeps the section)
  const twins = (h) => [...h.matchAll(/<h2 id="([^"]+)" data-twin-id="([^"]+)">/g)].map((m) => [m[1], m[2]]);
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
      // data-twin-id: every heading points at the heading in the same position on the other page
      assert.equal(twins(html.en).length, sections(html.en));
      assert.deepEqual(twins(html.en), twins(html.es).map(([a, b]) => [b, a]));
      for (const h of [html.en, html.es]) assert.ok(h.includes("/* lang-switch:start"), "toggle script");
    });
  }
  await check("404 has the footer with policy links in both languages", async () => {
    const h = await (await get("/nope")).text();
    for (const p of ["/privacy/", "/terms/", "/accessibility/", "/es/privacidad/", "/es/terminos/", "/es/accesibilidad/"])
      assert.ok(h.includes(`<a href="${p}"`), p);
    assert.ok(h.includes("Independent tutoring service.") && h.includes("Servicio independiente de tutorías."));
  });
  // ---- exam calendar ------------------------------------------------------------------------------
  console.log("booking page (Cal.com inline embed)");
  const BOOK = { en: "/book/", es: "/es/reservar/" };
  for (const p of ["/book", "/book.html", "/book/index.html", "/es/reservar", "/es/reservar.html", "/es/reservar/index.html"]) {
    await check(`${p} -> 301 ${p.startsWith("/es") ? BOOK.es : BOOK.en}`, async () => {
      const r = await get(p);
      assert.equal(r.status, 301);
      assert.equal(r.headers.get("location"), p.startsWith("/es") ? BOOK.es : BOOK.en);
    });
  }
  const bookHtml = {};
  for (const lang of ["en", "es"]) bookHtml[lang] = await (await get(BOOK[lang])).text();
  await check("booking pages: language, H1, canonical + hreflang pair, EN/ES switch links to the twin", () => {
    for (const lang of ["en", "es"]) {
      const h = bookHtml[lang];
      assert.match(h, new RegExp(`<html lang="${lang}">`));
      assert.match(h, lang === "es" ? /<h1[^>]*>Agenda tu llamada gratis de 20 minutos<\/h1>/ : /<h1[^>]*>Book your free 20-minute intro<\/h1>/);
      assert.ok(h.includes(`<link rel="canonical" href="https://josediaztutoring.com${BOOK[lang]}">`));
      assert.ok(h.includes('<link rel="alternate" hreflang="en" href="https://josediaztutoring.com/book/">'));
      assert.ok(h.includes('<link rel="alternate" hreflang="es" href="https://josediaztutoring.com/es/reservar/">'));
      assert.ok(h.includes('<a href="/book/" hreflang="en"') && h.includes('<a href="/es/reservar/" hreflang="es"'));
    }
  });
  await check("booking pages: same section ids in both languages; fallback links to the form and WhatsApp", () => {
    const ids = (h) => [...h.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map((m) => m[1]).join();
    assert.equal(ids(bookHtml.en), "book,scheduler");
    assert.equal(ids(bookHtml.es), ids(bookHtml.en));
    assert.match(bookHtml.en, /<strong>Prefer to message first\?<\/strong> <a href="\/#contact">/);
    assert.match(bookHtml.es, /<strong>¿Prefieres escribirme primero\?<\/strong> <a href="\/es\/#contact">/);
    for (const h of Object.values(bookHtml)) assert.match(h, /id="message-first"[\s\S]*?class="wa-link" href="https:\/\/wa\.me\/\d+"/);
  });
  await check("booking pages: Cal.com inline embed (light, brand color, utm_* only, generate_lead on bookingSuccessfulV2)", () => {
    for (const h of Object.values(bookHtml)) {
      assert.ok(h.includes('<div id="cal-inline" class="cal-inline"></div>'));
      assert.ok(h.includes('"https://app.cal.com"') && h.includes('/embed/embed.js'));
      assert.ok(h.includes('LINK = "josediaztutoring/20min"'));
      assert.match(h, /"cal-brand": "#1C4C9E"/);
      assert.match(h, /theme: "light"/);
      assert.match(h, /\^utm_/);
      assert.match(h, /action: "bookingSuccessfulV2"[\s\S]*?track\("generate_lead", \{ contact_method: "cal_booking" \}\)/);
      assert.doesNotMatch(h, /forwardQueryParams/);
    }
  });
  await check("every booking CTA points to the booking page (header, mobile bar, hero, exam pages, resource bar)", async () => {
    for (const [p, to] of [["/", BOOK.en], ["/es/", BOOK.es], ["/exams/", BOOK.en], ["/es/examenes/", BOOK.es], ["/exams/algebra-1-eoc/", BOOK.en], ["/es/examenes/eoc-algebra-1/", BOOK.es], ["/privacy/", BOOK.en], ["/es/privacidad/", BOOK.es], [BOOK.en, BOOK.en], [BOOK.es, BOOK.es]]) {
      const h = await (await get(p)).text();
      assert.ok(h.includes(`<a class="btn btn-primary head-cta bar-cta" href="${to}">`), `${p}: mobile bar`);
      assert.match(h, new RegExp(`<a class="btn btn-primary head-cta" href="${to}"`), `${p}: header`);
      assert.doesNotMatch(h, /href="(\/es)?\/?#contact"[^>]*>(<span[^>]*>)?(Book a free|Agenda una llamada|Llamada gratis)/, `${p}: a booking CTA still points to the form`);
    }
    for (const lang of ["en", "es"]) {
      const h = await (await get(lang === "es" ? "/es/" : "/")).text();
      assert.ok(h.includes(`<a class="btn btn-primary" href="${BOOK[lang]}" data-i18n="ctaLong">`), `hero ${lang}`);
      assert.ok(h.includes('<form'), "the home-page form stays");
    }
  });
  await check("privacy policy lists Cal.com in both languages", async () => {
    assert.match(await (await get("/privacy/")).text(), /<tr><td>Cal\.com<\/td><td>Scheduling[^<]*<\/td><td>Your name, email address and your answers to the booking questions<\/td><\/tr>/);
    assert.match(await (await get("/es/privacidad/")).text(), /<tr><td>Cal\.com<\/td><td>Agenda[^<]*<\/td><td>Tu nombre, tu correo y tus respuestas a las preguntas de la reserva<\/td><\/tr>/);
  });

  console.log("exam calendar (site-exams secret, filled by the server)");
  const fsx = require("node:fs");
  const examCal = require("../exam-calendar.js");
  const bundled = JSON.parse(fsx.readFileSync("data/exams/2026-27.json", "utf8"));
  const EXAMS = [
    { en: "/exams/", es: "/es/examenes/", title: ["Florida exam calendar 2026–27 | Jose Diaz Tutoring", "Calendario de exámenes de Florida 2026–27 | Jose Diaz Tutoring"],
      desc: ["Florida test dates for 2026–27: Algebra 1 and Geometry EOC, SAT, ACT, AP and college finals. Pick your student's grade to see what matters and when.",
        "Fechas de exámenes en Florida 2026–27: EOC de Álgebra 1 y Geometría, SAT, ACT, AP y finales universitarios. Elige el grado y mira qué importa."] },
    { en: "/exams/algebra-1-eoc/", es: "/es/examenes/eoc-algebra-1/", guide: true,
      title: ["Algebra 1 EOC: passing score, dates and how to prepare | Jose Diaz Tutoring", "EOC de Álgebra 1: nota para aprobar, fechas y cómo prepararse | Jose Diaz Tutoring"],
      desc: ["Florida Algebra 1 EOC: passing score 400, 2026–27 testing windows, other scores that meet the requirement, and free official practice.",
        "EOC de Álgebra 1 en Florida: se aprueba con 400, períodos 2026–27, otras notas que cumplen el requisito y práctica oficial gratis."] },
  ];
  app._setExamsToday(() => "2026-11-19");
  const examHtml = {};
  for (const page of EXAMS) {
    for (const [i, lang] of ["en", "es"].entries()) {
      const p = page[lang];
      const r = await get(p);
      const h = await r.text();
      examHtml[p] = h;
      Object.assign(all, { [p]: h });
      await check(`${p}: 200, cached 10 min, head, toggle, footer`, () => {
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), p === "/exams/" ? "private, no-cache" : "private, max-age=600");
        assert.equal(r.headers.get("vary"), p === "/exams/" ? "Cookie" : null);
        assert.ok(h.includes("/* lang-switch:start"), "toggle script");
        assert.ok(r.headers.get("strict-transport-security"));
        assert.match(h, new RegExp(`<html lang="${lang}">`));
        assert.equal(decode(h.match(/<title>([^<]*)<\/title>/)[1]), page.title[i]);
        assert.equal(decode(h.match(/<meta name="description" content="([^"]*)"/)[1]), page.desc[i]);
        assert.ok(h.includes(`<link rel="canonical" href="https://josediaztutoring.com${p}">`));
        for (const [hl, u] of [["en", page.en], ["es", page.es], ["x-default", page.en]])
          assert.ok(h.includes(`<link rel="alternate" hreflang="${hl}" href="https://josediaztutoring.com${u}">`), hl);
        assert.ok(h.includes(`<meta property="og:url" content="https://josediaztutoring.com${p}">`));
        assert.ok(h.includes('<meta property="og:image" content="https://josediaztutoring.com/og-image.png">'));
        assert.ok(h.includes('<meta name="twitter:card" content="summary_large_image">'));
        assert.ok(h.slice(0, h.indexOf("<title>")).includes("'dataLayer','GTM-TG7DX6ZB')"), "GTM missing");
        assert.ok(h.includes(`<a href="${page.en}" hreflang="en"`) && h.includes(`<a href="${page.es}" hreflang="es"`), "EN/ES toggle");
        assert.match(h, /<a class="wa-float wa-link" id="wa-float"[^>]*aria-label="[^"]+"/);
        assert.ok(h.includes(lang === "es" ? "SAT, AP y PSAT/NMSQT son marcas registradas de College Board." : "SAT, AP and PSAT/NMSQT are trademarks registered by College Board."), "trademark line");
        assert.ok(h.includes(lang === "es" ? "Servicio independiente de tutorías." : "Independent tutoring service."), "independence line");
        assert.ok(!/\{\{x:[\w.-]+\}\}/.test(h), "unfilled token");
        assert.ok(!h.includes("data-price") && !/\$(65|90|110|40|429|899|1,099)\b/.test(visible(h)), "a price on an exam page");
        if (page.guide) assert.match(h, /<body data-exam="alg1">/);
      });
      await check(`${p}: JSON-LD (BreadcrumbList${page.guide ? ", FAQPage word for word" : ""}, no Event)`, () => {
        const blocks = [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        assert.deepEqual(blocks.map((b) => b["@type"]), page.guide ? ["BreadcrumbList", "FAQPage"] : ["BreadcrumbList"]);
        assert.ok(!/"Event"/.test(JSON.stringify(blocks)));
        const crumbs = blocks[0].itemListElement;
        assert.equal(crumbs[crumbs.length - 1].item, `https://josediaztutoring.com${p}`);
        assert.equal(crumbs[0].item, `https://josediaztutoring.com${lang === "es" ? "/es/" : "/"}`);
        const text = visible(h);
        for (const c of crumbs) assert.ok(text.includes(c.name), c.name);
        if (page.guide) {
          const faq = blocks[1].mainEntity;
          assert.equal(faq.length, 4);
          assert.equal(blocks[1].inLanguage, lang);
          for (const q of faq) {
            assert.ok(text.includes(q.name), q.name);
            assert.ok(text.includes(q.acceptedAnswer.text), q.acceptedAnswer.text);
          }
          assert.ok(faq[0].acceptedAnswer.text.includes(lang === "es" ? "420 en SAT Math" : "SAT Math 420"));
        }
      });
      await check(`${p}: data inlined (</ escaped) and server-rendered content`, () => {
        const m = h.match(/<script id="exam-data" type="application\/json">([\s\S]*?)<\/script>/);
        assert.ok(m, "no #exam-data");
        assert.ok(!m[1].includes("</"), "</ not escaped");
        assert.deepEqual(JSON.parse(m[1]), bundled);
        const t = visible(h);
        if (lang === "en") assert.ok(t.includes("Dates checked Nov 19, 2026") || t.includes("Sources, checked Nov 19, 2026"), "checked date");
        else assert.ok(t.includes("19 de noviembre de 2026"), "checked date");
        if (!page.guide) {
          // every date of the year, grouped by month, with type and source link
          const ledger = h.slice(h.indexOf('id="ledger"'), h.indexOf("</section>", h.indexOf('id="ledger"')));
          assert.equal((ledger.match(/<li class="row/g) || []).length, bundled.events.length);
          assert.equal((ledger.match(/class="ibtn" href="https:/g) || []).length, bundled.events.length);
          assert.ok(visible(ledger).includes(lang === "es" ? "Diciembre de 2026" : "December 2026"));
          const panel = h.slice(h.indexOf('id="audPanel"'), h.indexOf('id="graph"'));
          assert.equal((panel.match(/<li class="aud-item">/g) || []).length, bundled.exams.length);
          assert.equal((panel.match(/>(Read the guide|Ver la guía)</g) || []).length, 1, "guide link only for pageLive exams");
          assert.ok(panel.includes(lang === "es" ? 'href="/es/examenes/eoc-algebra-1/"' : 'href="/exams/algebra-1-eoc/"'));
          assert.ok(!/coming soon|pronto/i.test(visible(panel)));
          assert.match(h, /<svg id="yearsvg"[^>]*><title id="yeartitle">2026–27<\/title><\/svg>/);
          assert.ok(h.includes("<noscript><style>#graph,"), "graph hidden without JS");
        } else {
          assert.ok(t.includes(lang === "es" ? "Próxima oportunidad: invierno, del 30 de noviembre al 18 de diciembre." : "Next chance: winter window, Nov 30 – Dec 18."), "next window");
          assert.ok(t.includes(lang === "es" ? "Próximo período: Invierno, 30 nov – 18 dic" : "Next window: Winter, Nov 30 – Dec 18"), "status line");
          assert.equal((h.match(/<li( class="(past|now)")?><div class="w-name">/g) || []).length, 4, "four windows");
          assert.equal((h.match(/<div class="brk">/g) || []).length, bundled.exams[0].breaks.length, "field notes");
          assert.equal((h.match(/<i class="on"><\/i>/g) || []).length, 38, "waffle");
          assert.ok(h.includes('href="https://flfast.org/families.html"'), "resource link");
          assert.match(h, /<ul id="srcList"><li><a href="https:/);
          assert.match(h, /<svg aria-label="[^"]+400\.?" class="ruler" id="heroRuler" role="img" viewBox="0 0 640 150"><g /);
          assert.match(h, /<a class="btn btn-ghost" href="https:\/\/claude\.ai\/new" id="claudeBtn" rel="noopener" target="_blank">/);
        }
      });
    }
  }
  // the hub's full date list, one line per row: "Dec 5 Sat | SAT | Test day SAT"
  const rowLines = (h) => [...h.slice(h.indexOf('id="ledger"')).matchAll(/<li class="row[^"]*">([\s\S]*?)<\/li>/g)].map((m) => {
    const g = (re) => decode(((m[1].match(re) || [])[1] || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    return `${g(/<span class="mon">(.*?)<\/span>/)} ${g(/<span class="day">(.*?)<\/span>/)} ${g(/<span class="dow">(.*?)<\/span>/)} | ${g(/<p class="title">(.*?)<\/p>/)} | ${g(/<p class="meta">(.*?)<\/p>/)}`;
  });
  await check("exam pages: date notice in every slot, page language, server-rendered; contact links from CONFIG", () => {
    const N = bundled.notice;
    const slots = (h) => Object.fromEntries([...h.matchAll(/<span data-notice="(\w+)">([^<]*)<\/span>/g)].map((m) => [m[1], decode(m[2])]));
    for (const page of EXAMS) for (const lang of ["en", "es"]) {
      const h = examHtml[page[lang]], got = slots(h);
      const want = page.guide ? ["short", "claude", "checker", "title", "body", "report"] : ["short", "title", "body", "report"];
      assert.deepEqual(Object.keys(got).sort(), [...want].sort(), page[lang]);
      for (const k of want) assert.equal(got[k], N[k][lang], `${page[lang]} ${k}`);
      assert.match(h, /<p class="notice-short"><svg aria-hidden="true"/);
      assert.match(h, /<aside class="sheet notice[^"]*" aria-labelledby="notice-h-(hub|exam)">/);
      const report = h.match(/<p class="notice-report">([\s\S]*?)<\/p>/)[1];
      assert.ok(report.includes('href="https://wa.me/17868329107"') && report.includes('href="mailto:jose@josediaztutoring.com"'), report);
      assert.ok(report.includes(lang === "es" ? ">Correo</a>" : ">Email</a>"));
      assert.ok(!/class="[^"]*\bhl\b/.test(h.slice(h.indexOf("<main"), h.indexOf("<script id=\"exam-data\""))), "no highlighter in the server-rendered page");
    }
    // a data file without "notice" -> the fallback text
    const D = examCal.parse(JSON.stringify({ ...bundled, notice: undefined }));
    const f = examCal.fill(fsx.readFileSync("www/es/examenes.html", "utf8"), D, "2026-11-19");
    assert.ok(f.includes(examCal.NOTICE_FALLBACK.short.es) && f.includes("Una nota sobre estas fechas"));
  });
  await check("exam pages: spot-check dates against the JSON", () => {
    const rows = rowLines(examHtml["/exams/"]), rowsEs = rowLines(examHtml["/es/examenes/"]);
    for (const s of ["Dec 5 Sat | SAT | Test day SAT", "Dec 12 Sat | ACT | Test day ACT", "Nov 30 Mon | Algebra 1 and Geometry EOC, winter window | Testing window Nov 30 – Dec 18",
      "May 10 Mon | AP Calculus AB and BC, 8 a.m. | Test day AP Calculus and Precalculus"]) assert.ok(rows.includes(s), `${s}\n${rows.join("\n")}`);
    assert.ok(rowsEs.some((r) => r.startsWith("Dic 5 Sáb | SAT |")), rowsEs.join("\n"));
    const guide = visible(examHtml["/exams/algebra-1-eoc/"]);
    assert.ok(guide.includes("Nov 30 – Dec 18, 2026"));
  });
  await check("/exams/data.json: the live data, JSON, cached 10 min, noindex", async () => {
    const r = await get("/exams/data.json");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^application\/json/);
    assert.equal(r.headers.get("cache-control"), "public, max-age=600");
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
    assert.deepEqual(await r.json(), bundled);
  });
  for (const p of ["/exams", "/exams.html", "/exams/index.html", "/exams/algebra-1-eoc", "/exams/algebra-1-eoc.html", "/es/examenes", "/es/examenes/eoc-algebra-1", "/es/examenes/index.html"]) {
    const to = p.replace(/(\.html|\/index\.html)$/, "") + "/";
    await check(`${p} -> 301 ${to}`, async () => {
      const r = await get(p);
      assert.equal(r.status, 301);
      assert.equal(r.headers.get("location"), to);
    });
  }
  for (const p of ["/exams/foo", "/exams/algebra-1-eoc/foo", "/exams/geometry-eoc/", "/es/examenes/foo", "/examenes/", "/es/exams/"]) {
    await check(`${p} -> 404 html, noindex`, async () => {
      const r = await get(p);
      assert.equal(r.status, 404);
      assert.equal(r.headers.get("x-robots-tag"), "noindex");
      assert.match(await r.text(), /This page doesn't exist/);
    });
  }
  await check("every page with the main footer links to the exam calendar", async () => {
    for (const [p, h] of Object.entries(all)) {
      const foot = h.slice(h.indexOf('<footer class="site-foot">'));
      assert.ok(foot.includes(p.startsWith("/es/") ? '<a href="/es/examenes/"' : '<a href="/exams/"'), p);
    }
    const h404 = await (await get("/nope")).text();
    assert.ok(h404.includes('<a href="/exams/"') && h404.includes('<a href="/es/examenes/" lang="es">'));
  });
  await check("home: subject links to the exam pages, and no Algebra 2 EOC", () => {
    assert.ok(pages.en.includes('incl. <a href="/exams/algebra-1-eoc/">Florida EOC</a> prep (Algebra 1)'));
    assert.ok(pages.es.includes('<a href="/es/examenes/eoc-algebra-1/">EOC de Florida</a> (Álgebra 1)'));
    for (const q of ["g10", "g11", "college"]) {
      assert.ok(pages.en.includes(`href="/exams/?for=${q}"`), q);
      assert.ok(pages.es.includes(`href="/es/examenes/?for=${q}"`), q);
    }
  });
  await check("a changed site-exams secret shows up without a rebuild; invalid or missing -> bundled data", async () => {
    const changed = JSON.parse(JSON.stringify(bundled));
    const sat = changed.events.find((e) => e.id === "sat-dec");
    sat.start = "2026-12-06";
    changed.revision = bundled.revision + 1;
    const quiet = console.warn, loud = console.log, warnings = [];
    console.warn = (...a) => warnings.push(a.join(" "));
    console.log = () => {};
    try {
      app._setExamsSource(async () => JSON.stringify(changed));
      const rows = rowLines(await (await get("/exams/")).text());
      assert.ok(rows.includes("Dec 6 Sun | SAT | Test day SAT") && !rows.includes("Dec 5 Sat | SAT | Test day SAT"), "new date not shown");
      assert.equal((await (await get("/exams/data.json")).json()).revision, bundled.revision + 1);
      // cached: the secret is read once, then not again within 10 minutes
      let reads = 0;
      app._setExamsSource(async () => { reads++; return JSON.stringify(changed); });
      await get("/exams/"); await get("/es/examenes/"); await get("/exams/data.json");
      assert.equal(reads, 1, "secret read more than once within the cache window");
      const broken = JSON.parse(JSON.stringify(changed));
      broken.events[0].exam = "nope";
      for (const [what, src] of [["invalid JSON", async () => "{nope"], ["bad data", async () => JSON.stringify(broken)], ["missing", async () => ""], ["unreadable", async () => { throw new Error("HTTP 403"); }]]) {
        app._setExamsSource(src);
        const rows = rowLines(await (await get("/exams/")).text());
        assert.ok(rows.includes("Dec 5 Sat | SAT | Test day SAT"), `${what}: bundled data not served`);
        assert.equal((await (await get("/exams/data.json")).json()).revision, bundled.revision, what);
      }
      assert.ok(warnings.some((w) => /invalid/.test(w)) && warnings.some((w) => /not set/.test(w)) && warnings.some((w) => /couldn't read/.test(w)), "no warning logged");
    } finally {
      console.warn = quiet;
      console.log = loud;
      app._setExamsSource(async () => "");
    }
  });
  await check("exam data: fill works for every day of the school year (EN + ES)", () => {
    const tpl = ["www/exams.html", "www/es/examenes.html", "www/exams/algebra-1-eoc.html", "www/es/examenes/eoc-algebra-1.html"].map((f) => fsx.readFileSync(f, "utf8"));
    const D = examCal.parse(JSON.stringify(bundled));
    for (let d = new Date(Date.UTC(2026, 6, 1)); d <= new Date(Date.UTC(2027, 8, 30)); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      for (const t of tpl) assert.ok(!/\{\{x:[\w.-]+\}\}/.test(examCal.fill(t, D, day)), day);
    }
    const end = visible(examCal.fill(tpl[2], D, "2027-08-02"));
    assert.ok(end.includes("2027-28 windows coming soon") && end.includes("Next chance: the 2027-28 schedule."), "end-of-year text");
  });
  app._setExamsToday(null);

  await check("every internal link and #anchor resolves", async () => {
    const seen = new Map();
    const ids = (h) => new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [from, h] of Object.entries(all)) {
      for (const [, href] of h.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) { // not inside scripts
        if (/^(https?:|mailto:|tel:)/.test(href) || href === "#") continue;
        const [p, hash] = href.split("#");
        const target = p || from;
        if (!seen.has(target)) {
          let r;
          try { r = await get(target); } catch (e) { throw new Error(`${from}: ${href}: ${e.cause?.code || e.message}`); }
          seen.set(target, r.status === 200 ? await r.text() : r.status);
        }
        const t = seen.get(target);
        assert.equal(typeof t, "string", `${from}: ${href} -> ${t}`);
        if (hash) assert.ok(ids(t).has(hash), `${from}: ${href} -> no #${hash}`);
      }
    }
  });
  await check("sitemap lists all 14 pages, sitemap namespace only (hreflang lives in each page's <head>)", async () => {
    const xml = await (await get("/sitemap.xml")).text();
    assert.equal((xml.match(/<loc>/g) || []).length, 14);
    assert.doesNotMatch(xml, /xhtml|hreflang|changefreq|priority/);
    assert.deepEqual([...new Set(xml.match(/<\/?[a-z]+/g).map((t) => t.replace(/[<\/]/g, "")))].sort(), ["lastmod", "loc", "url", "urlset"]);
    assert.ok(xml.includes("<loc>https://josediaztutoring.com/es/terminos/</loc>"));
    for (const p of ["/exams/", "/es/examenes/", "/exams/algebra-1-eoc/", "/es/examenes/eoc-algebra-1/", "/book/", "/es/reservar/"])
      assert.match(xml, new RegExp(`<loc>https://josediaztutoring.com${p}</loc>\\n    <lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod>`), p);
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
