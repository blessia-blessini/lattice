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

// UTST for REQ-LTTCE-FOS-00004 — the licence gate reads every declared
// expression the way SPDX defines it, including the legacy "/" form.

import { describe, it, expect } from 'vitest';
import { evaluateExpression, formatExpression, leafKey, parseExpression } from './spdx-expr.mjs';

const CATEGORIES = { MIT: 'allowed', 'Apache-2.0': 'allowed', 'MPL-2.0': 'obligation', 'GPL-3.0-only': 'denied' };
const classify = (leaf) => CATEGORIES[leaf.id] ?? 'review';

describe('parseExpression', () => {
    it('parses a single id', () => {
        expect(parseExpression('MIT')).toEqual({ type: 'license', id: 'MIT', exception: null });
    });

    it('binds AND tighter than OR', () => {
        expect(formatExpression(parseExpression('MIT OR Apache-2.0 AND Zlib'))).toBe('MIT OR (Apache-2.0 AND Zlib)');
    });

    it('honours parentheses', () => {
        expect(formatExpression(parseExpression('(MIT OR Apache-2.0) AND Unicode-3.0'))).toBe('(MIT OR Apache-2.0) AND Unicode-3.0');
    });

    it('flattens chains of the same operator', () => {
        const ast = parseExpression('Zlib OR (Apache-2.0 OR MIT)');
        expect(ast.type).toBe('or');
        expect(ast.args.map(leafKey)).toEqual(['Zlib', 'Apache-2.0', 'MIT']);
    });

    it('reads the legacy slash as OR', () => {
        expect(formatExpression(parseExpression('MIT/Apache-2.0'))).toBe('MIT OR Apache-2.0');
        expect(formatExpression(parseExpression('Apache-2.0 / MIT'))).toBe('Apache-2.0 OR MIT');
    });

    it('accepts lower-case operators from old npm packages', () => {
        expect(formatExpression(parseExpression('(MPL-2.0 or Apache-2.0)'))).toBe('MPL-2.0 OR Apache-2.0');
    });

    it('attaches a WITH exception to its licence', () => {
        const ast = parseExpression('Apache-2.0 WITH LLVM-exception OR MIT');
        expect(ast.args[0]).toEqual({ type: 'license', id: 'Apache-2.0', exception: 'LLVM-exception' });
        expect(leafKey(ast.args[0])).toBe('Apache-2.0 WITH LLVM-exception');
    });

    it.each(['', '   ', 'MIT OR', '(MIT', 'MIT)', 'AND MIT', 'MIT WITH', '(MIT OR Apache-2.0) WITH X'])(
        'rejects the malformed expression %j',
        (bad) => {
            expect(() => parseExpression(bad)).toThrow();
        },
    );
});

describe('evaluateExpression', () => {
    it('chooses the better category of an OR', () => {
        const r = evaluateExpression(parseExpression('GPL-3.0-only OR MIT'), classify);
        expect(r.category).toBe('allowed');
        expect(r.chosen.map(leafKey)).toEqual(['MIT']);
    });

    it('prefers allowed over obligation (dompurify: MPL-2.0 OR Apache-2.0)', () => {
        const r = evaluateExpression(parseExpression('MPL-2.0 OR Apache-2.0'), classify);
        expect(r.chosen.map(leafKey)).toEqual(['Apache-2.0']);
    });

    it('breaks a tie by rank, then by position', () => {
        const ast = parseExpression('Apache-2.0 OR MIT');
        expect(evaluateExpression(ast, classify).chosen[0].id).toBe('Apache-2.0');
        const rank = (leaf) => (leaf.id === 'MIT' ? 0 : 1);
        expect(evaluateExpression(ast, classify, rank).chosen[0].id).toBe('MIT');
    });

    it('takes the worst part of an AND and keeps every part', () => {
        const r = evaluateExpression(parseExpression('MIT AND GPL-3.0-only'), classify);
        expect(r.category).toBe('denied');
        expect(r.chosen.map(leafKey)).toEqual(['MIT', 'GPL-3.0-only']);
    });

    it('combines AND inside OR', () => {
        const r = evaluateExpression(parseExpression('(MIT OR Apache-2.0) AND MPL-2.0'), classify, (l) => (l.id === 'MIT' ? 0 : 1));
        expect(r.category).toBe('obligation');
        expect(r.chosen.map(leafKey)).toEqual(['MIT', 'MPL-2.0']);
    });

    it('reports an unknown licence as review', () => {
        expect(evaluateExpression(parseExpression('WTFPL'), classify).category).toBe('review');
    });
});
