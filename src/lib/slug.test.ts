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
import { slugify, disambiguateSlug } from './slug';

// These cases mirror `test_slugify_edge_cases` in src-tauri/src/toc.rs.
// If a row here fails, either the Rust algorithm changed (good — sync the
// other side) or the TS mirror has drifted (bad — fix the mirror). Do NOT
// "relax" a case to make a test pass without checking the Rust file.
describe('slugify (Rust mirror)', () => {
    it.each([
        ['Hello World', 'hello-world'],
        ['Why `useMemo`?', 'why-usememo'],
        ['  leading and trailing  ', 'leading-and-trailing'],
        // Non-ASCII letters are intentionally dropped to match Rust's
        // is_ascii_alphanumeric behavior. The 'é' becomes nothing, leaving "caf".
        ['Unicode café', 'unicode-caf'],
        ['snake_case_stays', 'snake_case_stays'],
        ['!!!', ''],
    ])('slugify(%j) === %j', (input, expected) => {
        expect(slugify(input)).toBe(expected);
    });

    it('collapses runs of whitespace and hyphens to a single hyphen', () => {
        expect(slugify('a   b')).toBe('a-b');
        expect(slugify('a---b')).toBe('a-b');
        expect(slugify('a - b')).toBe('a-b');
    });

    it('handles the real-world heading from the user report', () => {
        // The original bug repro: this slug must equal the link target the
        // backend writes into `[Pontosense from Canada](#pontosense-from-canada)`
        expect(slugify('Pontosense from Canada')).toBe('pontosense-from-canada');
    });

    it('returns empty string for input with no slug-eligible characters', () => {
        expect(slugify('   ')).toBe('');
        expect(slugify('---')).toBe('');
        expect(slugify('日本語')).toBe(''); // all non-ASCII
    });
});

describe('disambiguateSlug', () => {
    it('first occurrence keeps the bare slug', () => {
        const seen = new Map<string, number>();
        expect(disambiguateSlug('setup', seen)).toBe('setup');
    });

    it('subsequent occurrences get -1, -2, ...', () => {
        const seen = new Map<string, number>();
        expect(disambiguateSlug('setup', seen)).toBe('setup');
        expect(disambiguateSlug('setup', seen)).toBe('setup-1');
        expect(disambiguateSlug('setup', seen)).toBe('setup-2');
    });

    it('different bases are tracked independently', () => {
        const seen = new Map<string, number>();
        expect(disambiguateSlug('a', seen)).toBe('a');
        expect(disambiguateSlug('b', seen)).toBe('b');
        expect(disambiguateSlug('a', seen)).toBe('a-1');
        expect(disambiguateSlug('b', seen)).toBe('b-1');
    });
});
