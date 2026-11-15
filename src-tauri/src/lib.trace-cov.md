# Trace Coverage — lib.rs

Satellite file: records which implementation anchors in `lib.rs` cover which requirements and architecture
sections. (The last-vault wiring in `lib.rs` is recorded in `last_vault.trace-cov.md`.)
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-WIN-00001 **covers** REQ-LTTCE-WIN-00001  (`EDITOR_WINDOW_SIZE` = 850 × 600 logical pixels,
  applied by `configure_desktop_window` to every desktop editor window)
- IMPL-LTTCE-WIN-00001 **covers** ARCH-LTTCE-WIN-00001

## Tests

- No unit test: the size is a constant handed to the window builder, and a test of the constant would only
  restate it. The observable check is the CI app screenshot (`examples/app_screenshot.rs`, every desktop
  leg): on the Linux legs (no window manager, so no frame) the captured window is exactly the content area
  and must measure 850 × 600; on Windows and macOS it is that plus the OS frame. Checked by eye, not
  asserted — the screenshot step never fails a build.
- IMPL-LTTCE-FOS-00003 **covers** REQ-LTTCE-FOS-00003  (`open_document_window(path, read_only)`: the body
  `open_new_window` and `licences::open_licences_window` share; `readOnly` travels in the Direct Push
  payload; `licences::open_licences_window` registered in `generate_handler!`)
- IMPL-LTTCE-FOS-00003 **covers** ARCH-LTTCE-FOS-00003
- IMPL-LTTCE-CLU-00001 **covers** REQ-LTTCE-CLU-00001, REQ-LTTCE-CLU-00002  (`exit_on_help_or_unknown_option`,
  called first in `run()`; the pure parts and their tests are recorded in `platform/cli_args.trace-cov.md`)
- IMPL-LTTCE-CLU-00001 **covers** ARCH-LTTCE-CLU-00001
- IMPL-LTTCE-IMP-00002 **covers** REQ-LTTCE-IMP-00002  (`read_clipboard_image` command: asks
  `platform::read_clipboard_png`, waits at most `CLIPBOARD_READ_TIMEOUT`, returns Base64 through
  `clipboard_png_base64`) — UTST: `lib_tests.rs` `test_clipboard_png_base64_*` (Base64 round-trips through
  `save_image` byte-exact; no image and an empty buffer are `None`)
- IMPL-LTTCE-IMP-00002 **covers** ARCH-LTTCE-IMP-00001
