# Trace Coverage — daily_note.rs

Satellite file: records which implementation anchors in daily_note.rs (and the `open_daily_note`
registration in lib.rs) cover which requirements and architecture sections, and which tests cover them.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-DLN-00001 **covers** REQ-LTTCE-DLN-00005  (`DailyNotePrefix` — the prefix rule, enforced on
  construction and on deserialization)
- IMPL-LTTCE-DLN-00001 **covers** ARCH-LTTCE-DLN-00001
- IMPL-LTTCE-DLN-00002 **covers** REQ-LTTCE-DLN-00002  (`daily_note_base_name`)
- IMPL-LTTCE-DLN-00002 **covers** REQ-LTTCE-DLN-00004  (`daily_note_title`, ISO week-numbering year)
- IMPL-LTTCE-DLN-00002 **covers** ARCH-LTTCE-DLN-00001
- IMPL-LTTCE-DLN-00003 **covers** REQ-LTTCE-DLN-00002  (folder created, note path)
- IMPL-LTTCE-DLN-00003 **covers** REQ-LTTCE-DLN-00003  (`create_new` — an existing note is never rewritten)
- IMPL-LTTCE-DLN-00003 **covers** REQ-LTTCE-DLN-00004  (title written only by the creating call)
- IMPL-LTTCE-DLN-00003 **covers** ARCH-LTTCE-DLN-00001

## Tests

| Anchor               | UTST — `src-tauri/src/daily_note_tests.rs`                                  | ITST — `src-tauri/tests/wiring.rs`                                    |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| IMPL-LTTCE-DLN-00001 | `prefix_rules` (7 cases)                                                    | `test_open_daily_note_ipc_rejects_invalid_prefix`, `…_empty_prefix`   |
| IMPL-LTTCE-DLN-00002 | `file_name` (5 cases), `title` (6 cases, incl. CW01 in December, CW53 in January) | `test_open_daily_note_ipc_creates_then_reopens`, `…_empty_prefix` |
| IMPL-LTTCE-DLN-00003 | `create_or_open` (12 cases, incl. 8 concurrent callers), `command` (2 cases) | `test_open_daily_note_ipc_creates_then_reopens`                       |

- ITST `test_open_daily_note_ipc_*` **covers** REQ-LTTCE-DLN-00002, -00003, -00004, -00005 through the real
  IPC boundary (`tauri::test::get_ipc_response`, MockRuntime): camelCase argument names, prefix refusal
  before any folder is created, create → user edit → reopen leaves the edit intact.
- STST `daily_note_defaults`, `daily_note_cw_no_prefix` (`examples/e2e_harness.rs`, Windows only)
  **cover** REQ-LTTCE-DLN-00002 … -00006, and the toolbar half of -00001 (the menu entry calls the same
  handler — `App.coverage.test.tsx`), in the real binary: the 🗒 toolbar button is clicked twice in
  the real WebView against a fixture vault; the note is created with exactly its title, shown in the
  window, and the second click changes neither content nor modification time. Default settings in one
  run; empty prefix + calendar-week title in the other. Verified to fail when the backend rewrites an
  existing note. On Linux/macOS the system-level evidence remains the App flow in
  `src/App.coverage.test.tsx` (*App — handleOpenDailyNote*) together with the ITST above.
- Not automated: whether 🗒 + U+FE0F renders as a glyph in each WebView — visual judgement only.
