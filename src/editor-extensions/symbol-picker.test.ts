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

import { describe, it, expect, vi } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { symbolCompletion } from './symbol-picker';

// ---------------------------------------------------------------------------
// Minimal CompletionContext stubs
// ---------------------------------------------------------------------------

/** Returns a fake context where matchBefore yields the given match (or null). */
const makeCtx = (match: { from: number; to: number; text: string } | null): CompletionContext =>
    ({ matchBefore: vi.fn().mockReturnValue(match) } as unknown as CompletionContext);

/** Returns a fake context where matchBefore throws. */
const makeThrowingCtx = (): CompletionContext =>
    ({ matchBefore: () => { throw new Error('matchBefore exploded'); } } as unknown as CompletionContext);

describe('symbolCompletion', () => {

    // -----------------------------------------------------------------------
    // No trigger
    // -----------------------------------------------------------------------
    it('returns null when matchBefore returns null (no colon trigger)', () => {
        const ctx = makeCtx(null);
        expect(symbolCompletion(ctx)).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Trigger with empty query — returns all symbols
    // -----------------------------------------------------------------------
    it('returns a result with options when a colon trigger is found', () => {
        const ctx = makeCtx({ from: 5, to: 6, text: ':' });
        const result = symbolCompletion(ctx);
        expect(result).not.toBeNull();
        expect(result!.from).toBe(5);
        expect(Array.isArray(result!.options)).toBe(true);
        expect(result!.options.length).toBeGreaterThan(0);
    });

    it('sets filter: false on the result', () => {
        const ctx = makeCtx({ from: 0, to: 1, text: ':' });
        const result = symbolCompletion(ctx);
        expect(result!.filter).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Filtering by keyword
    // -----------------------------------------------------------------------
    it('filters options to those matching the query term', () => {
        // 'arrow' appears in many special-character labels/keywords
        const ctx = makeCtx({ from: 0, to: 6, text: ':arrow' });
        const result = symbolCompletion(ctx);
        expect(result).not.toBeNull();
        for (const opt of result!.options) {
            const haystack = (opt.label + ' ' + (opt.detail ?? '')).toLowerCase();
            expect(haystack).toContain('arrow');
        }
    });

    it('returns an empty options list when no symbol matches the query', () => {
        const ctx = makeCtx({ from: 0, to: 30, text: ':zzznomatchqueryzzzunique' });
        const result = symbolCompletion(ctx);
        expect(result).not.toBeNull();
        expect(result!.options).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Error path — catch block (lines 59-61)
    // -----------------------------------------------------------------------
    it('returns null and does not throw when matchBefore throws', () => {
        const ctx = makeThrowingCtx();
        expect(() => symbolCompletion(ctx)).not.toThrow();
        expect(symbolCompletion(ctx)).toBeNull();
    });
});
