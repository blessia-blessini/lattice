# Trace Coverage — invisible-chars.ts

Satellite file: records which implementation anchors cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

Shared contract module: it owns no rule of its own — it is the single definition of the character set
that the GFM linter rules and the Show Whitespace extension both act on (DRY).

---

- IMPL-LTTCE-LNT-00016 **covers** REQ-LTTCE-LNT-00016
- IMPL-LTTCE-LNT-00017 **covers** REQ-LTTCE-LNT-00017
- IMPL-LTTCE-WSP-0000A **covers** REQ-LTTCE-WSP-00007
- IMPL-LTTCE-LNT-00016 **covers** ARCH-LTTCE-LNT-00005
- IMPL-LTTCE-WSP-0000A **covers** ARCH-LTTCE-WSP-00001
