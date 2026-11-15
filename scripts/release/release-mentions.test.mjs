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

// UTST for CSTR-LTTCE-BLD-00002 — release notes mention no GitHub account.

import { describe, it, expect } from 'vitest';
import { quoteMentions } from './release-mentions.mjs';

describe('quoteMentions', () => {
    it('puts a bare @name in backticks, as the v0.3.52 notes needed', () => {
        const { text, quoted } = quoteMentions('- DOCS: Record calling the Legattice scan at @main as an accepted risk');
        expect(text).toBe('- DOCS: Record calling the Legattice scan at `@main` as an accepted risk');
        expect(quoted).toEqual(['@main']);
    });

    it('quotes at the start of a line, before punctuation, and every one of several', () => {
        const { text, quoted } = quoteMentions('@page rule (@media, @page).\n- see @a-b');
        expect(text).toBe('`@page` rule (`@media`, `@page`).\n- see `@a-b`');
        expect(quoted).toEqual(['@page', '@media', '@page', '@a-b']);
    });

    it('leaves e-mail addresses, URL paths and other non-mentions alone', () => {
        const input = 'mail someone@example.org, https://example.org/@user, a@b, @, @-x, x.@y';
        expect(quoteMentions(input)).toEqual({ text: input, quoted: [] });
    });

    it('leaves code alone: inline spans and fenced blocks', () => {
        const input = 'already `@main` and `x @y`\n```\n@inside fence\n```\nafter @z';
        const { text, quoted } = quoteMentions(input);
        expect(text).toBe('already `@main` and `x @y`\n```\n@inside fence\n```\nafter `@z`');
        expect(quoted).toEqual(['@z']);
    });

    it('is idempotent and keeps text without mentions byte for byte', () => {
        const once = quoteMentions('at @main\r\nand more').text;
        expect(quoteMentions(once)).toEqual({ text: once, quoted: [] });
        const plain = '### Changes\n- FIX: Something\n\n---\n';
        expect(quoteMentions(plain).text).toBe(plain);
    });
});
