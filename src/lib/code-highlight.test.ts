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

// UTST for IMPL-LTTCE-PRV-00001 — pure-logic tests for code-highlight.ts.

import { describe, it, expect } from 'vitest';
import { findCodeLanguage, loadCodeLanguage, highlightTokens } from './code-highlight';

//******************************************************************************
// findCodeLanguage tests
//******************************************************************************
describe('findCodeLanguage', () => {
    it('resolves a canonical name', () => {
        expect(findCodeLanguage('javascript')?.name).toBe('JavaScript');
    });

    it('resolves aliases the editor pane also accepts (js, ts)', () => {
        expect(findCodeLanguage('js')?.name).toBe('JavaScript');
        expect(findCodeLanguage('ts')?.name).toBe('TypeScript');
        // Note: file *extensions* that are not registered aliases (e.g. `py`,
        // `rs`) do NOT match — identical to the edit pane's fence matching.
        expect(findCodeLanguage('py')).toBeNull();
        expect(findCodeLanguage('rs')).toBeNull();
    });

    it('is case-insensitive', () => {
        expect(findCodeLanguage('TypeScript')?.name).toBe('TypeScript');
        expect(findCodeLanguage('RUST')?.name).toBe('Rust');
    });

    it('returns null for unknown, empty, and non-string tags', () => {
        expect(findCodeLanguage('no-such-language-xyz')).toBeNull();
        expect(findCodeLanguage('')).toBeNull();
        expect(findCodeLanguage(null)).toBeNull();
        expect(findCodeLanguage(undefined)).toBeNull();
    });
});
// findCodeLanguage tests END **************************************************


//******************************************************************************
// loadCodeLanguage tests
//******************************************************************************
describe('loadCodeLanguage', () => {
    it('loads a LanguageSupport for a known tag', async () => {
        const sup = await loadCodeLanguage('js');
        expect(sup).not.toBeNull();
        expect(sup!.language.parser).toBeDefined();
    });

    it('returns null (not a rejection) for unknown tags', async () => {
        await expect(loadCodeLanguage('no-such-language-xyz')).resolves.toBeNull();
    });
});
// loadCodeLanguage tests END **************************************************


//******************************************************************************
// highlightTokens tests
//******************************************************************************
describe('highlightTokens', () => {
    it('tokenises JavaScript with tok-* classes', async () => {
        const sup = await loadCodeLanguage('js');
        const tokens = highlightTokens('const x = 1; // hi', sup!.language);

        const byText = (t: string) => tokens.find(tok => tok.text === t);
        expect(byText('const')?.classes).toContain('tok-keyword');
        expect(byText('1')?.classes).toContain('tok-number');
        expect(byText('// hi')?.classes).toContain('tok-comment');
    });

    it('reassembles to the exact original code (no text loss)', async () => {
        const sup = await loadCodeLanguage('python');
        const code = 'def f(a):\n    return a + 1  # comment\n';
        const tokens = highlightTokens(code, sup!.language);
        // highlightCode emits breaks for newlines; joining must round-trip.
        expect(tokens.map(t => t.text).join('')).toBe(code);
    });

    it('marks line breaks as plain tokens', async () => {
        const sup = await loadCodeLanguage('js');
        const tokens = highlightTokens('let a;\nlet b;', sup!.language);
        const breaks = tokens.filter(t => t.text === '\n');
        expect(breaks.length).toBe(1);
        expect(breaks[0].classes).toBe('');
    });

    it('returns [] for empty input', async () => {
        const sup = await loadCodeLanguage('js');
        expect(highlightTokens('', sup!.language)).toEqual([]);
    });
});
// highlightTokens tests END ***************************************************
