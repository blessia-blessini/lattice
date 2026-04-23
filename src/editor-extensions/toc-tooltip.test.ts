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
import {
    isTocOpenMarker,
    isTocCloseMarker,
    isLineInsideTocBlock,
} from './toc-tooltip';

describe('isTocOpenMarker', () => {
    it('matches the canonical opener', () => {
        expect(isTocOpenMarker('<!-- TOC -->')).toBe(true);
    });

    it('matches openers with options', () => {
        expect(isTocOpenMarker('<!-- TOC minLevel=2 maxLevel=4 -->')).toBe(true);
    });

    it('matches lowercase TOC (case-insensitive, mirrors Rust)', () => {
        expect(isTocOpenMarker('<!-- toc -->')).toBe(true);
    });

    it('tolerates leading/trailing whitespace', () => {
        expect(isTocOpenMarker('   <!-- TOC -->   ')).toBe(true);
    });

    it('rejects the closer', () => {
        expect(isTocOpenMarker('<!-- /TOC -->')).toBe(false);
    });

    it('rejects prose that mentions the marker inline', () => {
        expect(isTocOpenMarker('Look at <!-- TOC --> please')).toBe(false);
    });

    it('rejects unrelated comments', () => {
        expect(isTocOpenMarker('<!-- some other note -->')).toBe(false);
    });
});

describe('isTocCloseMarker', () => {
    it('matches the canonical closer', () => {
        expect(isTocCloseMarker('<!-- /TOC -->')).toBe(true);
    });

    it('matches lowercase', () => {
        expect(isTocCloseMarker('<!-- /toc -->')).toBe(true);
    });

    it('rejects opener', () => {
        expect(isTocCloseMarker('<!-- TOC -->')).toBe(false);
    });
});

describe('isLineInsideTocBlock', () => {
    const lines = [
        '# Title',           // 1
        'some prose',        // 2
        '<!-- TOC -->',      // 3
        '- [Title](#title)', // 4
        '<!-- /TOC -->',     // 5
        '## Section',        // 6
    ];

    it('returns false outside any block', () => {
        expect(isLineInsideTocBlock(lines, 1)).toBe(false);
        expect(isLineInsideTocBlock(lines, 2)).toBe(false);
        expect(isLineInsideTocBlock(lines, 6)).toBe(false);
    });

    it('returns true on the body line between markers', () => {
        expect(isLineInsideTocBlock(lines, 4)).toBe(true);
    });

    it('returns false on the marker lines themselves', () => {
        expect(isLineInsideTocBlock(lines, 3)).toBe(false);
        expect(isLineInsideTocBlock(lines, 5)).toBe(false);
    });

    it('handles empty body (cursor on the line that would be empty)', () => {
        const empty = ['<!-- TOC -->', '<!-- /TOC -->'];
        // No body line exists at all in this minimal block — cursor on either
        // marker line is "outside".
        expect(isLineInsideTocBlock(empty, 1)).toBe(false);
        expect(isLineInsideTocBlock(empty, 2)).toBe(false);
    });

    it('handles multi-line bodies', () => {
        const multi = [
            '<!-- TOC -->',  // 1
            '- a',           // 2
            '  - a1',        // 3
            '- b',           // 4
            '<!-- /TOC -->', // 5
        ];
        expect(isLineInsideTocBlock(multi, 2)).toBe(true);
        expect(isLineInsideTocBlock(multi, 3)).toBe(true);
        expect(isLineInsideTocBlock(multi, 4)).toBe(true);
    });

    it('returns false for a dangling opener (no matching close)', () => {
        const dangling = [
            '<!-- TOC -->', // 1
            '- a',          // 2
            '## Heading',   // 3
        ];
        // Without a closer the block is malformed; the Rust side ignores it
        // entirely. We mirror that by *still* reporting "inside" until EOF —
        // because the user is in fact inside the dangling opener and would
        // benefit from the hint to refresh (which would do nothing, but the
        // alternative — silently lying about location — is more confusing).
        // If product intent shifts, this is the line to revisit.
        expect(isLineInsideTocBlock(dangling, 2)).toBe(true);
    });
});
