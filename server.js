/**
 * Booking-form endpoint for josediaztutoring.com.
 *
 * POST /api/contact (JSON) -> emails the request to Jose and a confirmation to
 * the client, through any SMTP server (Gmail by default).
 *
 * Pages: /, /es/ and /llms.txt are served here, with the prices filled in from
 * the JSON secret `site-pricing` (cached PRICING_TTL = 10 minutes; see
 * pricing.js). If the secret is missing or invalid, the built-in fallback
 * prices are used and a warning is logged; if filling fails, the built file
 * (which already holds the fallback prices) is sent as is. Every other page is
 * a static file (see app.yaml); any URL without a static handler reaches this
 * code and gets a 301 (/index.html, /es, /es/index.html, legal pages without
 * the trailing slash) or a real 404 page.
 *
 * Everything about the mail server lives in Secret Manager (never in this
 * repo), so it can be changed without a redeploy: values are re-read every
 * SECRET_TTL (5 minutes). The mail server is one JSON secret, `smtp-config`:
 *   {"user": "...", "password": "...", "host": "smtp.gmail.com", "port": 465,
 *    "secure": true, "from": "...", "ownerEmail": "..."}
 * Required keys:
 *   user        the SMTP login (for Gmail, the address that sends the mail)
 *   password    the SMTP password / App Password / API key
 * Optional keys (default in brackets):
 *   host        SMTP server [smtp.gmail.com]
 *   port        465 = implicit TLS, 587 = STARTTLS [465]
 *   secure      true = implicit TLS, false = STARTTLS (TLS still required)
 *               [true on port 465, false otherwise]
 *   from        the From address, if the login isn't an email address
 *               (e.g. SendGrid's "apikey") [user]
 *   ownerEmail  where requests go [the From address]
 * Other optional secrets (default in brackets):
 *   mail-ip-hourly-limit     form submissions per IP address per hour [20]
 *   mail-email-hourly-limit  form submissions per client email per hour [3]
 *   mail-daily-limit         form submissions per day in total [40]
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");
const pricingLib = require("./pricing.js");

const PORT = Number(process.env.PORT) || 8080;
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "";
const SITE_NAME = "Jose Diaz Tutoring";
const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
const LIMITS = { name: 100, email: 254, phone: 40, level: 60, course: 150, message: 4000 };
const MAX_BODY = 16 * 1024;

// --- secrets (Secret Manager REST API, token from the metadata server) -------
// Cached for SECRET_TTL so a changed value takes effect without a redeploy. If
// a refresh fails, the last good value keeps being used. Values put straight
// into `secrets` (the dev server's stubs) never expire.
const SECRET_TTL = 5 * 60e3;
const secrets = new Map();
const fetchedAt = new Map();

async function accessToken() {
  const r = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!r.ok) throw new Error(`metadata token: HTTP ${r.status}`);
  return (await r.json()).access_token;
}

async function fetchSecret(name, required) {
  const url = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}/versions/latest:access`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (r.ok) return Buffer.from((await r.json()).payload.data, "base64").toString("utf8").trim();
  // An optional secret that doesn't exist reads as 403, not 404, when access
  // is granted per secret, so both mean "not set" for optional secrets.
  if (!required && r.status === 404) return "";
  if (!required && r.status === 403) {
    // Either the secret doesn't exist, or it does and the app may not read it.
    // Say so: silently falling back to a default hides a missing IAM binding.
    console.warn(
      `Secret ${name}: permission denied (HTTP 403), using its default. If this secret exists, ` +
      "grant the app's service account roles/secretmanager.secretAccessor on it."
    );
    return "";
  }
  throw new Error(`secret ${name}: HTTP ${r.status}`);
}

async function secret(name, required = true) {
  if (secrets.has(name)) {
    const at = fetchedAt.get(name);
    if (at === undefined || Date.now() - at < SECRET_TTL) return secrets.get(name);
  }
  let value;
  try {
    value = await fetchSecret(name, required);
  } catch (err) {
    if (!secrets.has(name)) throw err;
    console.error(`Using cached ${name}; refresh failed:`, err.message);
    fetchedAt.set(name, Date.now()); // don't retry on every request
    return secrets.get(name);
  }
  secrets.set(name, value);
  fetchedAt.set(name, Date.now());
  return value;
}

function parseInt_(name, raw, def, min, max) {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}-${max}, got "${raw}"`);
  return n;
}

function parseBool(name, raw, def) {
  if (!raw) return def;
  const v = raw.toLowerCase();
  if (["true", "1", "yes"].includes(v)) return true;
  if (["false", "0", "no"].includes(v)) return false;
  throw new Error(`${name} must be true or false, got "${raw}"`);
}

/**
 * Parses an email address setting: "addr@x.com" or "Name <addr@x.com>" (the
 * name becomes the display name; default SITE_NAME). Returns { name, address },
 * or null when empty.
 */
function parseAddress(name, raw) {
  if (!raw) return null;
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^<>]+)>\s*$/);
  const address = (m ? m[2] : raw).trim();
  if (!EMAIL_RE.test(address) || /\s/.test(address)) {
    throw new Error(`${name} must be an email address like jose@example.com or "Name <jose@example.com>", got "${raw}"`);
  }
  return { name: (m && m[1].trim()) || SITE_NAME, address };
}

/**
 * The mail server settings, from the JSON secret `smtp-config` (see the top of
 * this file). Throws with a clear message if the secret is missing or invalid.
 */
const SMTP_KEYS = ["user", "password", "host", "port", "secure", "from", "ownerEmail"];
async function smtpConfig() {
  const raw = await secret("smtp-config");
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    throw new Error("secret smtp-config must be a JSON object (see README), and isn't valid JSON");
  }
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error("secret smtp-config must be a JSON object");
  const unknown = Object.keys(c).filter((k) => !SMTP_KEYS.includes(k));
  if (unknown.length) throw new Error(`smtp-config: unknown key(s) ${unknown.join(", ")}; allowed: ${SMTP_KEYS.join(", ")}`);
  const str = (k) => {
    const v = c[k];
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    throw new Error(`smtp-config.${k} must be a string`);
  };
  for (const k of ["user", "password"]) if (!str(k)) throw new Error(`smtp-config.${k} is required`);
  const port = parseInt_("smtp-config.port", str("port"), 465, 1, 65535);
  if (!str("from") && !EMAIL_RE.test(str("user"))) {
    throw new Error(`smtp-config.from is required: user "${str("user")}" isn't an email address`);
  }
  const from = parseAddress("smtp-config.from", str("from")) || parseAddress("smtp-config.user", str("user"));
  return {
    host: str("host") || "smtp.gmail.com",
    port,
    secure: parseBool("smtp-config.secure", str("secure"), port === 465),
    user: str("user"),
    password: String(c.password), // untrimmed: a password may legitimately have spaces at the ends
    from,
    owner: parseAddress("smtp-config.ownerEmail", str("ownerEmail")) || from,
  };
}

// A bad limit value is logged and replaced by its default: it shouldn't stop bookings.
async function limit(name, def) {
  try {
    return parseInt_(name, await secret(name, false), def, 1, 100000);
  } catch (err) {
    console.error(`Using ${name} = ${def}:`, err.message);
    return def;
  }
}

async function limits() {
  return {
    ip: await limit("mail-ip-hourly-limit", 20),       // per IP address per hour
    email: await limit("mail-email-hourly-limit", 3),  // per client email per hour
    day: await limit("mail-daily-limit", 40),          // in total per day
  };
}

// --- abuse limits (in memory; app.yaml keeps this to one instance) -----------
// A school or university shares one IP among many students, so the IP limit is
// generous; the per-email limit is what stops one inbox from being flooded with
// confirmations, and the daily total caps everything (2 emails per request;
// keep it well under the provider's limit, e.g. Gmail ~500/day).
const HOUR = 3600e3;
const DAY = 86400e3;
const byIp = new Map();
const byEmail = new Map();
let all = [];

function recent(map, key, now) {
  const q = (map.get(key) || []).filter((t) => now - t < HOUR);
  if (q.length) map.set(key, q);
  else map.delete(key);
  return q;
}

function sweep(map, now) {
  if (map.size < 5000) return;
  for (const key of [...map.keys()]) recent(map, key, now);
}

function allowed(ip, email, max = { ip: 20, email: 3, day: 40 }) {
  const now = Date.now();
  sweep(byIp, now);
  sweep(byEmail, now);
  email = email.toLowerCase();
  const qi = recent(byIp, ip, now);
  const qe = recent(byEmail, email, now);
  all = all.filter((t) => now - t < DAY);
  if (qi.length >= max.ip || qe.length >= max.email || all.length >= max.day) return false;
  byIp.set(ip, [...qi, now]);
  byEmail.set(email, [...qe, now]);
  all.push(now);
  return true;
}

// --- email -------------------------------------------------------------------
const LABELS = {
  en: { name: "Name", email: "Email", phone: "Phone", level: "Level", course: "Course", message: "Message" },
  es: { name: "Nombre", email: "Correo", phone: "Teléfono", level: "Nivel", course: "Curso", message: "Mensaje" },
};

const CONFIRM = {
  en: {
    subject: "I got your tutoring request",
    body: (v) =>
      `Hi ${v.name},\n\n` +
      "Thanks for reaching out. I received your request for a free 20-minute intro " +
      "and I'll reply within one business day to set up a time.\n\n" +
      `Level: ${v.level}\nCourse: ${v.course}\n\n` +
      "If you need to add anything, just reply to this email.\n\n" +
      "Jose Diaz\nhttps://josediaztutoring.com\n" +
      "\n-- \n" +
      "Jose Diaz Tutoring · Broward & Miami-Dade · Online anywhere\n" +
      "You're receiving this because you sent a request on josediaztutoring.com.\n" +
      "Privacy Policy: https://josediaztutoring.com/privacy/\n" +
      "Terms: https://josediaztutoring.com/terms/\n",
  },
  es: {
    subject: "Recibí tu solicitud de tutoría",
    body: (v) =>
      `Hola ${v.name}:\n\n` +
      "Gracias por escribirme. Recibí tu solicitud para una intro gratis de 20 minutos " +
      "y te respondo en un día hábil para coordinar el horario.\n\n" +
      `Nivel: ${v.level}\nCurso: ${v.course}\n\n` +
      "Si quieres agregar algo, solo responde a este correo.\n\n" +
      "Jose Diaz\nhttps://josediaztutoring.com\n" +
      "\n-- \n" +
      "Jose Diaz Tutoring · Broward y Miami-Dade · En línea desde cualquier lugar\n" +
      "Recibes este correo porque enviaste una solicitud en josediaztutoring.com.\n" +
      "Política de privacidad: https://josediaztutoring.com/es/privacidad/\n" +
      "Términos: https://josediaztutoring.com/es/terminos/\n",
  },
};

const oneLine = (s) => s.split(/\s+/).filter(Boolean).join(" ");

async function buildMessages(d, lang) {
  const { from, owner } = await smtpConfig();
  const L = LABELS[lang];

  // To Jose: everything the client typed. Reply goes straight to the client.
  const lines = ["name", "email", "phone", "level", "course"]
    .filter((k) => d[k])
    .map((k) => `${L[k]}: ${oneLine(d[k])}`);
  if (d.message) lines.push(`\n${L.message}:\n${d.message}`);
  lines.push(`\n(Form language: ${lang.toUpperCase()})`);
  const toOwner = {
    from,
    to: owner,
    replyTo: { name: oneLine(d.name), address: d.email },
    subject: `New tutoring request: ${oneLine(d.name)}`,
    text: lines.join("\n"),
  };

  // To the client: a fixed confirmation. Their free-text message is NOT echoed,
  // so the form can't be used to send arbitrary text to arbitrary addresses.
  const c = CONFIRM[lang];
  const toClient = {
    from,
    to: d.email,
    replyTo: owner,
    subject: c.subject,
    text: c.body({
      name: oneLine(d.name).slice(0, 60),
      level: oneLine(d.level).slice(0, 60) || "-",
      course: oneLine(d.course).slice(0, 100) || "-",
    }),
  };
  return [toOwner, toClient];
}

async function send(messages) {
  const smtp = await smtpConfig();
  console.log(`Sending via ${smtp.host}:${smtp.port} (${smtp.secure ? "TLS" : "STARTTLS"})`);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure, // STARTTLS is mandatory: never send the password in clear text
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 20000,
  });
  try {
    for (const m of messages) await transport.sendMail(m);
  } finally {
    transport.close();
  }
}

// --- HTTP --------------------------------------------------------------------
function reply(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) tooLarge = true; // keep draining so we can still reply
      else chunks.push(c);
    });
    req.on("end", () =>
      tooLarge ? reject(Object.assign(new Error("too_large"), { status: 413 }))
               : resolve(Buffer.concat(chunks).toString("utf8"))
    );
    req.on("error", reject);
  });
}

async function contact(req, res) {
  let raw;
  try {
    raw = JSON.parse(await readBody(req));
  } catch (err) {
    if (err.status === 413) return reply(res, 413, { ok: false, error: "too_large" });
    return reply(res, 400, { ok: false, error: "bad_request" });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return reply(res, 400, { ok: false, error: "bad_request" });
  }

  // Honeypot: real visitors never see or fill the "website" field.
  if (String(raw.website ?? "").trim()) return reply(res, 200, { ok: true });

  const d = {};
  for (const [k, n] of Object.entries(LIMITS)) d[k] = String(raw[k] ?? "").trim().slice(0, n);
  const lang = raw.lang === "es" ? "es" : "en";
  if (!d.name || !EMAIL_RE.test(d.email)) return reply(res, 400, { ok: false, error: "invalid" });

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (!allowed(ip, d.email, await limits())) return reply(res, 429, { ok: false, error: "rate_limited" });

  try {
    await send(await buildMessages(d, lang));
  } catch (err) {
    console.error("Failed to send booking email:", err);
    return reply(res, 502, { ok: false, error: "send_failed" });
  }
  console.log(JSON.stringify({ event: "booking_request", lang }));
  return reply(res, 200, { ok: true });
}

// --- prices (JSON secret site-pricing) ------------------------------------------------
// Cached for PRICING_TTL. Missing or invalid -> the fallback, with a warning. A failed
// refresh (network, Secret Manager down) keeps the last good value.
const PRICING_TTL = 10 * 60e3;
const PRICING_SECRET = "site-pricing";
let pricingSource = () => fetchSecret(PRICING_SECRET, false); // "" = not set; the dev server swaps this
let pricingCache = null; // { value, at }
let pricingLoad = null;

async function loadPricing() {
  let raw;
  try {
    raw = await pricingSource();
  } catch (err) {
    console.warn(`Pricing: couldn't read secret ${PRICING_SECRET} (${err.message}); using ${pricingCache ? "the last good prices" : "the fallback prices"}.`);
    return pricingCache ? pricingCache.value : pricingLib.FALLBACK;
  }
  if (!raw) {
    console.warn(`Pricing: secret ${PRICING_SECRET} is not set; using the fallback prices.`);
    return pricingLib.FALLBACK;
  }
  try {
    const value = pricingLib.parse(raw);
    if (!pricingCache || JSON.stringify(pricingCache.value) !== JSON.stringify(value)) {
      console.log(`Pricing: loaded ${PRICING_SECRET}: ${pricingLib.summary(value).replace(/\n/g, " | ")}`);
    }
    return value;
  } catch (err) {
    console.warn(`Pricing: secret ${PRICING_SECRET} is invalid (${err.message}); using the fallback prices.`);
    return pricingLib.FALLBACK;
  }
}

async function currentPricing() {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL) return pricingCache.value;
  pricingLoad ??= loadPricing()
    .then((value) => (pricingCache = { value, at: Date.now() }).value)
    .finally(() => (pricingLoad = null));
  return pricingLoad;
}

// --- pages: priced pages, redirects and the 404 page ----------------------------------
const PRICED = {
  "/": { file: "www/index.html", type: "text/html; charset=utf-8", fill: pricingLib.fillHtml },
  "/es/": { file: "www/es/index.html", type: "text/html; charset=utf-8", fill: pricingLib.fillHtml },
  "/llms.txt": { file: "www/llms.txt", type: "text/plain; charset=utf-8", fill: pricingLib.fillLlms },
};
const pageFiles = new Map(); // path -> built file (read once)
const rendered = new WeakMap(); // pricing value -> { path: filled page }

async function pricedPage(req, res, pathname) {
  const pg = PRICED[pathname];
  if (!pageFiles.has(pathname)) pageFiles.set(pathname, fs.readFileSync(path.join(__dirname, pg.file), "utf8"));
  const built = pageFiles.get(pathname);
  let body = built;
  try {
    const p = await currentPricing();
    if (!rendered.has(p)) rendered.set(p, {});
    const cache = rendered.get(p);
    body = cache[pathname] ??= pg.fill(built, p);
  } catch (err) {
    console.error(`Pricing: couldn't fill ${pathname}, sending the built page (fallback prices):`, err.message);
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": pg.type,
    "Cache-Control": "public, max-age=600",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const REDIRECTS = { "/index.html": "/", "/es": "/es/", "/es/index.html": "/es/" };
// legal pages: /privacy, /privacy.html and /privacy/index.html -> /privacy/ (the slash URLs are static, see app.yaml)
for (const p of ["/privacy", "/terms", "/accessibility", "/es/privacidad", "/es/terminos", "/es/accesibilidad"]) {
  REDIRECTS[p] = REDIRECTS[`${p}.html`] = REDIRECTS[`${p}/index.html`] = `${p}/`;
}
let page404 = null;

function notFoundPage(req, res) {
  try {
    page404 ??= fs.readFileSync(path.join(__dirname, "www/404.html"));
  } catch {
    page404 = Buffer.from("<!doctype html><title>404</title><p>Page not found. <a href=\"/\">Home</a></p>");
  }
  res.writeHead(404, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=600",
    "X-Robots-Tag": "noindex",
  });
  res.end(req.method === "HEAD" ? undefined : page404);
}

function page(req, res, pathname, query) {
  const read = req.method === "GET" || req.method === "HEAD";
  let to = REDIRECTS[pathname];
  // old ?lang=es links -> /es/ (keeps ?topic=, the class picked in the hero)
  if ((pathname === "/" || pathname === "/index.html") && query.get("lang") === "es") {
    to = "/es/" + (query.get("topic") ? "?topic=" + encodeURIComponent(query.get("topic")) : "");
  }
  if (to && read) {
    res.writeHead(301, { ...SECURITY_HEADERS, Location: to, "Cache-Control": "public, max-age=3600" });
    return res.end();
  }
  if (PRICED[pathname] && read) {
    return pricedPage(req, res, pathname).catch((err) => {
      console.error(err);
      if (!res.headersSent) notFoundPage(req, res);
    });
  }
  return notFoundPage(req, res);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL("http://localhost" + (req.url || "/"));
  } catch {
    return notFoundPage(req, res);
  }
  if (!url.pathname.startsWith("/api/")) return page(req, res, url.pathname, url.searchParams);
  if (url.pathname !== "/api/contact") return reply(res, 404, { ok: false, error: "not_found" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { ok: false, error: "method_not_allowed" });
  }
  contact(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) reply(res, 500, { ok: false, error: "server_error" });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Listening on ${PORT}`);
    currentPricing().catch(() => {}); // warm the price cache before the first visitor
    smtpConfig().then(
      (c) => console.log(`SMTP server: ${c.host}:${c.port} (${c.secure ? "TLS" : "STARTTLS"})`),
      (err) => console.error("SMTP settings are invalid:", err.message)
    );
  });
}

module.exports = {
  server, secrets, smtpConfig, buildMessages, allowed, currentPricing,
  _setSend: (fn) => (send = fn),
  // dev server / tests: read prices from somewhere else; clear the 10-minute cache
  _setPricingSource: (fn) => { pricingSource = fn; pricingCache = null; },
  _clearPricingCache: () => { pricingCache = null; },
};
