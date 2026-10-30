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
- IMPL-LTTCE-DLN-00005 **covers** REQ-LTTCE-DLN-00001  (one handler for the menu entry and the 🗒 toolbar
  button left of the font-size controls; passes the loaded prefix and title mode to `open_daily_note`, then
  `loadDocument`) — UTST: `src/App.coverage.test.tsx`, *App — handleOpenDailyNote*
- IMPL-LTTCE-DLN-00005 **covers** REQ-LTTCE-DLN-00005  (falls back to `DLN` for a malformed loaded prefix) —
  UTST: same suite
- IMPL-LTTCE-DLN-00005 **covers** ARCH-LTTCE-DLN-00001
- IMPL-LTTCE-DLN-00007 **covers** REQ-LTTCE-DLN-00007  (`handleOpenDailyNote` alerts, naming Settings ▸ Daily
  Notes ▸ "Daily Notes Path", when no path is known; no `open_daily_note` call) — UTST:
  `src/App.coverage.test.tsx`, *App — handleOpenDailyNote*, "tells the user, and does nothing else" (failed
  before the change)
- IMPL-LTTCE-DLN-00007 **covers** ARCH-LTTCE-DLN-00001
- IMPL-LTTCE-VLT-00001 **covers** REQ-LTTCE-VLT-00001  (`checkLaunch` treats a payload with an empty path as
  "no document": session restore, else the vault for "no document") — UTST: `src/App.coverage.test.tsx`,
  *App — launch without a file (empty payload)*: vault resolved and settings loaded, 🗒 works with no file
  opened, session restore still runs; all three failed before the fix
- IMPL-LTTCE-VLT-00001 **covers** ARCH-LTTCE-VLT-00001
- STST: `examples/e2e_harness.rs` scenario `last_vault`, launches 2 and 3 — a window opened without a
  document creates and opens today's note with no file or Settings opened first (Windows only; the
  isolated E2E home keeps it off the real home vault). See `src-tauri/src/last_vault.trace-cov.md`.
- IMPL-LTTCE-FOS-00003 **covers** REQ-LTTCE-FOS-00003  (`m_readOnlyPath` from the Direct Push payload's
  `readOnly`; `<Editor readOnly>` only while that path is the current file)
- IMPL-LTTCE-FOS-00003 **covers** ARCH-LTTCE-FOS-00003
- IMPL-LTTCE-RCT-00002 **covers** REQ-LTTCE-RCT-00001  (`addToMRU` / `removeFromMRU` through `updateMRU`:
  newest first, each path once, `MRU_MAX` = 20, persisted under `MRU_STORAGE_KEY`) — UTST:
  `src/App.coverage.test.tsx`, *App — MRU localStorage init*, *App — MRU truncation*
- IMPL-LTTCE-RCT-00002 **covers** REQ-LTTCE-RCT-00002  (`openRecent`: `notFound` → `confirm` naming the
  path, OK removes, Cancel keeps, never opened; `unavailable` or a failing check → opened as before, kept) —
  UTST: `src/App.coverage.test.tsx`, *App — MRU submenu item click* (file; not found + OK; not found + Cancel;
  unavailable; check throws)
- IMPL-LTTCE-RCT-00002 **covers** ARCH-LTTCE-RCT-00001
