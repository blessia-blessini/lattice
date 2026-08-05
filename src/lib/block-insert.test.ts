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

// UTST for REQ-LTTCE-TBL-00008 — a pasted table must occupy whole lines,
// otherwise GFM does not recognise the header row and the paste renders as
// prose full of pipes.

import { describe, it, expect } from 'vitest';
import { wrapAsBlock } from './block-insert';

const TABLE = '| a | b |\n| - | - |';

describe('wrapAsBlock', () => {
    it('adds nothing on an empty line', () => {
        expect(wrapAsBlock(TABLE, '', '')).toBe(TABLE);
    });

    it('breaks the line when text precedes the insertion point', () => {
        expect(wrapAsBlock(TABLE, 'prose ', '')).toBe(`\n${TABLE}`);
    });

    it('breaks the line when text follows the insertion point', () => {
        expect(wrapAsBlock(TABLE, '', ' more prose')).toBe(`${TABLE}\n`);
    });

    it('breaks both sides mid-paragraph', () => {
        expect(wrapAsBlock(TABLE, 'left', 'right')).toBe(`\n${TABLE}\n`);
    });

    it('treats a whitespace-only fragment as empty', () => {
        // Pasting onto an indented blank line must not gain a stray newline.
        expect(wrapAsBlock(TABLE, '    ', '\t')).toBe(TABLE);
    });
});
