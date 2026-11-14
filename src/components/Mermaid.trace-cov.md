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
- IMPL-LTTCE-PRV-00007 **covers** REQ-LTTCE-PRV-00006  (`Mermaid.tsx` PNG cache records the SVG it
  rasterises as the diagram's copy SVG — the light re-render when "Copy Diagrams On Light Background"
  applies — and forgets it on every re-render) — UTST: `src/components/Mermaid.test.tsx`, *copy SVG*
  (3 cases; the re-render case fails with the `forgetDiagramSvg` call removed)
- IMPL-LTTCE-PRV-00007 **covers** ARCH-LTTCE-PRV-00003
