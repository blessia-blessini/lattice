# Trace Coverage — last_vault.rs (+ its wiring in lib.rs)

Satellite file: records which implementation anchors cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-VLT-00002 **covers** REQ-LTTCE-VLT-00002  (`choose_vault`: the found path made absolute;
  "no document" that found only the home vault — compared by file identity, not spelling — gets the
  remembered vault; every other vault is remembered; `remember` writes atomically under a per-write
  unique temporary name, only on change. `lib.rs`: `find_vault_and_settle` and
  `initialize_vault_and_settle` apply it for `find_vault_settings_file` / `initialize_vault_settings`;
  `memory_location` keeps headless exports out; `last_vault_state_file` places it in `app_local_data_dir`)
- IMPL-LTTCE-VLT-00002 **covers** REQ-LTTCE-VLT-00003  (`recall`: a vanished vault, a damaged state file, a
  relative path or any file that is not `…/.lattice/settings.json` gives `None` → home vault, logged)
- IMPL-LTTCE-VLT-00002 **covers** ARCH-LTTCE-VLT-00002

## Tests

- UTST `src-tauri/src/last_vault_tests.rs` — 18 cases in `TempDir`s: recall/remember (nothing yet,
  round trip, creates the folder, vanished vault, damaged file, non-vault and relative paths refused,
  unchanged value not rewritten, no temporary file left, 8 concurrent writers in one process) and choose
  (remembered vault for no document, home with nothing remembered and nothing stored, vanished vault →
  home, document in a vault remembered, stray document keeps the memory, latest vault wins,
  working-directory vault beats the memory, a relative vault path is remembered absolute, the home vault
  spelled differently is still not remembered). The last three failed before review cycle 1's fixes.
- UTST `src-tauri/src/lib_tests.rs` — the command bodies, home/vault/state all in a `TempDir` and the walk
  bounded by it: `test_initialize_vault_remembers_the_new_vault` ("Initialize Vault Here" → a lookup
  without a document returns the new vault), `test_vault_lookup_remembers_and_recalls` (document in a
  vault → remembered → recalled → vault removed → home), `test_headless_export_takes_no_part_in_the_memory`.
  The first and last were checked to fail with the remembering, respectively the export rule, disabled.
- STST `examples/e2e_harness.rs` scenario `last_vault` (Windows only, like the whole harness) **covers**
  REQ-LTTCE-VLT-00001 … -00003 in the real binary, three launches sharing one isolated home: a document in
  vault `notes` is remembered in `<home>/app-local-data/last-vault.json`; a launch **without** a document
  opens today's note in `notes/daily` with two 🗒 clicks and nothing opened first; with `notes/.lattice`
  removed, the next such launch uses the home vault (`<home>/lattice-notes/daily`). Verified to fail at
  launch 2 when the recall is disabled.
- Not covered by an automated test: the real `app_local_data_dir` per OS (Tauri's resolver; E2E runs
  replace it with the isolated home on purpose); `last_vault_memory`'s reading of the real command line
  (the rule it applies, `memory_location`, is tested); mobile, where documents rarely have a vault above
  them.
