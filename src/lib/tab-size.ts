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

// IMPL-LTTCE-WSP-0000A — single frontend source for the Tab Size contract
// (REQ-LTTCE-WSP-00005). Keep in sync with the Rust constants
// TAB_SIZE_MIN / TAB_SIZE_MAX in src-tauri/src/settings.rs (documented
// pairing — the two codebases cannot share one constant without codegen).

/** Smallest allowed tab display width, in columns. */
export const TAB_SIZE_MIN = 2;
/** Largest allowed tab display width, in columns. */
export const TAB_SIZE_MAX = 8;
/** Default tab display width, in columns. */
export const TAB_SIZE_DEFAULT = 2;

//******************************************************************************
// clampTabSize
//******************************************************************************
/**
 * Coerce an arbitrary (possibly hand-edited or malformed) value into a
 * valid tab size: finite numbers are rounded and clamped into
 * [{@link TAB_SIZE_MIN}, {@link TAB_SIZE_MAX}]; anything else falls back
 * to {@link TAB_SIZE_DEFAULT}.
 */
export const clampTabSize = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(TAB_SIZE_MAX, Math.max(TAB_SIZE_MIN, Math.round(value)))
        : TAB_SIZE_DEFAULT;
// clampTabSize END ************************************************************
