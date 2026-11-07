# Trace Coverage — Menu.tsx

Satellite file: records which implementation anchors in Menu.tsx cover which requirements and
architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-WIN-00002 **covers** REQ-LTTCE-WIN-00002  (`MENU_WIDTH` = `75vw`, `MENU_MIN_WIDTH_PX` = 250 on
  the dropdown panel) — UTST: `src/components/Menu.test.tsx` ("opens three quarters of the window wide,
  never narrower than 250 px")
- IMPL-LTTCE-WIN-00002 **covers** ARCH-LTTCE-WIN-00002
- IMPL-LTTCE-RCT-00003 **covers** REQ-LTTCE-RCT-00003  (sub-item label rendered unchanged, `overflow-wrap:
  anywhere`; the 40-character cut `truncatePath` removed) — UTST: `src/components/Menu.test.tsx` ("shows a long
  path in full, wrapping at any character instead of cutting it")
- IMPL-LTTCE-RCT-00003 **covers** ARCH-LTTCE-RCT-00001
