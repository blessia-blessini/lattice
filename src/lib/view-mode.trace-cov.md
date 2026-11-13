# Trace Coverage — src/lib/view-mode.ts

Satellite file: records which implementation anchors in view-mode.ts cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-WIN-00004 **covers** REQ-LTTCE-WIN-00003  (the six view modes and their labels, one list for the
  toolbar and Settings; `toViewMode`; `startViewMode` with the defaults Preview / Edit) — UTST:
  `src/lib/view-mode.test.ts`; the Rust side of the pairing: `VIEW_MODE_STRINGS` in `src-tauri/src/settings_tests.rs`
- IMPL-LTTCE-WIN-00004 **covers** ARCH-LTTCE-WIN-00003
