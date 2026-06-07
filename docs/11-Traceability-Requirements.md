# Lattice — Traceability Requirements

This document captures the requirements for the traceability system itself, as specified during the first
traceability kickoff session (2026-06-04). It also serves as the normative definition of the ID schema used
across all Lattice traceability artefacts. This is the foundational document for Lattice's SPICE[^spice]
compliance efforts.

---

## Table of Contents
<!-- TOC -->
- [Lattice — Traceability Requirements](#lattice-traceability-requirements)
  - [Table of Contents](#table-of-contents)
  - [ID Schema](#id-schema)
    - [Format](#format)
    - [Field Definitions](#field-definitions)
    - [Numbering Convention](#numbering-convention)
    - [Known Product and Subsystem Codes](#known-product-and-subsystem-codes)
  - [Origin — Verbatim Requirement Text](#origin-verbatim-requirement-text)
  - [Derived Requirements](#derived-requirements)
    - [ID Scheme](#id-scheme)
    - [Satellite Trace Files](#satellite-trace-files)
    - [Documents](#documents)
<!-- /TOC -->

---

## How we link artefacts

  - in the artefact file itself we place a **comment** with an unique identifier.
  - The bidirectional link between artefacts is done by crating a file with the same name but a suffix `.trace-cov.md` and listing the list of links inside it.

## ID Schema

### Format

Every traceability identifier follows this structure:

```
TYPE-PPPPP-SSS-NNNNN
```

All fields are uppercase. Fields are separated by hyphens.

### Field Definitions

| Field   | Length | Content                                                                     |
| ------- | ------ | --------------------------------------------------------------------------- |
| `TYPE`  | 3–4    | Artefact type: `REQ` (requirement), `ARCH` (architecture), `IMPL` (impl.)   |
| `PPPPP` | 5      | Product code — identifies the product or repository (e.g. `LTTCE`)          |
| `SSS`   | 3      | Subsystem code — identifies the feature or chapter (e.g. `LNT`, `TRC`)      |
| `NNNNN` | 5      | 5-digit **uppercase hexadecimal** sequence number (range `00001`–`FFFFF`)   |

**Key property of `NNNNN`:** the value is hexadecimal, not decimal.
Digits 0–9 and letters A–F are valid. Examples: `00001`, `0000A`, `0000F`, `00010`, `1A3C7`.
This gives a namespace of 1 048 575 unique IDs per TYPE × PPPPP × SSS combination.

### Numbering Convention

Within a subsystem, IDs are assigned in ascending hex order. Gaps may be left deliberately to group
related items. Example convention for `LNT`:

| Range           | Purpose                                       |
| --------------- | --------------------------------------------- |
| `00001`–`00009` | General / cross-cutting requirements           |
| `0000A`–`0001F` | Specific lint rules (one ID per rule)          |
| `00020`–`FFFFF` | Reserved for future extensions                 |

### Known Product and Subsystem Codes

| Code    | Type    | Meaning                        |
| ------- | ------- | ------------------------------ |
| `LTTCE` | PPPPP   | Lattice — the main repository  |
| `LNK`   | SSS     | Preview link routing            |
| `LNT`   | SSS     | GFM[^gfm] Linter subsystem     |
| `TRC`   | SSS     | Traceability system            |

---

## Origin — Verbatim Requirement Text

Captured: 2026-06-04
Context: First-time traceability kickoff — GFM[^gfm] Linter feature used as the initial traceability pilot.

> **First time traceability kickoff**
>
> 1. Please add [new lint rules] (see `10-System-Requirements.md` Chapter LNT for the full rule list).
>
> 2. Please create a requirements document (if not already created named it `10-System-Requirements.md`)
>    and put a linter requirement chapter.
>
>    2.1. Mark in the Requirement each requirement with a comment tag `<!--REQ-PPPPP-SSS-ID-->`
>
>    2.2. In the architecture document add a section listing how the requirement is to be done, include:
>
>    - 2.2.1. Place `<!--ARCH-PPPPP-SSS-ID-->` in the architecture file
>    - 2.2.2. Generate a new file (trace-satellite file) named same as the architecture file but with
>      extension `.trace-cov.md` in the same folder as the architecture document and make (generate a
>      bullet list) which is like: `ARCH-PPPPP-SSS-ID` **covers** `REQ-PPPPP-SSS-ID`
>
>    2.3. In the new code put a comment (use comment depending on language) to place an anchor comment
>    like `IMPL-PPPPP-SSS-ID`. Make a similar satellite file in the same folder and name as the
>    "code"/implementation file, and make content in it a bullet list with:
>    - `IMPL-PPPPP-SSS-ID` **covers** `REQ-PPPPP-SSS-ID`  and
>    - `IMPL-PPPPP-SSS-ID` **covers** `ARCH-PPPPP-SSS-ID`
>
> 3. Add this very prompt-text as general requirements in a separate document called
>    `11-Traceability-Requirements`.
>
> This is just the start of our system and SPICE[^spice] compliance efforts.
>
> **Amendment (2026-06-04):** The `NNN` suffix in the ID schema is amended to `NNNNN` (5 digits)
> and the encoding is **hexadecimal** (uppercase), not decimal.
>
> **Style rules (2026-06-04):**
> - Markdown files SHALL use a maximum line length of 120 characters (no word-wrap assumed).
> - Abbreviations that appear for the first time in a document SHALL be followed by an MD footnote.

---

## Derived Requirements

The following requirements are derived from the verbatim text and amendment above.

### ID Scheme

<!--REQ-LTTCE-TRC-00001-->
**REQ-LTTCE-TRC-00001** — Every formal requirement SHALL be tagged with a unique HTML comment anchor of the
form `<!--REQ-PPPPP-SSS-NNNNN-->` immediately preceding the requirement statement in the requirements
document, where `NNNNN` is a 5-digit uppercase hexadecimal number.

<!--REQ-LTTCE-TRC-00002-->
**REQ-LTTCE-TRC-00002** — Every architecture section that describes how one or more requirements are to be
implemented SHALL be tagged with an anchor comment of the form `<!--ARCH-PPPPP-SSS-NNNNN-->` using the same
product and subsystem identifiers as the requirements it covers.

<!--REQ-LTTCE-TRC-00003-->
**REQ-LTTCE-TRC-00003** — Every implementation code unit (file, function, or block) that realises a
requirement SHALL contain an anchor comment of the form `IMPL-PPPPP-SSS-NNNNN` in the language-appropriate
comment syntax (e.g. `// IMPL-…` in TypeScript/Rust, `/* IMPL-… */` in CSS).

<!--REQ-LTTCE-TRC-00004-->
**REQ-LTTCE-TRC-00004** — The `NNNNN` portion of all traceability IDs SHALL be exactly 5 uppercase
hexadecimal digits (characters `0`–`9` and `A`–`F`). Leading zeros SHALL be included to reach 5 digits.
Example: the first item in a subsystem is `00001`; the tenth is `0000A`; the sixteenth is `00010`.

### Satellite Trace Files

<!--REQ-LTTCE-TRC-00005-->
**REQ-LTTCE-TRC-00005** — For every architecture document, a co-located satellite file named
`<basename>.trace-cov.md` (same directory, `.md` extension replaced by `.trace-cov.md`) SHALL be
maintained. It SHALL contain a bullet list of `ARCH-ID` **covers** `REQ-ID` entries.

<!--REQ-LTTCE-TRC-00006-->
**REQ-LTTCE-TRC-00006** — For every implementation file that carries `IMPL-…` anchors, a co-located
satellite file named `<basename>.trace-cov.md` (primary extension replaced by `.trace-cov.md`) SHALL be
maintained. It SHALL contain a bullet list of:
- `IMPL-ID` **covers** `REQ-ID`
- `IMPL-ID` **covers** `ARCH-ID`

### Documents

<!--REQ-LTTCE-TRC-00007-->
**REQ-LTTCE-TRC-00007** — The project SHALL maintain a `10-System-Requirements.md` document in the `docs/`
folder as the single source of truth for all system requirements, structured by chapter (one `SSS` code per
chapter).

<!--REQ-LTTCE-TRC-00008-->
**REQ-LTTCE-TRC-00008** — The project SHALL maintain a `11-Traceability-Requirements.md` document (this
file) in the `docs/` folder, capturing both the normative ID schema and the verbatim founding prompt.

<!--REQ-LTTCE-TRC-00009-->
**REQ-LTTCE-TRC-00009** — All Markdown documents in the `docs/` and `src/` trees that are part of the
traceability system SHALL use a maximum line length of 120 characters, and SHALL include MD footnotes
for abbreviations on their first occurrence within each document.

---

[^spice]: SPICE — SPICE (Software Process Improvement and Capability dEtermination).
    An industry process assessment model derived from ISO/IEC 15504, used to evaluate and
    improve software development processes in embedded and safety-critical systems.

[^gfm]: GFM — GitHub Flavored Markdown. The Markdown dialect specified by GitHub, extending CommonMark
    with tables, task lists, strikethrough, and autolinks. Specification: <https://github.github.com/gfm/>
