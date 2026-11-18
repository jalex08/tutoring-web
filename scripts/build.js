#!/usr/bin/env node
/**
 * Builds the Spanish pages, the legal pages and the structured data. No dependencies.
 *
 *   Sources (edit these):  www/index.html   English home page + CONFIG, and the site's
 *                                           shared header, footer, CSS and analytics
 *                          pages/*.html     English legal pages (privacy, terms, accessibility)
 *                          pages/legal.css  their extra CSS
 *                          i18n/es.js       Spanish text, keyed by data-i18n
 *   Outputs (generated):   www/es/index.html
 *                          www/{privacy,terms,accessibility}/index.html
 *                          www/es/{privacidad,terminos,accesibilidad}/index.html
 *                          in place: the JSON-LD block and footer year in www/index.html,
 *                                    the footer in www/404.html
 *                          www/sitemap.xml  (lastmod = date the page last changed)
 *
 * The legal pages show a "Last updated" date: the build date of the last build that
 * changed the page's text, so it is the date of the first deploy with that text.
 *
 * Run: npm run build      Check only (exit 1 if outputs are stale): npm run build -- --check
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "www/index.html");
const OUT_ES = path.join(ROOT, "www/es/index.html");
const SITEMAP = path.join(ROOT, "www/sitemap.xml");
const PAGE404 = path.join(ROOT, "www/404.html");
const SITE = "https://josediaztutoring.com";
const URLS = { en: `${SITE}/`, es: `${SITE}/es/` };
const CHECK = process.argv.includes("--check");

const ES = require(path.join(ROOT, "i18n/es.js"));
let html = fs.readFileSync(SRC, "utf8");
const pad2 = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`; // local date

// Legal pages: English source, URL in each language. `strict`: no prices, no phone.
const LEGAL = [
  { id: "privacy", src: "pages/privacy.html", en: "/privacy/", es: "/es/privacidad/", strict: true },
  { id: "terms", src: "pages/terms.html", en: "/terms/", es: "/es/terminos/", strict: true, noPrices: true },
  { id: "accessibility", src: "pages/accessibility.html", en: "/accessibility/", es: "/es/accesibilidad/" },
];
// English path -> Spanish path, for links on the Spanish pages
const ES_PATH = { "/": "/es/", ...Object.fromEntries(LEGAL.map((p) => [p.en, p.es])) };

// --- small HTML helpers (the page is hand-written, so these stay simple) -------
function fail(msg) {
  console.error("build: " + msg);
  process.exit(1);
}

/** Every element with data-i18n="key": its tag, key and inner-HTML span. */
function i18nElements(src) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(src))) {
    const [open, tag, key] = m;
    const start = m.index + open.length;
    // find the matching close tag, allowing nested elements of the same tag
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    tagRe.lastIndex = start;
    let depth = 1, t;
    while (depth && (t = tagRe.exec(src))) depth += t[1] ? -1 : 1;
    if (depth) fail(`no closing </${tag}> for data-i18n="${key}"`);
    out.push({ key, start, end: t.index });
  }
  return out;
}

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const text = (h) => decode(h.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Replace exactly one match of `re` in `src`, or fail. */
function replaceOne(src, re, fn, what) {
  const n = (src.match(new RegExp(re.source, "g")) || []).length;
  if (n !== 1) fail(`expected 1 ${what}, found ${n}`);
  return src.replace(re, fn);
}

/** Strings shown on a page, by data-i18n key. */
function strings(src) {
  const s = {};
  for (const el of i18nElements(src)) s[el.key] ??= src.slice(el.start, el.end);
  return s;
}

// --- CONFIG (read from the page's own <script>, so there's one copy) --------------
const cfgSrc = html.match(/const CONFIG = (\{[\s\S]*?\n\});/);
if (!cfgSrc) fail("CONFIG not found in www/index.html");
const CONFIG = vm.runInNewContext(`(${cfgSrc[1]})`);
const isSet = (v) => typeof v === "string" && v.trim() !== "" && !/^\[.*\]$/.test(v.trim());
const telDigits = (html.match(/href="tel:\+?(\d+)"/) || [])[1];
if (telDigits !== String(CONFIG.phone).replace(/\D/g, "")) fail(`footer tel: link (${telDigits}) doesn't match CONFIG.phone (${CONFIG.phone})`);
const footMail = (html.match(/<footer[\s\S]*?href="mailto:([^"]+)"/) || [])[1];
if (isSet(CONFIG.email) && footMail !== CONFIG.email) fail(`footer mailto: link (${footMail}) doesn't match CONFIG.email (${CONFIG.email})`);
// © year in the footer (static, so the pages need no script for it)
html = replaceOne(html, /(<span id="yr">)\d{4}(<\/span>)/, `$1${now.getFullYear()}$2`, "footer year");

// --- structured data --------------------------------------------------------------
function price(src, key) {
  const at = src.indexOf(`data-i18n="${key}"`);
  const m = at >= 0 && src.slice(at).match(/\$(\d+)/);
  if (!m) fail(`no price found after ${key}`);
  return Number(m[1]);
}

function jsonld(lang, s) {
  const url = URLS[lang];
  const T = (k) => {
    if (s[k] === undefined) fail(`structured data needs "${k}" (${lang})`);
    return text(s[k]);
  };
  const person = `${SITE}/#jose`;
  const business = `${SITE}/#business`;
  const hourly = { "@type": "UnitPriceSpecification", priceCurrency: "USD", unitCode: "HUR", unitText: "HOUR" };
  const offer = (nameKey, descKey, spec, extra = {}) => ({
    "@type": "Offer",
    name: T(nameKey),
    description: T(descKey),
    price: price(html, nameKey),
    priceCurrency: "USD",
    priceSpecification: { ...spec, price: price(html, nameKey) },
    itemOffered: { "@type": "Service", name: T(nameKey), provider: { "@id": person } },
    ...extra,
  });
  const subjects = ["hs1", "hs2", "hs3", "hs4", "hs5", "hs6", "u1", "u2", "u3", "u4", "e1", "e2", "e3", "e4"].map(T);
  const faq = [1, 2, 3, 4, 5, 6].map((i) => ({
    "@type": "Question",
    name: T(`q${i}`),
    acceptedAnswer: { "@type": "Answer", text: T(`a${i}`) },
  }));

  const personNode = {
    "@type": "Person",
    "@id": person,
    name: "Jose Diaz",
    alternateName: "Jalex Diaz",
    jobTitle: s.jobTitle ? T("jobTitle") : "Math, physics and engineering tutor",
    url,
    image: `${SITE}/og-image.png`,
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: "Universidad Tecnológica de La Habana José Antonio Echeverría",
      alternateName: "CUJAE",
    },
    knowsAbout: subjects,
    knowsLanguage: ["en", "es"],
    sameAs: [CONFIG.linkedin],
  };
  if (isSet(CONFIG.engineeringDegree)) {
    personNode.hasCredential = {
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "degree",
      name: CONFIG.engineeringDegree,
      recognizedBy: { "@type": "CollegeOrUniversity", name: personNode.alumniOf.name },
    };
  }

  const businessNode = {
    "@type": "ProfessionalService",
    "@id": business,
    name: "Jose Diaz Tutoring",
    url,
    description: T("metaDesc"),
    telephone: CONFIG.phone,
    image: `${SITE}/og-image.png`,
    logo: `${SITE}/apple-touch-icon.png`,
    priceRange: "$40–$110",
    currenciesAccepted: "USD",
    areaServed: [
      { "@type": "AdministrativeArea", name: "Broward County, FL" },
      { "@type": "AdministrativeArea", name: "Miami-Dade County, FL" },
    ],
    availableLanguage: ["en", "es"],
    founder: { "@id": person },
    sameAs: [CONFIG.linkedin, CONFIG.googleBusinessProfile].filter(isSet),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: T("ratesTitle"),
      itemListElement: [
        offer("r1t", "r1p", hourly),
        offer("r3t", "r3p", hourly),
        offer("r6t", "r6p", hourly),
        offer("r5t", "r5p", hourly, {
          eligibleQuantity: { "@type": "QuantitativeValue", minValue: 3, maxValue: 5, unitText: lang === "es" ? "estudiantes" : "students" },
        }),
        offer("r2t", "r2p", { "@type": "UnitPriceSpecification", priceCurrency: "USD", unitCode: "MON", unitText: "MONTH" }),
        offer("r4t", "r4p", { "@type": "PriceSpecification", priceCurrency: "USD" }),
      ],
    },
  };
  if (isSet(CONFIG.email)) businessNode.email = CONFIG.email;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        name: "Jose Diaz Tutoring",
        url: `${SITE}/`,
        inLanguage: lang,
        publisher: { "@id": business },
      },
      businessNode,
      personNode,
      { "@type": "FAQPage", "@id": `${url}#faq`, url, inLanguage: lang, mainEntity: faq },
    ],
  };
}

const ldBlock = (data) =>
  `<script type="application/ld+json" id="ld">\n${JSON.stringify(data, null, 1).replace(/</g, "\\u003c")}\n</script>`;
const LD_RE = /<script type="application\/ld\+json" id="ld">[\s\S]*?<\/script>/;

// --- English page: refresh its JSON-LD block in place -------------------------------
const enStrings = strings(html);
enStrings.metaDesc = html.match(/<meta name="description" content="([^"]*)">/)[1];
enStrings.jobTitle = "Math, physics and engineering tutor";
const enHtml = replaceOne(html, LD_RE, () => ldBlock(jsonld("en", enStrings)), "JSON-LD block");

// --- Spanish page -------------------------------------------------------------------
const missing = Object.keys(enStrings).filter((k) => !["metaDesc", "jobTitle"].includes(k) && !(k in ES));
if (missing.length) fail(`i18n/es.js is missing: ${missing.join(", ")}`);

/** The Spanish version of an English page or fragment (every data-i18n* must be in i18n/es.js). */
function translate(src) {
  let out = src;
  // inner HTML of data-i18n elements, last to first so offsets stay valid
  for (const el of i18nElements(out).reverse()) {
    if (!(el.key in ES)) fail(`i18n/es.js is missing: ${el.key}`);
    out = out.slice(0, el.start) + ES[el.key] + out.slice(el.end);
  }
  out = out.replace(/<[^>]*\sdata-i18n-ph="([^"]+)"[^>]*>/g, (tag, k) => {
    if (!(k in ES)) fail(`i18n/es.js is missing placeholder ${k}`);
    return replaceOne(tag, /(\splaceholder=")[^"]*"/, (_, a) => `${a}${esc(ES[k])}"`, `placeholder for ${k}`);
  });
  out = out.replace(/<[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, spec) => {
    for (const pair of spec.split(";")) {
      const [attr, k] = pair.split(":");
      if (!(k in ES)) fail(`i18n/es.js is missing ${k}`);
      const re = new RegExp(`(\\s${attr}=")[^"]*"`);
      if (!re.test(tag)) fail(`${attr} not found on element with data-i18n-attr="${spec}"`);
      tag = tag.replace(re, (_, a) => `${a}${esc(ES[k])}"`);
    }
    return tag;
  });
  return out;
}

/** Spanish pages link to Spanish pages (links with hreflang, i.e. the language toggle, are left alone). */
function localizeLinks(src) {
  return src.replace(/<a\b[^>]*>/g, (tag) =>
    /\shreflang=/.test(tag) ? tag : tag.replace(/(\shref=")(\/[^"#]*)(#[^"]*)?"/, (m, a, p, h = "") => (p in ES_PATH ? `${a}${ES_PATH[p]}${h}"` : m))
  );
}

let es = localizeLinks(translate(enHtml));

const head = [
  [/<html lang="en">/, '<html lang="es">', "<html lang>"],
  [/<script id="legacy-lang">[^<]*<\/script>\n/, "", "legacy ?lang script"],
  [/<title>[^<]*<\/title>/, `<title>${esc(ES.metaTitle)}</title>`, "<title>"],
  [/(<meta name="description" content=")[^"]*"/, `$1${esc(ES.metaDesc)}"`, "meta description"],
  [/(<link rel="canonical" href=")[^"]*"/, `$1${URLS.es}"`, "canonical"],
  [/(<meta property="og:title" content=")[^"]*"/, `$1${esc(ES.metaTitle)}"`, "og:title"],
  [/(<meta property="og:description" content=")[^"]*"/, `$1${esc(ES.ogDesc)}"`, "og:description"],
  [/(<meta property="og:locale" content=")en_US"/, '$1es_US"', "og:locale"],
  [/(<meta property="og:locale:alternate" content=")es_US"/, '$1en_US"', "og:locale:alternate"],
  [/(<meta property="og:url" content=")[^"]*"/, `$1${URLS.es}"`, "og:url"],
  [/(data-lang="en") aria-current="page"/, "$1", "EN link"],
  [/(data-lang="es")>/, '$1 aria-current="page">', "ES link"],
];
for (const [re, to, what] of head) es = replaceOne(es, re, to, what);

const esStrings = { ...ES };
for (const el of i18nElements(es)) esStrings[el.key] ??= es.slice(el.start, el.end);
es = replaceOne(es, LD_RE, () => ldBlock(jsonld("es", esStrings)), "JSON-LD block");
es = es.replace(
  "<!DOCTYPE html>\n",
  "<!DOCTYPE html>\n<!-- Generated by scripts/build.js from www/index.html + i18n/es.js. Edit those, then run `npm run build`. -->\n"
);

// --- shared parts, taken from the built home pages ----------------------------------
/** The text between two marker strings (inclusive of neither unless `keep`), exactly once. */
function between(src, from, to, what, keep = false) {
  const a = src.indexOf(from), b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  if (a < 0 || b < 0 || src.indexOf(from, a + 1) >= 0) fail(`${what}: markers not found exactly once`);
  return keep ? src.slice(a, b + to.length) : src.slice(a + from.length, b);
}
function parts(page) {
  return {
    gtmHead: between(page, "<!-- Google Tag Manager -->", "<!-- End Google Tag Manager -->", "GTM <head> snippet", true),
    gtmBody: between(page, "<!-- Google Tag Manager (noscript) -->", "<!-- End Google Tag Manager (noscript) -->", "GTM <body> snippet", true),
    css: between(page, "/* ==== shared:start", "/* ==== shared:end ==== */", "shared CSS", true),
    footerCss: between(page, "/* ---- footer-css:start", "/* ---- footer-css:end ---- */", "footer CSS", true),
    skip: between(page, '<a class="skip"', "</a>", "skip link", true),
    header: between(page, '<header class="site-head">', "</header>", "header", true),
    footer: between(page, '<footer class="site-foot">', "</footer>", "footer", true),
    wa: between(page, '<a class="wa-float', "</a>", "WhatsApp button", true),
    analytics: between(page, "/* analytics:start", "/* analytics:end */", "analytics script", true),
  };
}
const PARTS = { en: parts(enHtml), es: parts(es) };

/** Footer without scripts: links whose CONFIG value is set are shown, the current page is marked. */
function staticFooter(footer, current) {
  for (const [id, url] of [["foot-gbp", CONFIG.googleBusinessProfile], ["foot-review", CONFIG.googleReview]]) {
    if (isSet(url)) footer = replaceOne(footer, new RegExp(`<li id="${id}" hidden><a href="#"`), `<li id="${id}"><a href="${esc(url)}"`, id);
  }
  if (current) footer = replaceOne(footer, new RegExp(`<a href="${current}"`), `<a href="${current}" aria-current="page"`, `footer link to ${current}`);
  return footer;
}

const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const longDate = (iso, lang) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString(lang === "es" ? "es-US" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const DATE_RE = /<time datetime="(\d{4}-\d\d-\d\d)">[^<]*<\/time>/;
const visibleText = (h) => text(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " "));

/** One legal page in one language. Returns { html, date, sections }. `old` = the file as it is now. */
function legalPage(page, lang, old) {
  const P = PARTS[lang];
  let body = fs.readFileSync(path.join(ROOT, page.src), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  if (lang === "es") body = localizeLinks(translate(body));
  const meta = (name) => {
    const m = body.match(new RegExp(`<meta name="${name}" content="([^"]*)"[^>]*>\\n?`));
    if (!m) fail(`${page.src}: <meta name="${name}"> missing`);
    body = body.replace(m[0], "");
    return m[1];
  };
  const title = meta("title"), desc = meta("description");
  if (text(desc).length > 155) fail(`${page.src} (${lang}): meta description is ${text(desc).length} chars (max 155)`);
  body = body.trim();

  // section ids + the table of contents (static HTML)
  const toc = [], ids = new Set(["main", "toc-title", "summary-title"]);
  body = body.replace(/(<section class="sec"[^>]*>\s*)<h2>([\s\S]*?)<\/h2>/g, (_, open, h) => {
    const id = slug(text(h));
    if (!id || ids.has(id)) fail(`${page.src} (${lang}): duplicate or empty section id "${id}"`);
    ids.add(id);
    toc.push(`<li><a href="#${id}">${h}</a></li>`);
    return `${open}<h2 id="${id}">${h}</h2>`;
  });
  if (!toc.length) fail(`${page.src}: no sections`);
  body = replaceOne(body, /<ol data-toc><\/ol>/, `<ol>\n      ${toc.join("\n      ")}\n    </ol>`, "table of contents");
  for (const [, id] of body.matchAll(/href="#([^"]*)"/g)) if (!ids.has(id)) fail(`${page.src} (${lang}): link to missing #${id}`);

  // content rules
  const words = visibleText(body);
  if (/\[[^\]]*\]/.test(words) || /class="confirm"/.test(body)) fail(`${page.src} (${lang}): placeholder text left: ${words.match(/\[[^\]]*\]/)}`);
  if (page.strict && /tel:|\b786\b|832-?9107/.test(body)) fail(`${page.src} (${lang}): no phone number on this page (email only)`);
  if (page.noPrices && /\$|\bUSD\b|dollar|d[oó]lar|\b\d+\s+(sessions|sesiones)\b/i.test(words)) fail(`${page.src} (${lang}): no prices, amounts or package sizes on this page`);

  const url = (l) => `${SITE}${page[l]}`;
  const header = P.header
    .replace('class="mark" href="#top"', `class="mark" href="${lang === "es" ? "/es/" : "/"}"`)
    .replace(/href="#([\w-]+)"/g, `href="${lang === "es" ? "/es/" : "/"}#$1"`)
    .replace(/href="\/" hreflang="en"/, `href="${page.en}" hreflang="en"`)
    .replace(/href="\/es\/" hreflang="es"/, `href="${page.es}" hreflang="es"`);
  const wa = P.wa.replace(" is-hidden", "");
  const fonts = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap";

  const render = (date) => `<!DOCTYPE html>
<!-- Generated by scripts/build.js from ${page.src}${lang === "es" ? " + i18n/es.js" : ""} and the shared parts of www/index.html. Edit those, then run \`npm run build\`. -->
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${P.gtmHead}
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url(lang)}">
<link rel="alternate" hreflang="en" href="${url("en")}">
<link rel="alternate" hreflang="es" href="${url("es")}">
<link rel="alternate" hreflang="x-default" href="${url("en")}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Jose Diaz Tutoring">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:locale" content="${lang}_US">
<meta property="og:locale:alternate" content="${lang === "en" ? "es" : "en"}_US">
<meta property="og:url" content="${url(lang)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="theme-color" content="#1C4C9E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fonts}" rel="stylesheet">
<style>
  ${P.css}
${fs.readFileSync(path.join(ROOT, "pages/legal.css"), "utf8").trim()}
</style>
</head>
<body>
${P.gtmBody}
${P.skip}

${header}

<main id="main">
${body.replace(/<time data-build-date><\/time>/, `<time datetime="${date}">${longDate(date, lang)}</time>`)}

${wa}
</main>

${staticFooter(P.footer, page[lang])}

<script>
const LANG = "${lang}";
${P.analytics}
</script>
</body>
</html>
`;
  // keep the date unless the page itself changed
  let date = today;
  const was = old && old.match(DATE_RE);
  if (was && old.replace(DATE_RE, "<time>") === render(today).replace(DATE_RE, "<time>")) date = was[1];
  return { html: render(date), date, sections: toc.length };
}

const outputs = [];
const lastmod = {}; // url path -> date
const readOld = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const outFile = (p) => path.join(ROOT, "www", p, "index.html");
for (const page of LEGAL) {
  const built = {};
  for (const lang of ["en", "es"]) {
    built[lang] = legalPage(page, lang, readOld(outFile(page[lang])));
    outputs.push([outFile(page[lang]), built[lang].html]);
    lastmod[page[lang]] = built[lang].date;
  }
  if (built.en.sections !== built.es.sections) fail(`${page.src}: English has ${built.en.sections} sections, Spanish ${built.es.sections}`);
}

// --- 404 page: the site footer, in both languages -----------------------------------------
function footer404() {
  let f = staticFooter(PARTS.en.footer);
  f = replaceOne(f, /<h2 class="foot-h" data-i18n="footPolicies">Policies<\/h2>/,
    `<h2 class="foot-h">Policies <span lang="es">· ${ES.footPolicies}</span></h2>`, "404 policies heading");
  const esLinks = between(PARTS.es.footer, '<ul class="legal-links">', "</ul>", "Spanish policy links", true).replace('<ul class="legal-links">', '<ul class="legal-links" lang="es">');
  f = replaceOne(f, /(<ul class="legal-links">[\s\S]*?<\/ul>)/, `$1\n      ${esLinks}`, "404 policy links");
  f = replaceOne(f, /(<span data-i18n="footFine">[\s\S]*?<\/span>)/, `$1 <span lang="es">${ES.footFine}</span>`, "404 fine print");
  return f;
}
let page404 = fs.readFileSync(PAGE404, "utf8");
page404 = page404.replace(/(<!-- footer:start[^>]*-->\n)[\s\S]*?(<!-- footer:end -->)/, (_, a, b) => `${a}${footer404()}\n${b}`);
page404 = page404.replace(/(\/\* ---- footer-css:start[^\n]*\n)[\s\S]*?( {2}\/\* ---- footer-css:end ---- \*\/)/, (_, a, b) =>
  `${a}${PARTS.en.footerCss.replace(/^\/\* ---- footer-css:start[^\n]*\n/, "").replace(/\s*\/\* ---- footer-css:end ---- \*\/$/, "")}\n${b}`);
if (!page404.includes('<footer class="site-foot">') || !page404.includes(".site-foot{")) fail("www/404.html: footer markers missing");

// --- sitemap --------------------------------------------------------------------------
const oldMap = readOld(SITEMAP) || "";
const oldLastmod = Object.fromEntries([...oldMap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]));
const homeChanged = (file, content) => readOld(file) !== content;
lastmod["/"] = homeChanged(SRC, enHtml) ? today : oldLastmod[URLS.en] || today;
lastmod["/es/"] = homeChanged(OUT_ES, es) ? today : oldLastmod[URLS.es] || today;
const pairs = [{ en: "/", es: "/es/" }, ...LEGAL];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pairs.flatMap((pair) => ["en", "es"].map((l) => `  <url>
    <loc>${SITE}${pair[l]}</loc>
    <lastmod>${lastmod[pair[l]]}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${pair.en}"/>
    <xhtml:link rel="alternate" hreflang="es" href="${SITE}${pair.es}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${pair.en}"/>
  </url>`)).join("\n")}
</urlset>
`;

// --- write ----------------------------------------------------------------------------
outputs.unshift([SRC, enHtml], [OUT_ES, es], [PAGE404, page404]);
outputs.push([SITEMAP, sitemap]);
const stale = [];
for (const [file, content] of outputs) {
  if (readOld(file) === content) continue;
  stale.push(path.relative(ROOT, file));
  if (!CHECK) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

if (CHECK) {
  if (stale.length) fail(`out of date, run \`npm run build\`: ${stale.join(", ")}`);
  console.log("build: up to date");
} else {
  console.log(stale.length ? `build: wrote ${stale.join(", ")}` : "build: nothing changed");
}
