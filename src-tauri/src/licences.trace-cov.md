# Trace Coverage — licences.rs (+ its wiring in lib.rs, file_state.rs, tauri.conf.json)

Satellite file: records which implementation anchors cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-FOS-00003 **covers** REQ-LTTCE-FOS-00003  (`open_licences_window`: the bundled notices from
  `resource_dir()`, an error naming the path when the build lacks them, opened through
  `open_document_window(.., read_only = true)`; `refuse_write_into_resources`: the save guard used by
  `file_state::write_text_file`, comparing canonical forms of the nearest existing ancestor)
- IMPL-LTTCE-FOS-00003 **covers** ARCH-LTTCE-FOS-00003
- IMPL-LTTCE-FOS-00001 **covers** REQ-LTTCE-FOS-00001  (`NOTICES_FILE` = the resource name mapped in
  `tauri.conf.json` → `bundle.resources`; `scripts/build-msix.ps1` copies the same map)
- IMPL-LTTCE-FOS-00001 **covers** ARCH-LTTCE-FOS-00001

## Tests

- UTST `src-tauri/src/licences_tests.rs` — 9 cases in a `TempDir`: notices found / build without them;
  save refused for the notices, for a new file in a new sub-folder (failed before the
  nearest-existing-ancestor fix), for a `..` spelling, for non-existing components climbing back in;
  allowed elsewhere; a sibling folder with a common name prefix is not inside; no resource folder guards
  nothing.
- ITST: none in-process — `open_licences_window` needs a running app with a resource folder.
- STST `scripts/foss/assert-bundled.sh`, CI step 390 on every desktop leg: LICENSE and
  THIRD-PARTY-NOTICES.md byte-identical inside each downloadable package (REQ-LTTCE-FOS-00001).
- Not covered by an automated test: the Settings link opening a real window on a real install (the E2E
  harness is Windows-only and does not yet drive Settings); Android/iOS, where the resources are not
  bundled yet (FU-6).
