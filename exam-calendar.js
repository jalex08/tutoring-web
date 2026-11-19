/**
 * Exam calendar for josediaztutoring.com: one module for the server (fills the four exam
 * pages at request time), the build (checks the page templates) and scripts/set-exams.sh.
 * No dependencies. The same role pricing.js plays for prices.
 *
 * Data: one JSON file per school year (data/exams/2026-27.json). The live copy is the
 * Secret Manager secret `site-exams`; the build writes the bundled file into each page
 * template, and that copy is the fallback when the secret is missing or invalid.
 *
 * Page templates (built by scripts/build.js, never edited by hand) contain:
 *   {{x:name}}   a value or block of HTML filled here at request time (see VALUES below)
 *   <script id="exam-data" type="application/json">…</script>   the data, replaced here
 * fill(html, data, today) fills both. "today" is YYYY-MM-DD in America/New_York.
 *
 * Strings: STRINGS (EN + ES) is the single copy; the build also writes it into the page
 * script (pages/exams/exams.js), so the server and the browser say exactly the same thing.
 *
 * Validate a file:  node exam-calendar.js data/exams/2026-27.json
 * (The full check, with warnings and links, is scripts/check-exams.js.)
 */
"use strict";

const TZ = "America/New_York";
const SITE = "https://josediaztutoring.com";

const STRINGS = {
  en: { all: "All", state: "Florida state tests", satact: "SAT and ACT", ap: "AP exams", college: "College finals",
    test: "Test day", window: "Testing window", reg: "Registration deadline", late: "Late registration, extra fee", finals: "Finals week",
    today: "today", tomorrow: "tomorrow", inDays: "in {n} days", inWeeks: "in {n} weeks", inMonths: "in {n} months",
    open: "open now, {n} days left", openLast: "open now, last day", opens: "opens {x}",
    ics: "Add to calendar", source: "Source", showAll: "Show all {n} dates", showLess: "Show fewer",
    verify: "Confirm this date with your school", noNext: "No dates left this school year",
    emptyH: "{y} dates are on the way", emptyP: "Every {y0} date on this page has passed. ",
    done: "done", stNext: "Next window: {r}", stNone: "{y} windows coming soon",
    met: "That meets the Algebra 1 graduation requirement.", notMet: "Not yet. {n} more {u} to reach {c}.",
    point: "point", points: "points", yourScore: "your score", passes: "{c} passes", passHere: "← passing starts here",
    metFine: "Make sure the school has the official score report on file.", nextTitle: "Next chances to meet it",
    nEoc: "Algebra 1 EOC", nSat: "SAT on {d}", nAct: "ACT on {d}", regBy: "register by {d}", lateBy: "late registration until {d}",
    outRange: "Enter a score between {a} and {b}.", lvl: "Level", act: "○ ACT   ● SAT and others",
    freeHelp: "Free help that works", official: "Official", freeB: "Free", allExams: "All exams", startHere: "Start here",
    whatNow: "What to do now", nextDate: "Next date", guideLink: "Read the guide", datesLink: "See the dates",
    share: "Send this to another parent", shareText: "Exam dates and what to do for {g}: {u}",
    showingFor: "Showing dates for {g}.", showEvery: "Show every exam",
    allIntro: "Every exam on this calendar. Pick a grade above for the short list.",
    footFor: "These exams are highlighted in the calendar below.", waffle: "{n} out of 100 passed",
    nextWinText: "{w} window, {r}", nextWinNone: "the {y} schedule",
    rulerLabel: "{e} scale {a} to {b}. Level 3 starts at {c}.", meets: "{c} or higher",
    claudeIntro: "I'm a parent in Florida. Summarize the key takeaways from this page about the {e} in plain language. Then ask me my child's grade and whether they've taken the test, and tell me what to do next.",
    claudeFacts: "Key facts from the page ({y}, checked {d}):", claudeEnd: "If something depends on my child's school, tell me what to ask the counselor.", page: "Page: " },
  es: { all: "Todos", state: "Exámenes estatales", satact: "SAT y ACT", ap: "Exámenes AP", college: "Finales universitarios",
    test: "Día del examen", window: "Período de examen", reg: "Fecha límite de inscripción", late: "Inscripción tardía, con recargo", finals: "Semana de finales",
    today: "hoy", tomorrow: "mañana", inDays: "en {n} días", inWeeks: "en {n} semanas", inMonths: "en {n} meses",
    open: "abierto, quedan {n} días", openLast: "abierto, último día", opens: "abre {x}",
    ics: "Añadir al calendario", source: "Fuente", showAll: "Ver las {n} fechas", showLess: "Ver menos",
    verify: "Confirma esta fecha con la escuela", noNext: "No quedan fechas este año escolar",
    emptyH: "Las fechas de {y} ya vienen", emptyP: "Todas las fechas de {y0} de esta página ya pasaron. ",
    done: "hecho", stNext: "Próximo período: {r}", stNone: "Los períodos de {y} vienen pronto",
    met: "Esa nota cumple el requisito de graduación de Álgebra 1.", notMet: "Todavía no. Faltan {n} {u} para llegar a {c}.",
    point: "punto", points: "puntos", yourScore: "tu nota", passes: "{c} aprueba", passHere: "← aquí se aprueba",
    metFine: "Asegúrate de que la escuela tenga el informe oficial de la nota.", nextTitle: "Próximas oportunidades para cumplirlo",
    nEoc: "EOC de Álgebra 1", nSat: "SAT el {d}", nAct: "ACT el {d}", regBy: "inscríbete antes del {d}", lateBy: "inscripción tardía hasta el {d}",
    outRange: "Escribe una nota entre {a} y {b}.", lvl: "Nivel", act: "○ ACT   ● SAT y demás",
    freeHelp: "Ayuda gratis que funciona", official: "Oficial", freeB: "Gratis", allExams: "Todos los exámenes", startHere: "Empieza aquí",
    whatNow: "Qué hacer ahora", nextDate: "Próxima fecha", guideLink: "Ver la guía", datesLink: "Ver las fechas",
    share: "Envíaselo a otro padre o madre", shareText: "Fechas de exámenes y qué hacer en {g}: {u}",
    showingFor: "Mostrando las fechas de {g}.", showEvery: "Ver todos los exámenes",
    allIntro: "Todos los exámenes de este calendario. Elige un grado arriba para ver la lista corta.",
    footFor: "Estos exámenes aparecen resaltados en el calendario de abajo.", waffle: "{n} de cada 100 aprobaron",
    nextWinText: "{w}, {r}", nextWinNone: "el calendario {y}",
    rulerLabel: "Escala del {e}: de {a} a {b}. El Nivel 3 empieza en {c}.", meets: "{c} o más",
    claudeIntro: "Soy padre/madre en Florida. Resume en español, con palabras sencillas, lo más importante de esta página sobre el {e}. Luego pregúntame en qué grado está mi hijo/a y si ya tomó el examen, y dime qué hacer ahora.",
    claudeFacts: "Datos clave de la página ({y}, revisados el {d}):", claudeEnd: "Si algo depende de la escuela, dime qué preguntarle al consejero.", page: "Página: " },
};

// The date notice. The live text is D.notice (EN/ES) in the data; this is used only for a data file
// without a "notice" block (or without one of its keys).
const NOTICE_KEYS = ["short", "title", "body", "report", "checker", "claude", "ics"];
const NOTICE_FALLBACK = {
  short: { en: "Dates come from official sources and are checked regularly, but schools and testing agencies can change them. Always confirm with your school or the official site before you register or plan.",
    es: "Las fechas vienen de fuentes oficiales y se revisan con frecuencia, pero las escuelas y las agencias de exámenes pueden cambiarlas. Confirma siempre con tu escuela o en el sitio oficial antes de inscribirte o hacer planes." },
  title: { en: "A note about these dates", es: "Una nota sobre estas fechas" },
  body: { en: "I check every date against its official source and update this page when something changes. Still, schools, districts, the Florida Department of Education, College Board, ACT and colleges can move a date, a deadline or a rule at any time, sometimes at the last minute. This calendar is a free planning guide, not an official schedule: your school's calendar and the official sources linked here always come first, so please confirm before you register, pay a fee or plan around a date. Jose Diaz Tutoring isn't responsible for missed deadlines, fees or other outcomes based on the information on this page.",
    es: "Reviso cada fecha en su fuente oficial y actualizo esta página cuando algo cambia. Aun así, las escuelas, los distritos, el Departamento de Educación de Florida, College Board, ACT y las universidades pueden cambiar una fecha, un plazo o una regla en cualquier momento, a veces a última hora. Este calendario es una guía gratuita para planificar, no un calendario oficial: el calendario de tu escuela y las fuentes oficiales que enlazo aquí siempre tienen la última palabra, así que confirma antes de inscribirte, pagar una tarifa o planificar alrededor de una fecha. Jose Diaz Tutoring no se hace responsable de plazos perdidos, cargos u otras consecuencias por usar la información de esta página." },
  report: { en: "Spotted a date that changed? Tell me and I'll fix it.", es: "¿Viste una fecha que cambió? Avísame y la corrijo." },
  checker: { en: "This checker is a quick guide based on the scores FDOE publishes. Only your school counselor can confirm that a requirement is met.",
    es: "Este verificador es una guía rápida basada en las notas que publica el FDOE. Solo el consejero de la escuela puede confirmar que se cumplió un requisito." },
  claude: { en: "Claude's answer is written by AI and can make mistakes. Check anything important against the official sources.",
    es: "La respuesta de Claude la escribe una IA y puede equivocarse. Comprueba lo importante en las fuentes oficiales." },
  ics: { en: "Dates can change. Confirm with your school or the official source.", es: "Las fechas pueden cambiar. Confírmalas con tu escuela o en la fuente oficial." },
};

// Sources listed at the bottom of a guide, in this order (keys of data.sources; missing ones are skipped).
const GUIDE_SOURCES = { alg1: ["fdoe-eoc", "fdoe-schedule", "fdoe-grad", "fdoe-results", "flfast", "sat", "act"] };

// --- validation (what the pages need to render; scripts/check-exams.js adds warnings + links) ---
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const TYPES = ["test", "window", "reg", "late", "finals"];
const MAX_BYTES = 60000; // minified; Secret Manager's limit is 64 KiB

/** Every problem that would break the pages (empty array = usable). */
function problems(D) {
  const out = [];
  if (!isObj(D)) return ["data must be a JSON object"];
  const bi = (o, where) => {
    if (!isObj(o)) return out.push(`${where}: missing text`);
    for (const l of ["en", "es"]) if (typeof o[l] !== "string" || !o[l].trim()) out.push(`${where}: missing ${l === "en" ? "English" : "Spanish"}`);
  };
  const date = (s, where) => { if (!ISO.test(s || "") || isNaN(P(s))) out.push(`${where}: bad date ${JSON.stringify(s)}`); };
  for (const k of ["schoolYear", "range", "checked", "sources", "lanes", "exams", "events", "resources", "nextYear", "algebra1Requirement", "stats"]) {
    if (!D[k]) out.push(`missing top-level "${k}"`);
  }
  if (out.length) return out;
  if (!Number.isInteger(D.revision) || D.revision < 1) out.push('missing or bad "revision" (integer, +1 on every published change)');
  if (!/^\d{4}-\d{2}$/.test(D.schoolYear)) out.push(`schoolYear must look like "2026-27", got ${JSON.stringify(D.schoolYear)}`);
  date(D.range.start, "range.start"); date(D.range.end, "range.end"); date(D.checked, "checked");
  if (!D.nextYear.label) out.push("nextYear.label missing");
  bi(D.nextYear.note, "nextYear.note");
  for (const [k, s] of Object.entries(D.sources)) {
    if (!isObj(s) || typeof s.label !== "string" || !/^https:\/\//.test(s.url || "")) out.push(`source ${k}: needs a label and an https URL`);
  }
  for (const [k, r] of Object.entries(D.resources)) {
    if (!isObj(r)) { out.push(`resource ${k}: must be an object`); continue; }
    bi(r.label, `resource ${k}`);
    if (!/^https:\/\//.test(r.url || "")) out.push(`resource ${k}: URL must be https`);
  }
  const lanes = new Set();
  for (const l of D.lanes) { lanes.add(l.id); bi(l, `lane ${l.id}`); }
  const exams = new Set();
  for (const x of D.exams) {
    if (exams.has(x.id)) out.push(`duplicate exam id ${x.id}`);
    exams.add(x.id);
    if (!lanes.has(x.lane)) out.push(`exam ${x.id}: unknown lane ${x.lane}`);
    bi(x.name, `exam ${x.id}.name`); bi(x.stakes, `exam ${x.id}.stakes`);
    for (const k of x.resources || []) if (!D.resources[k]) out.push(`exam ${x.id}: unknown resource ${k}`);
    if (x.pageLive && (!x.page || !x.pageEs)) out.push(`exam ${x.id}: pageLive but page/pageEs missing`);
    for (const b of x.breaks || []) {
      if (!Array.isArray(b.en) || !Array.isArray(b.es) || b.en.length !== 2 || b.es.length !== 2) out.push(`exam ${x.id}: each "breaks" entry needs en and es [skill, why]`);
    }
  }
  const evs = new Set();
  for (const e of D.events) {
    const w = `event ${e.id}`;
    if (evs.has(e.id)) out.push(`duplicate event id ${e.id}`);
    evs.add(e.id);
    if (!exams.has(e.exam)) out.push(`${w}: unknown exam ${e.exam}`);
    for (const a of e.also || []) if (!exams.has(a)) out.push(`${w}: unknown "also" exam ${a}`);
    if (!TYPES.includes(e.type)) out.push(`${w}: unknown type ${e.type}`);
    date(e.start, `${w}.start`);
    if (e.end) { date(e.end, `${w}.end`); if (ISO.test(e.end) && ISO.test(e.start) && e.end < e.start) out.push(`${w}: end before start`); }
    if (!D.sources[e.src]) out.push(`${w}: unknown source ${e.src}`);
    bi(e.label, `${w}.label`);
    if (e.note) bi(e.note, `${w}.note`);
    if (e.short) bi(e.short, `${w}.short`);
  }
  for (const e of D.events) if (e.for && !evs.has(e.for)) out.push(`event ${e.id}: "for" points to unknown event ${e.for}`);
  for (const x of D.exams) {
    for (const id of x.windows || []) {
      if (!evs.has(id)) out.push(`exam ${x.id}: unknown window ${id}`);
      else if (!D.events.find((e) => e.id === id).short) out.push(`exam ${x.id}: window ${id} needs a "short" name`);
    }
  }
  for (const a of D.audiences || []) {
    bi(a.label, `audience ${a.id}.label`); bi(a.intro, `audience ${a.id}.intro`);
    (a.items || []).forEach((it, i) => {
      if (!exams.has(it.exam)) out.push(`audience ${a.id} item ${i}: unknown exam ${it.exam}`);
      bi(it.why, `audience ${a.id} item ${i}.why`); bi(it.todo, `audience ${a.id} item ${i}.todo`);
      if (it.src && !D.sources[it.src]) out.push(`audience ${a.id} item ${i}: unknown source ${it.src}`);
    });
  }
  const req = D.algebra1Requirement;
  if (!Array.isArray(req.tests) || !req.tests.length) out.push("algebra1Requirement.tests missing");
  else for (const T of req.tests) {
    if (!T.id || !T.en || !T.es) out.push(`algebra1Requirement test ${T.id}: needs id, en, es`);
    for (const k of ["min", "max", "cut", "step"]) if (typeof T[k] !== "number") out.push(`algebra1Requirement test ${T.id}: ${k} must be a number`);
    if (!(T.min <= T.cut && T.cut <= T.max) || T.step <= 0) out.push(`algebra1Requirement test ${T.id}: needs min <= cut <= max and step > 0`);
  }
  bi(req.note, "algebra1Requirement.note");
  if (D.notice !== undefined) {
    if (!isObj(D.notice)) out.push('"notice" must be an object');
    else for (const k of NOTICE_KEYS) if (D.notice[k] !== undefined) bi(D.notice[k], `notice.${k}`);
  }
  const st = D.stats.alg1PassRate2026;
  if (!isObj(st) || !["grades9to12", "grade8AndLower"].every((k) => Number.isInteger(st[k]) && st[k] >= 0 && st[k] <= 100)) {
    out.push("stats.alg1PassRate2026 needs grades9to12 and grade8AndLower (0–100)");
  }
  const bytes = Buffer.byteLength(JSON.stringify(D));
  if (bytes > MAX_BYTES) out.push(`minified size ${bytes} bytes: over the ${MAX_BYTES}-byte limit for the site-exams secret`);
  return out;
}

/** Parses + validates a JSON string. Returns the data or throws with every problem listed. */
function parse(raw) {
  let D;
  try { D = JSON.parse(raw); } catch (e) { throw new Error(`not valid JSON: ${e.message}`); }
  const errs = problems(D);
  if (errs.length) throw new Error(errs.join("; "));
  return deepFreeze(D);
}
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

// --- dates (all UTC internally; "today" is passed in as YYYY-MM-DD in Florida time) ---
function P(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
const diff = (a, b) => Math.round((a - b) / 864e5);
const todayInFlorida = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const yearText = (y) => String(y).replace("-", "–");

/** The data as it goes inside <script type="application/json">: no "</" or "<!--" can end or confuse the script. */
const inlineJson = (D) => JSON.stringify(D).replace(/<\//g, "<\\/").replace(/<!--/g, "\\u003c!--");

/** Everything one page needs to render, for one language and one day. */
function context(D, lang, today) {
  const L = STRINGS[lang];
  if (!L) throw new Error(`unknown page language ${lang}`);
  const LOC = lang === "es" ? "es-US" : "en-US";
  const TD = P(today);
  const t = (k, v) => { let s = L[k]; if (s === undefined) throw new Error(`no string ${k}`); if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const nm = (o) => (o ? o[lang] || o.en : "");
  const esc = escHtml;
  const f = (opts, d) => new Intl.DateTimeFormat(LOC, { ...opts, timeZone: "UTC" }).format(d);
  const clean = (s) => s.replace(/\./g, "");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const mon = (d) => cap(clean(f({ month: "short" }, d)));
  const dow = (d) => cap(clean(f({ weekday: "short" }, d)));
  const md = (d) => (lang === "es" ? d.getUTCDate() + " " + mon(d).toLowerCase() : mon(d) + " " + d.getUTCDate());
  const mdy = (d) => (lang === "es" ? `${d.getUTCDate()} de ${clean(f({ month: "long" }, d))} de ${d.getUTCFullYear()}` : f({ month: "short", day: "numeric", year: "numeric" }, d));
  const monthYear = (d) => cap(lang === "es" ? `${f({ month: "long" }, d)} de ${d.getUTCFullYear()}` : f({ month: "long", year: "numeric" }, d));
  const range = (ev) => (ev.end ? md(P(ev.start)) + " – " + md(P(ev.end)) : md(P(ev.start)));
  // Spanish window in a sentence: "del 3 al 28 de mayo", "del 30 de noviembre al 18 de diciembre"
  const dm = (d) => `${d.getUTCDate()} de ${f({ month: "long" }, d)}`;
  const delAl = (ev) => {
    const a = P(ev.start), b = P(ev.end || ev.start);
    if (+a === +b) return `el ${dm(a)}`;
    return a.getUTCMonth() === b.getUTCMonth() ? `del ${a.getUTCDate()} al ${dm(b)}` : `del ${dm(a)} al ${dm(b)}`;
  };
  const rel = (n) => (n === 0 ? t("today") : n === 1 ? t("tomorrow") : n <= 45 ? t("inDays", { n }) : n <= 120 ? t("inWeeks", { n: Math.round(n / 7) }) : t("inMonths", { n: Math.round(n / 30.4) }));
  function status(ev) {
    const a = P(ev.start), b = ev.end ? P(ev.end) : a;
    if (TD > b) return { state: "past" };
    if (TD >= a && ev.end) { const left = diff(b, TD); return { state: "open", text: left === 0 ? t("openLast") : t("open", { n: left + 1 }) }; }
    const n = diff(a, TD);
    return { state: "upcoming", n, text: ev.end ? t("opens", { x: rel(n) }) : rel(n) };
  }
  const examOf = (id) => D.exams.find((x) => x.id === id);
  const evById = (id) => D.events.find((e) => e.id === id);
  const byDate = (x, y) => P(x.start) - P(y.start) || P(x.end || x.start) - P(y.end || y.start);
  const upcoming = () => D.events.filter((e) => status(e).state !== "past").sort(byDate);
  const nextFor = (id) => upcoming().filter((e) => (e.exam === id || (e.also || []).includes(id)) && e.type !== "reg" && e.type !== "late")[0];
  const guideURL = (x) => (x && x.pageLive ? (lang === "es" ? x.pageEs : x.page) : null);
  return { D, lang, L, t, nm, esc, mon, dow, md, mdy, monthYear, range, delAl, status, examOf, evById, byDate, upcoming, nextFor, guideURL };
}

// --- rendered blocks (same markup as pages/exams/exams.js, which replaces them in the browser) ---
const ICON_WARN = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.7H1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>';

function resHTML(c, examId, max) {
  const x = c.examOf(examId);
  if (!x || !x.resources) return "";
  const list = x.resources.slice(0, max || 9).map((k) => {
    const r = c.D.resources[k];
    return `<li><a href="${c.esc(r.url)}" target="_blank" rel="noopener" data-res="${c.esc(k)}"><span class="badge${r.official ? "" : " free"}">${c.esc(r.official ? c.t("official") : c.t("freeB"))}</span><span><span class="rl">${c.esc(c.nm(r.label))}</span><span class="by">${c.esc(r.by)}</span></span><span class="ext" aria-hidden="true">↗</span></a></li>`;
  }).join("");
  return `<div class="res"><p class="res-h">${c.esc(c.t("freeHelp"))}</p><ul>${list}</ul></div>`;
}

function whenHTML(c, examId) {
  const n = c.nextFor(examId);
  if (!n) return `<p class="aud-when muted">${c.esc(c.t("noNext"))}</p>`;
  return `<p class="aud-when"><b>${c.esc(c.t("nextDate"))}:</b> ${c.esc(c.range(n))}<span class="hand">${c.esc(c.status(n).text)}</span></p>`;
}

/** Hub, #audPanel: the "All exams" view. */
function audPanel(c) {
  let html = `<p class="aud-intro">${c.esc(c.t("allIntro"))}</p><ul class="aud-list allgrid">`;
  for (const x of c.D.exams) {
    const lane = c.D.lanes.find((l) => l.id === x.lane), g = c.guideURL(x);
    html += `<li class="aud-item"><span class="lane-name">${c.esc(c.nm(lane))}</span><h3>${c.esc(c.nm(x.name))}</h3><p class="aud-why">${c.esc(c.nm(x.stakes))}</p>${whenHTML(c, x.id)}${resHTML(c, x.id, 2)}` +
      (g ? `<p class="aud-links"><a href="${c.esc(g)}">${c.esc(c.t("guideLink"))}</a></p>` : "") + "</li>";
  }
  return html + "</ul>";
}

/** Hub, #ledger: every date of the school year, in order, grouped by month (the script swaps in "Coming up"). */
function ledgerAll(c) {
  const evs = [...c.D.events].sort(c.byDate);
  let html = '<div class="ledger-all">', month = "";
  for (const e of evs) {
    const a = P(e.start), ex = c.examOf(e.exam), dl = e.type === "reg" || e.type === "late", src = c.D.sources[e.src];
    const m = c.monthYear(a);
    if (m !== month) { html += (month ? "</ol>" : "") + `<h3 class="ledger-month">${c.esc(m)}</h3><ol>`; month = m; }
    html += `<li class="row${c.status(e).state === "past" ? " past" : ""}">` +
      `<div class="when"><span class="mon">${c.esc(c.mon(a))}</span><span class="day">${a.getUTCDate()}</span><span class="dow">${c.esc(c.dow(a))}</span></div>` +
      `<div class="what"><p class="title">${c.esc(c.nm(e.label))}</p>` +
      `<p class="meta"><span class="tag${dl ? " dl" : ""}">${c.esc(c.t(e.type))}</span><span>${c.esc(e.end ? c.range(e) : c.nm(ex.name))}</span></p>` +
      (e.note ? `<p class="note">${c.esc(c.nm(e.note))}</p>` : "") +
      (e.verify ? `<p class="verify">${ICON_WARN}${c.esc(c.t("verify"))}</p>` : "") + "</div>" +
      `<div class="side"><a class="ibtn" href="${c.esc(src.url)}" target="_blank" rel="noopener" title="${c.esc(src.label)}">${c.esc(c.t("source"))}</a></div></li>`;
  }
  return html + (month ? "</ol>" : "") + "</div>";
}

function guideExam(c, exam) {
  const x = c.examOf(exam);
  if (!x) throw new Error(`no exam "${exam}" in the data`);
  return x;
}
const examWins = (c, exam) => (guideExam(c, exam).windows || []).map(c.evById).filter(Boolean);
const nextWin = (c, exam) => examWins(c, exam).filter((e) => c.status(e).state !== "past")[0];
const testById = (c, id) => c.D.algebra1Requirement.tests.find((T) => T.id === id);

/** Guide, #examStatus. */
function examStatus(c, exam) {
  const w = nextWin(c, exam);
  if (!w) return c.esc(c.t("stNone", { y: c.D.nextYear.label }));
  const s = c.status(w);
  return (s.state === "open" ? c.esc(c.nm(w.short) + " · " + c.range(w)) : c.esc(c.t("stNext", { r: c.nm(w.short) + ", " + c.range(w) }))) + ` <span class="hand">${c.esc(s.text)}</span>`;
}

/** Guide, [data-nextwin]: "winter window, Nov 30 – Dec 18". */
function nextWinText(c, exam) {
  const w = nextWin(c, exam);
  if (!w) return c.esc(c.t("nextWinNone", { y: c.D.nextYear.label }));
  return c.esc(c.t("nextWinText", { w: c.nm(w.short).toLowerCase(), r: c.lang === "es" ? c.delAl(w) : c.range(w) }));
}

/** Guide, #winList. */
function winList(c, exam) {
  return examWins(c, exam).map((e) => {
    const s = c.status(e);
    return `<li${s.state === "past" ? ' class="past"' : s.state === "open" ? ' class="now"' : ""}><div class="w-name">${c.esc(c.nm(e.short))}<span class="hand">${c.esc(s.state === "past" ? c.t("done") : s.text)}</span></div>` +
      `<div class="w-when">${c.esc(c.range(e))}, ${P(e.start).getUTCFullYear()}</div>` +
      (e.verify ? `<p class="verify">${ICON_WARN}${c.esc(c.t("verify"))}</p>` : "") + "</li>";
  }).join("");
}

/** Guide, #brkList: where students lose points. */
function brkList(c, exam) {
  return (guideExam(c, exam).breaks || []).map((b, i) =>
    `<div class="brk"><span class="n">${i + 1}</span><div><p class="skill">${c.esc(b[c.lang][0])}</p><p class="why">${c.esc(b[c.lang][1])}</p></div><span class="ex">${c.esc(b.ex)}</span></div>`
  ).join("");
}

/** Guide, #examLinks: free official practice. */
function examLinks(c, exam) {
  return (guideExam(c, exam).resources || []).map((k) => {
    const r = c.D.resources[k];
    return `<a href="${c.esc(r.url)}" target="_blank" rel="noopener" data-res="${c.esc(k)}"><span>${c.esc(c.nm(r.label))}<br><small>${c.esc(r.by)}</small></span><span aria-hidden="true">↗</span></a>`;
  }).join("");
}

/** Guide, #srcList. */
function srcList(c, exam) {
  return (GUIDE_SOURCES[exam] || []).filter((k) => c.D.sources[k]).map((k) => {
    const s = c.D.sources[k];
    return `<li><a href="${c.esc(s.url)}" target="_blank" rel="noopener">${c.esc(s.label)}</a></li>`;
  }).join("");
}

/** Guide, #waffle: 100 squares, the 9–12 pass rate filled in. */
function waffle(c) {
  const n = c.D.stats.alg1PassRate2026.grades9to12;
  return Array.from({ length: 100 }, (_, i) => (i < n ? '<i class="on"></i>' : "<i></i>")).join("");
}

/** Guide, the score checker without its script: the options, and a plain list for no-JS visitors. */
function chkOptions(c) {
  return c.D.algebra1Requirement.tests.map((T) => `<option value="${c.esc(T.id)}">${c.esc(c.nm(T))} (${T.min}–${T.max})</option>`).join("");
}
function chkList(c) {
  return c.D.algebra1Requirement.tests.map((T) => `<li><b>${c.esc(c.nm(T))}</b><span>${c.esc(c.t("meets", { c: T.levels ? `${c.t("lvl")} 3 (${T.cut})` : T.cut }))}</span></li>`).join("");
}

/** Guide, #heroRuler: the scale with the passing line (the wide version; the script redraws it to fit). */
function heroRuler(c, exam) {
  const T = testById(c, exam) || c.D.algebra1Requirement.tests[0];
  const W = 640, x0 = 24, x1 = W - 24, y = 58, h = 26, fs = 12.5, step = T.step;
  const X = (v) => +(x0 + (x1 - x0) * (v - T.min) / (T.max - T.min)).toFixed(2);
  const el = (n, a, txt) => `<${n}${Object.entries(a).map(([k, v]) => ` ${k}="${escHtml(v)}"`).join("")}${txt == null ? "/>" : `>${escHtml(txt)}</${n}>`}`;
  let g = "";
  if (T.levels) {
    T.levels.forEach((lv, i) => {
      const a = X(lv[0]), b = X(i === T.levels.length - 1 ? lv[1] : T.levels[i + 1][0]);
      g += el("rect", { x: a, y, width: +(b - a).toFixed(2), height: h, fill: i >= 2 ? "#E9F2E4" : "#fff", stroke: "#A9B5B1", "stroke-width": 1 });
      g += el("text", { x: +((a + b) / 2).toFixed(2), y: y + h / 2 + 5, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: i >= 2 ? "#1C4C9E" : "#55605E" }, ((b - a) < 70 ? "" : c.t("lvl") + " ") + (i + 1));
    });
  } else {
    g += el("rect", { x: x0, y, width: X(T.cut) - x0, height: h, fill: "#fff", stroke: "#A9B5B1" });
    g += el("rect", { x: X(T.cut), y, width: x1 - X(T.cut), height: h, fill: "#E9F2E4", stroke: "#A9B5B1" });
  }
  for (let v = Math.ceil(T.min / step) * step; v <= T.max; v += step) {
    const xx = X(v);
    g += el("line", { x1: xx, y1: y + h, x2: xx, y2: y + h + 7, stroke: "#55605E" });
    if (Math.abs(v - T.cut) > (T.max - T.min) * 0.04) g += el("text", { x: xx, y: y + h + 22, "text-anchor": "middle", "font-size": fs, fill: "#55605E" }, v);
  }
  for (const v of [T.min, T.max]) if (v % step) g += el("text", { x: X(v), y: y + h + 22, "text-anchor": v === T.min ? "start" : "end", "font-size": fs, fill: "#55605E" }, v);
  const cx = X(T.cut);
  g += el("rect", { x: cx - 24, y: y + h + 8, width: 48, height: 22, rx: 4, fill: "#232A2A" });
  g += el("line", { x1: cx, y1: y - 16, x2: cx, y2: y + h + 8, stroke: "#232A2A", "stroke-width": 2.5 });
  g += el("text", { x: cx, y: y + h + 24, "text-anchor": "middle", "font-size": 15, "font-weight": 700, fill: "#fff" }, T.cut);
  g += el("text", { x: cx + 8, y: y - 22, "font-family": "Kalam, cursive", "font-size": 18, "font-weight": 700, fill: "#1C4C9E" }, c.t("passHere"));
  return `<g font-family="Atkinson Hyperlegible, sans-serif">${g}</g>`;
}

function rulerLabel(c, exam) {
  const T = testById(c, exam) || c.D.algebra1Requirement.tests[0];
  return c.esc(c.t("rulerLabel", { e: c.nm(T), a: T.min, b: T.max, c: T.cut }));
}

// --- filling a page template -----------------------------------------------------------
const TOKEN_RE = /\{\{x:([\w.-]+)\}\}/g;
const DATA_RE = /(<script id="exam-data" type="application\/json">)([\s\S]*?)(<\/script>)/;

/** Value of one {{x:name}} token. `exam` = the guide's <body data-exam>, if any. */
function value(name, c, exam) {
  const needExam = () => { if (!exam) throw new Error(`{{x:${name}}} needs <body data-exam>`); return exam; };
  let m;
  switch (name) {
    case "year": return c.esc(yearText(c.D.schoolYear));
    case "checked": return c.esc(c.mdy(P(c.D.checked)));
    case "audPanel": return audPanel(c);
    case "ledger": return ledgerAll(c);
    case "examStatus": return examStatus(c, needExam());
    case "nextwin": return nextWinText(c, needExam());
    case "winList": return winList(c, needExam());
    case "brkList": return brkList(c, needExam());
    case "examLinks": return examLinks(c, needExam());
    case "srcList": return srcList(c, needExam());
    case "waffle": return waffle(c);
    case "waffleLabel": return c.esc(c.t("waffle", { n: c.D.stats.alg1PassRate2026.grades9to12 }));
    case "chkOptions": return chkOptions(c);
    case "chkList": return chkList(c);
    case "chkNote": return c.esc(c.nm(c.D.algebra1Requirement.note));
    case "heroRuler": return heroRuler(c, needExam());
    case "notice.short": case "notice.title": case "notice.body": case "notice.report": case "notice.checker": case "notice.claude": {
      const k = name.slice(7), v = c.D.notice && c.D.notice[k];
      return c.esc(c.nm(v && v[c.lang] ? v : NOTICE_FALLBACK[k]));
    }
    case "rulerLabel": return rulerLabel(c, needExam());
  }
  if ((m = name.match(/^cut\.([\w-]+)$/))) {
    const T = testById(c, m[1]);
    if (!T) throw new Error(`{{x:${name}}}: no test "${m[1]}" in algebra1Requirement.tests`);
    return String(T.cut);
  }
  if ((m = name.match(/^stat\.(grades9to12|grade8AndLower)$/))) return String(c.D.stats.alg1PassRate2026[m[1]]);
  throw new Error(`unknown token {{x:${name}}}`);
}

/** A page template with every {{x:…}} token and the #exam-data block filled from `D` as of `today`. */
function fill(html, D, today) {
  if (!ISO.test(today || "")) throw new Error(`fill: today must be YYYY-MM-DD, got ${today}`);
  const lang = (html.match(/<html lang="(\w+)">/) || [])[1];
  const exam = (html.match(/<body data-exam="([\w-]+)">/) || [])[1];
  const c = context(D, lang, today);
  const memo = new Map();
  let out = html.replace(TOKEN_RE, (_, name) => {
    if (!memo.has(name)) memo.set(name, value(name, c, exam));
    return memo.get(name);
  });
  if (!DATA_RE.test(out)) throw new Error("fill: no <script id=\"exam-data\"> block");
  out = out.replace(DATA_RE, (_, a, __, b) => a + inlineJson(D) + b);
  return out;
}

/** The data block of a built template (the bundled fallback), parsed and validated. */
function embedded(html) {
  const m = html.match(DATA_RE);
  if (!m) throw new Error("no <script id=\"exam-data\"> block");
  return parse(m[2].replace(/<\\\//g, "</").replace(/\\u003c!--/g, "<!--"));
}

/** One-line description (logs, set-exams.sh). */
const summary = (D) => `school year ${D.schoolYear}, revision ${D.revision}, checked ${D.checked}, ${D.events.length} dates, ${D.exams.length} exams`;

module.exports = { TZ, SITE, STRINGS, NOTICE_FALLBACK, GUIDE_SOURCES, MAX_BYTES, problems, parse, fill, embedded, inlineJson, todayInFlorida, yearText, summary, TOKEN_RE, DATA_RE };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node exam-calendar.js data.json"); process.exit(2); }
  try {
    const D = parse(require("node:fs").readFileSync(file, "utf8"));
    console.log(`${file}: valid (${summary(D)})`);
  } catch (e) {
    console.error(`${file}: INVALID: ${e.message}`);
    process.exit(1);
  }
}
