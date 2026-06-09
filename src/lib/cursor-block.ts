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

// IMPL-LTTCE-DVW-00001
//
// Pure logic for the Dual-View Cursor Flash feature (Chapter DVW):
// given the source-line intervals of the preview blocks and the editor's
// cursor line, decide which block (if any) must be flashed inverted.
//
// Deliberately DOM-free and React-free so the algorithm is unit-testable
// headless. The DOM glue lives in App.tsx (IMPL-LTTCE-DVW-00003).

import type { EditorState } from '@codemirror/state';

/** Closed source-line interval `[start, end]` of one preview block (1-based, inclusive). */
export interface SourceRange {
    start: number;
    end: number;
}

//******************************************************************************
// toSourceRange
//******************************************************************************
/**
 * Parse the `data-source-line` / `data-source-line-end` attribute pair of a
 * preview element into a {@link SourceRange}.
 *
 * Defensive: returns `null` for missing, non-numeric, non-positive or
 * inverted (`end < start`) inputs. A missing end attribute degrades to a
 * single-line range (`end = start`) so blocks rendered before the end-tagging
 * existed still participate.
 */
export function toSourceRange(
    startAttr: string | null | undefined,
    endAttr: string | null | undefined
): SourceRange | null {
    const start = parseInt(startAttr ?? '', 10);
    if (!Number.isFinite(start) || start < 1) return null;
    const endParsed = parseInt(endAttr ?? '', 10);
    const end = Number.isFinite(endParsed) && endParsed >= start ? endParsed : start;
    return { start, end };
}
// toSourceRange END ***********************************************************


//******************************************************************************
// findInnermostBlockIndex
//******************************************************************************
/**
 * Return the index of the **innermost** range containing `line`, or `-1`.
 *
 * Innermost = the containing range spanning the fewest source lines.
 * Tie-break: the later-starting range wins (deeper in the document tree —
 * a nested `<li>` starts at or after its parent `<ul>` but never before).
 *
 * Defensive: a non-finite or out-of-domain `line` (< 1) returns `-1`;
 * `null` entries (rejected by {@link toSourceRange}) are skipped, keeping
 * caller-side index alignment simple.
 */
export function findInnermostBlockIndex(
    ranges: ReadonlyArray<SourceRange | null>,
    line: number
): number {
    if (!Number.isFinite(line) || line < 1) return -1;

    let bestIdx = -1;
    let bestSpan = Number.POSITIVE_INFINITY;
    let bestStart = -1;

    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        if (!r) continue;
        if (line < r.start || line > r.end) continue;
        const span = r.end - r.start;
        if (span < bestSpan || (span === bestSpan && r.start > bestStart)) {
            bestIdx = i;
            bestSpan = span;
            bestStart = r.start;
        }
    }
    return bestIdx;
}
// findInnermostBlockIndex END *************************************************


//******************************************************************************
// isBlockTag
//******************************************************************************
/**
 * True for HTML tag names that count as flashable *block* elements
 * (REQ-LTTCE-DVW-00001 targets blocks, not inline spans — otherwise the
 * innermost match on a line like `**bold** text` would invert just the
 * `<strong>` word). `TR` is included (one Markdown table row = one source
 * line) but `TD`/`TH` are not: the row, not a single cell, is the unit the
 * user perceives as "their line". Case-insensitive; defensive on null.
 */
const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
    'TABLE', 'THEAD', 'TBODY', 'TR',
    'BLOCKQUOTE', 'PRE', 'HR', 'DIV', 'SECTION', 'FIGURE',
]);
export function isBlockTag(tagName: string | null | undefined): boolean {
    return !!tagName && BLOCK_TAGS.has(tagName.toUpperCase());
}
// isBlockTag END **************************************************************


//******************************************************************************
// cursorLineOf
//******************************************************************************
/**
 * 1-based line number of the primary cursor in a CodeMirror state.
 * Pure: works on a headless `EditorState`, no view required.
 */
export function cursorLineOf(state: EditorState): number {
    return state.doc.lineAt(state.selection.main.head).number;
}
// cursorLineOf END ************************************************************
