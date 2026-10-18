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

// UTST for REQ-LTTCE-DLN-00001 / REQ-LTTCE-DLN-00005 (IMPL-LTTCE-DLN-00007)

import { describe, it, expect } from 'vitest';
import {
    DAILY_NOTE_ICON,
    DAILY_NOTE_PREFIX_DEFAULT,
    DAILY_NOTE_PREFIX_MAX_LEN,
    dailyNotePrefixFromSettings,
    sanitizeDailyNotePrefixInput,
} from './daily-note';

describe('daily-note contract', () => {
    it('matches the Rust defaults (documented pairing with daily_note.rs)', () => {
        expect(DAILY_NOTE_PREFIX_DEFAULT).toBe('DLN');
        expect(DAILY_NOTE_PREFIX_MAX_LEN).toBe(3);
    });

    it('uses U+1F5D2 SPIRAL NOTE PAD in emoji presentation as the icon', () => {
        expect(DAILY_NOTE_ICON.codePointAt(0)).toBe(0x1f5d2);
        expect(DAILY_NOTE_ICON.endsWith('️')).toBe(true);
    });
});

describe('sanitizeDailyNotePrefixInput', () => {
    it('keeps valid input unchanged, including the empty prefix', () => {
        for (const ok of ['', 'D', 'DL', 'DLN', 'dln', 'a1Z', '007']) {
            expect(sanitizeDailyNotePrefixInput(ok)).toBe(ok);
        }
    });

    it('drops every character that is not a Latin letter or digit', () => {
        expect(sanitizeDailyNotePrefixInput('a/b')).toBe('ab');
        expect(sanitizeDailyNotePrefixInput('../')).toBe('');
        expect(sanitizeDailyNotePrefixInput('D L-N')).toBe('DLN');
        expect(sanitizeDailyNotePrefixInput('Äb1')).toBe('b1');
        expect(sanitizeDailyNotePrefixInput('🗒️')).toBe('');
    });

    it('keeps at most three characters', () => {
        expect(sanitizeDailyNotePrefixInput('ABCDE')).toBe('ABC');
        expect(sanitizeDailyNotePrefixInput('A.B.C.D')).toBe('ABC');
    });
});

describe('dailyNotePrefixFromSettings', () => {
    it('passes a valid stored prefix through, empty included', () => {
        expect(dailyNotePrefixFromSettings('J1')).toBe('J1');
        expect(dailyNotePrefixFromSettings('')).toBe('');
    });

    it('falls back to the default for a missing or malformed value', () => {
        expect(dailyNotePrefixFromSettings(undefined)).toBe('DLN');
        expect(dailyNotePrefixFromSettings(null)).toBe('DLN');
        expect(dailyNotePrefixFromSettings(42)).toBe('DLN');
        expect(dailyNotePrefixFromSettings('TOOLONG')).toBe('DLN');
        expect(dailyNotePrefixFromSettings('a/b')).toBe('DLN');
    });
});
