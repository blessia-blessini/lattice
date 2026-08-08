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
  - [Chapter WSP — Show Whitespace](#chapter-wsp-show-whitespace)
  - [Chapter SET — Settings Robustness](#chapter-set-settings-robustness)
  - [Chapter CPY — Preview Copy Fidelity](#chapter-cpy-preview-copy-fidelity)
  - [Chapter TBL — Spreadsheet Paste](#chapter-tbl-spreadsheet-paste)
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

## Chapter WSP — Show Whitespace

When editing whitespace-sensitive Markdown (indented list continuations, code blocks, trailing
double-space line breaks) the user needs to *see* spaces and tabs to understand the document
structure. The Show Whitespace feature visualizes them in the edit pane, in the subtle style
familiar from Word and VS Code.

<!--REQ-LTTCE-WSP-00001-->
**REQ-LTTCE-WSP-00001** — When the feature is enabled, the edit pane SHALL visualize whitespace
characters: each stretch of space characters SHALL be rendered with a faint centered dot per space,
and each tab character SHALL be rendered with a faint arrow. The visualization SHALL be subtle —
clearly dimmer than the surrounding text — yet perceivable in both the light and the dark editor
theme.

<!--REQ-LTTCE-WSP-00002-->
**REQ-LTTCE-WSP-00002** — The feature SHALL be controlled by a setting **"Show Whitespace"**
(persisted key `showWhitespace`) that is **OFF by default**, can be set and cleared from the
Settings panel, is persisted to the vault `settings.json`, and takes effect in the edit pane
immediately on toggle (no application restart or file reload).

<!--REQ-LTTCE-WSP-00003-->
**REQ-LTTCE-WSP-00003** — The visualization SHALL be purely decorative: it SHALL NOT modify the
document text, character metrics, line layout, cursor behaviour, or the saved file content in any
way, in either state of the setting.

<!--REQ-LTTCE-WSP-00004-->
**REQ-LTTCE-WSP-00004** — Pressing the **Tab** key in the edit pane SHALL insert a literal tab
character (`\t`) at the cursor when the selection is empty, and SHALL indent the selected lines when
a selection exists (Shift-Tab SHALL un-indent). The Tab key SHALL NOT move keyboard focus out of the
editor; the standard CM6[^cm6] escape sequence (Esc, then Tab) remains available for keyboard-only
focus navigation.

<!--REQ-LTTCE-WSP-00005-->
**REQ-LTTCE-WSP-00005** — A setting **"Tab Size"** (persisted key `tabSize`) SHALL control the
display width of a tab character in the edit pane, in columns. Valid values are the integers
**2 to 8**; the default is **2**. Out-of-range values in the hand-editable settings file SHALL be
clamped into the valid range on load. The setting SHALL be editable from the Settings panel and
SHALL take effect in the edit pane immediately. The editor's indent unit SHALL be one tab
character, so the indent width and the tab display width are always the same value.

<!--REQ-LTTCE-WSP-00006-->
**REQ-LTTCE-WSP-00006** — The editor SHALL provide **Tabify** and **Untabify** operations that
convert **only line-start (leading) whitespace**, column-accurately with respect to the Tab Size
setting: Tabify SHALL replace each full tab-stop of leading space width with one tab character,
keeping any remainder columns as spaces; Untabify SHALL replace leading tabs with the equivalent
number of space columns. The operations SHALL apply to the lines covered by the selection, or to
the **whole document** when the selection is empty, SHALL leave all non-leading text untouched,
SHALL preserve undo history, and SHALL be available both from the application menu and via the
keyboard shortcuts Ctrl/Cmd+Alt+T (Tabify) and Ctrl/Cmd+Alt+Shift+T (Untabify).

---

## Chapter SET — Settings Robustness

The vault `settings.json` is a hand-editable file. Editing mistakes (a wrong type, an absurd
number) must degrade gracefully: the user should lose at most the mistyped setting, never the
whole configuration.

<!--REQ-LTTCE-SET-00001-->
**REQ-LTTCE-SET-00001** — When loading settings, a field whose value cannot be parsed (wrong JSON
type, numeric overflow, or any other per-field error) SHALL fall back to that field's default
value **without affecting any other field** in the file. Only a file that is not valid JSON at
all (or whose top level is not an object) MAY cause all settings to fall back to defaults.
Unknown keys SHALL continue to be tolerated (forward compatibility).

<!--REQ-LTTCE-SET-00002-->
**REQ-LTTCE-SET-00002** — When saving settings, the application SHALL (a) refuse to write to any
path that is not a `settings.json` file directly inside a `.lattice` directory, leaving the
target untouched and returning an error, and (b) clamp range-constrained numeric fields (such as
`tabSize`) into their valid range **before** persisting, so the settings file on disk never
holds an out-of-range value regardless of the value received over IPC[^ipc].

---

## Chapter CPY — Preview Copy Fidelity

Rich text copied from the preview pane is pasted into external applications — MS Word, Outlook,
mail clients, wikis. The clipboard carries the selected DOM subtree as HTML, but **not** the
application's stylesheets, so any styling that lives only in a CSS class is lost on paste.
Word-family applications additionally discard the HTML5 `<mark>` element together with its
attributes (their HTML reader predates HTML5 and has no default style for it), which silently
drops the `==highlight==` yellow background.

<!--REQ-LTTCE-CPY-00001-->
**REQ-LTTCE-CPY-00001** — The preview pane SHALL render each `==highlight==` as an element whose
highlight background is carried by an **inline CSS style** on a tag that legacy HTML readers
understand (`<span style="background-color:…">`), and SHALL NOT use the HTML5 `<mark>` element.
Consequently, copying any preview selection SHALL preserve the highlight background when pasted
into applications whose HTML readers predate HTML5 (MS Word) — WYSIWYG across the clipboard — for
**every** copy path offered by the WebView[^webview] (keyboard, context menu, drag-and-drop), and
without the application intercepting clipboard events.

*Rationale*: CSS class rules do not travel with the clipboard, and Word-family readers discard
unknown tags together with their attributes — so a highlight defined by a stylesheet rule on a
`<mark>` element is lost twice over. Placing the colour inline, on a `<span>`, removes both failure
modes at the source rather than patching the clipboard afterwards.

*Note*: the single exception to "without the application intercepting clipboard events" is a
selection containing a rendered diagram, which REQ-LTTCE-MRC-00002 rewrites. The guarantee above is
unaffected in either direction: selections without a diagram are never intercepted
(REQ-LTTCE-MRC-00003), and a rewritten selection is built by cloning the live nodes, inline styles
included.


<!--REQ-LTTCE-CPY-00002-->
**REQ-LTTCE-CPY-00002** — The inline highlight colour SHALL follow the active preview theme
(light/dark), matching the colour the user sees on screen, and SHALL be expressed as an **opaque
`#rrggbb` value** — not `rgba()`, `hsl()`, or a colour keyword.

*Rationale*: the value is parsed by the receiving application's CSS engine, which on the
Word/Outlook family is far older than any WebView's and may drop notations it does not recognise,
taking the highlight with them. The requirement is platform-neutral: it holds identically on
Windows and Android (Chromium), macOS and iOS (WebKit) and Linux (WebKitGTK), because the mechanism
is markup, not a platform clipboard API.

### Receiving-application constraints (outside Lattice's control)

Two behaviours of the *receiving* application can still discard a correctly emitted highlight.
Recorded here so they are not mistaken for defects in the requirements above.

1. **MS Word paste mode.** Word keeps the highlight only when the paste preserves source
   formatting. Under *Merge Formatting* it retains structure, bold and lists but drops background
   shading — which looks exactly like a Lattice bug. Users set *File → Options → Advanced → Cut,
   copy, and paste → Pasting from other programs* to **Keep Source Formatting**, or pick it from
   the paste-options button per paste.

2. **New Outlook for Windows — known limitation, not addressable from Lattice.** New Outlook
   replaced Word's rendering engine with a web editor whose paste sanitiser removes inline
   background styling outright. Measured 2026-08-02 by placing hand-built CF_HTML directly on the
   clipboard (bypassing the app): `<span style="background-color:…">`, bare `<mark>`,
   `<mark style="…">`, `<mark>` wrapping a styled `<span>`, the `background:yellow` keyword form,
   and Word's own `background:yellow;mso-highlight:yellow` export form were **all** stripped. Only
   `bgcolor` on a `<td>` survived, which is unusable for inline text — a table is block-level and
   would destroy text flow in the preview. The same loss applies to content copied out of Word
   itself, confirming this is an Outlook behaviour, not a Lattice one. User workarounds: classic
   Outlook, or paste as an image.


---

## Chapter TBL — Spreadsheet Paste

Copying a range out of a spreadsheet (Excel, LibreOffice Calc, Google Sheets, Numbers) puts a TSV[^tsv]
grid on the clipboard: rows separated by newlines, cells separated by TAB. Pasted verbatim into a Markdown
document that grid is unreadable — nothing aligns and no renderer treats it as a table. Retyping it as a
GFM[^gfm] pipe table by hand is the manual step this chapter removes.

The conversion is offered, never imposed: the raw TSV is sometimes exactly what the user wants (a code
fence, a data snippet), and silently rewriting a paste is the kind of surprise that erodes trust in an
editor.

<!--REQ-LTTCE-TBL-00001-->
**REQ-LTTCE-TBL-00001** — When text pasted into the edit pane is recognised as a spreadsheet grid, Lattice
SHALL NOT insert it directly but SHALL first ask the user to choose between inserting it as a GFM[^gfm]
table and inserting the clipboard text verbatim.

*Rationale*: the conversion is lossy in one direction (TSV structure becomes Markdown markup) and the user
is the only one who knows which form they wanted.

<!--REQ-LTTCE-TBL-00002-->
**REQ-LTTCE-TBL-00002** — The choice SHALL be presented by an application-rendered dialog — not by a
platform dialog service — offering exactly three outcomes: insert as a Markdown table (the default action),
insert the clipboard text verbatim, and cancel. Cancel SHALL leave the document byte-identical to its state
before the paste. The dialog SHALL be operable from the keyboard alone.

*Rationale*: Lattice ships on Windows, macOS, Linux, Android and iOS. Platform dialog services differ in
availability, appearance and blocking behaviour across those five targets; markup rendered by the
application itself behaves identically on all of them and is reachable from the automated tests.

<!--REQ-LTTCE-TBL-00003-->
**REQ-LTTCE-TBL-00003** — In the converted table the **first grid row** SHALL become the header row,
followed by a generated alignment-separator row; the remaining rows SHALL become body rows. The column
count SHALL be that of the widest row, and shorter rows SHALL be extended with empty cells so every row
carries the same number of delimiters.

<!--REQ-LTTCE-TBL-00004-->
**REQ-LTTCE-TBL-00004** — Cell content SHALL be sanitised so that it cannot break the row it sits in:
a literal `|` SHALL be emitted as `\|`, a literal `\` as `\\`, and a line break inside a cell as `<br>`.
Leading and trailing whitespace SHALL be trimmed.

*Rationale*: a GFM[^gfm] table row is delimited by `|` and confined to one line; both characters are
common in spreadsheet data (units, paths, multi-line notes).

<!--REQ-LTTCE-TBL-00005-->
**REQ-LTTCE-TBL-00005** — Recognition SHALL honour the spreadsheet quoting dialect: a cell wrapped in
double quotes is read as one cell whose TABs and line breaks are content, and a doubled `""` inside such a
cell is one literal `"`.

*Rationale*: spreadsheets do not emit bare TSV[^tsv]. A naive split on TAB and newline turns any multi-line
cell into extra columns and rows, silently corrupting the pasted data.

<!--REQ-LTTCE-TBL-00006-->
**REQ-LTTCE-TBL-00006** — The emitted table SHALL be column-padded by the same rules the "Pad Tables"
command applies, so a pasted table is indistinguishable from one the user has already tidied.

<!--REQ-LTTCE-TBL-00007-->
**REQ-LTTCE-TBL-00007** — Pastes that are not spreadsheet grids SHALL be unaffected — no dialog, no
conversion, no change to the existing paste behaviour. This includes plain prose, single-column payloads,
payloads that are already GFM[^gfm] tables, and image pastes.

*Rationale*: the feature must be invisible until it is wanted; a false positive costs the user a dialog on
every ordinary paste.

<!--REQ-LTTCE-TBL-00008-->
**REQ-LTTCE-TBL-00008** — An inserted table SHALL occupy whole lines: when the insertion point sits inside
a line that already holds text, a line break SHALL be inserted on the affected side(s).

*Rationale*: GFM[^gfm] only recognises a table whose header row starts a line. Without the break the paste
renders as a paragraph full of pipes.


## Chapter MRC — Copying Rendered Diagrams

A Mermaid[^mermaid] diagram is rendered in the preview as an inline `<svg>`. Copying it appears to work —
the WebView[^webview] does put that markup in the clipboard's HTML flavour — and then the paste produces
nothing at all, because the applications people paste into (Word, Outlook, Gmail, Slack) do not render
inline SVG received from the clipboard. There is no image flavour on the clipboard either, so applications
that paste pictures have nothing to take. The user copies a diagram and pastes a hole.

<!--REQ-LTTCE-MRC-00001-->
**REQ-LTTCE-MRC-00001** — Each rendered diagram SHALL have a raster image of itself available, at the same
dimensions in CSS pixels as the diagram on screen, and flattened onto an opaque background so that no
transparency reaches the clipboard.

*Rationale*: a receiving application that cannot composite alpha renders transparency as black, which on a
diagram means an unreadable picture. Flattening at the source is the only place the correct background
colour is known.

<!--REQ-LTTCE-MRC-00005-->
**REQ-LTTCE-MRC-00005** — A setting **"Copy Diagrams On Light Background"** (persisted key
`copyDiagramsLight`, default **ON**) SHALL control the colours of that raster image. When ON, the image
SHALL be a light-themed diagram on the light background colour whatever theme the application is using;
when OFF, it SHALL match the diagram as displayed. The setting SHALL NOT change what is displayed.

*Rationale*: the documents people paste into are overwhelmingly white, so a dark-theme user pasting a
dark-theme picture gets something that does not fit the page — which is why the default is ON. It has to
be a re-render rather than a change of background, because Mermaid[^mermaid] draws dark-theme diagrams in
light colours: putting white behind those would yield white on white.

*Note*: colours a user has chosen explicitly SHALL be preserved. The light theme applies only as a
default, below the user's Default-Mermaid-Init and below any `%%{init:…}%%` written into the diagram
itself.

<!--REQ-LTTCE-MRC-00002-->
**REQ-LTTCE-MRC-00002** — When a copied preview selection contains a rendered diagram, the HTML flavour
placed on the clipboard SHALL carry that raster image in place of the diagram markup, and the plain-text
flavour SHALL carry the text of the selection as it would have without the substitution.

*Rationale*: the substitution is the whole feature; the plain-text clause is there because taking over a
clipboard event means taking over *every* flavour it would otherwise have filled.

<!--REQ-LTTCE-MRC-00003-->
**REQ-LTTCE-MRC-00003** — A copied preview selection that contains no rendered diagram SHALL be left
entirely to the WebView's own copy path, unmodified.

*Rationale*: REQ-LTTCE-CPY-00001 guarantees highlight fidelity across every copy path the WebView offers,
explicitly without the application intercepting clipboard events. Narrowing the interception to selections
that actually need it keeps that guarantee intact for everything else, rather than re-establishing it by
hand for each copy path.

<!--REQ-LTTCE-MRC-00004-->
**REQ-LTTCE-MRC-00004** — When a diagram's raster image is unavailable — not yet produced, or its
production failed — the copy SHALL proceed unmodified rather than being blocked, delayed, or failed.

*Rationale*: producing the image is opportunistic work. A copy is a user action with an immediate
expectation; degrading to today's behaviour is always better than making the user wait or lose the copy.


## Chapter FWT — File Watching and External Reload

Lattice watches the open file so a change made by another program (a `git checkout`, a sync client, a
second Lattice window) can be picked up without the user reopening the document. That watch points at the
same file Lattice itself writes to, on every autosave and every save-on-blur — so the naive reading of a
filesystem notification is wrong most of the time: the change it reports is usually Lattice's own.

Acting on such a notification is not a cosmetic mistake. Loading a document replaces the editor's state,
and the editing state — undo history and caret position — dies with it. This chapter exists because that
outcome was reachable while the user was typing: the caret moved to the top of the file mid-sentence, the
undo stack emptied, and the keystrokes typed during the reload were silently discarded.

<!--REQ-LTTCE-FWT-00001-->
**REQ-LTTCE-FWT-00001** — A filesystem notification whose file content is unchanged since Lattice last
read or wrote that file SHALL NOT be reported to the editing session as an external change.

*Rationale*: every save makes the operating system notify Lattice about Lattice. Content — not the
notification itself, and not a timer — is the only sound test of whether anything actually changed.

<!--REQ-LTTCE-FWT-00002-->
**REQ-LTTCE-FWT-00002** — The document SHALL be replaced only as the result of an explicit load: opening a
file, restoring a session, or reloading a file that has demonstrably changed on disk. No other event —
including any repaint, re-render or stale copy of previously loaded text — SHALL replace the document.

*Rationale*: replacing the document is destructive and irreversible (the undo history that would reverse
it is exactly what gets destroyed). A destructive operation must be something the application asks for,
never something it can drift into.

<!--REQ-LTTCE-FWT-00003-->
**REQ-LTTCE-FWT-00003** — While the document holds unsaved changes, an external change SHALL NOT be
loaded. This SHALL hold for changes made at any point before the reload completes, including while the
file is being read.

*Rationale*: unsaved work outranks the disk copy. A check performed only at the start of an asynchronous
reload leaves a window in which the user's keystrokes lose to a copy that was already stale when it was
read.

<!--REQ-LTTCE-FWT-00004-->
**REQ-LTTCE-FWT-00004** — When the file being edited is reloaded, the caret SHALL be kept at its offset in
the document, clamped to the length of the newly loaded text. When a *different* file is opened, the caret
SHALL be placed at the start of the document. In both cases the loaded document SHALL be presented as
having no unsaved changes.

*Rationale*: a reload the user did not initiate should disturb them as little as the new content allows;
sending the caret to the top of a long document loses their place for no reason. A newly opened file is a
different document, in which the previous offset carries no meaning at all.

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

[^tsv]: TSV — Tab-Separated Values. A plain-text tabular format: one record per line, fields separated by
    TAB. It is the `text/plain` clipboard flavour every major spreadsheet application writes when a cell
    range is copied.

[^ipc]: IPC — Inter-Process Communication. In Lattice: the Tauri command channel between the
    WebView frontend and the Rust backend (`invoke`).
