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

// IMPL-LTTCE-DLN-00007 — single frontend source for the daily-note UI
// contract (REQ-LTTCE-DLN-00001, REQ-LTTCE-DLN-00005).
//
// The rules themselves live in Rust (src-tauri/src/daily_note.rs): the file
// name, the title, and the authoritative prefix check, which rejects an
// invalid prefix on every path into the backend. This module only keeps the
// Settings input from ever *producing* an invalid prefix while the user types
// — an input filter must run synchronously on each keystroke and cannot wait
// for an IPC round trip. Keep DAILY_NOTE_PREFIX_DEFAULT,
// DAILY_NOTE_PREFIX_MAX_LEN and the character class below in sync with
// DailyNotePrefix in daily_note.rs (documented pairing — the two codebases
// cannot share one constant without codegen).

/** Prefix used when `settings.json` has none (the Rust default). */
export const DAILY_NOTE_PREFIX_DEFAULT = 'DLN';

/** Longest allowed prefix, in characters. */
export const DAILY_NOTE_PREFIX_MAX_LEN = 3;

/**
 * Icon of the daily-note command, on both the toolbar button and the menu
 * entry: U+1F5D2 SPIRAL NOTE PAD. The character's default presentation is
 * text, so U+FE0F (emoji presentation selector) is appended to get the same
 * colour glyph as the other toolbar emoji on every WebView.
 */
export const DAILY_NOTE_ICON = '\u{1F5D2}️';

/** Everything that is not a Latin letter or a digit. */
const NOT_PREFIX_CHAR = /[^A-Za-z0-9]/g;

//******************************************************************************
// sanitizeDailyNotePrefixInput
//******************************************************************************
/**
 * Turn whatever the user typed or pasted into a valid prefix: drop every
 * character that is not `A–Z`, `a–z` or `0–9`, then keep at most
 * {@link DAILY_NOTE_PREFIX_MAX_LEN} characters. The empty string is valid
 * and means "no prefix".
 */
export const sanitizeDailyNotePrefixInput = (raw: string): string =>
    raw.replace(NOT_PREFIX_CHAR, '').slice(0, DAILY_NOTE_PREFIX_MAX_LEN);
// sanitizeDailyNotePrefixInput END ********************************************


//******************************************************************************
// dailyNotePrefixFromSettings
//******************************************************************************
/**
 * The prefix to use for a value read back from `load_settings`. Rust already
 * replaces an invalid stored value with the default; this guards against a
 * missing or malformed field anyway (defensive, like `clampTabSize`) and
 * applies the same fallback rather than repairing the value.
 */
export const dailyNotePrefixFromSettings = (value: unknown): string =>
    typeof value === 'string' && sanitizeDailyNotePrefixInput(value) === value
        ? value
        : DAILY_NOTE_PREFIX_DEFAULT;
// dailyNotePrefixFromSettings END *********************************************
