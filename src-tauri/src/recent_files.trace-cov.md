# Trace Coverage — recent_files.rs

Satellite file: records which implementation anchors in recent_files.rs cover which requirements and
architecture sections, and which tests cover them.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-RCT-00001 **covers** REQ-LTTCE-RCT-00002  (`recent_file_state_of`: file / notFound / unavailable from
  one `std::fs::metadata` call; the command `recent_file_state`)
- IMPL-LTTCE-RCT-00001 **covers** ARCH-LTTCE-RCT-00001

## Tests

- UTST `src-tauri/src/recent_files_tests.rs`: a file; a folder, a deleted file, a deleted folder tree and an
  unresolvable relative path (all notFound); an invalid path with a NUL byte (unavailable, every OS); the three
  states serialise as `"file"`, `"notFound"`, `"unavailable"`. Every case inside its own `TempDir`.
- ITST `src-tauri/tests/wiring.rs` `test_recent_file_state_ipc`: the command through the real IPC boundary
  (MockRuntime) — argument `path`, answers `file` / `notFound` / `unavailable`.
- Not covered by a test: access denied (`PermissionDenied` → unavailable) — it needs a file the test user cannot
  read, which root and Windows administrators can always read; it takes the same `Err(_)` arm as the NUL-byte case.
