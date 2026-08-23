import { linter, Diagnostic } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';
import { describeInvisibleChar, isInvisibleChar } from '../lib/invisible-chars';

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
// InvisibleHit
//******************************************************************************
/** One invisible character found in a structural position on a single line. */
export interface InvisibleHit {
    /** 0-based offset of the offending character within the line. */
    index: number;
    /** Its UTF-16 code unit. */
    code: number;
    /** Which structural position it sits in — selects the diagnostic wording. */
    where: 'marker-gap' | 'checkbox' | 'after-checkbox' | 'indent';
}

/** True for the two characters CommonMark/GFM accepts as structural whitespace. */
const isMarkdownSpace = (ch: string): boolean => ch === ' ' || ch === '\t';

/** True for space, tab, or any invisible look-alike — the "visually blank" set. */
const isBlankish = (line: string, i: number): boolean =>
    isMarkdownSpace(line[i]) || isInvisibleChar(line.charCodeAt(i));


//******************************************************************************
// IMPL-LTTCE-LNT-00016 — findTaskMarkerInvisible helper
//******************************************************************************
/**
 * Detects an invisible character inside a construct that *looks* like a GFM
 * task-list item but will not render as one.
 *
 * GFM accepts only U+0020 and U+0009 as the whitespace of a task-list marker.
 * Any look-alike (U+00A0 above all — see `lib/invisible-chars.ts` for why it
 * gets there) disqualifies the marker silently: the item degrades to an
 * ordinary list item whose text begins with a literal `[ ]`, complete with its
 * normal bullet. The two lines are indistinguishable in the editor.
 *
 * Only the first offending character is reported: one diagnostic per line is
 * enough to send the author to the right place, and fixing it re-runs the scan.
 *
 * @param line Raw text of one document line, without its line break.
 * @returns The hit, or `null` when the line is fine or is not task-shaped.
 *
 * @example findTaskMarkerInvisible('- [ ]' + '\u00a0' + '(note)')
 *          // -> { index: 5, code: 0xa0, where: 'after-checkbox' }
 * @example findTaskMarkerInvisible('- [ ] (note)')  // -> null (clean ASCII)
 */
export function findTaskMarkerInvisible(line: string): InvisibleHit | null {
    // Leading indent + a bullet (-, *, +) or an ordered marker (N. / N)).
    const marker = /^[ \t]*(?:[-*+]|\d{1,9}[.)])/.exec(line);
    if (!marker) return null;

    // ── Gap between the list marker and the opening bracket ────────────────
    const gapStart = marker[0].length;
    let i = gapStart;
    while (i < line.length && isBlankish(line, i)) i++;
    if (i === gapStart) return null;        // no gap → not a list item at all
    if (line[i] !== '[') return null;       // not the `[x]` shape → not our rule

    // The bracket must hold exactly one character and then close.
    if (line[i + 2] !== ']') return null;

    for (let k = gapStart; k < i; k++) {
        if (isInvisibleChar(line.charCodeAt(k))) {
            return { index: k, code: line.charCodeAt(k), where: 'marker-gap' };
        }
    }

    // ── Inside the brackets ────────────────────────────────────────────────
    const box = line[i + 1];
    if (isInvisibleChar(line.charCodeAt(i + 1))) {
        return { index: i + 1, code: line.charCodeAt(i + 1), where: 'checkbox' };
    }
    // A bracket holding anything else (a letter, a digit) is ordinary text,
    // not a checkbox the user believes in — stay silent.
    if (!isMarkdownSpace(box) && box !== 'x' && box !== 'X') return null;

    // ── Directly after the closing bracket ─────────────────────────────────
    const after = i + 3;
    if (after < line.length && isInvisibleChar(line.charCodeAt(after))) {
        return { index: after, code: line.charCodeAt(after), where: 'after-checkbox' };
    }
    return null;
}
// findTaskMarkerInvisible END *************************************************


//******************************************************************************
// IMPL-LTTCE-LNT-00017 — findIndentInvisible helper
//******************************************************************************
/**
 * Detects an invisible character used as line-leading indentation.
 *
 * Indentation is what decides nesting, list continuation and code blocks, and
 * only spaces and tabs count. A line indented with U+00A0 therefore does not
 * nest the way it is drawn — it becomes a lazy continuation of the block above,
 * or a paragraph of its own.
 *
 * A line consisting *only* of blank-ish characters is deliberately not
 * reported: a lone U+00A0 on an otherwise empty line is a deliberate idiom for
 * forcing a visible empty paragraph.
 *
 * @param line Raw text of one document line, without its line break.
 * @returns The hit, or `null` when the indent is clean.
 *
 * @example findIndentInvisible('\u00a0\u00a0' + '(note)')
 *          // -> { index: 0, code: 0xa0, where: 'indent' }
 */
export function findIndentInvisible(line: string): InvisibleHit | null {
    let i = 0;
    while (i < line.length && isBlankish(line, i)) i++;
    if (i === line.length) return null;     // blank-only line → intentional

    for (let k = 0; k < i; k++) {
        if (isInvisibleChar(line.charCodeAt(k))) {
            return { index: k, code: line.charCodeAt(k), where: 'indent' };
        }
    }
    return null;
}
// findIndentInvisible END *****************************************************


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
    //
    // The code nodes are collected a second time on their own, because the
    // invisible-character rules need a *narrower* exclusion: a broken checkbox
    // such as `[<U+00A0>]` is parsed by Lezer as a shortcut-reference `Link`,
    // so excluding links would silence exactly the case the rule exists for.
    // Code, on the other hand, must stay excluded everywhere — a document that
    // *demonstrates* the problem inside a fence is not making the mistake.
    const excluded: Array<{ from: number; to: number }> = [];
    const codeRanges: Array<{ from: number; to: number }> = [];
    tree.cursor().iterate(node => {
        const isCode = ['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name);
        if (isCode) codeRanges.push({ from: node.from, to: node.to });
        if (isCode || ['Link', 'Image', 'Autolink'].includes(node.name)) {
            excluded.push({ from: node.from, to: node.to });
            return false; // don't descend into these
        }
    });
    const inRanges = (
        ranges: ReadonlyArray<{ from: number; to: number }>,
        from: number,
        to: number,
    ): boolean => ranges.some(r => from >= r.from && to <= r.to);

    const isExcluded = (from: number, to: number): boolean => inRanges(excluded, from, to);
    const isInCode = (from: number, to: number): boolean => inRanges(codeRanges, from, to);

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

    // IMPL-LTTCE-LNT-00016 / IMPL-LTTCE-LNT-00017 ── Invisible whitespace ──────
    // Scanned per line rather than through the Lezer tree, because the damage is
    // precisely that no node is produced: a task item broken this way parses as
    // an ordinary list item, indistinguishable from a deliberate one. Only
    // *structural* positions are reported — an invisible character in the middle
    // of prose renders as a space and is harmless, and is left to the Show
    // Whitespace extension to visualize (REQ-LTTCE-WSP-00007).
    for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);

        const hit = findTaskMarkerInvisible(line.text) ?? findIndentInvisible(line.text);
        if (!hit) continue;

        const at = line.from + hit.index;
        if (isInCode(at, at + 1)) continue;     // inside code — literal by intent

        const label = describeInvisibleChar(hit.code);
        const isTask = hit.where !== 'indent';

        const message = isTask
            ? `Invisible character ${label} ` +
            (hit.where === 'checkbox' ? 'inside the task-list checkbox. '
                : hit.where === 'after-checkbox' ? 'directly after the task-list checkbox. '
                    : 'between the list marker and the checkbox. ') +
            'GFM accepts only a space or a tab here, so this line does NOT render as a ' +
            'checkbox — it becomes an ordinary list item showing a literal "[ ]". ' +
            'Replace it with a normal space.'
            : `Line indented with the invisible character ${label}. ` +
            'Only spaces and tabs count as Markdown indentation, so this line does not ' +
            'nest the way it looks — it attaches to the block above or starts its own ' +
            'paragraph. Replace it with normal spaces or a tab.';

        diagnostics.push({
            from: at,
            to: at + 1,
            severity: isTask ? 'error' : 'warning',
            ...(isTask ? {} : { markClass: 'cm-gfm-lint cm-gfm-lint-warning' }),
            message,
        });
    }

    return diagnostics;
}

/** CM6 extension: wraps `lintGfm` with the standard debounce/scheduling. */
export const gfmLinter = linter(lintGfm);
