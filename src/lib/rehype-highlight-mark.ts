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
 * Rehype plugin: convert ==highlight== markers to <mark> elements.
 *
 * Walks the HAST tree and, for every text node whose value contains at least
 * one `==...==` span, replaces that text node with a sequence of plain text
 * nodes and <mark> element nodes.
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

/**
 * Split a plain string at every ==...== boundary, returning a HAST node array:
 * alternating text nodes and <mark> element nodes.
 * Exported for unit tests.
 */
export function splitAtMarks(text: string): any[] {
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
            tagName: 'mark',
            properties: {},
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
 * text / <mark> sequence.
 *
 * `inCode` is true when we are inside a <code> or <pre> subtree; text nodes
 * there are left completely unchanged.
 */
function walk(node: any, inCode: boolean): void {
    if (!node) return;

    if (node.type === 'element') {
        const nowInCode =
            inCode || node.tagName === 'code' || node.tagName === 'pre';

        if (Array.isArray(node.children)) {
            const newChildren: any[] = [];
            for (const child of node.children) {
                if (!nowInCode && child.type === 'text' && MARK_RE.test(child.value)) {
                    // Expand this text node into text + <mark> sequences.
                    newChildren.push(...splitAtMarks(child.value));
                } else {
                    // Recurse before pushing so nested elements are processed.
                    walk(child, nowInCode);
                    newChildren.push(child);
                }
            }
            node.children = newChildren;
        }
    } else if (Array.isArray(node.children)) {
        // Root node or other container — just recurse.
        for (const child of node.children) walk(child, inCode);
    }
}

export const rehypeHighlightMark = () => (tree: any) => {
    walk(tree, false);
};
