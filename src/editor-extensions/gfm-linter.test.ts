import { describe, it, expect, afterEach } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { forceLinting, forEachDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import {
    countTableCells,
    findIndentInvisible,
    findTaskMarkerInvisible,
    gfmLinter,
} from './gfm-linter';

// Written as escapes on purpose: a literal invisible character in a test
// fixture is exactly as unreadable as it is in a document, and a reviewer
// could not tell a deliberate fixture from a typo. Never paste the raw glyph.
const NBSP = '\u00a0';   // NO-BREAK SPACE - the one Word/Outlook/Teams inject
const ZWSP = '\u200b';   // ZERO WIDTH SPACE
const NNBSP = '\u202f';  // NARROW NO-BREAK SPACE
const BOM = '\ufeff';    // ZERO WIDTH NO-BREAK SPACE (BOM)

// ── Test helper ───────────────────────────────────────────────────────────────
// Creates a real CM6 EditorView with the Markdown language and gfmLinter
// extension, then uses forceLinting (CM6 public API) to run the linter
// synchronously and getDiagnostics to read the results.
// No internal functions are exported from gfm-linter.ts for test purposes.

const views: EditorView[] = [];

async function lint(content: string): Promise<Diagnostic[]> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = EditorState.create({
        doc: content,
        extensions: [
            markdown({ base: markdownLanguage }),
            gfmLinter,
        ],
    });
    const view = new EditorView({ state, parent: container });
    views.push(view);
    // Ensure Lezer has fully parsed the document before forcing lint
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    // forceLinting triggers the linter synchronously; the result is dispatched
    // as a transaction — we wait one microtask for it to settle.
    forceLinting(view);
    await Promise.resolve();
    const diags: Diagnostic[] = [];
    forEachDiagnostic(view.state, (d) => diags.push(d));
    return diags;
}

afterEach(() => {
    for (const v of views) {
        v.destroy();
        v.dom.parentNode?.removeChild(v.dom);
    }
    views.length = 0;
});

// ── countTableCells (pure helper) ─────────────────────────────────────────────

describe('countTableCells', () => {
    it('counts cells with leading and trailing pipes', () => {
        expect(countTableCells('| a | b | c |')).toBe(3);
    });
    it('counts cells without leading or trailing pipes', () => {
        expect(countTableCells('a | b | c')).toBe(3);
    });
    it('handles a single-cell row', () => {
        expect(countTableCells('| only |')).toBe(1);
    });
    it('handles two cells', () => {
        expect(countTableCells('| Name | Value |')).toBe(2);
    });
    it('handles extra surrounding whitespace', () => {
        expect(countTableCells('  | a | b |  ')).toBe(2);
    });
    it('does not split on escaped pipes', () => {
        expect(countTableCells('| a\\|b | c |')).toBe(2);
    });
    it('handles a separator-style row', () => {
        expect(countTableCells('| --- | --- |')).toBe(2);
    });
});

// ── Rule: Setext headings (REQ-LTTCE-LNT-0000A) ──────────────────────────────

describe('lintGfm — setext headings', () => {
    it('emits a hint on a level-1 setext heading', async () => {
        const diags = await lint('Title\n=====\n\nsome text');
        const d = diags.find(d => d.severity === 'hint' && d.message.includes('Setext'));
        expect(d, 'expected setext hint').toBeTruthy();
    });

    it('emits a hint on a level-2 setext heading', async () => {
        const diags = await lint('Subtitle\n--------\n\nsome text');
        const d = diags.find(d => d.severity === 'hint' && d.message.includes('Setext'));
        expect(d).toBeTruthy();
        expect(d!.message).toContain('##');
    });

    it('does NOT flag an ATX heading', async () => {
        const diags = await lint('# Normal ATX Heading\n\nsome text');
        expect(diags.filter(d => d.message.includes('Setext'))).toHaveLength(0);
    });
});

// ── Rule: Indented code block (REQ-LTTCE-LNT-0000B) ──────────────────────────

describe('lintGfm — indented code block', () => {
    it('emits a hint on a 4-space indented code block', async () => {
        const diags = await lint('Paragraph.\n\n    const x = 1;\n');
        const d = diags.find(d => d.severity === 'hint' && d.message.includes('Indented'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag a fenced code block', async () => {
        const diags = await lint('```typescript\nconst x = 1;\n```\n');
        expect(diags.filter(d => d.message.includes('Indented'))).toHaveLength(0);
    });
});

// ── Rule: HTML block (REQ-LTTCE-LNT-0000C) ───────────────────────────────────

describe('lintGfm — HTML block', () => {
    it('emits a warning on a raw HTML block', async () => {
        const diags = await lint('<div>\nhello\n</div>\n');
        const d = diags.find(d => d.severity === 'warning' && d.message.includes('HTML block'));
        expect(d).toBeTruthy();
    });
});

// ── Rule: Inline HTML tag (REQ-LTTCE-LNT-0000D) ──────────────────────────────

describe('lintGfm — inline HTML tag (whitelisted → hint)', () => {
    it('emits a hint for <br> (whitelisted void)', async () => {
        const diags = await lint('Some text with a <br> line break.\n');
        const d = diags.find(d => d.severity === 'hint' && d.message.includes('rendered in Lattice'));
        expect(d).toBeTruthy();
    });

    it('emits a hint for <sup> (whitelisted paired)', async () => {
        const diags = await lint('X<sup>2</sup>\n');
        const hints = diags.filter(d => d.severity === 'hint' && d.message.includes('rendered in Lattice'));
        expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it('emits a hint for <sub> (whitelisted paired)', async () => {
        const diags = await lint('H<sub>2</sub>O\n');
        const hints = diags.filter(d => d.severity === 'hint' && d.message.includes('rendered in Lattice'));
        expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it('emits a hint for <kbd> (whitelisted paired)', async () => {
        const diags = await lint('Press <kbd>Ctrl</kbd>+S\n');
        const hints = diags.filter(d => d.severity === 'hint' && d.message.includes('rendered in Lattice'));
        expect(hints.length).toBeGreaterThanOrEqual(1);
    });
});

describe('lintGfm — inline HTML tag (non-whitelisted → warning)', () => {
    it('emits a warning for <span> (not whitelisted)', async () => {
        const diags = await lint('Some <span>text</span> here.\n');
        const d = diags.find(d => d.severity === 'warning' && d.message.includes('not rendered in Lattice'));
        expect(d).toBeTruthy();
    });

    it('emits a warning for <em> (not whitelisted)', async () => {
        const diags = await lint('Use <em>emphasis</em> carefully.\n');
        const d = diags.find(d => d.severity === 'warning' && d.message.includes('not rendered in Lattice'));
        expect(d).toBeTruthy();
    });
});

// ── Rule: Table column mismatch (REQ-LTTCE-LNT-0000E) ────────────────────────

describe('lintGfm — table column mismatch', () => {
    it('emits an error when a body row has too many cells', async () => {
        const diags = await lint('| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n');
        const d = diags.find(d => d.severity === 'error' && d.message.includes('column'));
        expect(d).toBeTruthy();
        expect(d!.message).toContain('3 column(s)');
        expect(d!.message).toContain('2');
    });

    it('emits an error when a body row has too few cells', async () => {
        const diags = await lint('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n');
        const d = diags.find(d => d.severity === 'error' && d.message.includes('column'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag a well-formed table', async () => {
        const diags = await lint('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
        expect(diags.filter(d => d.severity === 'error')).toHaveLength(0);
    });
});

// ── Rule: Bare URL (REQ-LTTCE-LNT-0000F) ─────────────────────────────────────

describe('lintGfm — bare URL', () => {
    it('emits a hint on a bare https:// URL in prose', async () => {
        const diags = await lint('Visit https://example.com for more info.\n');
        const d = diags.find(d => d.severity === 'hint' && d.message.includes('Bare URL'));
        expect(d).toBeTruthy();
    });

    it('emits a hint on a bare http:// URL in prose', async () => {
        const diags = await lint('See http://old.example.com today.\n');
        const d = diags.find(d => d.message.includes('Bare URL'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag a URL inside a markdown link', async () => {
        const diags = await lint('[click here](https://example.com)\n');
        expect(diags.filter(d => d.message.includes('Bare URL'))).toHaveLength(0);
    });

    it('does NOT flag a URL inside a code span', async () => {
        const diags = await lint('Use `https://example.com` as the endpoint.\n');
        expect(diags.filter(d => d.message.includes('Bare URL'))).toHaveLength(0);
    });
});

// ── Rule: Single-tilde strikethrough (REQ-LTTCE-LNT-00010) ───────────────────

describe('lintGfm — single-tilde strikethrough', () => {
    it('emits a hint on ~text~ (single tilde)', async () => {
        const diags = await lint('This is ~wrong~ usage.\n');
        const d = diags.find(d => d.message.includes('Single-tilde'));
        expect(d).toBeTruthy();
        expect(d!.severity).toBe('hint');
    });

    it('does NOT flag ~~text~~ (double tilde GFM strikethrough)', async () => {
        const diags = await lint('This is ~~correct~~ GFM strikethrough.\n');
        expect(diags.filter(d => d.message.includes('Single-tilde'))).toHaveLength(0);
    });
});

// ── Rule: Loose list (REQ-LTTCE-LNT-00011) ───────────────────────────────────

describe('lintGfm — loose list', () => {
    it('emits a hint when a bullet list has a blank line between items', async () => {
        const diags = await lint('- item one\n\n- item two\n');
        const d = diags.find(d => d.message.includes('Loose list'));
        expect(d).toBeTruthy();
        expect(d!.severity).toBe('hint');
    });

    it('emits a hint for a loose ordered list', async () => {
        const diags = await lint('1. first\n\n2. second\n');
        const d = diags.find(d => d.message.includes('Loose list'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag a tight list', async () => {
        const diags = await lint('- item one\n- item two\n- item three\n');
        expect(diags.filter(d => d.message.includes('Loose list'))).toHaveLength(0);
    });
});

// ── Rule: Missing fenced code language tag (REQ-LTTCE-LNT-00012) ─────────────

describe('lintGfm — missing fenced code language tag', () => {
    it('emits a warning on a fenced block with no language', async () => {
        const diags = await lint('```\nconst x = 1;\n```\n');
        const d = diags.find(d => d.severity === 'warning' && d.message.includes('language tag'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag a fenced block with a language tag', async () => {
        const diags = await lint('```typescript\nconst x = 1;\n```\n');
        expect(diags.filter(d => d.message.includes('language tag'))).toHaveLength(0);
    });
});

// ── Rule: Empty image alt text (REQ-LTTCE-LNT-00013) ─────────────────────────

describe('lintGfm — empty image alt text', () => {
    it('emits a warning on an image with empty alt text', async () => {
        const diags = await lint('![](image.png)\n');
        const d = diags.find(d => d.severity === 'warning' && d.message.includes('alt text'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag an image with alt text', async () => {
        const diags = await lint('![A screenshot](image.png)\n');
        expect(diags.filter(d => d.message.includes('alt text'))).toHaveLength(0);
    });
});

// ── Rule: Duplicate heading text (REQ-LTTCE-LNT-00014) ───────────────────────

describe('lintGfm — duplicate heading text', () => {
    it('emits a warning on the second occurrence of a duplicate heading', async () => {
        const diags = await lint('# Overview\n\n## Details\n\n# Overview\n');
        const d = diags.find(d => d.severity === 'warning' && d.message.includes('Duplicate heading'));
        expect(d).toBeTruthy();
        expect(d!.message).toContain('overview');
    });

    it('is case-insensitive when comparing headings', async () => {
        const diags = await lint('# OVERVIEW\n\n# overview\n');
        const d = diags.find(d => d.message.includes('Duplicate heading'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag unique headings', async () => {
        const diags = await lint('# Introduction\n\n# Summary\n\n# Conclusion\n');
        expect(diags.filter(d => d.message.includes('Duplicate heading'))).toHaveLength(0);
    });
});

// ── Rule: Unclosed fenced code block (REQ-LTTCE-LNT-00015) ───────────────────

describe('lintGfm — unclosed fenced code block', () => {
    it('emits an error when a fenced block has no closing fence', async () => {
        const diags = await lint('Some intro.\n\n```typescript\nconst x = 1;\n');
        const d = diags.find(d => d.severity === 'error' && d.message.includes('Unclosed'));
        expect(d).toBeTruthy();
    });

    it('does NOT flag a properly closed fenced block', async () => {
        const diags = await lint('```typescript\nconst x = 1;\n```\n');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });

    it('does NOT flag tilde fences that are properly closed', async () => {
        const diags = await lint('~~~python\nprint("hi")\n~~~\n');
        expect(diags.filter(d => d.message.includes('Unclosed'))).toHaveLength(0);
    });
});

// ── Clean document (no diagnostics expected) ──────────────────────────────────

describe('lintGfm — clean document', () => {
    it('produces no diagnostics for a well-formed GFM document', async () => {
        const clean = [
            '# Introduction',
            '',
            'A paragraph with [a link](https://example.com) and **bold**.',
            '',
            '## Details',
            '',
            '- tight item one',
            '- tight item two',
            '',
            '```typescript',
            'const x = 1;',
            '```',
            '',
            '| Name | Value |',
            '| ---- | ----- |',
            '| foo  | bar   |',
        ].join('\n');
        const diags = await lint(clean);
        expect(diags).toHaveLength(0);
    });
});

// ── Rule: Invisible whitespace in a task marker (REQ-LTTCE-LNT-00016) ────────
//
// Regression origin: a real note pasted from a mail client carried 94 U+00A0.
// Three of them sat directly after a `[ ]`, so those bullets rendered as plain
// list items with a literal "[ ]" while their byte-identical-looking neighbours
// rendered as checkboxes.

describe('findTaskMarkerInvisible (pure helper)', () => {
    it('detects NBSP directly after the closing bracket', () => {
        const hit = findTaskMarkerInvisible(`\t- [ ]${NBSP}(Leo: indeed a CR)`);
        expect(hit).toEqual({ index: 6, code: 0x00a0, where: 'after-checkbox' });
    });

    it('detects NBSP inside the brackets', () => {
        const hit = findTaskMarkerInvisible(`- [${NBSP}] text`);
        expect(hit).toEqual({ index: 3, code: 0x00a0, where: 'checkbox' });
    });

    it('detects an invisible character between the list marker and the bracket', () => {
        const hit = findTaskMarkerInvisible(`-${NBSP}[ ] text`);
        expect(hit).toEqual({ index: 1, code: 0x00a0, where: 'marker-gap' });
    });

    it('detects a zero-width space inside the brackets', () => {
        const hit = findTaskMarkerInvisible(`- [${ZWSP}] text`);
        expect(hit?.code).toBe(0x200b);
    });

    it('detects a BOM after the closing bracket', () => {
        const hit = findTaskMarkerInvisible(`- [x]${BOM} done`);
        expect(hit?.code).toBe(0xfeff);
    });

    it('detects a narrow no-break space after the closing bracket', () => {
        const hit = findTaskMarkerInvisible(`* [ ]${NNBSP} text`);
        expect(hit?.code).toBe(0x202f);
    });

    it('works for ordered list markers too', () => {
        const hit = findTaskMarkerInvisible(`3. [ ]${NBSP}text`);
        expect(hit?.where).toBe('after-checkbox');
    });

    it('returns null for a clean ASCII task item', () => {
        expect(findTaskMarkerInvisible('\t- [ ] (Leo: indeed a CR)')).toBeNull();
        expect(findTaskMarkerInvisible('- [x] done')).toBeNull();
        expect(findTaskMarkerInvisible('- [X] done')).toBeNull();
        expect(findTaskMarkerInvisible('- [ ]\ttab separated')).toBeNull();
    });

    it('returns null for a task item with nothing after the marker', () => {
        expect(findTaskMarkerInvisible('- [ ]')).toBeNull();
    });

    it('returns null for lines that are not list items', () => {
        expect(findTaskMarkerInvisible(`a paragraph with${NBSP}an NBSP`)).toBeNull();
        expect(findTaskMarkerInvisible(`# Heading${NBSP}here`)).toBeNull();
    });

    it('returns null for a bracket that is not checkbox-shaped', () => {
        // A reference-style link label, not a checkbox the author believes in.
        expect(findTaskMarkerInvisible(`- [a]${NBSP}(https://example.com)`)).toBeNull();
        expect(findTaskMarkerInvisible(`- []${NBSP}text`)).toBeNull();
    });
});

describe('lintGfm — invisible whitespace in a task marker', () => {
    it('emits an error and points at the offending character', async () => {
        const doc = `8. Priority logic.\n\t- [ ]${NBSP}(Leo: indeed a CR)\n\t- [ ] (Leo: indeed a CR)\n`;
        const diags = await lint(doc);
        const d = diags.find(x => x.severity === 'error' && x.message.includes('U+00A0'));
        expect(d, 'expected an error for the NBSP task marker').toBeTruthy();
        expect(d!.message).toContain('does NOT render as a checkbox');
        // Exactly one character wide, so the underline lands on the culprit.
        expect(d!.to - d!.from).toBe(1);
    });

    it('flags only the broken bullet, not its clean neighbour', async () => {
        // The parent ordered item matters: a tab-indented bullet with no parent
        // is an indented CODE BLOCK in CommonMark, and code is never reported.
        const doc = `8. Priority logic.\n\t- [ ]${NBSP}(a)\n\t- [ ] (b)\n`;
        const diags = await lint(doc);
        expect(diags.filter(d => d.message.includes('U+00A0'))).toHaveLength(1);
    });

    it('still flags a broken checkbox that Lezer parses as a link reference', async () => {
        // Regression guard: `[<invisible>]` looks like a shortcut-reference link
        // to the Markdown parser. Excluding Link nodes here — as the bare-URL and
        // strikethrough scans do — would silence the rule's main case.
        const diags = await lint(`- [${NBSP}] text\n`);
        const d = diags.find(x => x.severity === 'error' && x.message.includes('U+00A0'));
        expect(d, 'expected the checkbox-position error').toBeTruthy();
    });

    it('names the character it found', async () => {
        const diags = await lint(`- [${ZWSP}] text\n`);
        const d = diags.find(x => x.message.includes('U+200B'));
        expect(d).toBeTruthy();
        expect(d!.message).toContain('ZERO WIDTH SPACE');
    });

    it('does NOT flag a clean task list', async () => {
        const diags = await lint('- [ ] one\n- [x] two\n');
        expect(diags.filter(d => d.message.includes('Invisible character'))).toHaveLength(0);
    });

    it('does NOT flag an invisible character inside a fenced code block', async () => {
        const diags = await lint('```text\n- [ ]' + NBSP + '(demo of the bug)\n```\n');
        expect(diags.filter(d => d.message.includes('Invisible character'))).toHaveLength(0);
    });
});

// ── Rule: Invisible whitespace as indentation (REQ-LTTCE-LNT-00017) ──────────

describe('findIndentInvisible (pure helper)', () => {
    it('detects an NBSP-indented line', () => {
        const hit = findIndentInvisible(`${NBSP}${NBSP} (Leo: a comment)`);
        expect(hit).toEqual({ index: 0, code: 0x00a0, where: 'indent' });
    });

    it('detects an NBSP mixed into an otherwise normal indent', () => {
        const hit = findIndentInvisible(`  ${NBSP} text`);
        expect(hit?.index).toBe(2);
    });

    it('returns null for a clean indent', () => {
        expect(findIndentInvisible('    text')).toBeNull();
        expect(findIndentInvisible('\t\ttext')).toBeNull();
        expect(findIndentInvisible('text')).toBeNull();
    });

    it('returns null for a blank-only line (deliberate spacer idiom)', () => {
        expect(findIndentInvisible(NBSP)).toBeNull();
        expect(findIndentInvisible(`  ${NBSP}  `)).toBeNull();
    });

    it('returns null when the NBSP is inside the text, not the indent', () => {
        expect(findIndentInvisible(`  some${NBSP}text`)).toBeNull();
    });
});

describe('lintGfm — invisible whitespace as indentation', () => {
    it('emits a warning for an NBSP-indented line', async () => {
        const diags = await lint(`1. An item.\n${NBSP}${NBSP} (Leo: a comment)\n`);
        const d = diags.find(x => x.severity === 'warning' && x.message.includes('U+00A0'));
        expect(d, 'expected a warning for the NBSP indent').toBeTruthy();
        expect(d!.message).toContain('does not');
        expect(d!.markClass).toContain('cm-gfm-lint-warning');
    });

    it('does NOT flag ordinary indentation', async () => {
        const diags = await lint('1. An item.\n   continued normally.\n');
        expect(diags.filter(d => d.message.includes('Invisible character')
            || d.message.includes('indented with'))).toHaveLength(0);
    });
});
