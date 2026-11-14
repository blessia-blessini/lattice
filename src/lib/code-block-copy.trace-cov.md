# Trace Coverage — code-block-copy.ts

Satellite file: records which implementation anchors in code-block-copy.ts cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-PRV-00004 **covers** REQ-LTTCE-PRV-00004  (`fenceText` — the Markdown source between the
  fences, final line break dropped, taken from the hast node, so a Mermaid fence gives its source and a
  highlighted one its plain text; `copyText` — the synchronous `execCommandCopy` first,
  inside the user gesture, the Async Clipboard API only as fallback; `execCommandCopy` restores focus
  and selection; a success flag, never rejects) — UTST: `src/lib/code-block-copy.test.ts` (all cases)
- IMPL-LTTCE-PRV-00004 **covers** REQ-LTTCE-PRV-00006  (`isMermaidFence`; `diagramSvgText` — the
  recorded copy SVG, else the SVG on screen, `null` without one; `serializeSvg` — XML serialisation,
  literal `xmlns` attributes removed so none is declared twice; `rememberDiagramSvg` /
  `forgetDiagramSvg`) — UTST: `src/lib/code-block-copy.test.ts`, *isMermaidFence*, *serializeSvg*,
  *diagramSvgText*
- IMPL-LTTCE-PRV-00004 **covers** REQ-LTTCE-PRV-00005  (`PREVIEW_UI_ATTR` and `stripPreviewUi` live in
  `preview-copy.ts` next to the other shared preview attributes — see `src/lib/preview-copy.trace-cov.md`)
- IMPL-LTTCE-PRV-00004 **covers** ARCH-LTTCE-PRV-00003
- ITST: `src/App.code-copy.test.tsx` — the real App's Markdown pipeline: buttons on tagged, untagged and
  Mermaid fences but not on inline code, "Copy SVG" on the diagram only; the copied text (a diagram
  copies its source, or its SVG); the export without a button
- STST: none automated — see `src/components/CodeBlock.trace-cov.md`
