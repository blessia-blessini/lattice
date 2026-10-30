# Trace Coverage — recent_files.rs

Satellite file: records which implementation anchors in recent_files.rs cover which requirements and
architecture sections, and which tests cover them.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-RCT-00001 **covers** REQ-LTTCE-RCT-00002  (`recent_file_state_of`: file / gone / unavailable from
  `std::fs::metadata` and whether the path's drive or root exists; the command `recent_file_state`)
- IMPL-LTTCE-RCT-00001 **covers** ARCH-LTTCE-RCT-00001

## Tests

- UTST `src-tauri/src/recent_files_tests.rs`: a file; a folder (gone); a deleted file and a deleted folder tree
  on an existing drive (gone); a path without a root (unavailable); the root of an absolute path; a drive letter
  that does not exist on this machine (unavailable; on Linux/macOS such a path has no root, same answer); the
  three states serialise as `"file"`, `"gone"`, `"unavailable"`. Every case inside its own `TempDir`.
- ITST `src-tauri/tests/wiring.rs` `test_recent_file_state_ipc`: the command through the real IPC boundary
  (MockRuntime) — argument `path`, answers `file` / `gone` / `unavailable`.
- Not covered by a test: access denied (`PermissionDenied` → unavailable) — it needs a file the test user cannot
  read, which root and Windows administrators can always read; the branch is the plain `Err(_)` arm.
