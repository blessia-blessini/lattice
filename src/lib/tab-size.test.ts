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

// UTST for REQ-LTTCE-WSP-00005 (IMPL-LTTCE-WSP-0000A)

import { describe, it, expect } from 'vitest';
import { clampTabSize, TAB_SIZE_MIN, TAB_SIZE_MAX, TAB_SIZE_DEFAULT } from './tab-size';

describe('tab-size contract', () => {
    it('exposes the documented range and default', () => {
        expect(TAB_SIZE_MIN).toBe(2);
        expect(TAB_SIZE_MAX).toBe(8);
        expect(TAB_SIZE_DEFAULT).toBe(2);
    });

    it('passes through in-range integers', () => {
        expect(clampTabSize(2)).toBe(2);
        expect(clampTabSize(5)).toBe(5);
        expect(clampTabSize(8)).toBe(8);
    });

    it('clamps out-of-range numbers', () => {
        expect(clampTabSize(1)).toBe(TAB_SIZE_MIN);
        expect(clampTabSize(0)).toBe(TAB_SIZE_MIN);
        expect(clampTabSize(-4)).toBe(TAB_SIZE_MIN);
        expect(clampTabSize(9)).toBe(TAB_SIZE_MAX);
        expect(clampTabSize(2 ** 64 - 1)).toBe(TAB_SIZE_MAX);
    });

    it('rounds fractional numbers before clamping', () => {
        expect(clampTabSize(3.4)).toBe(3);
        expect(clampTabSize(3.6)).toBe(4);
        expect(clampTabSize(8.4)).toBe(8);
    });

    it('falls back to the default for non-numeric or non-finite input', () => {
        expect(clampTabSize(undefined)).toBe(TAB_SIZE_DEFAULT);
        expect(clampTabSize(null)).toBe(TAB_SIZE_DEFAULT);
        expect(clampTabSize('4')).toBe(TAB_SIZE_DEFAULT);
        expect(clampTabSize(NaN)).toBe(TAB_SIZE_DEFAULT);
        expect(clampTabSize(Infinity)).toBe(TAB_SIZE_DEFAULT);
        expect(clampTabSize({})).toBe(TAB_SIZE_DEFAULT);
    });
});
