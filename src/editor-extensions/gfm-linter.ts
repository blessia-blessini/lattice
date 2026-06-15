import { linter, Diagnostic } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';

//******************************************************************************
// IMPL-LTTCE-LNT-0000E — countTableCells helper
// Counts GFM pipe-table cells in a single raw line.
// Handles optional leading/trailing pipes.
//
// @example countTableCells("| a | b | c |")  // → 3
// @example countTableCells("a | b | c")       // → 3
//******************************************************************************
export function countTableCells(line: string): number {
    const trimmed = line.trim();
    const inner = trimmed.replace(/^\||\|$/g, '');
    // Split on pipes not preceded by a backslash escape
    return inner.split(/(?<!\\)\|/).length;
}

//******************************************************************************
// IMPL-LTTCE-LNT-0000E — validateTable helper
// Walks a Table node and emits an error for every body row whose
// cell count differs from the header row.
//******************************************************************************
function validateTable(
    tableNode: SyntaxNode,
    doc: EditorView['state']['doc'],
    diagnostics: Diagnostic[],
): void {
    let headerCells: number | null = null;
    let child: SyntaxNode | null = tableNode.firstChild;

    while (child) {
        if (child.name === 'TableHeader' || child.name === 'TableRow') {
            const lineText = doc.lineAt(child.from).text;
            const cells = countTableCells(lineText);

            if (child.name === 'TableHeader') {
                headerCells = cells;
            } else if (headerCells !== null && cells !== headerCells) {
                diagnostics.push({
                    from: child.from,
                    to: child.to,
                    severity: 'error',
                    message:
                        `Table row has ${cells} column(s) but the header expects ${headerCells}. ` +
                        'This renders incorrectly in GFM.',
                });
            }
        }
        child = child.nextSibling;
    }
}

//******************************************************************************
// IMPL-LTTCE-LNT-00001 — gfmLinter
//
// CodeMirror linter that surfaces GFM-specific ambiguities and errors.
// Integrates with @codemirror/lint — no new runtime dependencies.
//
// `lintGfm` is the raw diagnostic function, exported for direct unit testing.
// `gfmLinter` wraps it with the CM6 linter() factory (debounce, scheduling).
//
// Severity levels:
//  error   → things that will definitely render broken
//  warning → things commonly stripped/sanitized by renderers
//  hint    → stylistic ambiguities that may render differently across parsers
//
// All hint/warning diagnostics carry markClass 'cm-gfm-lint' for green
// wavy underlines (App.css). HTML blocks additionally get
// 'cm-gfm-lint-warning' for an orange tint.
//******************************************************************************
function lintGfm(view: EditorView): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const tree = syntaxTree(view.state);
    const doc = view.state.doc;
    const text = doc.toString();

    // ── Build exclusion ranges ─────────────────────────────────────────────────
    // Positions inside links, images, autolinks, and code nodes are excluded
    // from text-based scans (bare URLs, single-tilde) to avoid false positives.
    const excluded: Array<{ from: number; to: number }> = [];
    tree.cursor().iterate(node => {
        if (['Link', 'Image', 'Autolink', 'InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) {
            excluded.push({ from: node.from, to: node.to });
            return false; // don't descend into these
        }
    });
    const isExcluded = (from: number, to: number): boolean =>
        excluded.some(r => from >= r.from && to <= r.to);

    // ── Heading collection for duplicate detection ─────────────────────────────
    // Gathered during the tree walk; duplicate check runs after.
    const headingSeen = new Map<string, number>(); // normalizedText → first-occurrence `from`
    const headingQueue: Array<{ from: number; to: number; normalized: string }> = [];

    // ── Tree walk ─────────────────────────────────────────────────────────────
    tree.cursor().iterate(node => {
        const { name, from, to } = node;

        // IMPL-LTTCE-LNT-0000A ── Setext headings ─────────────────────────────
        // `====` / `----` underlines are visually ambiguous: `----` looks
        // identical to a thematic break or table separator. ATX headings
        // (# Title) are unambiguous across all CommonMark/GFM parsers.
        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
            const level = name === 'SetextHeading1' ? 1 : 2;
            diagnostics.push({
                from,
                to,
                severity: 'hint',
                markClass: 'cm-gfm-lint',
                message:
                    `Setext heading (underline style). ` +
                    `Consider ATX style (${'#'.repeat(level)} …) for unambiguous GFM.`,
            });
        }

        // IMPL-LTTCE-LNT-0000B ── Indented code blocks ─────────────────────────
        // Four-space indent can be misread as list-continuation in some parsers.
        // Fenced blocks (```) are unambiguous and allow language tagging.
        if (name === 'CodeBlock') {
            diagnostics.push({
                from,
                to,
                severity: 'hint',
                markClass: 'cm-gfm-lint',
                message:
                    'Indented code block (4 spaces). ' +
                    'Prefer fenced code blocks (``` lang) for explicit language tagging and unambiguous rendering.',
            });
        }

        // IMPL-LTTCE-LNT-0000C ── HTML blocks ──────────────────────────────────
        if (name === 'HTMLBlock') {
            diagnostics.push({
                from,
                to,
                severity: 'warning',
                markClass: 'cm-gfm-lint cm-gfm-lint-warning',
                message:
                    'Raw HTML block: not rendered in Lattice preview. ' +
                    'Use Markdown equivalents for portability — many renderers ' +
                    '(Obsidian, VS Code, Typora) strip or ignore HTML blocks.',
            });
        }

        // IMPL-LTTCE-LNT-0000D ── Inline HTML tags ─────────────────────────────
        // A small whitelist (<sup>, <sub>, <kbd>, <br>) is rendered by Lattice.
        // Everything else is shown as literal text.
        if (name === 'HTMLTag') {
            const tagText = doc.sliceString(from, to);
            const isWhitelisted = /^<\/?(sup|sub|kbd|br)\s*\/?>$/i.test(tagText);
            if (isWhitelisted) {
                diagnostics.push({
                    from,
                    to,
                    severity: 'hint',
                    markClass: 'cm-gfm-lint',
                    message:
                        `Inline HTML tag: rendered in Lattice, but may not display correctly ` +
                        `in all other Markdown renderers (portability risk).`,
                });
            } else {
                diagnostics.push({
                    from,
                    to,
                    severity: 'warning',
                    markClass: 'cm-gfm-lint cm-gfm-lint-warning',
                    message:
                        'Inline HTML tag: not rendered in Lattice preview (shown as literal text). ' +
                        'Use a Markdown equivalent for reliable cross-renderer display.',
                });
            }
        }

        // IMPL-LTTCE-LNT-0000E ── Table column-count validation ────────────────
        if (name === 'Table') {
            validateTable(node.node, doc, diagnostics);
        }

        // IMPL-LTTCE-LNT-00011 ── Loose list ───────────────────────────────────
        // A blank line between any two list items makes the entire list loose:
        // all items are wrapped in <p>, adding extra vertical spacing.
        // One stray blank line affects items that have none around them.
        if (name === 'BulletList' || name === 'OrderedList') {
            const listText = doc.sliceString(from, to);
            if (/\n[ \t]*\n/.test(listText)) {
                diagnostics.push({
                    from,
                    to,
                    severity: 'hint',
                    markClass: 'cm-gfm-lint',
                    message:
                        'Loose list: blank line between items makes the entire list loose. ' +
                        'All items render with <p> tags (more spacing). Remove blank lines for a tight list.',
                });
            }
        }

        // IMPL-LTTCE-LNT-00012 ── Fenced code block without language tag ───────
        if (name === 'FencedCode') {
            let hasLang = false;
            let child: SyntaxNode | null = node.node.firstChild;
            while (child) {
                if (child.name === 'CodeInfo') { hasLang = true; break; }
                child = child.nextSibling;
            }
            if (!hasLang) {
                const fenceLine = doc.lineAt(from);
                diagnostics.push({
                    from,
                    to: fenceLine.to,
                    severity: 'warning',
                    markClass: 'cm-gfm-lint cm-gfm-lint-warning',
                    message:
                        'Fenced code block has no language tag. ' +
                        'Add an identifier (e.g. ```typescript) for syntax highlighting and unambiguous rendering.',
                });
            }
        }

        // IMPL-LTTCE-LNT-00013 ── Image with empty alt text ────────────────────
        if (name === 'Image') {
            const raw = doc.sliceString(from, to);
            // Image syntax: ![alt](url "title") or ![alt][ref]
            const altMatch = raw.match(/^!\[([^\]]*)\]/);
            if (altMatch && altMatch[1].trim() === '') {
                diagnostics.push({
                    from,
                    to: from + altMatch[0].length,
                    severity: 'warning',
                    markClass: 'cm-gfm-lint cm-gfm-lint-warning',
                    message:
                        'Image has empty alt text. ' +
                        'Provide a description for accessibility and as fallback when the image cannot load.',
                });
            }
        }

        // IMPL-LTTCE-LNT-00014 ── Duplicate heading text (collect phase) ───────
        if (/^(ATXHeading[1-6]|SetextHeading[12])$/.test(name)) {
            const raw = doc.sliceString(from, to);
            // Strip ATX markers (# / ## / ...) and trailing markers; take first line only
            const normalized = raw
                .replace(/^#{1,6}\s+/, '')
                .replace(/\s+#+\s*$/, '')
                .split('\n')[0]
                .trim()
                .toLowerCase();
            headingQueue.push({ from, to, normalized });
        }
    });

    // IMPL-LTTCE-LNT-00014 ── Duplicate heading text (report phase) ─────────────
    for (const h of headingQueue) {
        if (headingSeen.has(h.normalized)) {
            const slug = h.normalized.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
            diagnostics.push({
                from: h.from,
                to: h.to,
                severity: 'warning',
                markClass: 'cm-gfm-lint cm-gfm-lint-warning',
                message:
                    `Duplicate heading "${h.normalized}". ` +
                    `Anchor #${slug} will collide with an earlier heading, breaking internal links.`,
            });
        } else {
            headingSeen.set(h.normalized, h.from);
        }
    }

    // ── Text-based scans ──────────────────────────────────────────────────────
    // These operate on the raw document string and exclude positions already
    // covered by link/code nodes (see exclusion ranges above).

    // IMPL-LTTCE-LNT-0000F ── Bare URLs ─────────────────────────────────────────
    // A bare https?:// URL in plain text may not be autolinked by all renderers.
    // GFM spec requires autolink extension support, but not all tools enable it.
    const urlRe = /https?:\/\/[^\s<>()\[\]'"\\]+/g;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(text)) !== null) {
        if (!isExcluded(m.index, m.index + m[0].length)) {
            diagnostics.push({
                from: m.index,
                to: m.index + m[0].length,
                severity: 'hint',
                markClass: 'cm-gfm-lint',
                message:
                    'Bare URL. Wrap in <url> for a GFM autolink or [text](url) for a named link ' +
                    'to ensure consistent rendering across all Markdown parsers.',
            });
        }
    }

    // IMPL-LTTCE-LNT-00010 ── Single-tilde strikethrough ────────────────────────
    // GFM strikethrough requires double tildes (~~text~~). Single ~text~ is
    // non-standard and renders as plain text in most parsers.
    const tildeRe = /(?<!~)~(?!~)[^\n~]+(?<!~)~(?!~)/g;
    while ((m = tildeRe.exec(text)) !== null) {
        if (!isExcluded(m.index, m.index + m[0].length)) {
            diagnostics.push({
                from: m.index,
                to: m.index + m[0].length,
                severity: 'hint',
                markClass: 'cm-gfm-lint',
                message: 'Single-tilde ~text~ is non-standard. Use ~~text~~ for GFM strikethrough.',
            });
        }
    }

    // IMPL-LTTCE-LNT-00015 ── Unclosed fenced code block ────────────────────────
    // An unclosed fence causes everything after the opening line to render as
    // a code block, silently swallowing the rest of the document.
    {
        const lines = text.split('\n');
        let fenceChar: string | null = null;
        let fenceMinLen = 0;
        let fenceStartPos = 0;
        let pos = 0;

        for (const line of lines) {
            const fenceMatch = line.trimStart().match(/^(`{3,}|~{3,})/);
            if (fenceMatch) {
                const ch = fenceMatch[1][0];
                const len = fenceMatch[1].length;

                if (fenceChar === null) {
                    // Opening fence
                    fenceChar = ch;
                    fenceMinLen = len;
                    fenceStartPos = pos;
                } else if (ch === fenceChar && len >= fenceMinLen) {
                    // Valid closing fence: same character, at least as long
                    const restOfLine = line.trimStart().slice(len).trim();
                    if (restOfLine === '') {
                        fenceChar = null;
                    }
                }
            }
            pos += line.length + 1; // +1 for the '\n'
        }

        if (fenceChar !== null) {
            const openLine = doc.lineAt(fenceStartPos);
            diagnostics.push({
                from: fenceStartPos,
                to: openLine.to,
                severity: 'error',
                message:
                    'Unclosed fenced code block. ' +
                    'Everything after this fence renders as code, swallowing the rest of the document.',
            });
        }
    }

    return diagnostics;
}

/** CM6 extension: wraps `lintGfm` with the standard debounce/scheduling. */
export const gfmLinter = linter(lintGfm);
