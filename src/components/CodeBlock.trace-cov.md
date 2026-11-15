# Trace Coverage — CodeBlock.tsx

Satellite file: records which implementation anchors in CodeBlock.tsx (and its CSS / App.tsx wiring)
cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00004  (wrapper, button bar, `CopyButton` with
  `idle | busy | copied | failed` feedback reset after `COPY_FEEDBACK_MS`, restarted by every click; `busy` (hourglass,
  "Copying…", `aria-busy`) until the copy resolves, clicks ignored meanwhile; a copy that throws ends as failed;
  mouse-down keeps the selection) — UTST:
  `src/components/CodeBlock.test.tsx`
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00005  (bar marked `PREVIEW_UI_ATTR`, holds no text)
  — UTST: `src/components/CodeBlock.test.tsx`, first case
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00006  ("Copy SVG" before "Copy Mermaid Code" on a diagram;
  no SVG → failed, clipboard untouched) — UTST: `src/components/CodeBlock.test.tsx`, *CodeBlock — diagram*
  (5 cases)
- IMPL-LTTCE-PRV-00005 **covers** REQ-LTTCE-PRV-00007  ("Copy PNG image" first on a diagram, through
  `copyDiagramImage`; no PNG → failed, clipboard untouched; an unconfirmed picture keeps the hourglass up to
  `IMAGE_COPY_TIMEOUT_MS`, then failed) — UTST: `src/components/CodeBlock.test.tsx`,
  *CodeBlock — diagram* (order) and *CodeBlock — Copy PNG image* (4 cases)
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

**STST — Linux, "Copy PNG image" only.** `src-tauri/examples/paste_image_e2e.rs` (build-test step 1f):
in the release app under xvfb, the pointer is moved over a diagram and its "Copy PNG image" is clicked
through XTest — real X input, so a genuine user gesture for WebKitGTK — and the clipboard must then hold
a picture; pasted back into the editor, it must be saved as a PNG of exactly that size
(REQ-LTTCE-PRV-00007). This also shows that the button's hover visibility works (REQ-LTTCE-PRV-00004).
Verified by the author: WebKitGTK 2.52.6 puts a real `image/png` on the clipboard.

**STST — open on macOS, and for "Copy SVG" / "Copy Mermaid Code" on Linux.** The E2E harness runs on
Windows only (headless WKWebView and WebKitGTK were flaky). WebKit allows clipboard writes only inside a
real user gesture, and a scripted `click()` is not one, so a driver like the Windows one would test the
refusal, not the copy. The print/hover CSS (REQ-LTTCE-PRV-00004 / 00005) has no
automated end-to-end check on any platform.
