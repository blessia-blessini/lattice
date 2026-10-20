# Trace Coverage — Settings.tsx

Satellite file: records which implementation anchors in Settings.tsx cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-WSP-00003 **covers** REQ-LTTCE-WSP-00002
- IMPL-LTTCE-WSP-00003 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-WSP-00007 **covers** REQ-LTTCE-WSP-00005
- IMPL-LTTCE-WSP-00007 **covers** ARCH-LTTCE-WSP-00001
- IMPL-LTTCE-MRC-00003 **covers** REQ-LTTCE-MRC-00005
- IMPL-LTTCE-MRC-00003 **covers** ARCH-LTTCE-MRC-00001
- IMPL-LTTCE-DLN-00006 **covers** REQ-LTTCE-DLN-00005  (prefix input, filtered per keystroke) — UTST:
  `src/components/Settings.test.tsx`
- IMPL-LTTCE-DLN-00006 **covers** REQ-LTTCE-DLN-00006  (calendar-week-title toggle) — UTST:
  `src/components/Settings.test.tsx`
- IMPL-LTTCE-DLN-00006 **covers** ARCH-LTTCE-DLN-00001
- IMPL-LTTCE-FOS-00003 **covers** REQ-LTTCE-FOS-00003  (footer: "Licence: AGPL-3.0-or-later ·
  Open-source licences" → `Licences.openNotices()`; a failure is shown in the status line) — UTST:
  `src/components/Settings.test.tsx` ("Settings — open-source licences")
- IMPL-LTTCE-FOS-00003 **covers** ARCH-LTTCE-FOS-00003
