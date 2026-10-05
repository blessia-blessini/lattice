# Trace Coverage — export-document.ts

Satellite file: records which implementation anchors in export-document.ts cover which requirements
and architecture sections. The headless-export feature as a whole is traced in
`src-tauri/src/export.trace-cov.md`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-XPT-00008 **covers** REQ-LTTCE-XPT-00013  (`buildExportDocument`: doctype, UTF-8 head,
  file-name title, KaTeX's sheet with its woff2 fonts as `data:` URLs; the body unchanged)
- IMPL-LTTCE-XPT-00008 **covers** ARCH-LTTCE-XPT-00004

## Test coverage

- UTST: `src/lib/export-document.test.ts` — 18 cases, run against the KaTeX sheet and fonts this
  build bundles (the MathML-hiding and root-bar-clipping rules survive; one embedded woff2 per
  `@font-face` and no relative font URL left; `fontDataUrlsByName` on both path separators;
  `inlineKatexFonts` on minified and quoted `src:` lists, the declaration boundary, a missing font
  throws; `escapeHtmlText`; `buildExportDocument` structure and escaped title).
- ITST: ITST-LTTCE-XPT-00010 — `src-tauri/examples/export_demo.rs` `check_standalone`, on the file
  the real binary writes, on every desktop CI leg.
