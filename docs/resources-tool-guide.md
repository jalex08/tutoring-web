# Tool generation snippet

Paste this into any AI prompt when you create a tool for `/resources/`. It's what the site expects. The
tool runs full screen in a sandboxed iframe (no cookies, no storage, no access to the page around it).
The page's **Copy link** button shares the tool's setup only if the tool keeps its values in the URL #hash.

The admin warns, without blocking, when a file breaks one of these rules.

```text
Build this as ONE self-contained HTML file (inline CSS and JS; libraries from a public CDN
are fine). It will run full screen inside a sandboxed iframe on my tutoring site.

Requirements:
- Works on phones (360 px wide) and desktops. No site header, footer, logo or links to
  other sites. No forms that send data anywhere and no calls to external APIs.
- Keep every adjustable value in the URL hash (for example #angle=30&r=1&unit=deg).
  Read the hash on load; update it with history.replaceState whenever a value changes.
- Don't rely on localStorage, sessionStorage or cookies.
- Language: English by default. If you can, include Spanish UI text too and use it when
  the page URL has ?lang=es (Spanish uses "tú").
- Look: light background; ink blue #1C4C9E for controls and the main curve/vector;
  graphite #232A2A for text; highlighter yellow #F6E15A at most once, for the key result.
  Fonts from Google Fonts: Bricolage Grotesque (headings), Atkinson Hyperlegible (body).
- Every control has a visible label and units; keyboard accessible; touch targets at least
  44 px; respects prefers-reduced-motion.
- Show the math: the formula being used, with the live substituted values, so students see
  why the result is what it is.
- Include a "Reset" button that returns to the default values.
```

## What the site does with the file

- It serves the file at `/frame/<id>/v<N>` with `Content-Security-Policy: sandbox …` (no
  `allow-same-origin`) and `frame-ancestors 'self'`. The tool runs at an opaque origin: it can't read
  the site's cookies, pages or forms, even when opened directly. Other sites can't embed it.
- It adds one small script at the very top of the file:
  - **Storage shim:** `localStorage`, `sessionStorage` and `document.cookie` work in memory, so tools
    that use them don't crash. Nothing is kept between visits.
  - **Bridge:** when the tool's `#hash` changes (`hashchange`, `history.replaceState`/`pushState`), it
    tells the page, which copies the hash into its own address bar. Copy link and the EN/ES switch
    carry it, and opening that link restores the setup.
- The Spanish page loads the same file with `?lang=es`.
- Links the tool opens in a new tab (`target="_blank"`) open as ordinary tabs: the sandbox has
  `allow-popups-to-escape-sandbox`, so a PDF shows in the browser's viewer. The tool itself stays
  sandboxed (no `allow-same-origin`, no `allow-top-navigation`).

## Printable PDFs

A resource can have up to 20 PDFs (10 MB each), served at `/resources/<EN slug>/files/<name>` — the
same URL from the English and the Spanish page. The tool can link to them directly:

```js
const PDF_BASE = location.protocol === "file:" ? "" : "/resources/<EN slug>/files/";
// <a href="${PDF_BASE}My_Unit.pdf" target="_blank" rel="noopener">
```

- Names: letters, numbers, dots, hyphens and underscores, ending in lowercase `.pdf`
  (`PHY2053_Newtons_Laws_Formula_Cards.pdf`). Upper case is kept; two names can't differ only in case.
- The page lists them under "How to use it" ("Printable PDFs" / "PDF para imprimir"): label · size, in
  the config's order, opening in a new tab. Clicks on that list send `resource_file_open`
  (`resource_slug`, `file_name`); clicks inside the tool can't be counted (sandbox).
- The PDFs are `noindex` and not in the sitemap: the page is what should rank.
- In the admin, drop the .html, the .json and every PDF at once. PDFs are matched to the config's
  `files` by exact name; a checklist shows each listed file found or missing, and any dropped PDF the
  config doesn't list (with labels to fill in and an Add button). Publish waits until every listed PDF
  is uploaded. The Files section reorders, relabels, replaces (same URL) and deletes them.

## The config file (`<name>.json`, version 1)

Ask the AI for a second file with the same base name as the tool: `trigonometry-playground.html` and
`trigonometry-playground.json`. Drop both on the admin's file box, at once and in any order, or one at
a time. The JSON fills every field of the page text. Example: `test/fixtures/trigonometry-playground.json`.

```json
{
  "version": 1,
  "file": "trigonometry-playground.html",
  "subject": "geometry-trig",
  "levels": ["high-school", "college"],
  "courseTags": ["Geometry", "Algebra 2"],
  "en": {
    "title": "…", "slug": "…", "description": "… (155 characters max)",
    "intro": "First paragraph.\n\nSecond paragraph.",
    "howTo": ["Step one.", "Step two."],
    "keyIdeas": ["$\\sin^2\\theta + \\cos^2\\theta = 1$"],
    "faq": [{ "q": "…", "a": "…" }],
    "keywords": ["…"]
  },
  "es": { "same keys": "…" },
  "files": [
    { "file": "My_Unit_1.pdf", "en": "Unit 1: vectors", "es": "Unidad 1: vectores" }
  ],
  "related": ["projectile-motion-lab"]
}
```

- `subject`: algebra, geometry-trig, precalc, calculus, physics, circuits, digital-logic, programming,
  embedded or other. `levels`: high-school, college, engineering.
- `intro`: a blank line (`\n\n`) between paragraphs. Any text may use `$…$` math.
- Required in both languages: title, slug, description, intro, howTo and keyIdeas. `faq` and `keywords`
  are optional.
- `files` (optional): the printable PDFs, in display order, each with an EN and an ES label (see
  "Printable PDFs"). A config without `files` leaves the resource's files as they are.
- `related` (optional): EN slugs of resources to show first under "Related resources", in order.
  After those come resources sharing a course tag (most shared first, then newest), then the same
  subject (newest first); 3 in all. Unpublished ones are skipped until they're published.
- The admin fills the form; it doesn't publish. Problems (a `file` that doesn't match the .html, missing
  fields, a description over 155 characters, an invalid subject or level, a slug that's taken, with a
  one-click `slug-2`) show next to the field. Values are never dropped silently.
- Every uploaded config is kept as it was. Download it under the file box ("Config files").
- Replacing a live tool with a new .html + .json asks "Update the page text from the config?" (OK = yes).
  An .html alone replaces only the tool; a .json alone updates only the page text.
