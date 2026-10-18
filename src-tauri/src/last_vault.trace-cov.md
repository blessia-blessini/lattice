# Trace Coverage — last_vault.rs (+ its wiring in lib.rs)

Satellite file: records which implementation anchors cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-VLT-00002 **covers** REQ-LTTCE-VLT-00002  (`choose_vault`: "no document" that found only the
  home vault gets the remembered vault; every other vault is remembered; `remember` writes atomically and
  only on change; `lib.rs` `settle_vault` applies it in `find_vault_settings_file` and
  `initialize_vault_settings`, `last_vault_state_file` places it in `app_local_data_dir`)
- IMPL-LTTCE-VLT-00002 **covers** REQ-LTTCE-VLT-00003  (`recall`: a vanished vault, a damaged state file, a
  relative path or any file that is not `…/.lattice/settings.json` gives `None` → home vault, logged)
- IMPL-LTTCE-VLT-00002 **covers** ARCH-LTTCE-VLT-00002

## Tests

- UTST `src-tauri/src/last_vault_tests.rs` — 15 cases in `TempDir`s: recall/remember (nothing yet,
  round trip, creates the folder, vanished vault, damaged file, non-vault and relative paths refused,
  unchanged value not rewritten, no temporary file left) and choose (remembered vault for no document,
  home with nothing remembered and nothing stored, vanished vault → home, document in a vault remembered,
  stray document keeps the memory, latest vault wins, working-directory vault beats the memory).
- STST `examples/e2e_harness.rs` scenario `last_vault` (Windows only, like the whole harness) **covers**
  REQ-LTTCE-VLT-00001 … -00003 in the real binary, three launches sharing one isolated home: a document in
  vault `notes` is remembered in `<home>/app-local-data/last-vault.json`; a launch **without** a document
  opens today's note in `notes/daily` with two 🗒 clicks and nothing opened first; with `notes/.lattice`
  removed, the next such launch uses the home vault (`<home>/lattice-notes/daily`). Verified to fail at
  launch 2 when the recall is disabled.
- Not covered by an automated test: the real `app_local_data_dir` per OS (Tauri's resolver; E2E runs
  replace it with the isolated home on purpose), and mobile, where documents rarely have a vault above them.
