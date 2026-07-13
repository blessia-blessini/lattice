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
import { EditorView, highlightWhitespace } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

// IMPL-LTTCE-WSP-00001 — whitespace visualization extension (spaces + tabs)

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
});
// showWhitespaceTheme END *****************************************************


//******************************************************************************
// showWhitespaceExtension
//******************************************************************************
/**
 * Complete "Show Whitespace" editor extension: CM6's `highlightWhitespace()`
 * decorator plus the subtle Lattice theming above. Registered in
 * `Editor.tsx` inside a dedicated compartment so the `showWhitespace`
 * setting can toggle it live without recreating the editor state
 * (REQ-LTTCE-WSP-00001 / REQ-LTTCE-WSP-00002).
 */
export const showWhitespaceExtension: Extension = [
    highlightWhitespace(),
    showWhitespaceTheme,
];
// showWhitespaceExtension END *************************************************
