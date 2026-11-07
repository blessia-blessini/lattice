# Trace Coverage — platform/impls/windows.rs

Satellite file for the `IMPL-…` anchors in `windows.rs`. Only Chapter CLU is recorded here; the print-to-PDF
backend (IMPL-LTTCE-XPT-00005) is recorded in `../../export.trace-cov.md`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-CLU-00002 **covers** REQ-LTTCE-CLU-00003  (`attach_parent_console`: attach to the parent
  console when stdout or stderr has no handle, then restore every handle that was valid before)
- IMPL-LTTCE-CLU-00002 **covers** ARCH-LTTCE-CLU-00001

## Tests

- No unit test: the effect is a change of the process's standard handles, which a test inside the test
  binary (a console program with valid handles) cannot observe.
- STST-LTTCE-CLU-00001 (`examples/export_demo.rs` `scenario_usage`) runs the Windows release binary with
  both streams redirected — the "all handles valid, return early" path.
- The "no handle → attach" path: `std::process::Command` always gives a child valid handles, so no
  automated test produces it. Run by the author on Windows x64 with `Start-Process -NoNewWindow` (no
  redirection): the usage text appeared in the console and the exit status was 2.
