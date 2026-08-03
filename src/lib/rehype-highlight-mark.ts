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
 * Rehype plugin: convert ==highlight== markers to inline-styled <span> elements.
 *
 * Walks the HAST tree and, for every text node whose value contains at least
 * one `==...==` span, replaces that text node with a sequence of plain text
 * nodes and highlight <span> element nodes. See the note on MARK_CLASS below
 * for why the element is a styled <span> and not the semantic <mark>.
 *
 * Code fences and inline code are deliberately left untouched — text nodes
 * inside a <code> or <pre> ancestor are skipped entirely.
 *
 * Why rehype (not remark):
 *   At the remark (mdast) level `==` is not a recognised CommonMark / GFM
 *   token, so the characters land as plain text inside paragraph nodes.
 *   Processing them at the rehype (hast) level is simpler: we only need to
 *   walk text nodes and splice in element nodes — no micromark extension
 *   required.
 */

// Regex: == followed by one or more non-equals, non-newline characters, then ==.
// The non-greedy `+?` prevents greedy merging of adjacent marks.
// Exported for direct use in tests.
export const MARK_RE = /==((?:[^=\n]|=(?!=))+?)==/g;

// Default highlight colour — the light preview theme's value.
export const MARK_COLOR_DEFAULT = '#ffe000';

// Class kept for layout styling (radius/padding) and as a DOM hook for tests
// and the cursor-flash logic. The *colour* deliberately does NOT live in CSS.
export const MARK_CLASS = 'lattice-mark';

/**
 * WHY A STYLED <span> AND NOT <mark> (REQ-LTTCE-CPY-00001):
 *
 * The highlight has to survive a copy/paste into MS Word — WYSIWYG across the
 * clipboard. Two independent facts break `<mark>` there:
 *
 *   1. CSS classes do not travel with the clipboard. A colour defined in
 *      App.css as `.markdown-body mark { background-color: … }` is simply
 *      absent from the copied fragment, so the receiver has nothing to apply.
 *   2. Word's HTML reader predates HTML5. It has no default style for `<mark>`
 *      and discards unknown tags together with their attributes — so even an
 *      inline style on a `<mark>` would be thrown away.
 *
 * Emitting `<span class="lattice-mark" style="background-color:…">` fixes both
 * at the source: `<span>` is a tag every HTML reader understands, and the
 * inline style is part of the copied markup. The WebView serializes the
 * selected DOM subtree as-is, so this works for *every* copy path — keyboard,
 * context menu, drag-and-drop — with no clipboard event interception anywhere,
 * and identically on Chromium (Windows/Android) and WebKit (macOS/iOS/Linux).

 */

/**
 * Split a plain string at every ==...== boundary, returning a HAST node array:
 * alternating text nodes and highlight <span> element nodes.
 * Exported for unit tests.
 */
export function splitAtMarks(text: string, color: string = MARK_COLOR_DEFAULT): any[] {
    const parts: any[] = [];
    let lastIndex = 0;
    MARK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARK_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        parts.push({
            type: 'element',
            tagName: 'span',
            properties: {
                className: [MARK_CLASS],
                // Inline — this is what crosses the clipboard. See the note above.
                style: `background-color:${color}`,
            },
            children: [{ type: 'text', value: match[1] }],
        });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        parts.push({ type: 'text', value: text.slice(lastIndex) });
    }
    return parts;
}

/**
 * Walk the HAST tree. When we encounter an element node, rebuild its children
 * array by expanding any text node that contains `==...==` into the appropriate
 * text / highlight-<span> sequence.
 *
 * `inCode` is true when we are inside a <code> or <pre> subtree; text nodes
 * there are left completely unchanged.
 */
function walk(node: any, inCode: boolean, color: string): void {
    if (!node) return;

    if (node.type === 'element') {
        const nowInCode =
            inCode || node.tagName === 'code' || node.tagName === 'pre';

        if (Array.isArray(node.children)) {
            const newChildren: any[] = [];
            for (const child of node.children) {
                if (!child) {
                    // Null/undefined sentinels can appear in synthetic or
                    // malformed HAST trees.  Pass them through unchanged so
                    // the tree shape is preserved and no TypeError is thrown.
                    newChildren.push(child);
                    continue;
                }
                if (!nowInCode && child.type === 'text' && MARK_RE.test(child.value)) {
                    // Expand this text node into text + highlight-span sequences.
                    newChildren.push(...splitAtMarks(child.value, color));
                } else {
                    // Recurse before pushing so nested elements are processed.
                    walk(child, nowInCode, color);
                    newChildren.push(child);
                }
            }
            node.children = newChildren;
        }
    } else if (Array.isArray(node.children)) {
        // Root node or other container — just recurse.
        for (const child of node.children) walk(child, inCode, color);
    }
}

/**
 * @param options.color Highlight background written as an inline style. Passed
 *   by App.tsx from the active preview theme, so dark mode stays subdued while
 *   the colour still travels with the clipboard.
 */
export const rehypeHighlightMark = (options?: { color?: string }) => (tree: any) => {
    walk(tree, false, options?.color ?? MARK_COLOR_DEFAULT);
};
