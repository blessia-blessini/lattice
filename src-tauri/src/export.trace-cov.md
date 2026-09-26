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
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00007  (Linux: GTK file print backend + named printer,
  so no configured printer is needed; Windows and macOS never involved one)
- IMPL-LTTCE-XPT-00006 **covers** REQ-LTTCE-XPT-00004  (shared print stylesheet, `lib/print-style.ts`)
- IMPL-LTTCE-XPT-00006 **covers** ARCH-LTTCE-XPT-00002

---

## Test coverage of the anchors above

| Anchor                | Unit / automatic tests                                                        |
| :-------------------- | :---------------------------------------------------------------------------- |
| IMPL-LTTCE-XPT-00002  | `src/App.test.tsx` — *App — headless export launch* (9 cases, incl. the signal-ordering regression) |
| IMPL-LTTCE-XPT-00003  | `src-tauri/src/export.rs` `mod tests` (18 cases, incl. `is_expected_sender`); `platform/cli_args.rs` `mod tests` |
| IMPL-LTTCE-XPT-00004  | ITST-LTTCE-XPT-00010 — `src-tauri/examples/export_demo.rs` (`export-html`, `export-pdf`, `missing-input`); not unit-testable, needs a real process exit (see ARCH-LTTCE-XPT-00001) |
| IMPL-LTTCE-XPT-00005  | `platform/mod.rs` `mod tests` (`PdfDone`); `platform/impls/linux.rs` `mod linux_print_tests` (4 cases — printer-name resolution incl. the localized and blank-override cases, REQ-LTTCE-XPT-00007; pure, no environment mutation; compiled and run on the Linux leg only); host backends: ITST-LTTCE-XPT-00010 per desktop platform |
| IMPL-LTTCE-XPT-00006  | `src/lib/print-style.test.ts` (13 cases)                                       |

## Integration test

- ITST-LTTCE-XPT-00010 **covers** IMPL-LTTCE-XPT-00003, IMPL-LTTCE-XPT-00004, IMPL-LTTCE-XPT-00005

`src-tauri/examples/export_demo.rs` — the headless round trip on `docs/demo/demo.md`: both formats
produce a correct file beside the input and exit `0`, an unreadable input exits `1` and writes
nothing. Run as step 1d of `build-test.ps1` / `build-test.sh` and on **every desktop leg** of the CI
matrix (see `docs/60-test-strategy.md`).

**Runtime verification status of IMPL-LTTCE-XPT-00005** — the host print backends are FFI callbacks
into WebView2 / WebKitGTK / WKWebView, so neither unit tests nor the E2E harness can reach them.
ITST-LTTCE-XPT-00010 reaches them by running the real binary:

- Windows — verified by hand, and now by ITST-LTTCE-XPT-00010 on the `windows-desktop` and
  `windows-arm-desktop` legs.
- Linux — ITST-LTTCE-XPT-00010 executed it for the first time on 2026-09-26 and it FAILED, exactly as
  the paragraph above predicted: `WebKitGTK print failed: Printer not found`, because the settings
  named no printer and the runner has none. Fixed by REQ-LTTCE-XPT-00007 (file print backend + named
  printer). Still **unproven rather than verified**: the fix itself has not yet gone green on that leg,
  and it cannot be exercised on a Windows development machine at all, since `impls/linux.rs` is not
  compiled there.
- macOS — ITST-LTTCE-XPT-00010 did not reach the backend on 2026-09-26: it found no binary, because
  Tauri deletes `bundle/macos/*.app` once the DMG is written. The check now mounts the DMG and runs the
  `.app` inside it, so it tests what a user downloads; **unproven** until that leg goes green.

- Android, iOS — the `Platform::print_to_pdf` default refusal applies; no device test exists.
