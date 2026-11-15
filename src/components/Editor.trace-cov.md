# Trace Coverage — Editor.tsx

Satellite file: records which implementation anchors in Editor.tsx cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-DVW-00002 **covers** REQ-LTTCE-DVW-00001
- IMPL-LTTCE-DVW-00002 **covers** REQ-LTTCE-DVW-00003
- IMPL-LTTCE-DVW-00002 **covers** ARCH-LTTCE-DVW-00001
- IMPL-LTTCE-WSP-00002 **covers** REQ-LTTCE-WSP-00001
- IMPL-LTTCE-WSP-00002 **covers** REQ-LTTCE-WSP-00002
- IMPL-LTTCE-WSP-00002 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-WSP-00005 **covers** REQ-LTTCE-WSP-00004
- IMPL-LTTCE-WSP-00005 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-WSP-00006 **covers** REQ-LTTCE-WSP-00005
- IMPL-LTTCE-WSP-00006 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-WSP-00009 **covers** REQ-LTTCE-WSP-00006
- IMPL-LTTCE-WSP-00009 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-TBL-00003 **covers** REQ-LTTCE-TBL-00001
- IMPL-LTTCE-TBL-00003 **covers** REQ-LTTCE-TBL-00002
- IMPL-LTTCE-TBL-00003 **covers** REQ-LTTCE-TBL-00007
- IMPL-LTTCE-TBL-00003 **covers** REQ-LTTCE-TBL-00008
- IMPL-LTTCE-TBL-00003 **covers** ARCH-LTTCE-TBL-00001
- IMPL-LTTCE-FWT-00003 **covers** REQ-LTTCE-FWT-00002
- IMPL-LTTCE-FWT-00003 **covers** REQ-LTTCE-FWT-00004
- IMPL-LTTCE-FWT-00003 **covers** ARCH-LTTCE-FWT-00001
- IMPL-LTTCE-SEL-00003 **covers** REQ-LTTCE-SEL-00004
- IMPL-LTTCE-SEL-00003 **covers** ARCH-LTTCE-SEL-00001
- IMPL-LTTCE-FOS-00003 **covers** REQ-LTTCE-FOS-00003  (`readOnly` prop → `readOnlyExtensions`:
  `EditorState.readOnly` + a change filter that also stops the editor's own programmatic edits; paste
  swallowed before the image branch writes a file) — UTST: `src/components/Editor.read-only.test.tsx`
  (verified to fail with the change filter removed)
- IMPL-LTTCE-FOS-00003 **covers** ARCH-LTTCE-FOS-00003
- IMPL-LTTCE-IMP-00001 **covers** REQ-LTTCE-IMP-00001  (`insertPastedImage`: the one save-and-link path for
  a pasted picture, whichever route it came by; `NO_FILE_FOR_IMAGE_MESSAGE` when the document has no file)
- IMPL-LTTCE-IMP-00001 **covers** ARCH-LTTCE-IMP-00001
- IMPL-LTTCE-IMP-00002 **covers** REQ-LTTCE-IMP-00002  (empty-paste branch of the paste handler: asks
  `FileSystem.readClipboardImage` and hands a picture to `insertPastedImage`) — ITST:
  `src/components/Editor.paste-image.test.tsx` (4 of its 5 cases verified to fail with the branch disabled)
- IMPL-LTTCE-IMP-00002 **covers** ARCH-LTTCE-IMP-00001
