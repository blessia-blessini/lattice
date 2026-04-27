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

import { EditorState, StateField } from '@codemirror/state';
import { showTooltip, Tooltip } from '@codemirror/view';

/**
 * CodeMirror extension that surfaces a small tooltip near the cursor whenever
 * the cursor sits on a line that lies *between* a `<!-- TOC ... -->` opening
 * marker and a `<!-- /TOC -->` closing marker. The tooltip nudges the user to
 * press the keyboard shortcut that regenerates the block.
 *
 * The Rust backend is the source of truth for what counts as a TOC block when
 * the document is actually rewritten. This file purposely re-implements the
 * marker detection on the frontend in a *narrow* form (just the cursor's
 * line) because:
 *   1. The tooltip needs to update on every cursor move, and bouncing each
 *      check through Tauri IPC would feel sluggish.
 *   2. The check is line-local: we only need to know whether *this* line is
 *      "inside any TOC body", which is a simple linear scan.
 *
 * If you change the marker syntax in `src-tauri/src/toc.rs`, mirror it here.
 */

const TOOLTIP_HINT = 'Press Ctrl/Cmd+Shift+T to refresh TOC';

//******************************************************************************
// isTocOpenMarker / isTocCloseMarker
//******************************************************************************
/**
 * Whether `line` is a well-formed TOC opener (the `<!-- TOC ... -->` form,
 * possibly with options). The marker must be the only non-whitespace content
 * on its line — same rule as the Rust backend, so prose mentioning the literal
 * string never triggers the tooltip.
 */
export function isTocOpenMarker(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('<!--') || !trimmed.endsWith('-->')) return false;
    const inner = trimmed.slice(4, -3).trim();
    const firstToken = inner.split(/\s+/)[0] ?? '';
    return firstToken.toUpperCase() === 'TOC';
}

export function isTocCloseMarker(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('<!--') || !trimmed.endsWith('-->')) return false;
    const inner = trimmed.slice(4, -3).trim();
    return inner.toUpperCase() === '/TOC';
}
// isTocOpenMarker / isTocCloseMarker END *************************************

//******************************************************************************
// isLineInsideTocBlock
//******************************************************************************
/**
 * Walk the document's lines and decide whether `lineNumber` (1-based, matching
 * CodeMirror's `Line.number`) falls strictly between an opener and a closer.
 *
 * Pure function so it can be unit-tested without spinning up a CodeMirror
 * instance.
 *
 * Returns false if the line *is* a marker line — only the body is "inside".
 */
export function isLineInsideTocBlock(allLines: string[], lineNumber: number): boolean {
    let inside = false;
    for (let i = 0; i < allLines.length; i++) {
        const oneBasedLine = i + 1;
        const line = allLines[i];

        if (isTocOpenMarker(line)) {
            // The opener itself is not "inside"; everything after it is, until
            // a closer (or another opener, which aborts the pair on the Rust
            // side too).
            if (oneBasedLine === lineNumber) return false;
            inside = true;
            continue;
        }
        if (isTocCloseMarker(line)) {
            if (oneBasedLine === lineNumber) return false;
            inside = false;
            continue;
        }
        if (oneBasedLine === lineNumber) {
            return inside;
        }
    }
    return false;
}
// isLineInsideTocBlock END ***************************************************

//******************************************************************************
// computeTocTooltip
//******************************************************************************
/**
 * StateField support: given an EditorState, decide whether to show a tooltip
 * and where. We anchor the tooltip at the cursor position so it follows the
 * caret around as the user moves through the block.
 */
export function computeTocTooltip(state: EditorState): readonly Tooltip[] {
    // Only show when the selection is a simple cursor (no range) — otherwise
    // a multi-line selection would make the tooltip flicker in unhelpful
    // places.
    const sel = state.selection.main;
    if (!sel.empty) return [];

    const line = state.doc.lineAt(sel.head);
    const lineNumber = line.number;

    // Scan the whole doc. For typical Markdown notes (low thousands of lines)
    // this is well under a millisecond and only runs on cursor/doc updates.
    const allLines: string[] = [];
    for (let i = 1; i <= state.doc.lines; i++) {
        allLines.push(state.doc.line(i).text);
    }

    if (!isLineInsideTocBlock(allLines, lineNumber)) {
        return [];
    }

    return [
        {
            pos: sel.head,
            above: true,
            strictSide: false,
            arrow: true,
            create: () => {
                const dom = document.createElement('div');
                dom.className = 'cm-toc-tooltip';
                dom.textContent = TOOLTIP_HINT;
                // Inline styles so the tooltip works in either theme without
                // requiring a CSS edit. Subtle, monospace, slightly translucent.
                dom.style.padding = '4px 8px';
                dom.style.fontSize = '11px';
                dom.style.fontFamily =
                    "'Fira Code', 'Consolas', monospace";
                dom.style.background = '#2d333b';
                dom.style.color = '#c9d1d9';
                dom.style.border = '1px solid #444c56';
                dom.style.borderRadius = '4px';
                dom.style.whiteSpace = 'nowrap';
                return { dom };
            },
        },
    ];
}
// computeTocTooltip END ******************************************************

//******************************************************************************
// tocTooltipField
//******************************************************************************
const tocTooltipField = StateField.define<readonly Tooltip[]>({
    create: computeTocTooltip,
    update(tooltips, tr) {
        // Recompute when the doc changes OR when the selection moves. We don't
        // try to be cleverer than that — the cost is trivial.
        if (!tr.docChanged && !tr.selection) return tooltips;
        return computeTocTooltip(tr.state);
    },
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
});
// tocTooltipField END ********************************************************

/**
 * Public extension: drop into the editor's extension array.
 */
export const tocTooltip = [tocTooltipField];
