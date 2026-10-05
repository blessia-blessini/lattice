# Trace Coverage — Mermaid.tsx / lib/svg-raster.ts / lib/preview-copy.ts

Satellite file: records which implementation anchors in the diagram-copy path cover which requirements
and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-MRC-00001 **covers** REQ-LTTCE-MRC-00001
- IMPL-LTTCE-MRC-00001 **covers** REQ-LTTCE-MRC-00004
- IMPL-LTTCE-MRC-00001 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-MRC-00002 **covers** REQ-LTTCE-MRC-00002
- IMPL-LTTCE-MRC-00002 **covers** REQ-LTTCE-MRC-00003
- IMPL-LTTCE-MRC-00002 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-MRC-00003 **covers** REQ-LTTCE-MRC-00005
- IMPL-LTTCE-MRC-00003 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-XPT-00001 **covers** REQ-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00001 **covers** ARCH-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00001 **covers** REQ-LTTCE-XPT-00009  (`waitForPreviewSettled` reports
  `{ pending, total }` instead of resolving on timeout; `describeUnsettledPreview` builds the failure
  message; `resolveSettleTimeout` validates `exportSettleMs`) — UTST: `src/lib/preview-copy.test.ts`,
  *waiting for diagrams to settle* and *unsettled diagrams are an export failure*
- IMPL-LTTCE-XPT-00001 **covers** REQ-LTTCE-XPT-00010  (`waitForPreviewSettled` ends on a
  `MutationObserver`, not a polling timer, and counts `DIAGRAM_PNG_FAILED_ATTR` as final;
  `describeUnsettledPreview` reports a raster failure as its own cause) — UTST:
  `src/lib/preview-copy.test.ts`, *settling is event-driven, not timed* (settles with every timer frozen
  — fails against the old polling loop) and the two raster-failure message cases
- IMPL-LTTCE-XPT-00001 **covers** REQ-LTTCE-XPT-00014  (`HIGHLIGHT_PENDING_ATTR`; `waitForPreviewSettled`
  — formerly `waitForDiagramsSettled` — also waits until no code block is still loading its
  highlighting, counted as `codePending`; `describeUnsettledPreview` turns code still pending at the
  backstop into a failure) — UTST: `src/lib/preview-copy.test.ts`, *the settle wait covers code
  highlighting* (5 cases)
- IMPL-LTTCE-XPT-00001 **covers** ARCH-LTTCE-XPT-00004
- IMPL-LTTCE-MRC-00001 **covers** REQ-LTTCE-XPT-00010  (`Mermaid.tsx` PNG cache: a null rasterisation
  sets `DIAGRAM_PNG_FAILED_ATTR`, a success clears it; under `EXPORT_MODE_ATTR` it runs at once instead
  of in an idle callback) — UTST: `src/components/Mermaid.test.tsx`, *PNG cache final state and export
  mode* (5 cases)
