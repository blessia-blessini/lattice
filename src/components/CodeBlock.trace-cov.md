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
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00006  ("Copy SVG" before "Copy Mermaid Code" on a diagram;
  no SVG → failed, clipboard untouched) — UTST: `src/components/CodeBlock.test.tsx`, *CodeBlock — diagram*
  (4 cases)
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00007  ("Copy PNG image" first on a diagram, through
  `copyDiagramImage`; no PNG → failed, clipboard untouched) — UTST: `src/components/CodeBlock.test.tsx`,
  *CodeBlock — diagram* (order) and *CodeBlock — Copy PNG image* (2 cases)
- IMPL-LTTCE-PRV-00005 **covers** ARCH-LTTCE-PRV-00003  (also the `pre(props)` renderer in `App.tsx`)
  — ITST: `src/App.code-copy.test.tsx`
- IMPL-LTTCE-PRV-00006 (button CSS in `src/App.css`) **covers** REQ-LTTCE-PRV-00004  (visible on hover,
  focus, non-idle state, `hover: none`) and REQ-LTTCE-PRV-00005  (`display: none` in print, so also in
  the PDF export); the `<pre>` block margin moved onto `.code-block` so github-markdown-css's
  `:first-child` / `:last-child` margin rules still apply. Not unit-testable: jsdom applies no stylesheet and has no hover or print media.

**STST — Windows.** `src-tauri/examples/e2e_harness.rs`, scenario `copy_diagram` (driver
`src/services/StaticRuntime/CopyDiagramE2EDriver.ts`): in the real WebView2, a diagram's "Copy Mermaid Code",
"Copy SVG" and "Copy PNG image" are clicked with the real mouse (a genuine user gesture), and the system clipboard is read back after each through
Windows PowerShell's built-in clipboard class — the Mermaid source (REQ-LTTCE-PRV-00004), a standalone
SVG (REQ-LTTCE-PRV-00006), an image of the PNG's exact size (REQ-LTTCE-PRV-00007).

**STST — open on macOS and Linux.** The E2E harness runs on Windows only (headless WKWebView and
WebKitGTK were flaky). Beyond that, WebKit allows clipboard writes only inside a real user gesture, and a
scripted `click()` is not one, so a driver like the Windows one would test the refusal, not the copy. What
those WebViews decide — whether the copy command and `ClipboardItem` (WebKitGTK may not support
`image/png`) work there — is unverified. The print/hover CSS (REQ-LTTCE-PRV-00004 / 00005) has no
automated end-to-end check on any platform.
