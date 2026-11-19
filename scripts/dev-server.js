#!/usr/bin/env node
/**
 * Local preview that behaves like App Engine: reads the handlers in app.yaml,
 * serves static_files with their headers, and passes everything else to
 * server.js. Email is stubbed (logged, never sent). No dependencies.
 *
 *   npm run dev            -> http://localhost:8080
 *   PORT=3000 npm run dev
 *   PRICING_FILE=pricing.json npm run dev
 *                          prices from a local file instead of the site-pricing secret
 *                          (re-read as soon as the file changes; without it: the fallback)
 *   EXAMS_FILE=exams.json npm run dev
 *                          exam data from a local file instead of the site-exams secret
 *                          (same rules; an invalid or missing file -> the bundled data, with a warning)
 */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
};

/** Just enough YAML for app.yaml's handler list. */
function handlers() {
  const lines = fs.readFileSync(path.join(ROOT, "app.yaml"), "utf8").split("\n");
  const out = [];
  let cur = null, inHeaders = false;
  for (const raw of lines.slice(lines.indexOf("handlers:") + 1)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    let m;
    if ((m = line.match(/^- url: (.+)$/))) {
      out.push((cur = { url: new RegExp(`^${m[1].trim()}$`), headers: {} }));
      inHeaders = false;
    } else if (/^ {2}http_headers:/.test(line)) {
      inHeaders = true;
    } else if (inHeaders && (m = line.match(/^ {4}([\w-]+): "?(.*?)"?$/))) {
      cur.headers[m[1]] = m[2];
    } else if ((m = line.match(/^ {2}(\w+): "?(.*?)"?$/))) {
      cur[m[1]] = m[2];
      inHeaders = false;
    }
  }
  return out;
}

function createDevServer({ onSend, pricingFile = process.env.PRICING_FILE, examsFile = process.env.EXAMS_FILE } = {}) {
  const app = require(path.join(ROOT, "server.js"));
  // stub the mailer and secrets: nothing leaves this machine
  app.secrets.set("smtp-config", JSON.stringify({ user: "site@example.test", password: "dev-stub" }));
  for (const name of ["mail-daily-limit", "mail-ip-hourly-limit", "mail-email-hourly-limit"]) app.secrets.set(name, "");
  // prices: a local file stands in for the secret ("" = not set -> fallback prices)
  if (pricingFile) {
    const f = path.resolve(pricingFile);
    app._setPricingSource(async () => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : ""));
    fs.watchFile(f, { interval: 500 }, () => app._clearPricingCache());
    console.log(`Prices from ${f}`);
  } else {
    app._setPricingSource(async () => "");
  }
  // exam data: a local file stands in for the secret ("" = not set -> the bundled data)
  if (examsFile) {
    const f = path.resolve(examsFile);
    app._setExamsSource(async () => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : ""));
    fs.watchFile(f, { interval: 500 }, () => app._clearExamsCache());
    console.log(`Exam data from ${f}`);
  } else {
    app._setExamsSource(async () => "");
  }
  app._setSend(async (messages) => {
    for (const m of messages) console.log(`[email stub] to=${m.to} subject=${JSON.stringify(m.subject)}`);
    if (onSend) onSend(messages);
  });

  const routes = handlers();
  return http.createServer((req, res) => {
    const pathname = new URL("http://localhost" + req.url).pathname;
    const h = routes.find((r) => r.url.test(pathname));
    if (h && h.static_files) {
      const groups = pathname.match(h.url); // static_files may use \1, \2 ... like App Engine
      const file = path.join(ROOT, h.static_files.replace(/\\(\d)/g, (_, n) => groups[n]));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end("missing static file");
      }
      const exp = h.expiration || "10m";
      const secs = { m: 60, h: 3600, d: 86400 }[exp.slice(-1)] * Number(exp.slice(0, -1));
      const type = h.mime_type || MIME[path.extname(file)] || "application/octet-stream";
      res.writeHead(200, {
        ...h.headers,
        "Content-Type": type.startsWith("text/html") ? "text/html; charset=utf-8" : type,
        "Cache-Control": `public, max-age=${secs}`,
      });
      return res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
    }
    app.server.emit("request", req, res); // script: auto
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createDevServer().listen(port, () => console.log(`Dev server on http://localhost:${port} (email stubbed)`));
}

module.exports = { createDevServer };
