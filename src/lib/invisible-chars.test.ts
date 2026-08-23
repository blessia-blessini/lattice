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

// UTST for REQ-LTTCE-LNT-00016 / REQ-LTTCE-LNT-00017 / REQ-LTTCE-WSP-00007

import { describe, it, expect } from 'vitest';
import {
    INVISIBLE_CHARS,
    INVISIBLE_CHAR_CLASS,
    describeInvisibleChar,
    isInvisibleChar,
    isZeroWidthChar,
} from './invisible-chars';

describe('isInvisibleChar', () => {
    it('accepts the characters word processors substitute for a space', () => {
        expect(isInvisibleChar(0x00a0)).toBe(true);   // NO-BREAK SPACE
        expect(isInvisibleChar(0x202f)).toBe(true);   // NARROW NO-BREAK SPACE
        expect(isInvisibleChar(0x2007)).toBe(true);   // FIGURE SPACE
        expect(isInvisibleChar(0x3000)).toBe(true);   // IDEOGRAPHIC SPACE
    });

    it('accepts zero-width characters', () => {
        expect(isInvisibleChar(0x200b)).toBe(true);   // ZERO WIDTH SPACE
        expect(isInvisibleChar(0xfeff)).toBe(true);   // BOM
        expect(isInvisibleChar(0x2060)).toBe(true);   // WORD JOINER
    });

    it('rejects the legitimate Markdown whitespace', () => {
        expect(isInvisibleChar(0x0020)).toBe(false);  // space
        expect(isInvisibleChar(0x0009)).toBe(false);  // tab
        expect(isInvisibleChar(0x000a)).toBe(false);  // LF
        expect(isInvisibleChar(0x000d)).toBe(false);  // CR
    });

    it('rejects ordinary text characters', () => {
        expect(isInvisibleChar('a'.charCodeAt(0))).toBe(false);
        expect(isInvisibleChar('-'.charCodeAt(0))).toBe(false);
        expect(isInvisibleChar('['.charCodeAt(0))).toBe(false);
    });
});

describe('isZeroWidthChar', () => {
    it('is true only for characters with no advance width', () => {
        expect(isZeroWidthChar(0x200b)).toBe(true);
        expect(isZeroWidthChar(0xfeff)).toBe(true);
        expect(isZeroWidthChar(0x00a0)).toBe(false);
        expect(isZeroWidthChar(0x0020)).toBe(false);
    });
});

describe('describeInvisibleChar', () => {
    it('produces a code point plus the Unicode name', () => {
        expect(describeInvisibleChar(0x00a0)).toBe('U+00A0 NO-BREAK SPACE');
        expect(describeInvisibleChar(0x200b)).toBe('U+200B ZERO WIDTH SPACE');
    });

    it('degrades to a bare code point for an unknown character', () => {
        // Defensive path: a caller must never be able to emit "undefined".
        expect(describeInvisibleChar(0x0041)).toBe('U+0041');
    });
});

describe('INVISIBLE_CHAR_CLASS', () => {
    it('matches every character in the table and nothing else', () => {
        const re = new RegExp(INVISIBLE_CHAR_CLASS);
        for (const info of INVISIBLE_CHARS) {
            expect(re.test(String.fromCharCode(info.code)), info.name).toBe(true);
        }
        for (const ch of [' ', '\t', '\n', '\r', 'a', '[', ']', '-']) {
            expect(re.test(ch), `should not match ${JSON.stringify(ch)}`).toBe(false);
        }
    });

    it('is a source string, so each consumer owns its own RegExp state', () => {
        expect(typeof INVISIBLE_CHAR_CLASS).toBe('string');
    });

    it('finds every occurrence in a realistic pasted line', () => {
        const line = '- [ ]\u00a0(Leo: indeed a CR)\u200b';
        const found = line.match(new RegExp(INVISIBLE_CHAR_CLASS, 'g'));
        expect(found).toEqual(['\u00a0', '\u200b']);
    });
});

describe('INVISIBLE_CHARS table', () => {
    it('has no duplicate code points', () => {
        const codes = INVISIBLE_CHARS.map(c => c.code);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('never contains space or tab', () => {
        expect(INVISIBLE_CHARS.some(c => c.code === 0x20 || c.code === 0x09)).toBe(false);
    });
});
