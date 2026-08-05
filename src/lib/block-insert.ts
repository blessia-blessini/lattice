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

/**
 * Line-break padding for block-level Markdown constructs.
 *
 * Kept out of `Editor.tsx` because it is pure string logic: the editor supplies
 * the two line fragments that surround the insertion point, this function
 * decides how many newlines the payload needs. That keeps the rule unit-testable
 * without driving CodeMirror, and keeps it in one place for any future
 * block-level insertion (tables today, admonitions or code fences tomorrow).
 */

//******************************************************************************
// wrapAsBlock
//******************************************************************************
/**
 * IMPL-LTTCE-TBL-00005 — prefix and/or suffix `text` with a newline so that it
 * occupies whole lines.
 *
 * @param text   the block payload (e.g. a GFM table)
 * @param before the text on the insertion line *left* of the insertion point
 * @param after  the text on the insertion line *right* of the insertion point
 *
 * A break is added only when the corresponding side actually holds content —
 * whitespace-only fragments count as empty, so pasting onto an indented blank
 * line does not gain a stray leading newline.
 */
export const wrapAsBlock = (text: string, before: string, after: string): string => {
    const lead = before.trim().length > 0 ? '\n' : '';
    const trail = after.trim().length > 0 ? '\n' : '';
    return `${lead}${text}${trail}`;
};
// wrapAsBlock END *************************************************************
