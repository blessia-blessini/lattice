# Trace Coverage — App.tsx / App.css

Satellite file: records which implementation anchors in App.tsx and App.css cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-LNT-00002 **covers** REQ-LTTCE-LNT-00003
- IMPL-LTTCE-LNT-00002 **covers** ARCH-LTTCE-LNT-00002
- IMPL-LTTCE-LNT-00003 **covers** REQ-LTTCE-LNT-00004
- IMPL-LTTCE-LNT-00003 **covers** ARCH-LTTCE-LNT-00002
- IMPL-LTTCE-LNK-00001 **covers** REQ-LTTCE-LNK-00001
- IMPL-LTTCE-LNK-00001 **covers** REQ-LTTCE-LNK-00002
- IMPL-LTTCE-LNK-00001 **covers** REQ-LTTCE-LNK-00004
- IMPL-LTTCE-LNK-00001 **covers** REQ-LTTCE-LNK-00005
- IMPL-LTTCE-LNK-00001 **covers** REQ-LTTCE-LNK-00007
- IMPL-LTTCE-LNK-00001 **covers** ARCH-LTTCE-LNK-00001
- IMPL-LTTCE-LNK-00003 **covers** REQ-LTTCE-LNK-00003
- IMPL-LTTCE-LNK-00003 **covers** ARCH-LTTCE-LNK-00001
- IMPL-LTTCE-DVW-00003 **covers** REQ-LTTCE-DVW-00001
- IMPL-LTTCE-DVW-00003 **covers** REQ-LTTCE-DVW-00003
- IMPL-LTTCE-DVW-00003 **covers** ARCH-LTTCE-DVW-00001
- IMPL-LTTCE-DVW-00004 **covers** REQ-LTTCE-DVW-00002
- IMPL-LTTCE-DVW-00004 **covers** REQ-LTTCE-DVW-00003
- IMPL-LTTCE-DVW-00004 **covers** ARCH-LTTCE-DVW-00001
- IMPL-LTTCE-DVW-00005 **covers** REQ-LTTCE-DVW-00001
- IMPL-LTTCE-DVW-00005 **covers** REQ-LTTCE-DVW-00002
- IMPL-LTTCE-DVW-00005 **covers** ARCH-LTTCE-DVW-00001
- IMPL-LTTCE-FWT-00002 **covers** REQ-LTTCE-FWT-00002
- IMPL-LTTCE-FWT-00002 **covers** REQ-LTTCE-FWT-00003
- IMPL-LTTCE-FWT-00002 **covers** ARCH-LTTCE-FWT-00001
- IMPL-LTTCE-MRC-00002 **covers** REQ-LTTCE-MRC-00002
- IMPL-LTTCE-MRC-00002 **covers** REQ-LTTCE-MRC-00003
- IMPL-LTTCE-MRC-00002 **covers** REQ-LTTCE-MRC-00004
- IMPL-LTTCE-MRC-00002 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-SEL-00004 **covers** REQ-LTTCE-SEL-00001
- IMPL-LTTCE-SEL-00004 **covers** REQ-LTTCE-SEL-00002
- IMPL-LTTCE-SEL-00004 **covers** REQ-LTTCE-SEL-00003
- IMPL-LTTCE-SEL-00004 **covers** ARCH-LTTCE-SEL-00001
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00004
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00009  (waits with Rust's `exportSettleMs`; an
  unsettled diagram fails the export through `export_ready({ error })`) — UTST: `src/App.test.tsx`,
  *App — headless export launch* (budget pass-through; html and pdf incomplete-document cases)
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00010  (sets `EXPORT_MODE_ATTR` on `<html>` before the
  document loads, so diagrams rasterise without an idle slot; a raster failure fails the export at
  once) — UTST: `src/App.test.tsx`, *App — headless export launch* (html and pdf mark the window, an
  ordinary launch does not, raster-failure message)
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00012  (passes Rust's `exportPageMarginsMm` to
  `applyPrintStyle` in the PDF launch branch, and keeps them in a ref for a later `beforeprint`) —
  UTST: `src/App.test.tsx`, *App — headless export launch* (three REQ-LTTCE-XPT-00012 cases)
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00013  (the HTML launch branch loads
  `lib/export-document.ts` with a dynamic `import()` and wraps `buildExportHtml`'s output in
  `buildExportDocument`) — UTST: `src/App.test.tsx`, *App — headless export launch* (an HTML launch
  hands back a whole document titled with the file name and carrying KaTeX's sheet)
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00014  (passes the preview root's `data-theme`, read
  from the DOM, to `buildExportDocument`; imports `preview-theme.css` for the pane) — UTST:
  `src/App.test.tsx`, *App — headless export launch* (the article carries the preview root's theme;
  the preview is serialised in the same turn it settled — a re-render landing after the settle must
  not reach the file, which reproduces CI run 37351395621 against the earlier import order)
- IMPL-LTTCE-XPT-00002 **covers** ARCH-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00002 **covers** ARCH-LTTCE-XPT-00002
- IMPL-LTTCE-XPT-00002 **covers** ARCH-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00002 **covers** ARCH-LTTCE-XPT-00004
