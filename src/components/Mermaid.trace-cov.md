# Trace Coverage — Mermaid.tsx / lib/svg-raster.ts

Satellite file: records which implementation anchors in the diagram-copy path cover which requirements
and architecture sections.
`lib/preview-copy.ts` has its own satellite, `src/lib/preview-copy.trace-cov.md`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-MRC-00001 **covers** REQ-LTTCE-MRC-00001
- IMPL-LTTCE-MRC-00001 **covers** REQ-LTTCE-MRC-00004
- IMPL-LTTCE-MRC-00001 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-MRC-00003 **covers** REQ-LTTCE-MRC-00005
- IMPL-LTTCE-MRC-00003 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-MRC-00001 **covers** REQ-LTTCE-XPT-00010  (`Mermaid.tsx` PNG cache: a null rasterisation
  sets `DIAGRAM_PNG_FAILED_ATTR`, a success clears it; under `EXPORT_MODE_ATTR` it runs at once instead
  of in an idle callback) — UTST: `src/components/Mermaid.test.tsx`, *PNG cache final state and export
  mode* (5 cases)
