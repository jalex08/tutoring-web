/**
 * Preview cards (1200x630 PNG, EN and ES), made on publish with satori (layout -> SVG) and resvg
 * (SVG -> PNG). Pure JavaScript + one native module; no headless browser.
 * Design follows www/og-image.png: pad-green grid with the red margin line on the left, the ink-blue
 * panel on the right with "Jose Diaz" and the motto, josediaztutoring.com at the bottom.
 * Fonts: fonts/*.woff (Bricolage Grotesque 800, Atkinson Hyperlegible 400/700, Kalam 700; SIL OFL 1.1,
 * licenses next to them), Latin subset from Fontsource (covers Spanish).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const W = 1200, H = 630, PANEL = 380;
const C = { pad: "#E9F2E4", grid: "#C7DDBE", graphite: "#232A2A", muted: "#55605E", ink: "#1C4C9E", hi: "#F6E15A", margin: "#E7A3A3" };
const MOTTO = {
  en: ["I don't just teach.", "I make sure you learn."],
  es: ["Mi meta no es enseñarte.", "Es que aprendas."],
};
const LABEL = { en: "Free interactive tool", es: "Herramienta interactiva gratis" };

const font = (f) => fs.readFileSync(path.join(__dirname, "fonts", f));
let FONTS = null;
const fonts = () => (FONTS ??= [
  { name: "Bricolage Grotesque", data: font("bricolage-grotesque-latin-800-normal.woff"), weight: 800, style: "normal" },
  { name: "Atkinson Hyperlegible", data: font("atkinson-hyperlegible-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "Atkinson Hyperlegible", data: font("atkinson-hyperlegible-latin-700-normal.woff"), weight: 700, style: "normal" },
  { name: "Kalam", data: font("kalam-latin-700-normal.woff"), weight: 700, style: "normal" },
]);

// a tiny h() for satori's element objects
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) } });

function titleSize(t) {
  const n = t.length;
  return n <= 28 ? 72 : n <= 45 ? 62 : n <= 65 ? 54 : n <= 90 ? 46 : 40;
}

/** The card as satori elements. */
function element({ title, subline, lang }) {
  const t = title.length > 120 ? `${title.slice(0, 117).trimEnd()}…` : title;
  const left = h("div", {
    width: W - PANEL, height: H, position: "relative", flexDirection: "column", padding: "64px 56px 52px 92px",
    backgroundColor: C.pad,
    backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
    backgroundSize: "22px 22px",
  },
  h("div", { position: "absolute", left: 52, top: 0, width: 2, height: H, backgroundColor: C.margin, opacity: 0.8 }),
  h("div", { fontFamily: "Atkinson Hyperlegible", fontWeight: 700, fontSize: 26, color: C.ink }, LABEL[lang]),
  h("div", { marginTop: 22, fontFamily: "Bricolage Grotesque", fontWeight: 800, fontSize: titleSize(t), lineHeight: 1.08, letterSpacing: "-0.02em", color: C.graphite }, t),
  subline ? h("div", { marginTop: 22, fontFamily: "Atkinson Hyperlegible", fontWeight: 400, fontSize: 28, color: C.muted }, subline) : null,
  h("div", { position: "absolute", left: 92, top: H - 82, fontFamily: "Atkinson Hyperlegible", fontWeight: 400, fontSize: 26, color: C.muted }, "josediaztutoring.com"));

  const [m1, m2] = MOTTO[lang];
  const right = h("div", { width: PANEL, height: H, backgroundColor: C.ink, flexDirection: "column", justifyContent: "center", padding: "0 34px" },
    h("div", { fontFamily: "Bricolage Grotesque", fontWeight: 800, fontSize: 60, color: "#fff", letterSpacing: "-0.02em" }, "Jose Diaz"),
    h("div", { marginTop: 34, fontFamily: "Atkinson Hyperlegible", fontWeight: 700, fontSize: 26, color: "#fff" }, m1),
    h("div", { marginTop: 8, flexDirection: "column", alignSelf: "flex-start" },
      h("div", { fontFamily: "Kalam", fontWeight: 700, fontSize: 30, color: "#fff" }, m2),
      h("div", { marginTop: -10, width: "100%", height: 12, backgroundColor: C.hi, opacity: 0.85, borderRadius: 3 })));

  return h("div", { width: W, height: H, flexDirection: "row" }, left, right);
}

/** PNG buffer for one card. */
async function renderCard({ title, subline = "", lang }) {
  const satori = require("satori").default;
  const { Resvg } = require("@resvg/resvg-js");
  const svg = await satori(element({ title, subline, lang }), { width: W, height: H, fonts: fonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
}

/** A card's object path: og/<id>-<lang>-<first 8 hex of its sha256>.png (new name when it changes). */
const cardPath = (id, lang, png) => `og/${id}-${lang}-${crypto.createHash("sha256").update(png).digest("hex").slice(0, 8)}.png`;

module.exports = { renderCard, cardPath, element };
