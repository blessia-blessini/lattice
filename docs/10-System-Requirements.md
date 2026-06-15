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
  - [Chapter LNK — Preview Link Routing](#chapter-lnk-preview-link-routing)
  - [Chapter DVW — Dual-View Cursor Flash](#chapter-dvw-dual-view-cursor-flash)
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
The message SHALL note that HTML blocks are not rendered in the Lattice preview, and that many
other renderers (VS Code preview, Obsidian, Typora) also strip or ignore them.
*Rationale*: GFM[^gfm] permits HTML blocks but renderer support varies widely; Lattice does not
render them. Authors should use Markdown equivalents for reliable, portable output.

### Rule: Inline HTML Tag

<!--REQ-LTTCE-LNT-0000D-->
**REQ-LTTCE-LNT-0000D** — The linter SHALL emit a diagnostic on any inline HTML tag embedded in
prose, with severity depending on whether the tag is in the Lattice safe-render whitelist:

- **Whitelisted tags** (`<sup>`, `<sub>`, `<kbd>`, `<br>`): **hint** severity.
  The message SHALL note that the tag renders in Lattice but may not display in all other renderers
  (portability risk).
- **All other inline tags**: **warning** severity.
  The message SHALL note that the tag is not rendered in Lattice (shown as literal text) and that a
  Markdown equivalent should be used instead.

*Rationale*: Lattice renders a curated whitelist of typographic inline tags (`<sup>`, `<sub>`,
`<kbd>`, `<br>`) for authoring convenience — these are also rendered by GitHub and Obsidian.
All other raw HTML is intentionally not rendered. The two-tier diagnostic guides authors toward
portable alternatives without blocking the common, well-supported cases.

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

## Chapter LNK — Preview Link Routing

The preview pane renders Markdown as HTML[^html] via ReactMarkdown. Clicking a link in the preview must be
intercepted and routed correctly — different link types require different handling to protect user privacy,
prevent WebView[^webview] navigation (which would discard editor state), and provide a consistent UX.

<!--REQ-LTTCE-LNK-00001-->
**REQ-LTTCE-LNK-00001** — The preview pane SHALL intercept all link clicks. No link click SHALL cause the
Tauri[^tauri] WebView[^webview] to navigate away from the application. This applies to all link types: external
URLs, local file paths, and in-page anchors.

<!--REQ-LTTCE-LNK-00002-->
**REQ-LTTCE-LNK-00002** — Links with an `https://` or `mailto:` scheme SHALL be opened in the user's default
system browser via the Tauri opener plugin. They SHALL NOT be opened inside the Lattice WebView[^webview].

<!--REQ-LTTCE-LNK-00003-->
**REQ-LTTCE-LNK-00003** — Links with a plain `http://` scheme (no TLS[^tls]) SHALL be visually rendered as
blocked: struck-through text with reduced opacity and a `not-allowed` cursor. A native hover tooltip SHALL
state that the link is intentionally blocked and recommend using HTTPS[^tls] instead. No navigation or
external request SHALL occur when such a link is clicked.

<!--REQ-LTTCE-LNK-00004-->
**REQ-LTTCE-LNK-00004** — In-page anchor links (hrefs beginning with `#`) SHALL scroll the preview pane
smoothly to the element with the matching heading ID. No new window SHALL be opened.

<!--REQ-LTTCE-LNK-00005-->
**REQ-LTTCE-LNK-00005** — Local relative file links whose target has a `.md`, `.markdown`, or `.txt`
extension SHALL open the resolved absolute path in a **new** Lattice window via `open_new_window`, leaving
the current window and its editor state untouched.

<!--REQ-LTTCE-LNK-00006-->
**REQ-LTTCE-LNK-00006** — The path resolution for local file links SHALL correctly handle relative segments
`./`, `../`, and nested subdirectories, and SHALL strip any `#fragment` suffix before resolving.
*Rationale*: markdown links always use forward slashes regardless of host platform; the resolver must
normalise separators to the platform convention detected from the current file path.

<!--REQ-LTTCE-LNK-00007-->
**REQ-LTTCE-LNK-00007** — Local file links whose target does NOT match the document extensions in
REQ-LTTCE-LNK-00005 (e.g. `.pdf`, `.png`) SHALL be silently ignored — no navigation, no new window.

---

## Chapter DVW — Dual-View Cursor Flash

In all dual view modes (`dual`, `dual-swap`, `dual-top`, `dual-bottom`) the editor and the preview pane are
visible simultaneously. While editing, the user needs immediate visual confirmation of *where* the line under
the editing cursor is located in the rendered preview. The Cursor Flash feature provides this by briefly
rendering the corresponding preview block with inverted colors.

<!--REQ-LTTCE-DVW-00001-->
**REQ-LTTCE-DVW-00001** — In any dual view mode, whenever the editor cursor moves to a different source
line (by keyboard, mouse click, or as a side effect of typing), the **innermost** preview block element whose
source-line range contains that cursor line SHALL be highlighted with **inverted colors** (color inversion of
the block's rendered content and background). If no preview element's source range contains the cursor line
(e.g. a blank separator line), no highlight SHALL be shown. Innermost means: of all containing elements, the
one spanning the smallest source-line range (ties resolved to the later-starting element).

<!--REQ-LTTCE-DVW-00002-->
**REQ-LTTCE-DVW-00002** — The inversion SHALL apply to the block's entire rendered inline content, expressly
including `==highlight==` `<mark>` spans, whose highlight background SHALL appear inverted as well. Display
mathematics (`$$...$$` blocks rendered by KaTeX[^katex]) SHALL react to the flash like any other block, and
the KaTeX output — including its internal SVG glyphs (root bars, stretchy braces) — SHALL invert together
with the text. Raster images and Mermaid[^mermaid] diagrams inside the flashed block SHALL be
counter-inverted so that they keep their natural colors.

<!--REQ-LTTCE-DVW-00003-->
**REQ-LTTCE-DVW-00003** — The inverted highlight SHALL appear without perceptible delay on cursor movement,
SHALL persist for approximately 2 seconds after the last cursor-line change, and SHALL then fade out
(approx. 400 ms). Any further cursor-line change SHALL restart the hold period and move the highlight to the
new block. The highlight SHALL NOT appear in the single `edit` or single `preview` view modes, and SHALL
survive a preview re-render (e.g. caused by typing) for the remainder of its hold period.

---

## Chapter PRV — Preview Code Syntax Highlighting

The edit pane already syntax-highlights fenced code blocks via CM6[^cm6] Lezer parsers. The preview
pane must give the user the same comprehension aid on the rendered side, with colors fitting the
preview's own (independent) light/dark theme.

<!--REQ-LTTCE-PRV-00001-->
**REQ-LTTCE-PRV-00001** — The preview pane SHALL syntax-highlight the content of every fenced code
block carrying a language tag, using the **same language registry** (names and aliases) the edit pane
uses for fence highlighting. A tag unknown to that registry, an untagged fence, and inline code SHALL
render as plain (unhighlighted) code. A `mermaid` tag keeps its existing diagram rendering.

<!--REQ-LTTCE-PRV-00002-->
**REQ-LTTCE-PRV-00002** — Highlight colors SHALL follow the preview pane's own light/dark theme
selection (GitHub-style palettes, consistent with the editor's GitHub themes), and highlighting SHALL
NOT alter the text content of the code block in any way.

<!--REQ-LTTCE-PRV-00003-->
**REQ-LTTCE-PRV-00003** — Language parser bundles SHALL be loaded lazily and asynchronously; while a
bundle loads (and if loading fails) the block SHALL be readable as plain code. Highlighting SHALL
never block or break preview rendering.

---

[^mermaid]: Mermaid — a JavaScript diagramming library rendering text definitions inside fenced code blocks
    as SVG diagrams. <https://mermaid.js.org>

[^katex]: KaTeX — a fast math typesetting library rendering TeX notation to HTML/SVG in the browser.
    <https://katex.org>

---

[^html]: HTML — HyperText Markup Language.

[^webview]: WebView — the embedded browser rendering engine used by Tauri to display the application UI
    (WebView2 on Windows, WKWebView on macOS).

[^tauri]: Tauri — the Rust-based framework used to build Lattice as a native desktop and mobile application.
    <https://tauri.app>

[^tls]: TLS — Transport Layer Security. `https://` uses TLS to encrypt traffic; `http://` does not.
    Plain HTTP leaks request content and headers to any network observer.

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
