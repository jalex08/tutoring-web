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
 *                          www/privacy.html, www/terms.html, www/accessibility.html
 *                          www/es/privacidad.html, www/es/terminos.html, www/es/accesibilidad.html
 *                          in place: the JSON-LD block and footer year in www/index.html,
 *                                    the footer in www/404.html
 *                          www/exams.html, www/exams/algebra-1-eoc.html,
 *                          www/es/examenes.html, www/es/examenes/eoc-algebra-1.html
 *                                           exam calendar page templates, from pages/exams/
 *                                           (server.js fills them at request time, see below)
 *                          www/sitemap.xml  (lastmod = date the page's own content last changed)
 *                          www/llms.txt     its price lines (between the pricing markers)
 *                          seo/pending-indexnow.json  pages whose content differs from
 *                                    seo/published-pages.json (for scripts/indexnow.js)
 *
 * Dates: a page's "content" is its <title>, meta description and <main>, without scripts, the
 * shared WhatsApp button / motto band and the "Last updated" date itself; never the <head>,
 * GTM, header, footer, shared CSS or © year. The sitemap lastmod and the legal pages' "Last
 * updated" are the same date: the day that content last changed (America/New_York), taken from
 * seo/published-pages.json (committed) while the content hash matches. A changed page gets the
 * date from git: today if its source files have uncommitted content changes, else the date of
 * the last commit that changed its content (see gitDate). Exam pages: the later of that and the
 * date of the bundled exam data's current revision (its changelog).
 *
 *   npm run build -- --from-history   re-derive every date from git and rewrite
 *                                     seo/published-pages.json (needs a full clone)
 *
 * Prices: every price on the home pages and in llms.txt comes from pricing.js. The build writes
 * the built-in fallback values (pricing.FALLBACK) into the files; on App Engine, server.js
 * fills in the live values from the `site-pricing` secret when it serves them.
 *
 * Exam calendar: the data is one JSON file per school year (EXAM_DATA below). The build first runs
 * scripts/check-exams.js on it (errors stop the build, warnings only print), then writes it into each
 * exam page template as the fallback copy. On App Engine, server.js fills the templates' {{x:…}}
 * tokens and the data block from the `site-exams` secret at request time (exam-calendar.js), so a
 * date change needs no rebuild. See docs/exam-calendar.md.
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
const FROM_HISTORY = process.argv.includes("--from-history");

// Bundled exam data: the fallback when the site-exams secret is missing or invalid. Next school year:
// add data/exams/2027-28.json and change this one line (then build + deploy).
const EXAM_DATA = "data/exams/2026-27.json";
const examCal = require(path.join(ROOT, "exam-calendar.js"));

// the exam data is checked before anything else: errors stop the build, warnings only print
{
  const r = require("node:child_process").spawnSync(process.execPath, [path.join(ROOT, "scripts/check-exams.js"), path.join(ROOT, EXAM_DATA)], { encoding: "utf8" });
  process.stdout.write(r.stdout.replace(/^\n/, ""));
  process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`build: ${EXAM_DATA} has errors (see above)`);
    process.exit(1);
  }
}

const ES = require(path.join(ROOT, "i18n/es.js"));
const pricing = require(path.join(ROOT, "pricing.js"));
const LLMS = path.join(ROOT, "www/llms.txt");
let html = fs.readFileSync(SRC, "utf8");
// Dates ("Last updated", sitemap lastmod, footer year) are in Florida time, whatever the machine's time zone.
const TZ = "America/New_York";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); // YYYY-MM-DD

// Legal pages: English source, URL in each language. `strict`: no prices, no phone.
const LEGAL = [
  { id: "privacy", src: "pages/privacy.html", en: "/privacy/", es: "/es/privacidad/", strict: true },
  { id: "terms", src: "pages/terms.html", en: "/terms/", es: "/es/terminos/", strict: true, noPrices: true },
  { id: "accessibility", src: "pages/accessibility.html", en: "/accessibility/", es: "/es/accesibilidad/" },
];
// Exam calendar pages: English source (Spanish in i18n/es.js), URL in each language. Templates the server fills.
const EXAM_PAGES = [
  { id: "hub", src: "pages/exams/hub.html", en: "/exams/", es: "/es/examenes/" },
  { id: "alg1", src: "pages/exams/algebra-1-eoc.html", en: "/exams/algebra-1-eoc/", es: "/es/examenes/eoc-algebra-1/" },
];
// English path -> Spanish path, for links on the Spanish pages
const RESOURCES = { en: "/resources/", es: "/es/recursos/" }; // the library; its pages are rendered by server.js (resources.js)
const ES_PATH = { "/": "/es/", [RESOURCES.en]: RESOURCES.es, ...Object.fromEntries([...LEGAL, ...EXAM_PAGES].map((p) => [p.en, p.es])) };

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
// the visible phone and email in the footer's contact rows (static on the legal and 404 pages)
const rowText = (id) => ((html.match(new RegExp(`<li id="${id}">[\\s\\S]*?class="contact-detail">([^<]*)<`)) || [])[1] || "");
if (!String(CONFIG.phone).replace(/\D/g, "").endsWith(rowText("foot-tel").replace(/\D/g, "")) || !rowText("foot-tel")) fail(`footer phone text (${rowText("foot-tel")}) doesn't match CONFIG.phone (${CONFIG.phone})`);
if (isSet(CONFIG.email) && rowText("foot-mail") !== CONFIG.email) fail(`footer email text (${rowText("foot-mail")}) doesn't match CONFIG.email (${CONFIG.email})`);
// © year in the footer (static, so the pages need no script for it)
html = replaceOne(html, /(<span id="yr">)\d{4}(<\/span>)/, `$1${today.slice(0, 4)}$2`, "footer year");

// prices: the fallback values everywhere (the server swaps in the live ones)
const fill = (src, fn) => { try { return fn(src, pricing.FALLBACK); } catch (e) { fail(e.message); } };
html = fill(html, pricing.fillSpans);

// --- structured data --------------------------------------------------------------
function jsonld(lang, s) {
  const url = URLS[lang];
  const T = (k) => {
    if (s[k] === undefined) fail(`structured data needs "${k}" (${lang})`);
    return text(s[k]);
  };
  const person = `${SITE}/#jose`;
  const business = `${SITE}/#business`;
  // price and priceSpecification are set by pricing.applyLd (the same code the server uses)
  const offer = (id, nameKey, descKey, extra = {}) => ({
    "@type": "Offer",
    "@id": `${SITE}/#${id}`,
    name: T(nameKey),
    description: T(descKey),
    price: 0,
    priceCurrency: "USD",
    priceSpecification: {},
    itemOffered: { "@type": "Service", name: T(nameKey), provider: { "@id": person } },
    ...extra,
  });
  const subjects = ["hs1", "hs2", "hs3", "hs4", "hs5", "hs6", "u1", "u2", "u3", "u4", "e1", "e2", "e3", "e4"].map(T);
  // the MCAT subject, spelled out (the page shows it as "MCAT physics & math" + "Chem/Phys section, …")
  subjects.splice(10, 0, lang === "es" ? "Física y matemáticas del MCAT (sección Chem/Phys)" : "MCAT physics and math (Chem/Phys section)");
  // the FAQ questions in page order (word for word the same as the page)
  const faqKeys = [...html.matchAll(/<summary data-i18n="(q\d+)">/g)].map((m) => m[1]);
  if (!faqKeys.length) fail("no FAQ questions found");
  const faq = faqKeys.map((q) => q.slice(1)).map((i) => ({
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
    priceRange: "",
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
        offer("rate-highSchool", "r1t", "r1p"),
        offer("rate-college", "r3t", "r3p"),
        offer("rate-engineering", "r6t", "r6p"),
        offer("rate-groupPerStudent", "r5t", "r5p", {
          eligibleQuantity: { "@type": "QuantitativeValue", minValue: 3, maxValue: 5, unitText: lang === "es" ? "estudiantes" : "students" },
        }),
        offer("plan-hs-monthly", "r2t", "r2p"),
        offer("plan-college-semester", "r4t", "r4p"),
        offer("plan-engineering-semester", "r7t", "r7p"),
      ],
    },
  };
  if (isSet(CONFIG.email)) businessNode.email = CONFIG.email;

  const ld = {
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
  try { return pricing.applyLd(ld, pricing.FALLBACK); } catch (e) { fail(e.message); }
}

const ldBlock = (data) => `<script type="application/ld+json" id="ld">\n${pricing.ldJson(data)}\n</script>`;
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
    /\shreflang=/.test(tag) ? tag : tag.replace(/(\shref=")(\/[^"#?]*)(\?[^"#]*)?(#[^"]*)?"/, (m, a, p, q = "", h = "") => (p in ES_PATH ? `${a}${ES_PATH[p]}${q}${h}"` : m))
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
es = fill(es, pricing.fillSpans);

const esStrings = { ...ES };
for (const el of i18nElements(es)) esStrings[el.key] ??= es.slice(el.start, el.end);
es = replaceOne(es, LD_RE, () => ldBlock(jsonld("es", esStrings)), "JSON-LD block");
es = es.replace(
  "<!DOCTYPE html>\n",
  "<!DOCTYPE html>\n<!-- Generated by scripts/build.js from www/index.html + i18n/es.js. Edit those, then run `npm run build`. -->\n"
);

// the server's fill with the fallback values must change nothing in the built pages
for (const [name, page] of [["www/index.html", enHtml], ["www/es/index.html", es]]) {
  if (fill(page, pricing.fillHtml) !== page) fail(`${name}: filling it with the fallback prices changes it (pricing.js and build.js disagree)`);
}
const llms = fill(fs.readFileSync(LLMS, "utf8"), pricing.fillLlms);

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
    // the EN/ES toggle's click handler (saves the choice, keeps the section)
    langSwitch: between(page, "/* lang-switch:start", "/* lang-switch:end */", "language switch script", true),
    // exam pages only: the motto band (markup + CSS) and the fonts link with Kalam
    motto: between(page, '<figure class="wrap">', "</figure>", "motto band", true),
    mottoCss: between(page, "/* motto band */", "/* sections */", "motto CSS", true).replace(/\/\* sections \*\/$/, "").trim(),
    fonts: (page.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)" rel="stylesheet">/) || fail("fonts link not found in www/index.html"))[1],
  };
}
const PARTS = { en: parts(enHtml), es: parts(es) };

/** Footer without scripts: links whose CONFIG value is set are shown, the current page is marked. */
function staticFooter(footer, current) {
  for (const [id, url] of [["foot-gbp", CONFIG.googleBusinessProfile], ["foot-review", CONFIG.googleReview]]) {
    if (isSet(url)) footer = replaceOne(footer, new RegExp(`<li id="${id}" hidden><a href="#"`), `<li id="${id}"><a href="${esc(url)}"`, id);
  }
  // contact rows whose CONFIG value isn't set are left out (the home page's script removes them the same way)
  for (const [id, value] of [["foot-wa", CONFIG.whatsapp], ["foot-tel", CONFIG.phone], ["foot-mail", CONFIG.email], ["foot-li", CONFIG.linkedin]]) {
    if (!isSet(value)) footer = replaceOne(footer, new RegExp(`\\n *<li id="${id}">[\\s\\S]*?</li>`), "", `footer row ${id}`);
  }
  if (current) footer = replaceOne(footer, new RegExp(`<a href="${current}"`), `<a href="${current}" aria-current="page"`, `footer link to ${current}`);
  return footer;
}

// --- exam calendar pages ---------------------------------------------------------------------
const examData = examCal.parse(fs.readFileSync(path.join(ROOT, EXAM_DATA), "utf8"));
const EXAM_TM = "SAT, AP and PSAT/NMSQT are trademarks registered by College Board. ACT is a registered trademark of ACT Education Corp. MCAT is a registered trademark of the AAMC. None of them is affiliated with this site. Always confirm dates with the official source linked on each one.";
const clientJs = replaceOne(fs.readFileSync(path.join(ROOT, "pages/exams/exams.js"), "utf8").trim(), /__EXAM_STRINGS__/, () => JSON.stringify(examCal.STRINGS), "exam strings placeholder");
const examCss = fs.readFileSync(path.join(ROOT, "pages/exams/exams.css"), "utf8").trim();
const ldScript = (data) => `<script type="application/ld+json">\n${pricing.ldJson(data)}\n</script>`;
// days the build fills every template with, to prove the server can (start, mid-year, end, after the year)
const FILL_DAYS = [...new Set([today, examData.range.start, examData.checked, "2026-12-02", "2027-05-12", examData.range.end, "2027-08-02"])];

/** One exam page template in one language: the site's head, header, footer and scripts around pages/exams/*.html. */
function examPage(page, lang) {
  const P = PARTS[lang];
  let body = fs.readFileSync(path.join(ROOT, page.src), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  if (lang === "es") body = localizeLinks(translate(body));
  const meta = (name, required = true) => {
    const m = body.match(new RegExp(`<meta name="${name}" content="([^"]*)"[^>]*>\\n?`));
    if (!m) { if (required) fail(`${page.src}: <meta name="${name}"> missing`); return null; }
    body = body.replace(m[0], "");
    return m[1];
  };
  const title = meta("title"), desc = meta("description"), exam = meta("exam", false);
  body = replaceOne(body.trim(), /<!--site-motto-->/g, () => P.motto, "motto placeholder");
  // contact details from CONFIG, never typed in the page sources (no email link if CONFIG.email isn't set)
  const waUrl = `https://wa.me/${CONFIG.whatsapp}`;
  body = body.replace(/\{\{cfg:wa\}\}/g, waUrl).replace(/<!--notice-contact-->/g, () =>
    `<a class="wa-link" href="${waUrl}" target="_blank" rel="noopener">WhatsApp</a>` +
    (isSet(CONFIG.email) ? ` · <a href="mailto:${esc(CONFIG.email)}">${lang === "es" ? ES.footEmail : "Email"}</a>` : ""));
  if (/\{\{cfg:|<!--notice-contact-->/.test(body)) fail(`${page.src}: unfilled contact placeholder`);
  // the floating WhatsApp button sits inside <main>, like the legal pages
  body += `\n\n${P.wa.replace(" is-hidden", "")}`;

  const url = (l) => `${SITE}${page[l]}`;
  const header = P.header
    .replace('class="mark" href="#top"', `class="mark" href="${lang === "es" ? "/es/" : "/"}"`)
    .replace(/href="#([\w-]+)"/g, `href="${lang === "es" ? "/es/" : "/"}#$1"`)
    .replace(/href="\/" hreflang="en"/, `href="${page.en}" hreflang="en"`)
    .replace(/href="\/es\/" hreflang="es"/, `href="${page.es}" hreflang="es"`);
  let footer = staticFooter(P.footer, P.footer.includes(`<a href="${page[lang]}"`) ? page[lang] : null);
  footer = replaceOne(footer, /(<span data-i18n="footFine">[\s\S]*?<\/span>)/, (m) => `${m} <span>${lang === "es" ? ES.exmTm : EXAM_TM}</span>`, "footer fine print");

  // structured data, in the page's language: BreadcrumbList (all), FAQPage (guides, word for word)
  const crumbs = [...(body.match(/<nav class="crumbs"[\s\S]*?<\/nav>/) || fail(`${page.src}: no breadcrumb`))[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
  const ld = [{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((m, i) => {
      const href = (m[1].match(/href="([^"]+)"/) || [])[1];
      return { "@type": "ListItem", position: i + 1, name: text(m[1]), item: href ? SITE + href : url(lang) };
    }),
  }];
  const faq = [...body.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)];
  if (faq.length) {
    ld.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: url(lang),
      inLanguage: lang,
      mainEntity: faq.map((m) => ({ "@type": "Question", name: text(m[1]), acceptedAnswer: { "@type": "Answer", text: text(m[2]) } })),
    });
  }

  const html = `<!DOCTYPE html>
<!-- Generated by scripts/build.js from ${page.src}${lang === "es" ? " + i18n/es.js" : ""}, pages/exams/exams.{css,js} and the shared parts of www/index.html.
     Edit those, then run \`npm run build\`. The {{x:…}} tokens and the exam data are filled by server.js at request time. -->
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
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/og-image.png">
<meta name="theme-color" content="#1C4C9E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${P.fonts}" rel="stylesheet">
<style>
  ${P.css}
  ${P.mottoCss}
${examCss}
</style>
<noscript><style>#graph,#chkForm{display:none}.nojs-only{display:grid !important}</style></noscript>
${ld.map(ldScript).join("\n")}
</head>
<body${exam ? ` data-exam="${exam}"` : ""}>
${P.gtmBody}
${P.skip}

${header}

<main id="main">
${body}
</main>

${footer}

<script id="exam-data" type="application/json">${examCal.inlineJson(examData)}</script>
<script>
const LANG = "${lang}";
${P.analytics}
</script>
<script>
${P.langSwitch}
</script>
<script>
${clientJs}
</script>
</body>
</html>
`;
  // checks: the server can fill it (any day of the year), nothing is left unfilled, the text fits
  for (const day of FILL_DAYS) {
    let filled;
    try { filled = examCal.fill(html, examData, day); } catch (e) { fail(`${page.src} (${lang}): can't fill it for ${day}: ${e.message}`); }
    const left = filled.match(/.{0,60}\{\{x:[\w.-]+\}\}/);
    if (left) fail(`${page.src} (${lang}): unfilled token on ${day}: ${left[0]}`);
    const d = text(filled.match(/<meta name="description" content="([^"]*)"/)[1]);
    if (d.length > 155) fail(`${page.src} (${lang}): meta description is ${d.length} chars (max 155)`);
    for (const m of filled.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1]); } catch (e) { fail(`${page.src} (${lang}): JSON-LD invalid after filling: ${e.message}`); }
    }
  }
  const words = visibleText(body);
  if (/\$\s?\d/.test(words)) fail(`${page.src} (${lang}): no prices on the exam pages`);
  return html;
}

const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const longDate = (iso, lang) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString(lang === "es" ? "es-US" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const DATE_RE = /<time datetime="(\d{4}-\d\d-\d\d)">[^<]*<\/time>/;
const visibleText = (h) => text(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " "));

/** One legal page in one language. Returns { html, date, sections, ids }. `old` = the file as it is now,
 *  `twin` = the other language's section ids in order (each heading gets data-twin-id, for the EN/ES toggle). */
function legalPage(page, lang, twin) {
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
    const t = twin && twin[toc.length];
    toc.push(`<li><a href="#${id}">${h}</a></li>`);
    return `${open}<h2 id="${id}"${t ? ` data-twin-id="${t}"` : ""}>${h}</h2>`;
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
<script>
${P.langSwitch}
</script>
</body>
</html>
`;
  // the date is decided by the caller from the page's content (pageDate), the same as the sitemap lastmod
  return { render, sections: toc.length, ids: toc.map((li) => li.match(/href="#([^"]+)"/)[1]) };
}

// --- dates: content hash, published state, git history -----------------------------------
// seo/published-pages.json (committed): { url: { hash, lastmod[, changed, rev] } } as of the last
// successful IndexNow submission (written by scripts/indexnow.js, or by --from-history).
// hash = SHA-256 of the page's content (pageContent). lastmod = the sitemap date; exam pages also
// keep `changed` (their content date) and `rev` (the exam data revision).
const PUBLISHED = path.join(ROOT, "seo/published-pages.json");
const PENDING = path.join(ROOT, "seo/pending-indexnow.json");
const readJson = (f, dflt) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : dflt);
const published = FROM_HISTORY ? null : readJson(PUBLISHED, null);
const oldPending = FROM_HISTORY ? {} : Object.fromEntries(readJson(PENDING, []).map((p) => [p.url, p]));
const sha = (s) => require("node:crypto").createHash("sha256").update(s).digest("hex");

/** A page's own content: <title>, meta description and <main>, minus scripts, the shared WhatsApp
 *  button, the motto band (except on the home page, where it is that page's content), the "Last
 *  updated" date and the © year. Used for built pages and for the home page source in git history. */
function pageContent(h, { home = false } = {}) {
  const one = (re, what) => { const m = h.match(re); if (!m) fail(`page content: ${what} not found`); return m[0]; };
  let main = one(/<main id="main">[\s\S]*<\/main>/, "<main>")
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<a class="wa-float[\s\S]*?<\/a>/g, "")
    .replace(/<time datetime="\d{4}-\d\d-\d\d">[^<]*<\/time>|<time data-build-date><\/time>/g, "<time></time>")
    .replace(/(<span id="yr">)\d{4}(<\/span>)/g, "$1$2");
  if (!home) main = main.replace(/<figure class="wrap">[\s\S]*?<\/figure>/g, "");
  return [one(/<title>[^<]*<\/title>/, "<title>"), one(/<meta name="description" content="[^"]*">/, "meta description"), main.replace(/[ \t]+$/gm, "")].join("\n");
}

// git history (only for pages whose content isn't in seo/published-pages.json, and --from-history)
const git = (...a) => require("node:child_process").execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
let gitChecked = false;
function gitReady() {
  if (gitChecked) return;
  let shallow;
  try { shallow = git("rev-parse", "--is-shallow-repository").trim(); } catch (e) { fail(`dates need git history, and git failed: ${e.message.split("\n")[0]}`); }
  if (shallow !== "false") fail("dates need the full git history, but this clone is shallow. Run `git fetch --unshallow`, then build again.");
  gitChecked = true;
}
const floridaDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
/** A file at a commit (null if it didn't exist), or in the working tree (rev = null). */
function fileAt(rev, f) {
  if (rev === null) return fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), "utf8") : null;
  try { return git("show", `${rev}:${f}`); } catch { return null; }
}
const esAt = new Map();
function spanishAt(rev) {
  if (!esAt.has(rev)) {
    const src = fileAt(rev, "i18n/es.js");
    const mod = { exports: {} };
    if (src) vm.runInNewContext(src, { module: mod, exports: mod.exports });
    esAt.set(rev, mod.exports);
  }
  return esAt.get(rev);
}
/** The page's source files, and its source content at a revision: what pageContent covers, read
 *  from the sources (the Spanish pages: the English source + the i18n/es.js entries it uses). */
function sourcesOf(p) {
  if (p === "/" || p === "/es/") return { files: p === "/" ? ["www/index.html"] : ["www/index.html", "i18n/es.js"], src: "www/index.html", home: true, es: p === "/es/" };
  const page = [...LEGAL, ...EXAM_PAGES].find((x) => x.en === p || x.es === p);
  const es = page.es === p;
  return { files: es ? [page.src, "i18n/es.js"] : [page.src], src: page.src, home: false, es };
}
function sourceContent(p, rev) {
  const S = sourcesOf(p);
  const h = fileAt(rev, S.src);
  if (h === null) return null;
  const own = S.home ? pageContent(h, { home: true }) : h.replace(/^<!--[\s\S]*?-->\s*/, "").replace(/<script\b[\s\S]*?<\/script>/g, "");
  if (!S.es) return own;
  const ES_ = spanishAt(rev), keys = new Set(S.home ? ["metaTitle", "metaDesc"] : []);
  for (const m of own.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of own.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(";")) keys.add(pair.split(":")[1]);
  return own + "\n" + JSON.stringify([...keys].sort().map((k) => [k, ES_[k] ?? null]));
}
/** When the page's content last changed, from its source files: today if the working tree differs
 *  from HEAD, else the (Florida) date of the newest commit that changed it. */
function gitDate(p) {
  gitReady();
  const files = sourcesOf(p).files;
  const now = sourceContent(p, null);
  const log = git("log", "--format=%H %cI", "--", ...files).trim().split("\n").filter(Boolean).map((l) => l.split(" "));
  if (!log.length) return { date: today, basis: `${files.join(" + ")}: not committed yet` };
  if (now !== sourceContent(p, "HEAD")) return { date: today, basis: `${files.join(" + ")}: uncommitted change` };
  for (let i = 0; i < log.length; i++) {
    const [hash, iso] = log[i];
    const older = i + 1 < log.length ? sourceContent(p, log[i + 1][0]) : null;
    if (sourceContent(p, hash) !== older) return { date: floridaDate(iso), basis: `${hash.slice(0, 7)} ${files.join(" + ")}` };
  }
  fail(`${p}: no commit changed its content`);
}

// exam pages: the bundled data's current revision and its date (from the changelog)
const examRaw = JSON.parse(fs.readFileSync(path.join(ROOT, EXAM_DATA), "utf8"));
const examRev = examRaw.revision;
const examRevDate = ((examRaw.changelog || []).find((c) => c.revision === examRev) || {}).date;
if (!/^\d{4}-\d\d-\d\d$/.test(examRevDate || "")) fail(`${EXAM_DATA}: no changelog entry with a date for revision ${examRev}`);
const isExamPage = (p) => EXAM_PAGES.some((x) => x.en === p || x.es === p);

const lastmod = {}, basis = {}, pending = [], seed = {};
/** The date for page p whose built content hashes to `hash`: lastmod (sitemap, "Last updated"). */
function pageDate(p, hash) {
  const url = SITE + p, pub = published && published[url], op = oldPending[url];
  const exam = isExamPage(p);
  let changed;
  if (pub && pub.hash === hash) { changed = pub.changed || pub.lastmod; basis[p] = "seo/published-pages.json"; }
  else if (op && op.hash === hash) { changed = op.changed || op.lastmod; basis[p] = "earlier build (pending)"; }
  else { const g = gitDate(p); changed = g.date; basis[p] = g.basis; }
  const date = exam && examRevDate > changed ? examRevDate : changed;
  if (exam && examRevDate > changed) basis[p] += `; exam data revision ${examRev} (${examRevDate})`;
  const entry = exam ? { hash, lastmod: date, changed, rev: examRev } : { hash, lastmod: date };
  seed[url] = entry;
  if (!pub || pub.hash !== hash || (exam && pub.rev !== examRev)) pending.push({ url, ...entry });
  lastmod[p] = date;
  return date;
}

const outputs = [];
const readOld = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
// /privacy/ -> www/privacy.html, /es/privacidad/ -> www/es/privacidad.html (app.yaml maps the URL to the file)
const outFile = (p) => path.join(ROOT, "www", p.replace(/^\/|\/$/g, "") + ".html");
for (const page of LEGAL) {
  const built = {};
  const ids = { en: legalPage(page, "en").ids, es: legalPage(page, "es").ids }; // the headings' ids, for data-twin-id
  for (const lang of ["en", "es"]) {
    built[lang] = legalPage(page, lang, ids[lang === "en" ? "es" : "en"]);
    const date = pageDate(page[lang], sha(pageContent(built[lang].render("2000-01-01"))));
    outputs.push([outFile(page[lang]), built[lang].render(date)]);
  }
  if (built.en.sections !== built.es.sections) fail(`${page.src}: English has ${built.en.sections} sections, Spanish ${built.es.sections}`);
}

for (const page of EXAM_PAGES) {
  const built = { en: examPage(page, "en"), es: examPage(page, "es") };
  const tokens = (h) => [...new Set([...h.matchAll(examCal.TOKEN_RE)].map((m) => m[1]))].sort().join();
  if (tokens(built.en) !== tokens(built.es)) fail(`${page.src}: English and Spanish use different {{x:…}} tokens:\n  en ${tokens(built.en)}\n  es ${tokens(built.es)}`);
  for (const lang of ["en", "es"]) outputs.push([outFile(page[lang]), built[lang]]);
}

// --- 404 page: the site footer, in both languages -----------------------------------------
function footer404() {
  let f = staticFooter(PARTS.en.footer);
  f = replaceOne(f, /<h2 class="foot-h" data-i18n="footPolicies">Policies<\/h2>/,
    `<h2 class="foot-h">Policies <span lang="es">· ${ES.footPolicies}</span></h2>`, "404 policies heading");
  const esLinks = between(PARTS.es.footer, '<ul class="legal-links">', "</ul>", "Spanish policy links", true).replace('<ul class="legal-links">', '<ul class="legal-links" lang="es">');
  f = replaceOne(f, /(<ul class="legal-links">[\s\S]*?<\/ul>)/, `$1\n      ${esLinks}`, "404 policy links");
  f = replaceOne(f, /(<span data-i18n="footFine">[\s\S]*?<\/span>)/, `$1 <span lang="es">${ES.footFine}</span>`, "404 fine print");
  f = replaceOne(f, /(<a href="\/exams\/" data-i18n="footExams">[^<]*<\/a>)/, `$1 · <a href="/es/examenes/" lang="es">${ES.footExams}</a>`, "404 exam calendar link");
  f = replaceOne(f, /(<a href="\/resources\/" data-i18n="footResources">[^<]*<\/a>)/, `$1 · <a href="/es/recursos/" lang="es">${ES.footResources}</a>`, "404 resources link");
  return f;
}
let page404 = fs.readFileSync(PAGE404, "utf8");
// the same GTM <head> snippet (with the src -> utm_* script) as every other page
page404 = replaceOne(page404, /<!-- Google Tag Manager -->[\s\S]*?<!-- End Google Tag Manager -->/, () => PARTS.en.gtmHead, "404 GTM <head> snippet");
page404 = page404.replace(/(<!-- footer:start[^>]*-->\n)[\s\S]*?(<!-- footer:end -->)/, (_, a, b) => `${a}${footer404()}\n${b}`);
page404 = page404.replace(/(\/\* ---- footer-css:start[^\n]*\n)[\s\S]*?( {2}\/\* ---- footer-css:end ---- \*\/)/, (_, a, b) =>
  `${a}${PARTS.en.footerCss.replace(/^\/\* ---- footer-css:start[^\n]*\n/, "").replace(/\s*\/\* ---- footer-css:end ---- \*\/$/, "")}\n${b}`);
if (!page404.includes('<footer class="site-foot">') || !page404.includes(".site-foot{")) fail("www/404.html: footer markers missing");

// --- Resources: the shell for server-rendered pages, and the admin service's copy of the library ---
// www/resources-shell.json: per language, the site's parts (GTM, shared CSS, header, footer, scripts) and
// pages/resources/*.{css,js}, for lib/resources/render.js (used by server.js and the admin's preview).
// lib/resources/*.js and the shell are copied into admin/lib/ (the admin service deploys from admin/).
for (const [lang, page] of [["en", enHtml], ["es", es]]) {
  if (!page.includes('<section id="tools" class="tools-home" hidden>') || !page.includes("<!--resources:cards-->")) fail(`home page (${lang}): the "Free interactive tools" section or its <!--resources:cards--> marker is missing`);
}
function resourcesShell(lang) {
  const P = PARTS[lang], S = lang === "es" ? ES : enStrings;
  const lib = RESOURCES[lang];
  const header = replaceOne(P.header
    .replace('class="mark" href="#top"', `class="mark" href="${lang === "es" ? "/es/" : "/"}"`)
    .replace(/href="#([\w-]+)"/g, `href="${lang === "es" ? "/es/" : "/"}#$1"`)
    .replace(/href="\/" hreflang="en"/, `href="${RESOURCES.en}" hreflang="en"`)
    .replace(/href="\/es\/" hreflang="es"/, `href="${RESOURCES.es}" hreflang="es"`),
    new RegExp(`(<a href="${lib}" data-i18n="navResources")`), `$1 aria-current="page"`, "nav link to the library");
  const s = {};
  for (const k of ["ctaShort", "ctaMini", "ctaLong", "guarantee"]) {
    if (!S[k]) fail(`resources shell: no ${k} text (${lang})`);
    s[k] = S[k];
  }
  return {
    gtmHead: P.gtmHead, gtmBody: P.gtmBody, css: P.css, fonts: P.fonts, skip: P.skip,
    header, footer: staticFooter(P.footer), wa: P.wa.replace(" is-hidden", ""),
    analytics: P.analytics, langSwitch: P.langSwitch, s,
    resourcesCss: fs.readFileSync(path.join(ROOT, "pages/resources/resources.css"), "utf8").trim(),
    resourceJs: fs.readFileSync(path.join(ROOT, "pages/resources/resource.js"), "utf8").trim(),
    libraryJs: fs.readFileSync(path.join(ROOT, "pages/resources/library.js"), "utf8").trim(),
  };
}
const shellJson = JSON.stringify({ _: "Generated by scripts/build.js from www/index.html, i18n/es.js and pages/resources/. Edit those, then run `npm run build`.", en: resourcesShell("en"), es: resourcesShell("es") }, null, 1) + "\n";
outputs.push([path.join(ROOT, "www/resources-shell.json"), shellJson], [path.join(ROOT, "admin/lib/resources-shell.json"), shellJson]);
for (const f of fs.readdirSync(path.join(ROOT, "lib/resources")).filter((f) => f.endsWith(".js")).sort()) {
  const src = fs.readFileSync(path.join(ROOT, "lib/resources", f), "utf8");
  outputs.push([path.join(ROOT, "admin/lib/resources", f), `// GENERATED by scripts/build.js from lib/resources/${f}. Edit that file, then run \`npm run build\`.\n${src}`]);
}
// the config schema (lib/resources/configcheck.js reads it from admin/lib/ when deployed)
outputs.push([path.join(ROOT, "admin/lib/resource-config.schema.json"), fs.readFileSync(path.join(ROOT, "schemas/resource-config.schema.json"), "utf8")]);

// --- sitemap lastmod (home + exam pages; the legal pages got theirs above) ------------------
for (const [p, h] of [["/", enHtml], ["/es/", es]]) pageDate(p, sha(pageContent(h, { home: true })));
for (const [file, content] of outputs) {
  const p = "/" + path.relative(path.join(ROOT, "www"), file).replace(/\.html$/, "/");
  if (isExamPage(p)) pageDate(p, sha(pageContent(content)));
}
const pairs = [{ en: "/", es: "/es/" }, ...LEGAL, ...EXAM_PAGES];
for (const p of pairs.flatMap((x) => [x.en, x.es])) if (!lastmod[p]) fail(`no date for ${p}`);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pairs.flatMap((pair) => ["en", "es"].map((l) => `  <url>
    <loc>${SITE}${pair[l]}</loc>
    <lastmod>${lastmod[pair[l]]}</lastmod>
  </url>`)).join("\n")}
</urlset>
`;

// --- write ----------------------------------------------------------------------------
outputs.unshift([SRC, enHtml], [OUT_ES, es], [PAGE404, page404]);
outputs.push([SITEMAP, sitemap], [LLMS, llms]);
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
  fs.mkdirSync(path.dirname(PENDING), { recursive: true });
  const order = pairs.flatMap((x) => [x.en, x.es]).map((p) => SITE + p);
  if (FROM_HISTORY) {
    // the pages as they are now are the published ones (run this only when they're live)
    fs.writeFileSync(PUBLISHED, JSON.stringify(Object.fromEntries(order.map((u) => [u, seed[u]])), null, 2) + "\n");
    fs.writeFileSync(PENDING, "[]\n");
    console.log("build: dates re-derived from git history; wrote seo/published-pages.json\n");
    console.log("| URL | lastmod | based on |\n|---|---|---|");
    for (const u of order) console.log(`| ${u.slice(SITE.length)} | ${lastmod[u.slice(SITE.length)]} | ${basis[u.slice(SITE.length)]} |`);
  } else {
    fs.writeFileSync(PENDING, JSON.stringify(pending, null, 2) + "\n");
    console.log(`build: IndexNow pending: ${pending.length ? pending.map((p) => p.url.slice(SITE.length)).join(" ") : "none"}`);
  }
}
