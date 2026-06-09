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

/**
 * cursor-block.test.ts — unit tests (UTST level) for IMPL-LTTCE-DVW-00001.
 *
 * Pure, headless tests of the Dual-View Cursor Flash selection logic:
 * REQ-LTTCE-DVW-00001 (innermost containing block, blank line → none).
 * cursorLineOf is tested against a real (DOM-free) CodeMirror EditorState.
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
    toSourceRange,
    findInnermostBlockIndex,
    isBlockTag,
    cursorLineOf,
    type SourceRange,
} from './cursor-block';

// ===========================================================================
// toSourceRange — attribute parsing, defensive cases
// ===========================================================================
describe('toSourceRange', () => {
    it('parses a normal start/end pair', () => {
        expect(toSourceRange('3', '7')).toEqual({ start: 3, end: 7 });
    });

    it('degrades a missing end attribute to a single-line range', () => {
        expect(toSourceRange('5', null)).toEqual({ start: 5, end: 5 });
        expect(toSourceRange('5', undefined)).toEqual({ start: 5, end: 5 });
        expect(toSourceRange('5', 'garbage')).toEqual({ start: 5, end: 5 });
    });

    it('clamps an inverted end (end < start) to a single-line range', () => {
        expect(toSourceRange('9', '4')).toEqual({ start: 9, end: 9 });
    });

    it('rejects missing, non-numeric, zero or negative starts', () => {
        expect(toSourceRange(null, '3')).toBeNull();
        expect(toSourceRange(undefined, '3')).toBeNull();
        expect(toSourceRange('', '3')).toBeNull();
        expect(toSourceRange('abc', '3')).toBeNull();
        expect(toSourceRange('0', '3')).toBeNull();
        expect(toSourceRange('-2', '3')).toBeNull();
    });
});

// ===========================================================================
// findInnermostBlockIndex — REQ-LTTCE-DVW-00001 selection semantics
// ===========================================================================
describe('findInnermostBlockIndex', () => {
    // Document shape used below (1-based source lines):
    //   ul   [5, 8]   <- index 0
    //   li   [5, 5]   <- index 1
    //   li   [6, 8]   <- index 2 (item with nested content)
    //   p    [10, 12] <- index 3 (multi-line paragraph)
    const ranges: SourceRange[] = [
        { start: 5, end: 8 },
        { start: 5, end: 5 },
        { start: 6, end: 8 },
        { start: 10, end: 12 },
    ];

    it('picks the innermost (smallest-span) containing range', () => {
        expect(findInnermostBlockIndex(ranges, 5)).toBe(1);  // li beats ul
        expect(findInnermostBlockIndex(ranges, 7)).toBe(2);  // nested li beats ul
        expect(findInnermostBlockIndex(ranges, 11)).toBe(3); // middle of paragraph
    });

    it('returns -1 when no range contains the line (blank separator line)', () => {
        expect(findInnermostBlockIndex(ranges, 9)).toBe(-1);
        expect(findInnermostBlockIndex(ranges, 1)).toBe(-1);
        expect(findInnermostBlockIndex(ranges, 999)).toBe(-1);
    });

    it('breaks span ties toward the later-starting (deeper) range', () => {
        const tied: SourceRange[] = [
            { start: 2, end: 4 },
            { start: 3, end: 5 },
        ];
        expect(findInnermostBlockIndex(tied, 3)).toBe(1);
        expect(findInnermostBlockIndex(tied, 4)).toBe(1);
        expect(findInnermostBlockIndex(tied, 2)).toBe(0); // only [2,4] contains 2
    });

    it('keeps the first entry on a full tie (parent precedes child in DOM order)', () => {
        const equal: SourceRange[] = [
            { start: 5, end: 5 },
            { start: 5, end: 5 },
        ];
        expect(findInnermostBlockIndex(equal, 5)).toBe(0);
    });

    it('skips null entries while preserving index alignment', () => {
        const withNulls: Array<SourceRange | null> = [
            null,
            { start: 3, end: 3 },
            null,
        ];
        expect(findInnermostBlockIndex(withNulls, 3)).toBe(1);
    });

    it('is defensive on out-of-domain lines and empty input', () => {
        expect(findInnermostBlockIndex(ranges, 0)).toBe(-1);
        expect(findInnermostBlockIndex(ranges, -3)).toBe(-1);
        expect(findInnermostBlockIndex(ranges, NaN)).toBe(-1);
        expect(findInnermostBlockIndex(ranges, Infinity)).toBe(-1);
        expect(findInnermostBlockIndex([], 5)).toBe(-1);
    });
});

// ===========================================================================
// isBlockTag — block/inline split used by the App-side DOM filter
// ===========================================================================
describe('isBlockTag', () => {
    it('accepts block-level tags case-insensitively', () => {
        for (const tag of ['P', 'p', 'H1', 'h3', 'LI', 'UL', 'TABLE', 'TR', 'PRE', 'BLOCKQUOTE']) {
            expect(isBlockTag(tag), tag).toBe(true);
        }
    });

    it('rejects inline tags so a flash never inverts a single word', () => {
        for (const tag of ['STRONG', 'EM', 'A', 'CODE', 'MARK', 'SPAN', 'IMG']) {
            expect(isBlockTag(tag), tag).toBe(false);
        }
    });

    it('rejects TD/TH — the row, not the cell, is the flash unit', () => {
        expect(isBlockTag('TD')).toBe(false);
        expect(isBlockTag('TH')).toBe(false);
        expect(isBlockTag('TR')).toBe(true);
    });

    it('is defensive on null/undefined/empty', () => {
        expect(isBlockTag(null)).toBe(false);
        expect(isBlockTag(undefined)).toBe(false);
        expect(isBlockTag('')).toBe(false);
    });
});

// ===========================================================================
// cursorLineOf — real headless CodeMirror EditorState (no DOM, no view)
// ===========================================================================
describe('cursorLineOf', () => {
    const doc = 'alpha\nbravo\ncharlie\n\necho';

    it('reports the 1-based line of the primary cursor', () => {
        // Position 0 = start of line 1.
        expect(cursorLineOf(EditorState.create({ doc, selection: { anchor: 0 } }))).toBe(1);
        // 'bravo' starts at offset 6 (line 2).
        expect(cursorLineOf(EditorState.create({ doc, selection: { anchor: 6 } }))).toBe(2);
        // End of document = line 5.
        expect(cursorLineOf(EditorState.create({ doc, selection: { anchor: doc.length } }))).toBe(5);
    });

    it('reports the blank line when the cursor sits on it', () => {
        // Line 4 is empty; its start offset is 20 ('alpha\nbravo\ncharlie\n' = 20 chars).
        expect(cursorLineOf(EditorState.create({ doc, selection: { anchor: 20 } }))).toBe(4);
    });
});
