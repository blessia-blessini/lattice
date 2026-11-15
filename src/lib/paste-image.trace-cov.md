# Trace Coverage — paste-image.ts

Satellite file: records which implementation anchors in `paste-image.ts` cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-IMP-00001 **covers** REQ-LTTCE-IMP-00001  (`imageMarkdown`, `NO_FILE_FOR_IMAGE_MESSAGE`)
- IMPL-LTTCE-IMP-00002 **covers** REQ-LTTCE-IMP-00002  (`isEmptyPaste`: no item, no type, no text — the
  paste WebKitGTK delivers for a picture; decided by content, never by platform)
- IMPL-LTTCE-IMP-00001 / 00002 **cover** ARCH-LTTCE-IMP-00001

## Tests

- UTST: `src/lib/paste-image.test.ts` — the WebKitGTK empty paste, a picture item (Windows/macOS), text in
  `types` or only through `getData`, HTML, and a paste with no `clipboardData`.
