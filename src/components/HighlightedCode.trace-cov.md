# Trace Coverage — HighlightedCode.tsx

Satellite file: records which implementation anchors in HighlightedCode.tsx (and its CSS / App.tsx
wiring) cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-PRV-00002 **covers** REQ-LTTCE-PRV-00001
- IMPL-LTTCE-PRV-00002 **covers** REQ-LTTCE-PRV-00003
- IMPL-LTTCE-PRV-00002 **covers** ARCH-LTTCE-PRV-00001
- IMPL-LTTCE-PRV-00002 **covers** REQ-LTTCE-XPT-00014  (`HIGHLIGHT_PENDING_ATTR` on the `<code>` while
  the parser for the current tag loads; removed on any outcome) — UTST:
  `src/components/HighlightedCode.test.tsx` (3 pending-marker cases)
- IMPL-LTTCE-PRV-00002 **covers** ARCH-LTTCE-XPT-00004
- IMPL-LTTCE-PRV-00003 (token palettes, now in `src/preview-theme.css`) **covers** REQ-LTTCE-PRV-00002 —
  see `src/preview-theme.trace-cov.md`
