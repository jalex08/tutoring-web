/**
 * Booking-form endpoint for josediaztutoring.com.
 *
 * POST /api/contact (JSON) -> emails the request to Jose and a confirmation to
 * the client, through any SMTP server (Gmail by default). The pages are
 * served as static files by App Engine (see app.yaml); any URL without a
 * static handler reaches this code and gets a 301 (/index.html, /es, /es/index.html) or a real 404 page.
 *
 * Everything about the mail server lives in Secret Manager (never in this
 * repo), so it can be changed without a redeploy: values are re-read every
 * SECRET_TTL (5 minutes). Required:
 *   smtp-user      the SMTP login (for Gmail, the address that sends the mail)
 *   smtp-password  the SMTP password / App Password / API key
 * Optional (default in brackets):
 *   smtp-host      SMTP server [smtp.gmail.com]
 *   smtp-port      465 = implicit TLS, 587 = STARTTLS [465]
 *   smtp-secure    "true" = implicit TLS, "false" = STARTTLS (TLS still
 *                  required) [true on port 465, false otherwise]
 *   smtp-from      the From address, if the login isn't an email address
 *                  (e.g. SendGrid's "apikey") [smtp-user]
 *   owner-email    where requests go [the From address]
 *   mail-daily-limit  max form submissions per day in total [40]
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");

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
  if (!required && [403, 404].includes(r.status)) return "";
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

async function smtpConfig() {
  const port = parseInt_("smtp-port", await secret("smtp-port", false), 465, 1, 65535);
  return {
    host: (await secret("smtp-host", false)) || "smtp.gmail.com",
    port,
    secure: parseBool("smtp-secure", await secret("smtp-secure", false), port === 465),
  };
}

async function dailyLimit() {
  try {
    return parseInt_("mail-daily-limit", await secret("mail-daily-limit", false), 40, 1, 100000);
  } catch (err) {
    console.error("Using a daily limit of 40:", err.message); // a bad limit shouldn't stop bookings
    return 40;
  }
}

// --- abuse limits (in memory; app.yaml keeps this to one instance) -----------
const PER_IP = { max: 3, ms: 3600e3 };   // 3 requests per IP per hour
// Requests per day in total come from the mail-daily-limit secret (default 40);
// keep it well under the provider's limit (2 emails each; Gmail allows ~500/day).
const DAY = 86400e3;
const byIp = new Map();
let all = [];

function allowed(ip, dailyMax = 40) {
  const now = Date.now();
  const q = (byIp.get(ip) || []).filter((t) => now - t < PER_IP.ms);
  all = all.filter((t) => now - t < DAY);
  if (q.length >= PER_IP.max || all.length >= dailyMax) {
    byIp.set(ip, q);
    return false;
  }
  q.push(now);
  all.push(now);
  byIp.set(ip, q);
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
      "Jose Diaz\nhttps://josediaztutoring.com\n",
  },
  es: {
    subject: "Recibí tu solicitud de tutoría",
    body: (v) =>
      `Hola ${v.name}:\n\n` +
      "Gracias por escribirme. Recibí tu solicitud para una intro gratis de 20 minutos " +
      "y te respondo en un día hábil para coordinar el horario.\n\n" +
      `Nivel: ${v.level}\nCurso: ${v.course}\n\n` +
      "Si quieres agregar algo, solo responde a este correo.\n\n" +
      "Jose Diaz\nhttps://josediaztutoring.com\n",
  },
};

const oneLine = (s) => s.split(/\s+/).filter(Boolean).join(" ");

async function buildMessages(d, lang) {
  const sender = (await secret("smtp-from", false)) || (await secret("smtp-user"));
  const owner = (await secret("owner-email", false)) || sender;
  const from = { name: SITE_NAME, address: sender };
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
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure, // STARTTLS is mandatory: never send the password in clear text
    auth: { user: await secret("smtp-user"), pass: await secret("smtp-password") },
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
  if (!allowed(ip, await dailyLimit())) return reply(res, 429, { ok: false, error: "rate_limited" });

  try {
    await send(await buildMessages(d, lang));
  } catch (err) {
    console.error("Failed to send booking email:", err);
    return reply(res, 502, { ok: false, error: "send_failed" });
  }
  console.log(JSON.stringify({ event: "booking_request", lang }));
  return reply(res, 200, { ok: true });
}

// --- pages: redirects and the 404 page ------------------------------------------
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
const REDIRECTS = { "/index.html": "/", "/es": "/es/", "/es/index.html": "/es/" };
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
  let to = REDIRECTS[pathname];
  // old ?lang=es links (in production "/" is static and handled in the page itself)
  if ((pathname === "/" || pathname === "/index.html") && query.get("lang") === "es") to = "/es/";
  if (to && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(301, { ...SECURITY_HEADERS, Location: to, "Cache-Control": "public, max-age=3600" });
    return res.end();
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
  server.listen(PORT, () => console.log(`Listening on ${PORT}`));
}

module.exports = { server, secrets, smtpConfig, buildMessages, allowed, _setSend: (fn) => (send = fn) };
