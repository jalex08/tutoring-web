/**
 * Sign-in for the admin service: "Sign in with Google" done by the app itself (OAuth 2.0 / OpenID
 * Connect, authorization-code flow). App Engine can only put IAP in front of the WHOLE app (public site
 * included), so the admin can't rely on IAP.
 *
 *   GET /auth/login?next=/path   -> Google's sign-in (state + nonce in a short-lived cookie)
 *   GET /auth/callback           -> code exchanged with Google (with the client secret), ID token checked
 *                                   (aud, iss, exp, nonce, email_verified), email must be in ADMIN_EMAILS
 *                                   -> session cookie (12 h), back to `next`
 *   GET /auth/logout             -> cookie cleared
 *
 * Session cookie: __Host-jdt_admin = base64url({email, exp}).HMAC-SHA256, HttpOnly, Secure, SameSite=Lax,
 * key derived from the client secret (rotating the secret signs everyone out). Every request re-checks
 * the signature, the expiry and ADMIN_EMAILS.
 *
 * Config (admin.yaml): ADMIN_EMAILS, OAUTH_CLIENT_ID, ADMIN_BASE_URL (the redirect URI is
 * ADMIN_BASE_URL + /auth/callback; never taken from the Host header). The client secret is the
 * Secret Manager secret `admin-oauth-client-secret`.
 *
 * If a request does carry IAP's signed header (IAP turned on some day), iap.js verifies it instead.
 * Local only: DEV_NO_IAP=1 skips everything (refused on App Engine).
 */
"use strict";

const crypto = require("node:crypto");
const iap = require("./iap.js");

const SESSION_COOKIE = "__Host-jdt_admin";
const STATE_COOKIE = "__Host-jdt_oauth";
const SESSION_HOURS = 12;
const SECRET_NAME = "admin-oauth-client-secret";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

let fetchImpl = (...a) => fetch(...a); // tests swap it
let secretCache = null; // { value, at }

async function clientSecret(env = process.env) {
  if (env.OAUTH_CLIENT_SECRET) return env.OAUTH_CLIENT_SECRET; // tests / local only
  if (secretCache && Date.now() - secretCache.at < 10 * 60e3) return secretCache.value;
  const t = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!t.ok) throw new Error(`metadata token: HTTP ${t.status}`);
  const token = (await t.json()).access_token;
  const r = await fetchImpl(`https://secretmanager.googleapis.com/v1/projects/${env.GOOGLE_CLOUD_PROJECT}/secrets/${SECRET_NAME}/versions/latest:access`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`secret ${SECRET_NAME}: HTTP ${r.status} (create it and grant the App Engine service account Secret Accessor on it)`);
  const value = Buffer.from((await r.json()).payload.data, "base64").toString("utf8").trim();
  secretCache = { value, at: Date.now() };
  return value;
}

const b64 = (s) => Buffer.from(s).toString("base64url");
const unb64 = (s) => Buffer.from(String(s), "base64url").toString("utf8");
const hmac = (key, s) => crypto.createHmac("sha256", key).update(s).digest("base64url");
const sessionKey = (secret) => crypto.createHash("sha256").update(`jdt-admin-session:${secret}`).digest();

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const safeNext = (n) => (typeof n === "string" && /^\/(?![\/\\])[\x21-\x7e]*$/.test(n) && !n.startsWith("/auth/") ? n : "/");
const equal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function config(env = process.env) {
  const base = String(env.ADMIN_BASE_URL || "").replace(/\/+$/, "");
  const clientId = String(env.OAUTH_CLIENT_ID || "").trim();
  if (!/^https:\/\//.test(base)) throw new Error("ADMIN_BASE_URL is not set (admin.yaml)");
  if (!clientId) throw new Error("OAUTH_CLIENT_ID is not set (admin.yaml)");
  return { base, clientId, redirectUri: `${base}/auth/callback` };
}

/** The signed-in admin's email, or null (not signed in). Throws only for misconfiguration. */
async function sessionEmail(req, env = process.env) {
  if (env.DEV_NO_IAP === "1") {
    if (env.GAE_ENV || env.GAE_SERVICE) throw new Error("DEV_NO_IAP is not allowed on App Engine");
    return env.DEV_ADMIN_EMAIL || "dev@localhost";
  }
  if (req.headers["x-goog-iap-jwt-assertion"]) return iap.adminEmail(req, env);
  const raw = cookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !equal(sig, hmac(sessionKey(await clientSecret(env)), body))) return null;
  let s;
  try { s = JSON.parse(unb64(body)); } catch { return null; }
  if (!s || typeof s.exp !== "number" || s.exp < Date.now() / 1000) return null;
  const email = String(s.email || "").toLowerCase();
  return iap.allowedEmails(env).includes(email) ? email : null;
}

/**
 * CSRF token for the signed-in admin (sent back in the X-CSRF-Token header on every state-changing
 * /api/ call; the pages carry it in <meta name="csrf-token">). Bound to the session cookie, keyed with
 * the client secret, so it's the same on every instance and changes at every sign-in. Without a session
 * cookie (DEV_NO_IAP, IAP, tests) it's bound to the email with a per-process key.
 */
const PROCESS_KEY = crypto.randomBytes(32);
async function csrfToken(req, email, env = process.env) {
  const raw = cookies(req)[SESSION_COOKIE];
  if (raw && env.DEV_NO_IAP !== "1" && !req.headers["x-goog-iap-jwt-assertion"]) {
    const key = crypto.createHash("sha256").update(`jdt-admin-csrf:${await clientSecret(env)}`).digest();
    return hmac(key, `session|${raw}`);
  }
  return hmac(PROCESS_KEY, `email|${String(email || "").toLowerCase()}`);
}

/** Handles /auth/*. Returns true if it answered. `send(res, status, headers, body)`. */
async function route(req, res, url, send, env = process.env) {
  const p = url.pathname;
  if (!p.startsWith("/auth/")) return false;
  const html = (status, title, msg, extra = {}) => send(res, status, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", ...extra },
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
    `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32em;margin:12vh auto;padding:0 16px"><h1 style="font-size:1.4rem">${title}</h1><p>${msg}</p></body></html>`);

  if (p === "/auth/login") {
    const { clientId, redirectUri } = config(env);
    const state = crypto.randomBytes(18).toString("base64url"), nonce = crypto.randomBytes(18).toString("base64url");
    const next = safeNext(url.searchParams.get("next"));
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", state, nonce, prompt: "select_account" });
    const allow = iap.allowedEmails(env);
    if (allow.length === 1) q.set("login_hint", allow[0]);
    send(res, 302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "Set-Cookie": setCookie(STATE_COOKIE, b64(JSON.stringify({ state, nonce, next })), 600) }, "");
    return true;
  }

  if (p === "/auth/callback") {
    let saved;
    try { saved = JSON.parse(unb64(cookies(req)[STATE_COOKIE] || "")); } catch { saved = null; }
    const clear = setCookie(STATE_COOKIE, "", 0);
    if (url.searchParams.get("error")) { html(403, "Sign-in cancelled", `Google said: ${String(url.searchParams.get("error")).replace(/[^\w.-]/g, "")}. <a href="/auth/login">Try again</a>.`, { "Set-Cookie": clear }); return true; }
    if (!saved || !saved.state || !equal(saved.state, url.searchParams.get("state") || "")) {
      html(400, "Sign-in expired", 'The sign-in took too long or was started in another tab. <a href="/auth/login">Sign in again</a>.', { "Set-Cookie": clear });
      return true;
    }
    const { clientId, redirectUri } = config(env);
    const r = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: clientId, client_secret: await clientSecret(env), redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) {
      console.warn(`Admin: token exchange failed: HTTP ${r.status} ${j.error || ""} ${j.error_description || ""}`);
      html(502, "Sign-in failed", 'Google didn\'t accept the sign-in (see the admin logs). <a href="/auth/login">Try again</a>.', { "Set-Cookie": clear });
      return true;
    }
    // The ID token came straight from Google's token endpoint over TLS, authenticated with our client
    // secret (OpenID Connect Core 3.1.3.7), so its claims are checked without re-verifying the signature.
    let c;
    try { c = JSON.parse(unb64(j.id_token.split(".")[1])); } catch { c = {}; }
    const email = String(c.email || "").toLowerCase();
    const problem = c.aud !== clientId ? "wrong audience" : !ISSUERS.has(c.iss) ? "wrong issuer" : !(c.exp > Date.now() / 1000) ? "expired"
      : !equal(c.nonce || "", saved.nonce) ? "wrong nonce" : c.email_verified !== true && c.email_verified !== "true" ? "email not verified"
      : !iap.allowedEmails(env).includes(email) ? `${email || "(no email)"} is not in ADMIN_EMAILS` : "";
    if (problem) {
      console.warn(`Admin: sign-in refused: ${problem}`);
      html(403, "Not allowed", `This Google account can't use the admin${email ? ` (${email.replace(/[<>&"]/g, "")})` : ""}. <a href="/auth/login">Use another account</a>.`, { "Set-Cookie": clear });
      return true;
    }
    const body = b64(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }));
    const value = `${body}.${hmac(sessionKey(await clientSecret(env)), body)}`;
    console.log(JSON.stringify({ event: "admin_sign_in", admin: email }));
    send(res, 302, { Location: safeNext(saved.next), "Set-Cookie": [clear, setCookie(SESSION_COOKIE, value, SESSION_HOURS * 3600)] }, "");
    return true;
  }

  if (p === "/auth/logout") {
    html(200, "Signed out", 'You\'re signed out of the admin. <a href="/auth/login">Sign in again</a>.', { "Set-Cookie": setCookie(SESSION_COOKIE, "", 0) });
    return true;
  }
  send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found.");
  return true;
}

module.exports = { sessionEmail, csrfToken, equal, route, safeNext, SESSION_COOKIE, STATE_COOKIE, _setFetch: (f) => { fetchImpl = f; secretCache = null; } };
