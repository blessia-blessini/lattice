// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
    isTocOpenMarker,
    isTocCloseMarker,
    isLineInsideTocBlock,
    computeTocTooltip,
} from './toc-tooltip';

// ---------------------------------------------------------------------------
// isTocOpenMarker
// ---------------------------------------------------------------------------
describe('isTocOpenMarker', () => {
    it('returns true for a bare <!-- TOC --> marker', () => {
        expect(isTocOpenMarker('<!-- TOC -->')).toBe(true);
    });

    it('returns true for a marker with options (case-insensitive token)', () => {
        expect(isTocOpenMarker('<!-- TOC depthFrom:2 depthTo:4 -->')).toBe(true);
    });

    it('returns true when there is leading/trailing whitespace', () => {
        expect(isTocOpenMarker('  <!-- TOC -->  ')).toBe(true);
    });

    it('returns false for the closing marker', () => {
        expect(isTocOpenMarker('<!-- /TOC -->')).toBe(false);
    });

    it('returns false for ordinary HTML comments', () => {
        expect(isTocOpenMarker('<!-- some comment -->')).toBe(false);
    });

    it('returns false for a plain text line', () => {
        expect(isTocOpenMarker('## Heading')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isTocCloseMarker
// ---------------------------------------------------------------------------
describe('isTocCloseMarker', () => {
    it('returns true for <!-- /TOC -->', () => {
        expect(isTocCloseMarker('<!-- /TOC -->')).toBe(true);
    });

    it('returns true with surrounding whitespace', () => {
        expect(isTocCloseMarker('  <!-- /TOC -->  ')).toBe(true);
    });

    it('returns false for the opening marker', () => {
        expect(isTocCloseMarker('<!-- TOC -->')).toBe(false);
    });

    it('returns false for arbitrary comments', () => {
        expect(isTocCloseMarker('<!-- end -->')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isLineInsideTocBlock
// ---------------------------------------------------------------------------
describe('isLineInsideTocBlock', () => {
    const lines = [
        '# Intro',            // 1
        '<!-- TOC -->',       // 2
        '- Item A',           // 3
        '- Item B',           // 4
        '<!-- /TOC -->',      // 5
        '## Section',         // 6
    ];

    it('returns false for a line before the TOC block', () => {
        expect(isLineInsideTocBlock(lines, 1)).toBe(false);
    });

    it('returns false for the opening marker line itself', () => {
        expect(isLineInsideTocBlock(lines, 2)).toBe(false);
    });

    it('returns true for a line inside the TOC block', () => {
        expect(isLineInsideTocBlock(lines, 3)).toBe(true);
        expect(isLineInsideTocBlock(lines, 4)).toBe(true);
    });

    it('returns false for the closing marker line itself', () => {
        expect(isLineInsideTocBlock(lines, 5)).toBe(false);
    });

    it('returns false for a line after the TOC block', () => {
        expect(isLineInsideTocBlock(lines, 6)).toBe(false);
    });

    // line number beyond the array length — hits the fallthrough return false (line 107)
    it('returns false when lineNumber exceeds total line count', () => {
        expect(isLineInsideTocBlock(lines, 99)).toBe(false);
    });

    it('returns false for a document with no TOC block at all', () => {
        const plain = ['# Hello', 'Some text', '## World'];
        expect(isLineInsideTocBlock(plain, 2)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// computeTocTooltip
// ---------------------------------------------------------------------------

/** Build a minimal EditorState with the given document text and cursor offset. */
function makeState(doc: string, cursorPos: number): EditorState {
    return EditorState.create({
        doc,
        selection: { anchor: cursorPos },
    });
}

describe('computeTocTooltip', () => {
    const docWithToc = [
        '# Title',
        '<!-- TOC -->',
        '- entry',
        '<!-- /TOC -->',
        '## Body',
    ].join('\n');

    // Cursor at start of "- entry" line (line 3)
    // "# Title\n" = 8 chars, "<!-- TOC -->\n" = 13 chars → offset 21
    const insideOffset = 8 + 13; // start of "- entry"

    it('returns a tooltip array with one element when cursor is inside the TOC block', () => {
        const state = makeState(docWithToc, insideOffset);
        const tooltips = computeTocTooltip(state);
        expect(tooltips).toHaveLength(1);
    });

    it('tooltip pos equals the cursor head', () => {
        const state = makeState(docWithToc, insideOffset);
        const tooltips = computeTocTooltip(state);
        expect(tooltips[0].pos).toBe(insideOffset);
    });

    it('tooltip create() returns a div with the refresh hint text', () => {
        const state = makeState(docWithToc, insideOffset);
        const tooltips = computeTocTooltip(state);
        const { dom } = tooltips[0].create!(null as any);
        expect(dom.tagName).toBe('DIV');
        expect(dom.textContent).toContain('Ctrl/Cmd+Shift+T');
    });

    it('returns [] when cursor is outside the TOC block', () => {
        // Cursor at very start of document — line 1, before opening marker
        const state = makeState(docWithToc, 0);
        expect(computeTocTooltip(state)).toHaveLength(0);
    });

    it('returns [] when the selection is a range (not an empty cursor)', () => {
        const state = EditorState.create({
            doc: docWithToc,
            selection: { anchor: insideOffset, head: insideOffset + 3 },
        });
        expect(computeTocTooltip(state)).toHaveLength(0);
    });

    it('returns [] for a plain document with no TOC markers', () => {
        const plain = '# Hello\nsome content\n## World';
        const state = makeState(plain, 8); // cursor in "some content"
        expect(computeTocTooltip(state)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// tocTooltipField.update — via StateField transaction (lines 176-177)
// ---------------------------------------------------------------------------
import { tocTooltip } from './toc-tooltip';

describe('tocTooltip StateField (update path)', () => {
    it('recomputes tooltips when the document changes', () => {
        // Start with plain doc (no TOC) — no tooltip expected
        const initialDoc = '# Hello\nsome text';
        const state1 = EditorState.create({
            doc: initialDoc,
            selection: { anchor: 8 },
            extensions: [tocTooltip],
        });

        // Apply a transaction that inserts a TOC block so the cursor is now inside
        const tocBlock = '<!-- TOC -->\n- item\n<!-- /TOC -->\n';
        const tr = state1.update({
            changes: { from: 0, to: 0, insert: tocBlock },
            // move cursor into "- item" line: tocBlock prefix is "<!-- TOC -->\n" = 13 chars
            selection: { anchor: 13 },
        });
        const state2 = tr.state;

        // The field should now contain a tooltip for the cursor inside the TOC
        const tooltips = state2.field(tocTooltip[0] as any);
        expect(Array.isArray(tooltips)).toBe(true);
        expect((tooltips as any[]).length).toBe(1);
    });

    it('clears the tooltip when the selection moves outside the TOC block (selection-only transaction)', () => {
        const doc = '# Title\n<!-- TOC -->\n- entry\n<!-- /TOC -->\n## Body';
        // Start with cursor inside the TOC block
        const insidePos = 8 + 13; // start of "- entry"
        const state1 = EditorState.create({
            doc,
            selection: { anchor: insidePos },
            extensions: [tocTooltip],
        });

        // Move cursor before the TOC (to position 0 — inside "# Title")
        const tr = state1.update({ selection: { anchor: 0 } });
        const state2 = tr.state;

        const tooltips = state2.field(tocTooltip[0] as any);
        expect((tooltips as any[]).length).toBe(0);
    });

    it('returns the cached tooltips unchanged when neither doc nor selection changes', () => {
        // This covers the early-return branch in the update() function:
        //   `if (!tr.docChanged && !tr.selection) return tooltips;`
        // We create a state with cursor OUTSIDE the TOC, then apply a
        // transaction that carries no doc change and no selection annotation
        // (only metadata). The field must return the same empty-array reference.
        const doc = '# Hello\nSome text without any TOC markers';
        const state1 = EditorState.create({
            doc,
            selection: { anchor: 0 },
            extensions: [tocTooltip],
        });
        const tooltipsBefore = state1.field(tocTooltip[0] as any) as any[];

        // Apply a no-op transaction (no doc change, no explicit selection).
        const tr = state1.update({});
        const state2 = tr.state;

        const tooltipsAfter = state2.field(tocTooltip[0] as any) as any[];
        // Both should be empty and, because the update short-circuits, they
        // should be the identical array reference.
        expect(tooltipsAfter).toHaveLength(0);
        expect(tooltipsAfter).toBe(tooltipsBefore);
    });
});
