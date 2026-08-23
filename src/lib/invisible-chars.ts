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

//******************************************************************************
// MODULE: invisible-chars
//******************************************************************************
/**
 * Single source of truth for "invisible" characters — code points that either
 * look exactly like an ASCII space or have no glyph at all, yet are NOT the
 * ASCII space (U+0020) or tab (U+0009).
 *
 * Why this module exists (DRY): two independent features need the same table.
 *
 * 1. `editor-extensions/gfm-linter.ts` — CommonMark/GFM block syntax accepts
 *    **only** space and tab as structural whitespace. An invisible character in
 *    a structural position therefore silently changes how the document renders:
 *    `- [ ]<U+00A0>text` is not a task item at all, it is an ordinary list item
 *    whose text happens to start with `[ ]`.
 * 2. `editor-extensions/show-whitespace.ts` — the same characters must be made
 *    perceivable in the edit pane, distinctly from ordinary spaces and tabs.
 *
 * Both consumers depend on this contract only, never on each other.
 *
 * Provenance: these characters arrive by paste from word processors, mail
 * clients and chat tools (Word, Outlook, Teams, browsers), which routinely
 * substitute U+00A0 for a typed space. They survive a copy round-trip, so the
 * author has no way of noticing them without tooling.
 */

//******************************************************************************
// InvisibleCharInfo
//******************************************************************************
/** One entry of the invisible-character table. */
export interface InvisibleCharInfo {
    /** Unicode code point. */
    code: number;
    /** Formal Unicode name, used verbatim in linter messages. */
    name: string;
    /** True when the character occupies no advance width (no glyph box). */
    zeroWidth: boolean;
}

//******************************************************************************
// INVISIBLE_CHARS
//******************************************************************************
/**
 * The table itself. Deliberately does NOT contain U+0020, U+0009, CR or LF —
 * those are the legitimate whitespace of a Markdown document.
 *
 * U+2028/U+2029 are included: they are line/paragraph separators that neither
 * CommonMark nor CodeMirror treats as a line break, so they behave as an
 * invisible character sitting inside a line.
 */
export const INVISIBLE_CHARS: readonly InvisibleCharInfo[] = [
    { code: 0x00a0, name: 'NO-BREAK SPACE', zeroWidth: false },
    { code: 0x1680, name: 'OGHAM SPACE MARK', zeroWidth: false },
    { code: 0x2000, name: 'EN QUAD', zeroWidth: false },
    { code: 0x2001, name: 'EM QUAD', zeroWidth: false },
    { code: 0x2002, name: 'EN SPACE', zeroWidth: false },
    { code: 0x2003, name: 'EM SPACE', zeroWidth: false },
    { code: 0x2004, name: 'THREE-PER-EM SPACE', zeroWidth: false },
    { code: 0x2005, name: 'FOUR-PER-EM SPACE', zeroWidth: false },
    { code: 0x2006, name: 'SIX-PER-EM SPACE', zeroWidth: false },
    { code: 0x2007, name: 'FIGURE SPACE', zeroWidth: false },
    { code: 0x2008, name: 'PUNCTUATION SPACE', zeroWidth: false },
    { code: 0x2009, name: 'THIN SPACE', zeroWidth: false },
    { code: 0x200a, name: 'HAIR SPACE', zeroWidth: false },
    { code: 0x200b, name: 'ZERO WIDTH SPACE', zeroWidth: true },
    { code: 0x200c, name: 'ZERO WIDTH NON-JOINER', zeroWidth: true },
    { code: 0x200d, name: 'ZERO WIDTH JOINER', zeroWidth: true },
    { code: 0x2028, name: 'LINE SEPARATOR', zeroWidth: true },
    { code: 0x2029, name: 'PARAGRAPH SEPARATOR', zeroWidth: true },
    { code: 0x202f, name: 'NARROW NO-BREAK SPACE', zeroWidth: false },
    { code: 0x205f, name: 'MEDIUM MATHEMATICAL SPACE', zeroWidth: false },
    { code: 0x2060, name: 'WORD JOINER', zeroWidth: true },
    { code: 0x3000, name: 'IDEOGRAPHIC SPACE', zeroWidth: false },
    { code: 0xfeff, name: 'ZERO WIDTH NO-BREAK SPACE (BOM)', zeroWidth: true },
];

/** Lookup table built once from `INVISIBLE_CHARS`. */
const BY_CODE: ReadonlyMap<number, InvisibleCharInfo> =
    new Map(INVISIBLE_CHARS.map(c => [c.code, c]));

/**
 * Character class matching exactly the code points in `INVISIBLE_CHARS`.
 * Exported as a *source string* (not a RegExp) so every consumer can build its
 * own regex with the flags it needs — a shared RegExp object with `/g` carries
 * mutable `lastIndex` state and is not safe to share.
 */
export const INVISIBLE_CHAR_CLASS =
    '[\\u00a0\\u1680\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]';

//******************************************************************************
// isInvisibleChar
//******************************************************************************
/**
 * @param code UTF-16 code unit (from `String.prototype.charCodeAt`).
 * @returns true when the code point is one of the invisible characters.
 * @example isInvisibleChar(0x00a0)  // → true  (NO-BREAK SPACE)
 * @example isInvisibleChar(0x0020)  // → false (ordinary space)
 */
export function isInvisibleChar(code: number): boolean {
    return BY_CODE.has(code);
}
// isInvisibleChar END *********************************************************


//******************************************************************************
// describeInvisibleChar
//******************************************************************************
/**
 * Human-readable identification for a linter message or a tooltip.
 *
 * Defensive: an unknown code point still produces a usable `U+XXXX` label
 * rather than `undefined`, so a caller can never emit a broken message.
 *
 * @example describeInvisibleChar(0x00a0)  // → "U+00A0 NO-BREAK SPACE"
 */
export function describeInvisibleChar(code: number): string {
    const hex = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    const info = BY_CODE.get(code);
    return info ? `${hex} ${info.name}` : hex;
}
// describeInvisibleChar END ***************************************************


//******************************************************************************
// isZeroWidthChar
//******************************************************************************
/**
 * True when the character has no advance width, and therefore cannot be made
 * visible with a background decoration alone — see `show-whitespace.ts`, which
 * marks these with an outline that does not participate in layout.
 */
export function isZeroWidthChar(code: number): boolean {
    return BY_CODE.get(code)?.zeroWidth === true;
}
// isZeroWidthChar END *********************************************************
