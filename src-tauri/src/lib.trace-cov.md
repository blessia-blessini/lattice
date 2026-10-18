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
