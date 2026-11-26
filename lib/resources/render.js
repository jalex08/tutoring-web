/**
 * Server-side HTML for the Resources feature: a resource page (/resources/<slug>/,
 * /es/recursos/<slug>/), the library (/resources/, /es/recursos/), the home page's "Free interactive
 * tools" cards and the sitemap entries.
 *
 * `shell` = www/resources-shell.json[lang], written by scripts/build.js from www/index.html and
 * i18n/es.js: the site's GTM snippets, shared CSS, header, footer, analytics and EN/ES switch scripts,
 * plus pages/resources/*.{css,js}. So these pages always match the rest of the site.
 */
"use strict";

const M = require("./model.js");
const math = require("./math.js");
const { sizeLabel } = require("./files.js");

const { SITE, BASE, SUBJECTS, LEVELS, EXAM_LINKS } = M;
const esc = math.escapeHtml;

const T = {
  en: {
    titleSuffix: "free interactive tool",
    home: "Home", resources: "Resources", allResources: "All resources",
    homeLabel: "Jose Diaz Tutoring, home",
    copy: "Copy link", copied: "Copied", copyFailed: "Couldn't copy. Copy the address bar instead.",
    back: "Resources", share: "Share", more: "More options", otherLang: "Español",
    fullscreen: "Full screen", exitFullscreen: "Exit full screen",
    cue: "How it works", howTo: "How to use it", keyIdeas: "Key ideas", faq: "Questions", files: "Printable PDFs",
    related: "Related resources", seeAlso: "See also",
    toolLabel: "Interactive tool", noscript: "This interactive tool needs JavaScript.",
    ctaHead: "Want help with this topic?",
    ctaText: "I'm Jose Diaz, an engineer who tutors math, physics and engineering, online and in South Florida, in English or Spanish.",
    libTitle: "Free interactive tools",
    libMetaTitle: "Free interactive math, physics & engineering tools | Jose Diaz Tutoring",
    libDesc: "Free interactive tools for algebra, trig, calculus, physics and circuits, made by an engineer who tutors. Use them online, no sign-up.",
    libLede: "Tools I made for my students. Move the sliders and see how the math works. Free, no sign-up.",
    subject: "Subject", level: "Level", all: "All",
    count: (n) => (n === 1 ? "1 tool" : `${n} tools`),
    empty: "The first tools are on their way. Check back soon.",
    noMatch: "No tools match these filters yet.",
    freeTool: "Free interactive tool",
    preview: "Preview: not published. Links go to the live site.",
  },
  es: {
    titleSuffix: "herramienta interactiva gratis",
    home: "Inicio", resources: "Recursos", allResources: "Todos los recursos",
    homeLabel: "Jose Diaz Tutoring, inicio",
    copy: "Copiar enlace", copied: "Copiado", copyFailed: "No se pudo copiar. Copia la barra de direcciones.",
    back: "Recursos", share: "Compartir", more: "Más opciones", otherLang: "English",
    fullscreen: "Pantalla completa", exitFullscreen: "Salir de pantalla completa",
    cue: "Cómo funciona", howTo: "Cómo usarla", keyIdeas: "Ideas clave", faq: "Preguntas", files: "PDF para imprimir",
    related: "Recursos relacionados", seeAlso: "Mira también",
    toolLabel: "Herramienta interactiva", noscript: "Esta herramienta interactiva necesita JavaScript.",
    ctaHead: "¿Quieres ayuda con este tema?",
    ctaText: "Soy Jose Diaz, ingeniero. Doy tutorías de matemáticas, física e ingeniería, en línea y en el sur de Florida, en inglés o español.",
    libTitle: "Herramientas interactivas gratis",
    libMetaTitle: "Herramientas interactivas gratis de matemáticas, física e ingeniería | Jose Diaz Tutoring",
    libDesc: "Herramientas interactivas gratis de álgebra, trigonometría, cálculo, física y circuitos, hechas por un ingeniero tutor. Úsalas en línea, sin registrarte.",
    libLede: "Herramientas que hice para mis estudiantes. Mueve los controles y mira cómo funcionan las matemáticas. Gratis, sin registrarte.",
    subject: "Materia", level: "Nivel", all: "Todas",
    count: (n) => (n === 1 ? "1 herramienta" : `${n} herramientas`),
    empty: "Las primeras herramientas vienen en camino. Vuelve pronto.",
    noMatch: "Todavía no hay herramientas con estos filtros.",
    freeTool: "Herramienta interactiva gratis",
    preview: "Vista previa: no publicada. Los enlaces van al sitio en vivo.",
  },
};

const ld = (x) => `<script type="application/ld+json">\n${JSON.stringify(x, null, 2).replace(/</g, "\\u003c")}\n</script>`;
const other = (lang) => (lang === "es" ? "en" : "es");
const homeOf = (lang) => (lang === "es" ? "/es/" : "/");
const ogUrl = (doc, lang) => (doc.og && doc.og[lang] ? `/resources/${doc.og[lang]}` : "/og-image.png");
const isoDay = (iso) => (iso ? String(iso).slice(0, 10) : "");
const subjectLabel = (doc, lang) => (SUBJECTS[doc.subject] || SUBJECTS.other)[lang];
const levelLabels = (doc, lang) => doc.levels.map((l) => LEVELS[l][lang]);
const frameSrc = (doc, lang, frameBase = "/frame") => `${frameBase}/${doc.id}/v${doc.file.version}${lang === "es" ? "?lang=es" : ""}`;

const newest = M.newest;

function headCommon(shell, { lang, title, desc, canonical, alternates, image, noindex = false, extraCss = "", katex = false, gtm = true }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${gtm ? shell.gtmHead : ""}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ""}<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="${alternates.en}">
<link rel="alternate" hreflang="es" href="${alternates.es}">
<link rel="alternate" hreflang="x-default" href="${alternates.en}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Jose Diaz Tutoring">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:locale" content="${lang}_US">
<meta property="og:locale:alternate" content="${other(lang)}_US">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}${image}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}${image}">
<meta name="theme-color" content="#1C4C9E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${shell.fonts}" rel="stylesheet">
${katex ? `<link rel="stylesheet" href="${math.KATEX_CSS}">\n` : ""}<style>
  ${shell.css}
${shell.resourcesCss}
${extraCss}
</style>`;
}

function card(doc, lang, { headingTag = "h3", lazy = true } = {}) {
  const t = doc[lang];
  return `<li class="tool-card" data-subject="${esc(doc.subject)}" data-levels="${esc(doc.levels.join(" "))}">
  <a href="${M.pathOf(doc, lang)}">
    <img src="${ogUrl(doc, lang)}" alt="" width="1200" height="630"${lazy ? ' loading="lazy"' : ""} decoding="async">
    <span class="tool-card-body">
      <span class="tool-card-sub">${esc(subjectLabel(doc, lang))}</span>
      <${headingTag} class="tool-card-title">${esc(math.plain(t.title))}</${headingTag}>
      <span class="tool-card-desc">${esc(math.plain(t.description))}</span>
      <span class="tool-levels">${levelLabels(doc, lang).map((l) => `<span class="lvl">${esc(l)}</span>`).join("")}</span>
    </span>
  </a>
</li>`;
}

/** The home page's cards (3 newest), or "" when there are none. */
function homeCards(docs, lang) {
  const list = newest(docs.filter(M.isLive)).slice(0, 3);
  if (!list.length) return "";
  return `<ul class="tool-cards">\n${list.map((d) => card(d, lang)).join("\n")}\n</ul>`;
}

const ICON = {
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M6 13l6 6 6-6"/></svg>',
};

/**
 * One resource page. `all` = every resource (for related links). Options:
 *   preview: true  -> admin preview (noindex, no GTM, banner, links resolve to the live site)
 *   frameBase      -> where /frame/<id>/v<N> is served (the admin serves its own, for drafts)
 *   filesBase      -> origin for the PDF links ("" = this site; the admin serves draft files itself)
 */
function resourcePage({ doc, lang, shell, all = [], preview = false, frameBase = "/frame", filesBase = "" }) {
  const t = doc[lang], S = T[lang], o = other(lang);
  const url = (l) => `${SITE}${M.pathOf(doc, l)}`;
  const title = math.plain(t.title);
  const desc = math.plain(t.description);
  const fullTitle = `${title} — ${S.titleSuffix} | Jose Diaz Tutoring`;
  const image = ogUrl(doc, lang);
  const libPath = BASE[lang];
  const book = lang === "es" ? "/es/reservar/" : "/book/"; // the online booking page (Cal.com)
  const texts = [t.intro, ...t.howTo, ...t.keyIdeas, ...t.faq.flatMap((f) => [f.q, f.a])];
  const katex = texts.some(math.hasMath);

  const related = M.relatedFor(doc, all, 3);
  const files = M.uploadedFiles(doc);
  const exam = EXAM_LINKS.find((x) => x.en === doc.relatedExamPage);

  const crumbs = [
    { name: S.home, item: `${SITE}${homeOf(lang)}` },
    { name: S.resources, item: `${SITE}${libPath}` },
    { name: title, item: url(lang) },
  ];
  const lds = [
    {
      "@context": "https://schema.org",
      "@type": "LearningResource",
      name: title,
      description: desc,
      url: url(lang),
      inLanguage: lang,
      educationalLevel: levelLabels(doc, lang),
      about: { "@type": "Thing", name: subjectLabel(doc, lang) },
      learningResourceType: "interactive tool",
      interactivityType: "active",
      isAccessibleForFree: true,
      ...(t.keywords.length ? { keywords: t.keywords.join(", ") } : {}),
      author: { "@type": "Person", "@id": `${SITE}/#jose`, name: "Jose Diaz" },
      provider: { "@type": "ProfessionalService", "@id": `${SITE}/#business`, name: "Jose Diaz Tutoring" },
      image: `${SITE}${image}`,
      ...(doc.publishedAt ? { datePublished: isoDay(doc.publishedAt) } : {}),
      ...(doc.updatedAt ? { dateModified: isoDay(doc.updatedAt) } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })),
    },
  ];
  if (t.faq.length) {
    lds.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: url(lang),
      inLanguage: lang,
      mainEntity: t.faq.map((f) => ({ "@type": "Question", name: math.plain(f.q), acceptedAnswer: { "@type": "Answer", text: math.plain(f.a) } })),
    });
  }

  const langLinks = ["en", "es"].map((l) =>
    `<a href="${M.pathOf(doc, l)}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === lang ? ' aria-current="page"' : ""}>${l.toUpperCase()}</a>`).join("\n      ");

  const body = `<header class="res-bar">
    <a class="res-back" href="${libPath}"><span aria-hidden="true">←</span> ${esc(S.back)}</a>
    <a class="res-mark" href="${homeOf(lang)}" aria-label="${esc(S.homeLabel)}">Jose Diaz</a>
    <span class="res-title">${esc(title)}</span>
    <span class="res-actions">
      <a class="res-btn res-all" href="${libPath}" aria-label="${esc(S.allResources)}" title="${esc(S.allResources)}">${ICON.grid}<span class="res-lbl">${esc(S.allResources)}</span></a>
      <nav class="lang" aria-label="${lang === "es" ? "Idioma" : "Language"}">
        ${langLinks}
      </nav>
      <span class="res-share-wrap">
        <button class="res-btn" type="button" id="res-share" aria-label="${esc(S.share)}" title="${esc(S.share)}" data-copied="${esc(S.copied)}" data-failed="${esc(S.copyFailed)}">${ICON.share}<span class="res-lbl">${esc(S.share)}</span></button>
        <span class="res-toast" id="res-toast" hidden>${esc(S.copied)}</span>
      </span>
      <button class="res-btn res-fs" type="button" id="res-fs" hidden data-enter="${esc(S.fullscreen)}" data-exit="${esc(S.exitFullscreen)}" aria-label="${esc(S.fullscreen)}" title="${esc(S.fullscreen)}">${ICON.expand}</button>
      <a class="btn btn-primary res-cta" href="${book}" data-loc="bar"><span class="cta-full">${shell.s.ctaShort}</span><span class="cta-mini">${shell.s.ctaMini}</span></a>
      <span class="res-more">
        <button class="res-btn" type="button" id="res-more" aria-expanded="false" aria-controls="res-menu" aria-label="${esc(S.more)}" title="${esc(S.more)}">${ICON.dots}</button>
        <span class="res-menu" id="res-menu" hidden>
          <a href="${homeOf(lang)}">${esc(S.home)}</a>
          <a href="${M.pathOf(doc, o)}" hreflang="${o}" lang="${o}" data-lang="${o}">${esc(S.otherLang)}</a>
          <button type="button" id="res-menu-fs" hidden data-enter="${esc(S.fullscreen)}" data-exit="${esc(S.exitFullscreen)}">${esc(S.fullscreen)}</button>
        </span>
      </span>
    </span>
    <p class="sr-only" id="res-status" role="status" aria-live="polite"></p>
  </header>
${preview ? `  <p class="res-preview">${esc(S.preview)}</p>\n` : ""}
  <div class="res-stage" id="tool">
    <iframe id="res-frame" title="${esc(title)}" sandbox="${require("./frame.js").SANDBOX}" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <script>(function(){var f=document.getElementById("res-frame"),h=location.hash,ids=["main","tool","how","files","ideas","faq","related","get-help"];
      if(h.length>2000||ids.indexOf(h.slice(1))>=0)h="";f.src=${JSON.stringify(frameSrc(doc, lang, frameBase))}+h;window.__jdtToolHash=h;})();</script>
    <noscript><p class="res-noscript">${esc(S.noscript)}</p></noscript>
    <a class="res-cue" href="#how">${esc(S.cue)} ${ICON.down}</a>
  </div>

<main id="main">
  <div class="wrap res-wrap">
    <article class="note-sheet res-sheet">
      <nav class="crumbs" aria-label="${lang === "es" ? "Ruta de navegación" : "Breadcrumb"}">
        <ol><li><a href="${homeOf(lang)}">${esc(S.home)}</a></li><li><a href="${libPath}">${esc(S.resources)}</a></li><li aria-current="page">${esc(title)}</li></ol>
      </nav>
      <p class="res-kicker">${esc(subjectLabel(doc, lang))}${doc.levels.length ? ` · ${esc(levelLabels(doc, lang).join(" · "))}` : ""}</p>
      <h1>${math.inline(t.title)}</h1>
      <div class="res-intro">${math.paragraphs(t.intro)}</div>

      <section id="how" class="res-sec" tabindex="-1">
        <h2>${esc(S.howTo)}</h2>
        <ol class="res-steps">${t.howTo.map((s) => `\n          <li>${math.inline(s)}</li>`).join("")}
        </ol>
      </section>
${files.length ? `
      <section id="files" class="res-sec" data-resource-slug="${esc(doc.slugEn)}">
        <h2>${esc(S.files)}</h2>
        <ul class="res-files">${files.map((f) => `
          <li><a href="${filesBase}${esc(M.fileUrl(doc, f.name))}" target="_blank" rel="noopener" data-file="${esc(f.name)}">${esc((lang === "es" ? f.labelEs : f.labelEn) || f.name)}</a> <span class="res-file-size">· ${sizeLabel(f.sizeBytes, lang)}</span></li>`).join("")}
        </ul>
      </section>` : ""}
      <!-- phase3:email-me-this-tool -->
${t.keyIdeas.length ? `
      <section id="ideas" class="res-sec">
        <h2>${esc(S.keyIdeas)}</h2>
        <ul class="res-ideas">${t.keyIdeas.map((s) => `\n          <li>${math.inline(s)}</li>`).join("")}
        </ul>
      </section>` : ""}
${t.faq.length ? `
      <section id="faq" class="res-sec">
        <h2>${esc(S.faq)}</h2>
        <div class="faq">${t.faq.map((f) => `\n          <details><summary>${math.inline(f.q)}</summary><p>${math.inline(f.a)}</p></details>`).join("")}
        </div>
      </section>` : ""}
${exam ? `
      <p class="res-see-also">${esc(S.seeAlso)}: <a href="${exam[lang]}">${esc(exam.label[lang])}</a></p>` : ""}
    </article>
${related.length ? `
    <section id="related" class="res-related">
      <h2>${esc(S.related)}</h2>
      <ul class="tool-cards">
${related.map((d) => card(d, lang)).join("\n")}
      </ul>
    </section>` : ""}

    <section id="get-help" class="res-help">
      <h2>${esc(S.ctaHead)}</h2>
      <p>${esc(S.ctaText)}</p>
      <div class="guarantee">
        <svg class="check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.2 12.4l3.2 3.2 6.4-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>${shell.s.guarantee}</p>
      </div>
      <p class="res-help-cta"><a class="btn btn-primary" href="${book}" data-loc="cta">${shell.s.ctaLong}</a></p>
    </section>
    <!-- phase3:request-a-tool -->
  </div>
</main>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${preview ? `<base href="${SITE}/">\n` : ""}${headCommon(shell, { lang, title: fullTitle, desc, canonical: url(lang), alternates: { en: url("en"), es: url("es") }, image, noindex: preview, katex, gtm: !preview })}
${lds.map(ld).join("\n")}
</head>
<body class="res-page" data-resource-id="${esc(doc.id)}">
${preview ? "" : shell.gtmBody}
${shell.skip}

${body}

${shell.footer}

<script>
const LANG = "${lang}";
${shell.analytics}
</script>
<script>
${shell.langSwitch}
</script>
<script>
${shell.resourceJs}
</script>
</body>
</html>
`;
}

/** The library: every live resource, newest first, with subject and level filters. */
function libraryPage({ docs, lang, shell }) {
  const S = T[lang];
  const live = newest(docs.filter(M.isLive));
  const url = (l) => `${SITE}${BASE[l]}`;
  const subjects = Object.keys(SUBJECTS).filter((s) => live.some((d) => d.subject === s));
  const levels = Object.keys(LEVELS).filter((l) => live.some((d) => d.levels.includes(l)));
  const chips = (group, keys, labels) =>
    `<div class="lib-filter" role="group" aria-label="${esc(group === "subject" ? S.subject : S.level)}" data-group="${group}">
          <span class="lib-filter-label" aria-hidden="true">${esc(group === "subject" ? S.subject : S.level)}</span>
          <button type="button" class="chip" data-value="" aria-pressed="true">${esc(S.all)}</button>${keys.map((k) => `
          <button type="button" class="chip" data-value="${esc(k)}" aria-pressed="false">${esc(labels[k][lang])}</button>`).join("")}
        </div>`;
  const crumbs = [{ name: S.home, item: `${SITE}${homeOf(lang)}` }, { name: S.resources, item: url(lang) }];
  const lds = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: S.libTitle,
      description: S.libDesc,
      url: url(lang),
      inLanguage: lang,
      isPartOf: { "@id": `${SITE}/#website` },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: live.length,
        itemListElement: live.map((d, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}${M.pathOf(d, lang)}`, name: math.plain(d[lang].title) })),
      },
    },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })) },
  ];
  const footer = shell.footer.replace(`<a href="${BASE[lang]}"`, `<a href="${BASE[lang]}" aria-current="page"`);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headCommon(shell, { lang, title: S.libMetaTitle, desc: S.libDesc, canonical: url(lang), alternates: { en: url("en"), es: url("es") }, image: "/og-image.png" })}
${lds.map(ld).join("\n")}
</head>
<body class="lib-page">
${shell.gtmBody}
${shell.skip}

${shell.header}

<main id="main">
  <section class="band pad lib-band">
    <div class="wrap">
      <nav class="crumbs" aria-label="${lang === "es" ? "Ruta de navegación" : "Breadcrumb"}">
        <ol><li><a href="${homeOf(lang)}">${esc(S.home)}</a></li><li aria-current="page">${esc(S.resources)}</li></ol>
      </nav>
      <h1>${esc(S.libTitle)}</h1>
      <p class="lede">${esc(S.libLede)}</p>
    </div>
  </section>
  <section class="lib">
    <div class="wrap">
${live.length ? `${live.length > 1 ? `      <div class="lib-filters" id="lib-filters" hidden>
        ${chips("subject", subjects, SUBJECTS)}
        ${chips("level", levels, LEVELS)}
      </div>\n` : ""}      <p class="lib-count" id="lib-count" role="status" aria-live="polite" data-one="${esc(S.count(1))}" data-many="${esc(S.count(2).replace("2", "{n}"))}">${esc(S.count(live.length))}</p>
      <ul class="tool-cards" id="lib-list">
${live.map((d, i) => card(d, lang, { headingTag: "h2", lazy: i > 2 })).join("\n")}
      </ul>
      <p class="lib-empty" id="lib-nomatch" hidden>${esc(S.noMatch)}</p>` : `      <p class="lib-empty">${esc(S.empty)}</p>`}
      <!-- phase3:request-a-tool -->
    </div>
  </section>
${shell.wa}
</main>

${footer}

<script>
const LANG = "${lang}";
${shell.analytics}
</script>
<script>
${shell.langSwitch}
</script>
<script>
${shell.libraryJs}
</script>
</body>
</html>
`;
}

/** Sitemap <url> entries: the two library pages and every live resource in both languages (none while there are no live resources). */
function sitemapEntries(docs) {
  const live = docs.filter(M.isLive);
  if (!live.length) return ""; // an empty library is thin content: listed once there's a tool
  const lastLib = live.map((d) => isoDay(d.updatedAt || d.publishedAt)).sort().pop();
  const entry = (loc, lastmod) => `  <url>\n    <loc>${esc(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`;
  const out = [entry(`${SITE}${BASE.en}`, lastLib), entry(`${SITE}${BASE.es}`, lastLib)];
  for (const d of newest(live)) for (const l of ["en", "es"]) out.push(entry(`${SITE}${M.pathOf(d, l)}`, isoDay(d.updatedAt || d.publishedAt)));
  return out.join("\n");
}

module.exports = { T, resourcePage, libraryPage, homeCards, sitemapEntries, card, newest, ogUrl, frameSrc };
