# Trace Coverage — CodeBlock.tsx

Satellite file: records which implementation anchors in CodeBlock.tsx (and its CSS / App.tsx wiring)
cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00004  (wrapper, button bar, `CopyButton` with
  `idle | copied | failed` feedback reset after `COPY_FEEDBACK_MS`, restarted by every click; mouse-down keeps the selection) — UTST:
  `src/components/CodeBlock.test.tsx`
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00005  (bar marked `PREVIEW_UI_ATTR`, holds no text)
  — UTST: `src/components/CodeBlock.test.tsx`, first case
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00006  ("Copy SVG" before "Copy code" on a diagram;
  no SVG → failed, clipboard untouched) — UTST: `src/components/CodeBlock.test.tsx`, *CodeBlock — diagram*
  (4 cases)
- IMPL-LTTCE-PRV-00005 **covers** ARCH-LTTCE-PRV-00003  (also the `pre(props)` renderer in `App.tsx`)
  — ITST: `src/App.code-copy.test.tsx`
- IMPL-LTTCE-PRV-00006 (button CSS in `src/App.css`) **covers** REQ-LTTCE-PRV-00004  (visible on hover,
  focus, non-idle state, `hover: none`) and REQ-LTTCE-PRV-00005  (`display: none` in print, so also in
  the PDF export); the `<pre>` block margin moved onto `.code-block` so github-markdown-css's
  `:first-child` / `:last-child` margin rules still apply. Not unit-testable: jsdom applies no stylesheet and has no hover or print media.

**STST — open.** No end-to-end test covers this chapter yet. A real one needs the E2E harness
(Windows only) to click a button in the WebView and read the system clipboard back, which the stack
cannot do without a new dependency. What the WebView itself decides
— whether `navigator.clipboard.writeText` is allowed, and the print/hover CSS — is therefore verified
only by trying it in the running app.
