/**
 * Prices for josediaztutoring.com: one source for the server (fills the live
 * pages), the build (writes the fallback values into the static HTML) and
 * scripts/set-pricing.sh (validates a file before it goes to Secret Manager).
 * No dependencies.
 *
 * The live values are the JSON secret `site-pricing` (see README, "Prices").
 * Everything shown on the page is derived from it, never typed by hand:
 *   per hour  = price / sessions   whole -> "$N/hour", else "about $round(N)/hour"
 *   save      = sessions x single rate - price
 *   badge %   = round(average over plans of (1 - price / (sessions x rate)) x 100)
 *   priceRange (JSON-LD) = "$min–$max" of the single-session rates
 *
 * In the HTML every derived value sits in <span data-price="KEY">…</span>:
 *   rate.<highSchool|college|engineering|groupPerStudent>     "$65"
 *   plan.<id>.price | .perHour | .save | .sessions            "$1,099", "about $92/hour", "$221", "12"
 *   badge                                                     "17%"
 * JSON-LD offers carry "@id": ".../#rate-<key>" or ".../#plan-<id>".
 *
 * Validate a file:  node pricing.js pricing.json
 */
"use strict";

const RATE_KEYS = ["highSchool", "college", "engineering", "groupPerStudent"];
// The page has one row per plan, with fixed labels, so the ids, levels and periods are fixed too.
const PLANS = {
  "hs-monthly": { level: "highSchool", period: "month" },
  "college-semester": { level: "college", period: "semester" },
  "engineering-semester": { level: "engineering", period: "semester" },
};

const FALLBACK = deepFreeze({
  currency: "USD",
  rates: { highSchool: 65, college: 90, engineering: 110, groupPerStudent: 40 },
  plans: [
    { id: "hs-monthly", level: "highSchool", sessions: 8, price: 429, period: "month" },
    { id: "college-semester", level: "college", sessions: 12, price: 899, period: "semester" },
    { id: "engineering-semester", level: "engineering", sessions: 12, price: 1099, period: "semester" },
  ],
});

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

// --- validation ---------------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Every problem with a pricing object (empty array = valid). */
function problems(p) {
  const out = [];
  const exactKeys = (o, keys, where) => {
    const extra = Object.keys(o).filter((k) => !keys.includes(k));
    const missing = keys.filter((k) => !(k in o));
    if (extra.length) out.push(`${where}: unknown key(s) ${extra.join(", ")}`);
    if (missing.length) out.push(`${where}: missing ${missing.join(", ")}`);
  };
  if (!isObj(p)) return ["pricing must be a JSON object"];
  exactKeys(p, ["currency", "rates", "plans"], "pricing");
  if (p.currency !== "USD") out.push(`currency must be "USD", got ${JSON.stringify(p.currency)}`);

  if (!isObj(p.rates)) out.push("rates must be an object");
  else {
    exactKeys(p.rates, RATE_KEYS, "rates");
    for (const k of RATE_KEYS) if (k in p.rates && !isInt(p.rates[k], 1, 10000)) out.push(`rates.${k} must be a whole number of dollars (1–10000), got ${JSON.stringify(p.rates[k])}`);
  }

  if (!Array.isArray(p.plans)) out.push("plans must be an array");
  else {
    const ids = p.plans.map((x) => isObj(x) && x.id);
    for (const id of Object.keys(PLANS)) if (ids.filter((x) => x === id).length !== 1) out.push(`plans: need exactly one "${id}"`);
    if (p.plans.length !== Object.keys(PLANS).length) out.push(`plans: need exactly ${Object.keys(PLANS).length} plans (${Object.keys(PLANS).join(", ")}), got ${p.plans.length}`);
    p.plans.forEach((x, i) => {
      const where = `plans[${i}]${isObj(x) && typeof x.id === "string" ? ` (${x.id})` : ""}`;
      if (!isObj(x)) return out.push(`${where} must be an object`);
      exactKeys(x, ["id", "level", "sessions", "price", "period"], where);
      const want = PLANS[x.id];
      if (!want) return out.push(`${where}: unknown id ${JSON.stringify(x.id)} (allowed: ${Object.keys(PLANS).join(", ")})`);
      if (x.level !== want.level) out.push(`${where}: level must be "${want.level}", got ${JSON.stringify(x.level)}`);
      if (x.period !== want.period) out.push(`${where}: period must be "${want.period}", got ${JSON.stringify(x.period)}`);
      if (!isInt(x.sessions, 1, 100)) out.push(`${where}: sessions must be a whole number 1–100, got ${JSON.stringify(x.sessions)}`);
      if (!isInt(x.price, 1, 100000)) out.push(`${where}: price must be a whole number of dollars (1–100000), got ${JSON.stringify(x.price)}`);
      const rate = isObj(p.rates) && p.rates[want.level];
      if (isInt(x.sessions, 1, 100) && isInt(x.price, 1, 100000) && Number.isInteger(rate) && x.price >= x.sessions * rate) {
        out.push(`${where}: price ${x.price} must be less than ${x.sessions} sessions x $${rate} = ${x.sessions * rate} (a plan has to save money)`);
      }
    });
  }
  return out;
}

/** Parses + validates a JSON string. Returns the pricing object or throws with every problem listed. */
function parse(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch (e) {
    throw new Error(`not valid JSON: ${e.message}`);
  }
  const errs = problems(p);
  if (errs.length) throw new Error(errs.join("; "));
  return deepFreeze(p);
}

// --- derived numbers --------------------------------------------------------------------
/** Everything the page shows, computed from a valid pricing object. */
function derive(p) {
  const plans = {};
  const pcts = [];
  for (const x of p.plans) {
    const rate = p.rates[x.level];
    const perHour = x.price / x.sessions;
    const full = x.sessions * rate;
    pcts.push((1 - x.price / full) * 100);
    plans[x.id] = { ...x, rate, perHour, perHourWhole: Number.isInteger(perHour), perHourRounded: Math.round(perHour), save: full - x.price, pct: (1 - x.price / full) * 100 };
  }
  const rates = Object.values(p.rates);
  return {
    rates: { ...p.rates },
    plans,
    badge: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
    priceRange: `$${Math.min(...rates)}–$${Math.max(...rates)}`,
  };
}

const money = (n) => "$" + n.toLocaleString("en-US");
const PER_HOUR = {
  en: (d) => (d.perHourWhole ? `${money(d.perHour)}/hour` : `about ${money(d.perHourRounded)}/hour`),
  es: (d) => (d.perHourWhole ? `${money(d.perHour)}/hora` : `unos ${money(d.perHourRounded)}/hora`),
};

/** The text for one data-price key, or throws for an unknown key. */
function value(key, d, lang) {
  let m;
  if ((m = key.match(/^rate\.(\w+)$/)) && m[1] in d.rates) return money(d.rates[m[1]]);
  if (key === "badge") return `${d.badge}%`;
  if ((m = key.match(/^plan\.([\w-]+)\.(price|perHour|save|sessions)$/)) && d.plans[m[1]]) {
    const x = d.plans[m[1]];
    return { price: money(x.price), perHour: PER_HOUR[lang](x), save: money(x.save), sessions: String(x.sessions) }[m[2]];
  }
  throw new Error(`unknown data-price key "${key}"`);
}

// --- filling pages ------------------------------------------------------------------------
const SITE = "https://josediaztutoring.com";
const LD_RE = /(<script type="application\/ld\+json" id="ld">\n)([\s\S]*?)(\n<\/script>)/;
const SPAN_RE = /(<span data-price="([^"]+)">)[^<]*(<\/span>)/g;
const ldJson = (data) => JSON.stringify(data, null, 1).replace(/</g, "\\u003c");

/** Sets the prices in a parsed JSON-LD graph (in place): offers by "@id", and priceRange. */
function applyLd(ld, p) {
  const d = derive(p);
  const biz = ld["@graph"].find((n) => n["@type"] === "ProfessionalService");
  if (!biz) throw new Error("JSON-LD: no ProfessionalService");
  biz.priceRange = d.priceRange;
  const seen = new Set();
  for (const offer of biz.hasOfferCatalog.itemListElement) {
    const m = String(offer["@id"] || "").match(/#(rate|plan)-([\w-]+)$/);
    if (!m) throw new Error(`JSON-LD: offer without a #rate-/#plan- @id: ${offer.name}`);
    seen.add(m[2]);
    if (m[1] === "rate") {
      if (!(m[2] in d.rates)) throw new Error(`JSON-LD: unknown rate ${m[2]}`);
      offer.price = d.rates[m[2]];
      offer.priceSpecification = { "@type": "UnitPriceSpecification", priceCurrency: p.currency, unitCode: "HUR", unitText: "HOUR", price: offer.price };
    } else {
      const x = d.plans[m[2]];
      if (!x) throw new Error(`JSON-LD: unknown plan ${m[2]}`);
      offer.price = x.price;
      offer.priceSpecification = x.period === "month"
        ? { "@type": "UnitPriceSpecification", priceCurrency: p.currency, unitCode: "MON", unitText: "MONTH", price: x.price }
        : { "@type": "PriceSpecification", priceCurrency: p.currency, price: x.price };
      // descriptions are the page text, which starts with the number of sessions
      offer.description = String(offer.description).replace(/^\d+/, String(x.sessions));
    }
    offer.priceCurrency = p.currency;
  }
  const want = [...RATE_KEYS, ...Object.keys(PLANS)];
  const missing = want.filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`JSON-LD: no offer for ${missing.join(", ")}`);
  return ld;
}

/** Fills every <span data-price> of a page (language from <html lang>). */
function fillSpans(html, p) {
  const lang = (html.match(/<html lang="(\w+)">/) || [])[1];
  if (!PER_HOUR[lang]) throw new Error(`fillSpans: unknown page language ${lang}`);
  const d = derive(p);
  let n = 0;
  const out = html.replace(SPAN_RE, (_, open, key, close) => (n++, `${open}${value(key, d, lang)}${close}`));
  if (!n) throw new Error("fillSpans: no data-price spans");
  return out;
}

/** A home page (en or es) with every price, per-hour figure, saving, the badge and the JSON-LD filled in. */
function fillHtml(html, p) {
  let out = fillSpans(html, p);
  if (!LD_RE.test(out)) throw new Error("fillHtml: JSON-LD block not found");
  out = out.replace(LD_RE, (_, a, json, b) => a + ldJson(applyLd(JSON.parse(json), p)) + b);
  return out;
}

/** The "## Rates" bullet list of llms.txt. */
function llmsRateLines(p) {
  const d = derive(p);
  const r = d.rates, hs = d.plans["hs-monthly"], co = d.plans["college-semester"], en = d.plans["engineering-semester"];
  const ph = (x) => PER_HOUR.en(x);
  return [
    `- High school, one-on-one: ${money(r.highSchool)} per hour`,
    `- College, one-on-one: ${money(r.college)} per hour`,
    `- Engineering courses, one-on-one: ${money(r.engineering)} per hour`,
    `- Group exam review: ${money(r.groupPerStudent)} per student, per hour (3–5 students from the same course, 2-hour session before a midterm or final)`,
    `- High school, monthly plan: ${money(hs.price)} for ${hs.sessions} sessions a month, same days and times each week (${ph(hs)}, save ${money(hs.save)})`,
    `- College, semester plan: ${money(co.price)} for ${co.sessions} one-on-one sessions scheduled around midterms and the final (${ph(co)}, save ${money(co.save)})`,
    `- Engineering, semester plan: ${money(en.price)} for ${en.sessions} one-on-one sessions in an engineering course (${ph(en)}, save ${money(en.save)})`,
    `- Plans save about ${d.badge}% compared with single sessions.`,
  ].join("\n");
}

/** llms.txt with the bullet list under "## Rates" regenerated. */
function fillLlms(txt, p) {
  const re = /(\n## Rates\n\n(?:[^\n]+\n)*?\n)((?:- [^\n]*\n)+)/;
  if (!re.test(txt)) throw new Error('fillLlms: no bullet list under "## Rates"');
  return txt.replace(re, (_, a) => a + llmsRateLines(p) + "\n");
}

/** A readable summary (for set-pricing.sh and the build log). */
function summary(p) {
  const d = derive(p);
  const lines = [`rates: high school ${money(d.rates.highSchool)}/h, college ${money(d.rates.college)}/h, engineering ${money(d.rates.engineering)}/h, group ${money(d.rates.groupPerStudent)}/student/h`];
  for (const x of Object.values(d.plans)) {
    lines.push(`${x.id}: ${x.sessions} sessions ${money(x.price)} -> ${PER_HOUR.en(x)} (${x.perHour.toFixed(2)}), save ${money(x.save)} (${x.pct.toFixed(2)}%)`);
  }
  lines.push(`badge: ${d.badge}%   priceRange: ${d.priceRange}`);
  return lines.join("\n");
}

module.exports = { FALLBACK, PLANS, RATE_KEYS, problems, parse, derive, value, applyLd, fillSpans, fillHtml, ldJson, fillLlms, llmsRateLines, summary, SITE };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node pricing.js pricing.json");
    process.exit(2);
  }
  try {
    const p = parse(require("node:fs").readFileSync(file, "utf8"));
    console.log(`${file}: valid\n${summary(p)}`);
  } catch (e) {
    console.error(`${file}: INVALID: ${e.message}`);
    process.exit(1);
  }
}
