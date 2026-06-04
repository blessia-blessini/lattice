# Lattice — System Requirements

This document captures the formal system requirements for Lattice. Each requirement is tagged with a unique
anchor comment of the form `<!--REQ-PPPPP-SSS-NNNNN-->` to support traceability to architecture and
implementation artefacts. For the ID schema definition see `11-Traceability-Requirements.md`.

---

## Table of Contents
<!-- TOC -->
- [Lattice — System Requirements](#lattice-system-requirements)
  - [Table of Contents](#table-of-contents)
  - [Chapter LNT — GFM Linter](#chapter-lnt-gfm-linter)
    - [General](#general)
    - [Severity Visualisation](#severity-visualisation)
    - [Rule: Setext Headings](#rule-setext-headings)
    - [Rule: Indented Code Block](#rule-indented-code-block)
    - [Rule: Raw HTML Block](#rule-raw-html-block)
    - [Rule: Inline HTML Tag](#rule-inline-html-tag)
    - [Rule: Table Column Mismatch](#rule-table-column-mismatch)
    - [Rule: Bare URL](#rule-bare-url)
    - [Rule: Single-Tilde Strikethrough](#rule-single-tilde-strikethrough)
    - [Rule: Loose List](#rule-loose-list)
    - [Rule: Missing Fenced Code Language Tag](#rule-missing-fenced-code-language-tag)
    - [Rule: Empty Image Alt Text](#rule-empty-image-alt-text)
    - [Rule: Duplicate Heading Text](#rule-duplicate-heading-text)
    - [Rule: Unclosed Fenced Code Block](#rule-unclosed-fenced-code-block)
<!-- /TOC -->

---

## Chapter LNT — GFM[^gfm] Linter

The GFM[^gfm] Linter feature provides live, in-editor feedback about Markdown constructs that are ambiguous,
non-portable, or outright broken under the GitHub Flavored Markdown specification. It is the first step
toward SPICE[^spice]-aligned quality gates for document authoring.

### General

<!--REQ-LTTCE-LNT-00001-->
**REQ-LTTCE-LNT-00001** — The editor SHALL integrate a live GFM[^gfm] linter powered by the
CodeMirror 6[^cm6] `@codemirror/lint` package. The linter SHALL run automatically as the user types
(debounced, with no manual trigger required) and SHOULD NOT introduce new runtime dependencies beyond
those already present in the project.

<!--REQ-LTTCE-LNT-00002-->
**REQ-LTTCE-LNT-00002** — The linter SHALL use three severity levels for its diagnostics:
- `error` (will render broken),
- `warning` (commonly stripped or mishandled by renderers), and
- `hint` (stylistic ambiguity; may render differently across parsers).

**REQ-LTTCE-LNT-00002.1** — Each severity level SHALL be visually distinguishable in the editor without
requiring the lint panel to be open.

### Severity Visualisation

<!--REQ-LTTCE-LNT-00003-->
**REQ-LTTCE-LNT-00003** — Hint-severity GFM[^gfm] diagnostics SHALL be rendered with a **green** wavy
underline, visually distinct from the default CodeMirror[^cm6] hint style, to signal a low-risk advisory
rather than an error.

<!--REQ-LTTCE-LNT-00004-->
**REQ-LTTCE-LNT-00004** — Warning-severity GFM[^gfm] diagnostics SHALL be rendered with an **orange**
wavy underline, distinct from both the green hint and the red error underline.

<!--REQ-LTTCE-LNT-00005-->
**REQ-LTTCE-LNT-00005** — Error-severity GFM[^gfm] diagnostics SHALL be rendered with the default
CodeMirror[^cm6] **red** wavy underline.

### Rule: Setext Headings

<!--REQ-LTTCE-LNT-0000A-->
**REQ-LTTCE-LNT-0000A** — The linter SHALL emit a **hint** diagnostic on any setext-style heading (text
followed by a line of `====` or `----`). The message SHALL recommend ATX[^atx] style (`# Heading`) as
the unambiguous alternative.
*Rationale*: the `----` underline is visually identical to a thematic break and a table separator,
causing misparse in some CommonMark implementations.

### Rule: Indented Code Block

<!--REQ-LTTCE-LNT-0000B-->
**REQ-LTTCE-LNT-0000B** — The linter SHALL emit a **hint** diagnostic on any indented code block
(four-space or tab indented). The message SHALL recommend fenced code blocks with an explicit language tag.
*Rationale*: indented code can be misread as list-continuation prose by parsers with slightly different
whitespace rules.

### Rule: Raw HTML Block

<!--REQ-LTTCE-LNT-0000C-->
**REQ-LTTCE-LNT-0000C** — The linter SHALL emit a **warning** diagnostic on any raw HTML block.
The message SHALL note that HTML may be stripped or sanitized by many Markdown renderers
(GitHub Docs, VS Code preview, Obsidian, Typora).
*Rationale*: GFM[^gfm] permits HTML but renderer support varies widely; content may silently disappear.

### Rule: Inline HTML Tag

<!--REQ-LTTCE-LNT-0000D-->
**REQ-LTTCE-LNT-0000D** — The linter SHALL emit a **hint** diagnostic on any inline HTML tag embedded in
prose. The message SHALL note the same renderer-compatibility risk as raw HTML blocks.

### Rule: Table Column Mismatch

<!--REQ-LTTCE-LNT-0000E-->
**REQ-LTTCE-LNT-0000E** — The linter SHALL emit an **error** diagnostic on any GFM[^gfm] pipe-table body
row whose cell count differs from the header row's cell count. The message SHALL state the expected and
actual counts.
*Rationale*: mismatched column counts render as visually broken or truncated tables in all GFM-compliant
renderers.

### Rule: Bare URL

<!--REQ-LTTCE-LNT-0000F-->
**REQ-LTTCE-LNT-0000F** — The linter SHALL emit a **hint** diagnostic on any bare `http://` or `https://`
URL appearing in prose text (i.e., not already inside a link `[text](url)`, autolink `<url>`,
image `![alt](url)`, or code span). The message SHALL recommend wrapping in `<url>` or `[text](url)`.
*Rationale*: the GFM[^gfm] autolink extension is not universally enabled; bare URLs may render as plain
text on some platforms.

### Rule: Single-Tilde Strikethrough

<!--REQ-LTTCE-LNT-00010-->
**REQ-LTTCE-LNT-00010** — The linter SHALL emit a **hint** diagnostic on any single-tilde construct
`~text~` that appears in prose and is not part of a GFM[^gfm] double-tilde strikethrough `~~text~~`.
The message SHALL recommend `~~text~~`.
*Rationale*: single-tilde strikethrough is non-standard and renders as plain text in all GFM-compliant
parsers.

### Rule: Loose List

<!--REQ-LTTCE-LNT-00011-->
**REQ-LTTCE-LNT-00011** — The linter SHALL emit a **hint** diagnostic on any bullet or ordered list that
contains at least one blank line between items (i.e., a loose list). The message SHALL explain that one
blank line anywhere in the list makes all items render with `<p>` tags, increasing vertical spacing for
the entire list.
*Rationale*: authors often add blank lines for visual breathing room in the source, not realising the
structural impact on rendered output.

### Rule: Missing Fenced Code Language Tag

<!--REQ-LTTCE-LNT-00012-->
**REQ-LTTCE-LNT-00012** — The linter SHALL emit a **warning** diagnostic on any fenced code block that
has no language identifier on the opening fence line (e.g., ` ``` ` with no language). The message SHALL
recommend adding a language tag.
*Rationale*: without a language tag, syntax highlighting is disabled in all renderers; the tag is also
required by some static site generators for correct rendering.

### Rule: Empty Image Alt Text

<!--REQ-LTTCE-LNT-00013-->
**REQ-LTTCE-LNT-00013** — The linter SHALL emit a **warning** diagnostic on any image whose alt text is
empty (`![](url)`). The message SHALL cite accessibility and fallback text concerns.
*Rationale*: empty alt text fails WCAG[^wcag] accessibility checks and produces no fallback when the
image cannot load.

### Rule: Duplicate Heading Text

<!--REQ-LTTCE-LNT-00014-->
**REQ-LTTCE-LNT-00014** — The linter SHALL emit a **warning** diagnostic on any heading whose normalised
text (lowercased, leading `#` markers stripped) is identical to a preceding heading in the same document.
The message SHALL name the colliding anchor slug.
*Rationale*: duplicate headings produce colliding anchor IDs (`#heading-name`), silently breaking
internal cross-links and TOC[^toc] entries.

### Rule: Unclosed Fenced Code Block

<!--REQ-LTTCE-LNT-00015-->
**REQ-LTTCE-LNT-00015** — The linter SHALL emit an **error** diagnostic on the opening fence line of any
fenced code block that has no matching closing fence before the end of the document. The message SHALL
warn that all content after the fence renders as code.
*Rationale*: an unclosed fence silently swallows the rest of the document into a code block, which is
always unintentional.

---

[^gfm]: GFM — GitHub Flavored Markdown. The Markdown dialect specified by GitHub, extending CommonMark
    with tables, task lists, strikethrough, and autolinks. Specification: <https://github.github.com/gfm/>

[^cm6]: CM6 — CodeMirror 6. The sixth major version of the CodeMirror browser-based code-editor library,
    used in Lattice as the editing surface. <https://codemirror.net>

[^atx]: ATX heading style — headings prefixed with one or more `#` characters (e.g. `## Heading`).
    Named after Aaron Swartz's *atx* plain-text formatting tool (2002).

[^wcag]: WCAG — Web Content Accessibility Guidelines. Published by the W3C, WCAG defines success criteria
    for making web content accessible to people with disabilities. <https://www.w3.org/WAI/standards-guidelines/wcag/>

[^spice]: SPICE — Software Process Improvement and Capability dEtermination (ISO/IEC 15504). A framework
    for assessing and improving software development processes. Automotive SPICE (ASPICE) is the automotive
    industry's profile of this standard.

[^toc]: TOC — Table of Contents.
