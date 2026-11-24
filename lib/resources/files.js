/**
 * PDFs attached to a resource: the upload checks (admin) and the HTTP response (public site and admin
 * preview). Public URL: /resources/<slug-en>/files/<name> (resources.js). Stored at
 * resources/<id>/files/<name> in the private bucket and streamed from there, never buffered whole.
 *
 * Response: Content-Type application/pdf, inline with the file's own name, nosniff, noindex (the page is
 * what should rank), ETag = the file's sha256 (a replaced file shows up within the cache hour),
 * If-None-Match -> 304, HEAD, and one byte range (Range / If-Range) for mobile PDF viewers. A request
 * for several ranges gets the whole file (allowed by RFC 9110).
 */
"use strict";

const M = require("./model.js");

const PDF_MAGIC = Buffer.from("%PDF-");

/** Throws an Error with a plain message if the upload can't be used. */
function validatePdf(name, buf, maxBytes) {
  if (!M.validFileName(name)) throw new Error(M.fileNameProblem(name));
  if (!buf || !buf.length) throw new Error(`${name} is empty.`);
  if (buf.length > maxBytes) throw new Error(`${name} is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB.`);
  if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw new Error(`${name} isn't a PDF (it doesn't start with %PDF-).`);
}

/** "234 KB", "2.6 MB" (ES: "2,6 MB"). */
function sizeLabel(bytes, lang = "en") {
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = (bytes / 1048576).toFixed(1);
  return `${lang === "es" ? mb.replace(".", ",") : mb} MB`;
}

/**
 * The byte range to send for a Range header and a file size:
 *   null           no Range, or one we ignore (not bytes, several ranges, malformed) -> the whole file
 *   { start, end } inclusive
 *   "unsatisfiable" -> 416
 */
function parseRange(header, size) {
  const h = String(header || "").trim();
  if (!h) return null;
  const m = h.match(/^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") { // suffix: the last n bytes
    const n = Number(m[2]);
    if (!n || !size) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;
  return { start, end };
}

const etagOf = (file) => `"${file.sha256}"`;
function etagMatches(header, etag) {
  const h = String(header || "").trim();
  if (!h) return false;
  if (h === "*") return true;
  return h.split(",").map((t) => t.trim().replace(/^W\//, "")).includes(etag);
}

/**
 * Sends one attached file. `open({ start, end })` -> a Readable or null (missing object -> onMissing()).
 * `baseHeaders`: the site's security headers. `cacheControl`: public (site) or no-store (admin).
 */
async function send(req, res, { file, open, baseHeaders = {}, cacheControl = "public, max-age=3600", onMissing }) {
  const etag = etagOf(file);
  const common = {
    ...baseHeaders,
    "Cache-Control": cacheControl,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  };
  if (etagMatches(req.headers["if-none-match"], etag)) {
    res.writeHead(304, common);
    return res.end();
  }
  const size = file.sizeBytes;
  const headers = {
    ...common,
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${file.name}"`,
    "Accept-Ranges": "bytes",
  };
  const ifRange = req.headers["if-range"];
  let range = ifRange && ifRange.trim() !== etag ? null : parseRange(req.headers.range, size);
  if (range === "unsatisfiable") {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": "0" });
    return res.end();
  }
  const status = range ? 206 : 200;
  const length = range ? range.end - range.start + 1 : size;
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  headers["Content-Length"] = String(length);
  if (req.method === "HEAD") {
    res.writeHead(status, headers);
    return res.end();
  }
  const stream = await open(range || {});
  if (!stream) return onMissing();
  res.writeHead(status, headers);
  stream.on("error", (err) => { console.error(`Resources: file stream failed (${file.name}): ${err.message}`); res.destroy(err); });
  stream.pipe(res);
}

module.exports = { validatePdf, sizeLabel, parseRange, etagMatches, send, PDF_MAGIC };
