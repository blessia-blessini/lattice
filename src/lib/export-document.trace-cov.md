# Trace Coverage — export-document.ts

Satellite file: records which implementation anchors in export-document.ts cover which requirements
and architecture sections. The headless-export feature as a whole is traced in
`src-tauri/src/export.trace-cov.md`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-XPT-00008 **covers** REQ-LTTCE-XPT-00013  (`buildExportDocument`: doctype, UTF-8 head,
  file-name title, KaTeX's sheet with its woff2 fonts as `data:` URLs; the body unchanged)
- IMPL-LTTCE-XPT-00008 **covers** REQ-LTTCE-XPT-00014  (embeds `preview-theme.css` and
  github-markdown-css in `App.tsx`'s import order; the body in `<article class="markdown-body"
  data-theme>`; `exportPageCss`, `resolveExportTheme`, `joinStylesheets`)
- IMPL-LTTCE-XPT-00008 **covers** ARCH-LTTCE-XPT-00004
- IMPL-LTTCE-FOS-00005 **covers** REQ-LTTCE-FOS-00005  (`cssNoticeComment` puts
  `export-notices.generated.txt` first in `exportStylesheet()`, as a `/*! … */` comment; refuses an empty
  text and `*/`. The generator side is in `scripts/foss/foss.trace-cov.md`)
- IMPL-LTTCE-FOS-00005 **covers** ARCH-LTTCE-FOS-00005

## Test coverage

- UTST: `src/lib/export-document.test.ts` — 38 cases, run against the stylesheets and fonts this build
  bundles. REQ-LTTCE-XPT-00013 (19): one KaTeX release in `package-lock.json`, so the renderer's HTML
  is the sheet's own; the MathML-hiding and root-bar-clipping rules survive; one
  embedded woff2 per `@font-face` and no relative font URL left; `fontDataUrlsByName` on both path
  separators; `inlineKatexFonts` on minified and quoted `src:` lists, the declaration boundary, a
  missing font throws; `escapeHtmlText`; `buildExportDocument` structure and escaped title.
  REQ-LTTCE-XPT-00014 (11): theme resolution, page frame per theme, the `</style` guard, sheet order,
  both token palettes, the article wrapper and its theme, a token reached by the palette selector.
  REQ-LTTCE-FOS-00005 (8): `cssNoticeComment` wraps, normalises CRLF, refuses `*/` and an empty text;
  the sheet opens with the generated notices; they name KaTeX's and github-markdown-css's holders, licence
  and text, and the installed version of each of the two packages.
- ITST: ITST-LTTCE-XPT-00010 — `src-tauri/examples/export_demo.rs` `check_standalone` and
  `check_preview_look`, on the file the real binary writes, on every desktop CI leg.
- STST: STST-LTTCE-FOS-00005 — `export_demo.rs` `check_notices` on the same file: the `<style>` opens
  with the notices comment, which names both holders and carries the licence text (4 unit cases).
