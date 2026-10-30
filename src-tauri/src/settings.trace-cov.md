# Trace Coverage — settings.rs

Satellite file: records which implementation anchors in settings.rs cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-WSP-00004 **covers** REQ-LTTCE-WSP-00002
- IMPL-LTTCE-WSP-00004 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-WSP-00008 **covers** REQ-LTTCE-WSP-00005
- IMPL-LTTCE-WSP-00008 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-SET-00001 **covers** REQ-LTTCE-SET-00001
- IMPL-LTTCE-SET-00001 **covers** ARCH-LTTCE-SET-00001
- IMPL-LTTCE-SET-00002 **covers** REQ-LTTCE-SET-00002
- IMPL-LTTCE-SET-00002 **covers** ARCH-LTTCE-SET-00001
- IMPL-LTTCE-MRC-00003 **covers** REQ-LTTCE-MRC-00005
- IMPL-LTTCE-MRC-00003 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-DLN-00004 **covers** REQ-LTTCE-DLN-00005
- IMPL-LTTCE-DLN-00004 **covers** REQ-LTTCE-DLN-00006
- IMPL-LTTCE-DLN-00004 **covers** ARCH-LTTCE-DLN-00001
- IMPL-LTTCE-DLN-00006 **covers** REQ-LTTCE-DLN-00008  (`expand_daily_notes_path` on load, `condense_daily_notes_path` on save)
- IMPL-LTTCE-DLN-00006 **covers** REQ-LTTCE-DLN-00009  (`get_vault_root`: home vault → `<home>/lattice-notes`)
- IMPL-LTTCE-DLN-00006 **covers** ARCH-LTTCE-DLN-00001

## Tests — IMPL-LTTCE-DLN-00006

- UTST `settings_tests.rs`: `test_get_vault_root` (home vault → `<home>/lattice-notes`, other vault → its
  folder, paths that are not `.lattice/settings.json` refused); `test_expand_daily_notes_path` (`{notesRoot}`
  replaced, empty → `<notes root>/daily`); `test_condense_daily_notes_path` (inside → token, outside → unchanged).
- ITST `settings_tests.rs`: `test_load_settings_internal_valid_vault_file` (a stored `{notesRoot}/notes` comes
  back expanded); `test_save_settings_internal_creates_and_reads_back` and `test_save_settings_shim_persists_to_disk`
  (a path inside the vault is written to disk with the token).
- STST `examples/e2e_harness.rs` scenario `last_vault` (Windows): a fixture vault with settings `{}` gets
  today's note in `<vault>/daily` (empty value → default), and after the vault is removed the note goes to
  the home vault's `<home>/lattice-notes/daily` (REQ-LTTCE-DLN-00009).
- Not covered by a test: a value that is neither empty nor contains the token (used as written) — trivially
  the identity in `expand_daily_notes_path`.
