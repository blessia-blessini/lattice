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
 * Preview-pane copy fidelity for ==highlight== marks.
 * IMPL-LTTCE-CPY-00001 — covers REQ-LTTCE-CPY-00001 / ARCH-LTTCE-CPY-00001.
 *
 * WHY THIS MODULE EXISTS:
 *   When the user copies a selection from the preview pane, the WebView puts
 *   the selected DOM fragment on the clipboard as a `text/html` flavor.
 *   Two facts combine to lose the highlight in MS Word / new Outlook:
 *
 *   1. Stylesheets do NOT travel with the clipboard. The yellow background of
 *      our <mark> elements comes from App.css (`.markdown-body mark`), so the
 *      copied fragment contains a *bare* `<mark>` with no styling at all.
 *   2. Word's / Outlook's HTML reader predates HTML5. It has no UA default
 *      style for the HTML5 `<mark>` element (browsers ship
 *      `mark { background: yellow }`, Word ships nothing), so it drops the
 *      unknown tag and keeps only its text — the emphasis vanishes.
 *      `<strong>` / `<em>` survive because they are HTML-4-era tags Word knows.
 *
 *   THE FIX: intercept the `copy` event on the preview pane and rewrite the
 *   clipboard HTML so each `<mark>` becomes a `<span>` carrying the highlight
 *   as an *inline* CSS background. Inline styles are honored by Word, Outlook,
 *   Google Docs, email clients, etc. A <span> is used (not `<mark style=…>`)
 *   because Word discards attributes of tags it does not recognize.
 *
 *   Pure DOM string/fragment logic — must run synchronously inside the copy
 *   event (`clipboardData.setData` is only valid during dispatch), therefore
 *   it cannot be a Rust/Tauri command (async IPC): frontend by necessity.
 */

// Background color for highlights in *copied* HTML.
// Keep in sync with `.markdown-body mark` in App.css (light theme value —
// pasted content usually lands on a white document, so the light color is
// always used regardless of the current preview theme).
export const HIGHLIGHT_COPY_BG = '#ffe000';

/** Minimal structural view of a ClipboardEvent — keeps the handler testable. */
export interface PreviewCopyEvent {
    clipboardData: Pick<DataTransfer, 'setData'> | null;
    preventDefault(): void;
}

//******************************************************************************
// inlineMarkHighlights
//******************************************************************************
/**
 * Replace every <mark> under `root` with a <span> carrying the highlight as an
 * inline background style. Children are moved, not cloned, so text and nested
 * inline elements (<strong>, links, …) are preserved.
 * Returns the number of marks converted.
 */
export function inlineMarkHighlights(root: ParentNode): number {
    const marks = root.querySelectorAll('mark');
    for (const mark of marks) {
        const span = mark.ownerDocument.createElement('span');
        span.setAttribute('style', `background:${HIGHLIGHT_COPY_BG};`);
        while (mark.firstChild) {
            span.appendChild(mark.firstChild);
        }
        mark.replaceWith(span);
    }
    return marks.length;
}
// inlineMarkHighlights END ****************************************************


//******************************************************************************
// buildCopyHtml
//******************************************************************************
/**
 * Serialize the given selection ranges to an HTML string with all <mark>
 * highlights inlined. Returns `null` when the selection contains no <mark>
 * at all — callers should then leave the native copy behavior untouched
 * (minimal interference principle).
 */
export function buildCopyHtml(ranges: readonly Range[]): string | null {
    const container = document.createElement('div');
    for (const range of ranges) {
        container.appendChild(range.cloneContents());
    }
    if (inlineMarkHighlights(container) === 0) {
        return null;
    }
    return container.innerHTML;
}
// buildCopyHtml END ***********************************************************


//******************************************************************************
// handlePreviewCopy
//******************************************************************************
/**
 * Copy-event handler for the preview pane.
 *
 * If the selection contains at least one <mark>, replaces the clipboard
 * payload: `text/html` gets the fragment with inlined highlight styles,
 * `text/plain` gets the selection's plain text (unchanged semantics).
 * Otherwise does nothing and lets the WebView perform its default copy.
 *
 * Returns true when the clipboard was rewritten (mainly for tests).
 */
export function handlePreviewCopy(
    e: PreviewCopyEvent,
    selection: Selection | null,
): boolean {
    if (!e.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }
    const ranges: Range[] = [];
    for (let i = 0; i < selection.rangeCount; i++) {
        ranges.push(selection.getRangeAt(i));
    }
    const html = buildCopyHtml(ranges);
    if (html === null) {
        return false;
    }
    e.preventDefault();
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', selection.toString());
    return true;
}
// handlePreviewCopy END *******************************************************
