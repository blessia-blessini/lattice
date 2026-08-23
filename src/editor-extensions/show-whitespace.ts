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
import {
    Decoration,
    EditorView,
    MatchDecorator,
    ViewPlugin,
    highlightWhitespace,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import {
    INVISIBLE_CHAR_CLASS,
    describeInvisibleChar,
    isZeroWidthChar,
} from '../lib/invisible-chars';

// IMPL-LTTCE-WSP-00001 — whitespace visualization extension (spaces + tabs)
// IMPL-LTTCE-WSP-0000A — invisible / exotic whitespace visualization

//******************************************************************************
// showWhitespaceTheme
//******************************************************************************
/**
 * Subtle per-theme styling for CM6's built-in whitespace decorations.
 *
 * `highlightWhitespace()` tags stretches of spaces with `.cm-highlightSpace`
 * (rendered by the CM6 base theme as a small centered radial-gradient dot)
 * and each tab with `.cm-highlightTab` (rendered as a right-pointing arrow
 * background image). Both are pure decorations: they change no text content
 * and no glyph metrics, so enabling/disabling the feature never reflows the
 * document (REQ-LTTCE-WSP-00003).
 *
 * The CM6 defaults (`#aaa` dot / `#888` arrow) are too prominent on the
 * GitHub light theme and slightly off on the dark one, so this base theme
 * dims them to VS-Code-like subtlety while staying visible:
 * - spaces: theme-matched grey at ~50% alpha (the dot itself is tiny, so a
 *   higher alpha than VS Code's 0.16 is needed to stay perceptible),
 * - tabs: the default arrow faded via opacity (works for both themes since
 *   the arrow is a neutral grey SVG).
 */
const showWhitespaceTheme = EditorView.baseTheme({
    '&light .cm-highlightSpace': {
        backgroundImage: 'radial-gradient(circle at 50% 55%, rgba(87, 96, 106, 0.3) 16%, transparent 5%)',
    },
    '&dark .cm-highlightSpace': {
        backgroundImage: 'radial-gradient(circle at 50% 55%, rgba(139, 148, 158, 0.3) 16%, transparent 5%)',
    },
    '&light .cm-highlightTab': {
        opacity: '0.2',
    },
    '&dark .cm-highlightTab': {
        opacity: '0.3',
    },

    // ── Invisible / exotic whitespace (REQ-LTTCE-WSP-00007) ──────────────────
    // Deliberately NOT the subtle grey used for spaces and tabs: these
    // characters are pasted in by accident and silently change how the document
    // parses, so they are marked in the warning hue instead of the neutral one.
    //
    // Only `background` and `box-shadow` are used. Neither participates in
    // layout, so the marks add no advance width and cannot reflow the document
    // — REQ-LTTCE-WSP-00003 is satisfied by construction, exactly as it is for
    // the built-in space/tab marks.
    '&light .cm-invisibleChar': {
        backgroundColor: 'rgba(191, 135, 0, 0.22)',
        boxShadow: '0 0 0 1px rgba(154, 103, 0, 0.55)',
        borderRadius: '2px',
    },
    '&dark .cm-invisibleChar': {
        backgroundColor: 'rgba(210, 153, 34, 0.25)',
        boxShadow: '0 0 0 1px rgba(210, 153, 34, 0.6)',
        borderRadius: '2px',
    },
    // A zero-width character has no glyph box, so a background paints nothing.
    // The 1px ring is all that can be seen — and being a shadow it still costs
    // no layout width.
    '&light .cm-invisibleChar-zeroWidth': {
        backgroundColor: 'transparent',
        boxShadow: '0 0 0 1px rgba(207, 34, 46, 0.8)',
    },
    '&dark .cm-invisibleChar-zeroWidth': {
        backgroundColor: 'transparent',
        boxShadow: '0 0 0 1px rgba(248, 81, 73, 0.8)',
    },
});
// showWhitespaceTheme END *****************************************************


//******************************************************************************
// invisibleCharDecoration
//******************************************************************************
/**
 * Mark decoration for one invisible character, memoized per code point so a
 * viewport re-scan reuses the same `Decoration` object instead of allocating a
 * fresh one per match.
 *
 * The `title` attribute names the character (`U+00A0 NO-BREAK SPACE`), so
 * hovering the mark identifies it without leaving the editor.
 */
const decoCache = new Map<number, Decoration>();

function invisibleCharDecoration(code: number): Decoration {
    let deco = decoCache.get(code);
    if (!deco) {
        deco = Decoration.mark({
            class: isZeroWidthChar(code)
                ? 'cm-invisibleChar cm-invisibleChar-zeroWidth'
                : 'cm-invisibleChar',
            attributes: { title: describeInvisibleChar(code) },
        });
        decoCache.set(code, deco);
    }
    return deco;
}
// invisibleCharDecoration END *************************************************


//******************************************************************************
// invisibleCharPlugin
//******************************************************************************
/**
 * Viewport-scoped decorator for the characters listed in
 * `lib/invisible-chars.ts` (REQ-LTTCE-WSP-00007).
 *
 * CM6's `highlightWhitespace()` knows only U+0020 and U+0009, which is exactly
 * the blind spot that lets a pasted U+00A0 hide in plain sight. `MatchDecorator`
 * is the CM6-native way to add the missing ones: it scans only the visible
 * range and re-scans incrementally on update, so cost is independent of
 * document size. No new dependency — both pieces come from `@codemirror/view`.
 */
const invisibleCharMatcher = new MatchDecorator({
    // A fresh RegExp per module load; `INVISIBLE_CHAR_CLASS` is shared as a
    // source string precisely because a `/g` RegExp carries mutable state.
    regexp: new RegExp(INVISIBLE_CHAR_CLASS, 'g'),
    decoration: match => invisibleCharDecoration(match[0].charCodeAt(0)),
});

const invisibleCharPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = invisibleCharMatcher.createDeco(view);
        }

        update(update: ViewUpdate) {
            this.decorations = invisibleCharMatcher.updateDeco(update, this.decorations);
        }
    },
    { decorations: plugin => plugin.decorations },
);
// invisibleCharPlugin END *****************************************************


//******************************************************************************
// showWhitespaceExtension
//******************************************************************************
/**
 * Complete "Show Whitespace" editor extension: CM6's `highlightWhitespace()`
 * decorator, the invisible-character decorator, plus the subtle Lattice theming
 * above. Registered in `Editor.tsx` inside a dedicated compartment so the
 * `showWhitespace` setting can toggle it live without recreating the editor
 * state (REQ-LTTCE-WSP-00001 / REQ-LTTCE-WSP-00002 / REQ-LTTCE-WSP-00007).
 */
export const showWhitespaceExtension: Extension = [
    highlightWhitespace(),
    invisibleCharPlugin,
    showWhitespaceTheme,
];
// showWhitespaceExtension END *************************************************
