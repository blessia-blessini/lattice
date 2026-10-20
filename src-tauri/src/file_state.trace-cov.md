# Trace Coverage — file_state.rs / lib.rs (`watch_file`)

Satellite file: records which implementation anchors in file_state.rs and the `watch_file` command in
lib.rs cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-FWT-00001 **covers** REQ-LTTCE-FWT-00001
- IMPL-LTTCE-FWT-00001 **covers** ARCH-LTTCE-FWT-00001
- IMPL-LTTCE-FOS-00003 **covers** REQ-LTTCE-FOS-00003  (`write_text_file` asks
  `licences::refuse_write_into_resources` before writing; the rule itself is tested in
  `licences_tests.rs`)
- IMPL-LTTCE-FOS-00003 **covers** ARCH-LTTCE-FOS-00003
