/**
 * Identity-Aware Proxy check for the admin service. IAP (turned on for the `admin` service only) signs
 * every request it lets through with the header x-goog-iap-jwt-assertion (ES256 JWT). We verify it on
 * every request, so the admin stays closed even if IAP were switched off by mistake:
 *   - signature: one of Google's IAP public keys (https://www.gstatic.com/iap/verify/public_key-jwk)
 *   - iss = https://cloud.google.com/iap
 *   - aud = /projects/<PROJECT_NUMBER>/apps/<PROJECT_ID>  (App Engine)
 *   - exp / iat within a minute of skew
 *   - email in ADMIN_EMAILS
 *
 * Local only: DEV_NO_IAP=1 skips the check (refused when running on App Engine).
 */
"use strict";

const crypto = require("node:crypto");

const KEYS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const ISSUER = "https://cloud.google.com/iap";
const SKEW = 60;

let keys = null; // { at, byKid: Map }
let audience = null;

async function iapKeys(force = false) {
  if (!force && keys && Date.now() - keys.at < 3600e3) return keys.byKid;
  const r = await fetch(KEYS_URL);
  if (!r.ok) throw new Error(`IAP keys: HTTP ${r.status}`);
  const byKid = new Map();
  for (const jwk of (await r.json()).keys || []) byKid.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
  keys = { at: Date.now(), byKid };
  return byKid;
}

async function expectedAudience(env = process.env) {
  if (env.IAP_AUDIENCE) return env.IAP_AUDIENCE;
  if (audience) return audience;
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/project/numeric-project-id", { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`project number: HTTP ${r.status}`);
  return (audience = `/projects/${(await r.text()).trim()}/apps/${env.GOOGLE_CLOUD_PROJECT}`);
}

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/**
 * Verifies a JWT and returns its payload, or throws. `getKey(kid)` -> KeyObject (tests pass their own).
 */
async function verifyJwt(jwt, { aud, getKey, now = Date.now() / 1000 }) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = b64json(parts[0]), payload = b64json(parts[1]);
  if (header.alg !== "ES256") throw new Error(`unexpected alg ${header.alg}`);
  const key = await getKey(header.kid);
  if (!key) throw new Error("unknown key id");
  const ok = crypto.verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("bad signature");
  if (payload.iss !== ISSUER) throw new Error("wrong issuer");
  if (payload.aud !== aud) throw new Error("wrong audience");
  if (typeof payload.exp !== "number" || payload.exp + SKEW < now) throw new Error("expired");
  if (typeof payload.iat !== "number" || payload.iat - SKEW > now) throw new Error("issued in the future");
  return payload;
}

const allowedEmails = (env = process.env) =>
  String(env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e && !e.endsWith("@example.com"));

/** The signed-in admin's email, or throws with a reason (for the log; the visitor just sees 403). */
async function adminEmail(req, env = process.env) {
  if (env.DEV_NO_IAP === "1") {
    if (env.GAE_ENV || env.GAE_SERVICE) throw new Error("DEV_NO_IAP is not allowed on App Engine");
    return env.DEV_ADMIN_EMAIL || "dev@localhost";
  }
  const allow = allowedEmails(env);
  if (!allow.length) throw new Error("ADMIN_EMAILS is not set");
  const jwt = req.headers["x-goog-iap-jwt-assertion"];
  if (!jwt) throw new Error("no IAP header (is IAP on for the admin service?)");
  const aud = await expectedAudience(env);
  const payload = await verifyJwt(jwt, {
    aud,
    getKey: async (kid) => (await iapKeys()).get(kid) || (await iapKeys(true)).get(kid),
  });
  const email = String(payload.email || "").toLowerCase();
  if (!allow.includes(email)) throw new Error(`${email || "(no email)"} is not in ADMIN_EMAILS`);
  return email;
}

module.exports = { adminEmail, verifyJwt, allowedEmails, ISSUER };
