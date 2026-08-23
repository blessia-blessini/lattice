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
// MODULE: select-all
//******************************************************************************
/**
 * Decides what Ctrl/Cmd+A means, given where the focus currently is.
 *
 * ## The defect this exists for
 *
 * Lattice is a single WebView[^webview] document: the toolbar, the file-name
 * label, the status line, the edit pane and the preview pane are all one DOM
 * tree. When focus sits on none of the editable surfaces — right after a file
 * load, after clicking a toolbar button, after closing a dialog — Ctrl+A
 * reaches the WebView's own "select everything" handler and it does exactly
 * that: the whole application chrome ends up selected, file name included, and
 * a following Ctrl+C copies that instead of the document.
 *
 * ## The rule
 *
 * Select All is scoped to whichever pane owns the keystroke:
 *
 * - focus inside the **edit pane** → the whole Markdown source, as plain text;
 * - focus inside the **preview pane** → the rendered subtree, so the copy that
 *   follows carries HTML (and rides the existing preview-copy path, which
 *   substitutes rasterised diagrams — see `preview-copy.ts`);
 * - focus inside a genuine text field (a dialog input) → untouched, because
 *   Select All there means "this field", and taking that away would be a worse
 *   bug than the one being fixed;
 * - focus on the application chrome → the pane the current view mode makes
 *   primary. Never the chrome itself.
 *
 * The logic is a pure function over elements and two visibility flags so it can
 * be unit-tested without mounting the application, with the DOM mutation kept
 * in a separate, equally small helper.
 */

//******************************************************************************
// SelectAllScope
//******************************************************************************
/**
 * What Ctrl/Cmd+A should act on.
 *
 * `native` means "do not intervene" — the browser's own handling is correct
 * for that target. `none` means there is nothing sensible to select.
 */
export type SelectAllScope = 'editor' | 'preview' | 'native' | 'none';

//******************************************************************************
// SelectAllContext
//******************************************************************************
/** Everything the decision depends on. No React, no globals. */
export interface SelectAllContext {
    /** Where the keystroke came from — normally `document.activeElement`. */
    target: Element | null;
    /** Root element of the edit pane, or null before mount. */
    editorPane: Element | null;
    /** Root element of the preview pane, or null before mount. */
    previewPane: Element | null;
    /** Whether the edit pane is visible in the current view mode. */
    editorVisible: boolean;
    /** Whether the preview pane is visible in the current view mode. */
    previewVisible: boolean;
}

/**
 * `<input>` types that hold user-editable text and therefore have a meaningful
 * native Select All. Deliberately excludes button-like and picker-like types,
 * where Ctrl+A would otherwise be swallowed for no benefit.
 */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
    '', 'text', 'search', 'url', 'tel', 'email', 'password', 'number',
]);

//******************************************************************************
// isNativeTextField
//******************************************************************************
/**
 * True when the element is a real text-entry control whose own Select All must
 * be left alone.
 *
 * CodeMirror's editing surface is a `contenteditable` div, not an `<input>`,
 * so it is intentionally NOT matched here — the edit pane is handled by
 * containment instead.
 */
export function isNativeTextField(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type?.toLowerCase() ?? '';
        return TEXT_INPUT_TYPES.has(type);
    }
    return false;
}
// isNativeTextField END *******************************************************


//******************************************************************************
// IMPL-LTTCE-SEL-00001 — resolveSelectAllScope
//******************************************************************************
/**
 * Map "where the focus is" to "what Select All should select".
 *
 * Order matters. A text field wins over pane containment, because a dialog
 * input rendered inside a pane must keep its native behaviour. Pane
 * containment then wins over the view-mode fallback, so a click into the
 * preview really does scope the next Ctrl+A to the preview even in dual view.
 *
 * @example resolveSelectAllScope({ target: bodyEl, editorPane, previewPane,
 *          editorVisible: true, previewVisible: true })   // -> 'editor'
 */
export function resolveSelectAllScope(ctx: SelectAllContext): SelectAllScope {
    const { target, editorPane, previewPane, editorVisible, previewVisible } = ctx;

    if (isNativeTextField(target)) return 'native';

    if (target && editorPane?.contains(target)) return 'editor';
    if (target && previewPane?.contains(target)) return 'preview';

    // Chrome, <body>, or nothing focused: fall back to the pane the current
    // view mode makes primary. The edit pane wins whenever it is on screen —
    // in a dual view the source is what the user is working in.
    if (editorVisible) return 'editor';
    if (previewVisible) return 'preview';
    return 'none';
}
// resolveSelectAllScope END ***************************************************


//******************************************************************************
// IMPL-LTTCE-SEL-00002 — selectElementContents
//******************************************************************************
/**
 * Put the document selection around everything inside `el`, and nothing else.
 *
 * Used for the preview pane, where the selection *is* the deliverable: the
 * copy that follows serialises the selected subtree as `text/html`.
 *
 * Defensive by design — a missing element, a WebView with no selection object,
 * or a range the engine refuses must degrade to "no selection changed" rather
 * than throw inside a key handler.
 *
 * @returns true when a selection was actually established.
 */
export function selectElementContents(el: Element | null): boolean {
    if (!el) return false;
    try {
        const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
        if (!selection) return false;
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    } catch {
        return false;
    }
}
// selectElementContents END ***************************************************


//******************************************************************************
// isSelectAllChord
//******************************************************************************
/**
 * True for Ctrl+A / Cmd+A and nothing else.
 *
 * Shift and Alt variants are left to the platform: Ctrl+Shift+A and
 * Ctrl+Alt+A are other applications' shortcuts, not Select All.
 */
export function isSelectAllChord(e: Pick<KeyboardEvent,
    'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>): boolean {
    if (!(e.ctrlKey || e.metaKey)) return false;
    if (e.altKey || e.shiftKey) return false;
    return e.key === 'a' || e.key === 'A';
}
// isSelectAllChord END ********************************************************
