# Trace Coverage — export.rs / lib.rs (`build_window_with_file_ex`) / platform/cli_args.rs / platform/mod.rs (`print_to_pdf`, `PdfDone`) / platform/impls/{windows,linux,macos}.rs / src/lib/print-style.ts

Satellite file: records which implementation anchors in the headless `--export-html` / `--export-pdf`
path cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

## HTML export

- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00002
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00003 **covers** ARCH-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00004 **covers** REQ-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00004 **covers** ARCH-LTTCE-XPT-00001

## PDF export

- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00004  (frontend launch branch, `App.tsx`)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00004  (orchestration + output naming, `export.rs`)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00005
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00006  (bounded `PDF_PRINT_TIMEOUT`, per-file failure)
- IMPL-LTTCE-XPT-00004 **covers** REQ-LTTCE-XPT-00006  (non-zero process exit code)
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00004  (host-WebView print backends)
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00006  (unsupported platform reported as a failure)
- IMPL-LTTCE-XPT-00005 **covers** ARCH-LTTCE-XPT-00002
- IMPL-LTTCE-XPT-00006 **covers** REQ-LTTCE-XPT-00004  (shared print stylesheet, `lib/print-style.ts`)
- IMPL-LTTCE-XPT-00006 **covers** ARCH-LTTCE-XPT-00002

---

## Test coverage of the anchors above

| Anchor                | Unit / automatic tests                                                        |
| :-------------------- | :---------------------------------------------------------------------------- |
| IMPL-LTTCE-XPT-00002  | `src/App.test.tsx` — *App — headless export launch* (6 cases)                  |
| IMPL-LTTCE-XPT-00003  | `src-tauri/src/export.rs` `mod tests`; `platform/cli_args.rs` `mod tests`      |
| IMPL-LTTCE-XPT-00004  | not unit-testable — needs a real process exit (see ARCH-LTTCE-XPT-00001)       |
| IMPL-LTTCE-XPT-00005  | `platform/mod.rs` `mod tests` (`PdfDone`); host backends: CI compile only      |
| IMPL-LTTCE-XPT-00006  | `src/lib/print-style.test.ts` (13 cases)                                       |

**Runtime verification status of IMPL-LTTCE-XPT-00005** — the host print backends cannot be reached by
either test harness (they are FFI callbacks into WebView2 / WebKitGTK / WKWebView):

- Windows — compiles locally, exercised by hand.
- Linux, macOS — compile-verified by the CI build matrix only; **unverified at runtime**.
- Android, iOS — the `Platform::print_to_pdf` default refusal applies; no device test exists.
