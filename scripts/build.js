#!/usr/bin/env node
/**
 * Builds the Spanish page and the structured data. No dependencies.
 *
 *   Sources (edit these):  www/index.html   English page + CONFIG
 *                          i18n/es.js       Spanish text, keyed by data-i18n
 *   Outputs (generated):   www/es/index.html
 *                          the JSON-LD <script id="ld"> block inside www/index.html
 *                          www/sitemap.xml  (lastmod = build date)
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
const SITE = "https://josediaztutoring.com";
const URLS = { en: `${SITE}/`, es: `${SITE}/es/` };
const CHECK = process.argv.includes("--check");

const ES = require(path.join(ROOT, "i18n/es.js"));
let html = fs.readFileSync(SRC, "utf8");

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

let es = enHtml;
// inner HTML of data-i18n elements, last to first so offsets stay valid
for (const el of i18nElements(es).reverse()) es = es.slice(0, el.start) + ES[el.key] + es.slice(el.end);
es = es.replace(/<[^>]*\sdata-i18n-ph="([^"]+)"[^>]*>/g, (tag, k) => {
  if (!(k in ES)) fail(`i18n/es.js is missing placeholder ${k}`);
  return replaceOne(tag, /(\splaceholder=")[^"]*"/, (_, a) => `${a}${esc(ES[k])}"`, `placeholder for ${k}`);
});
es = es.replace(/<[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, spec) => {
  for (const pair of spec.split(";")) {
    const [attr, k] = pair.split(":");
    if (!(k in ES)) fail(`i18n/es.js is missing ${k}`);
    const re = new RegExp(`(\\s${attr}=")[^"]*"`);
    if (!re.test(tag)) fail(`${attr} not found on element with data-i18n-attr="${spec}"`);
    tag = tag.replace(re, (_, a) => `${a}${esc(ES[k])}"`);
  }
  return tag;
});

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

// --- sitemap --------------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const alt = (indent) =>
  ["en", "es"].map((l) => `${indent}<xhtml:link rel="alternate" hreflang="${l}" href="${URLS[l]}"/>`).join("\n") +
  `\n${indent}<xhtml:link rel="alternate" hreflang="x-default" href="${URLS.en}"/>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${["en", "es"].map((l) => `  <url>
    <loc>${URLS[l]}</loc>
    <lastmod>${today}</lastmod>
${alt("    ")}
  </url>`).join("\n")}
</urlset>
`;

// --- write ----------------------------------------------------------------------------
const outputs = [
  [SRC, enHtml],
  [OUT_ES, es],
];
let stale = [];
for (const [file, content] of outputs) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (old === content) continue;
  stale.push(path.relative(ROOT, file));
  if (!CHECK) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
// the sitemap only changes date when a page changed (or it doesn't exist yet)
const oldMap = fs.existsSync(SITEMAP) ? fs.readFileSync(SITEMAP, "utf8") : "";
const mapNeeded = !oldMap.includes("hreflang") || stale.length;
if (mapNeeded && oldMap !== sitemap) {
  stale.push("www/sitemap.xml");
  if (!CHECK) fs.writeFileSync(SITEMAP, sitemap);
}

if (CHECK) {
  if (stale.length) fail(`out of date, run \`npm run build\`: ${stale.join(", ")}`);
  console.log("build: up to date");
} else {
  console.log(stale.length ? `build: wrote ${stale.join(", ")}` : "build: nothing changed");
}
