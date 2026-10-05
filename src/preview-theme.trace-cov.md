# Trace Coverage — preview-theme.css

Satellite file: records which implementation anchors in preview-theme.css cover which requirements and
architecture sections. The block moved here from `App.css` unchanged, so the HTML export can embed it
(ARCH-LTTCE-XPT-00004).
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-PRV-00003 **covers** REQ-LTTCE-PRV-00002  (code-token palettes, light and dark)
- IMPL-LTTCE-PRV-00003 **covers** ARCH-LTTCE-PRV-00002
- IMPL-LTTCE-PRV-00003 **covers** REQ-LTTCE-XPT-00014  (embedded in every `--export-html` file by
  `lib/export-document.ts`)
- IMPL-LTTCE-PRV-00003 **covers** ARCH-LTTCE-XPT-00004

## Test coverage

- `src/App.test.tsx` — *App.css invariants*: the dark override uses the variable names github-markdown-css
  defines (now read from this file).
- `src/lib/export-document.test.ts` — the file is embedded, before KaTeX and github-markdown-css, with
  both token palettes.
