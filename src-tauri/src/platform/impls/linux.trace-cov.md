# Trace Coverage — platform/impls/linux.rs

Satellite file for the `IMPL-…` anchors in `linux.rs`. Only Chapter IMP is recorded here; the print-to-PDF
backend (IMPL-LTTCE-XPT-00005) is recorded in `../../export.trace-cov.md`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-IMP-00002 **covers** REQ-LTTCE-IMP-00002  (`read_clipboard_png`: on the GTK main thread,
  `gtk::Clipboard::request_image`, the `Pixbuf` encoded as PNG; a failed hop drops `done`, read as "no
  image")
- IMPL-LTTCE-IMP-00002 **covers** ARCH-LTTCE-IMP-00001

## Tests

- STST: `examples/paste_image_e2e.rs` (build-test step 1f, Linux legs) — the release app, a 37×23 picture
  owned by the check through GTK, a real Ctrl+V and Ctrl+S through XTest; the saved document must link a
  PNG of exactly that size. No unit test of the read itself: it needs a display and a clipboard owner.
  The Base64 hand-over it feeds is unit-tested in `lib_tests.rs` (`test_clipboard_png_base64_*`).
- Evidence (by the author, WSL Ubuntu 24.04, WebKitGTK 2.52.6, X11 backend): WebKitGTK's paste event for a
  clipboard picture is empty (no items, types or files), whether the picture is owned by the same or by
  another process, while a text paste carries `text/plain`; GTK's clipboard read returns the picture of
  another process (16×16 `Pixbuf`). Under WSLg's Wayland backend the owner could not take the clipboard
  without focus, so Wayland is not verified.
- Type-checked and clippy-clean on Linux (WSL) — `cargo check` / `cargo clippy --lib --tests`.
