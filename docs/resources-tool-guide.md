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
  "es": { "same keys": "…" }
}
```

- `subject`: algebra, geometry-trig, precalc, calculus, physics, circuits, digital-logic, programming,
  embedded or other. `levels`: high-school, college, engineering.
- `intro`: a blank line (`\n\n`) between paragraphs. Any text may use `$…$` math.
- Required in both languages: title, slug, description, intro, howTo and keyIdeas. `faq` and `keywords`
  are optional.
- The admin fills the form; it doesn't publish. Problems (a `file` that doesn't match the .html, missing
  fields, a description over 155 characters, an invalid subject or level, a slug that's taken, with a
  one-click `slug-2`) show next to the field. Values are never dropped silently.
- Every uploaded config is kept as it was. Download it under the file box ("Config files").
- Replacing a live tool with a new .html + .json asks "Update the page text from the config?" (OK = yes).
  An .html alone replaces only the tool; a .json alone updates only the page text.
