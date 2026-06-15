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
 * rehype-safe-html — IMPL-LTTCE-PRV-00002
 *
 * Converts a curated whitelist of raw HTML nodes in the hast tree into proper
 * hast element nodes so they are rendered in the preview pane.
 *
 * ## Why a whitelist instead of rehype-raw?
 * `rehype-raw` re-parses the entire document and renders *all* raw HTML, which
 * is a security risk (XSS via arbitrary tags/attributes).  We only need a small,
 * safe set of typographic elements, so a targeted conversion is both safer and
 * dependency-free.
 *
 * ## Whitelisted tags
 * | Tag     | Type   | Use case            |
 * | ------- | ------ | ------------------- |
 * | `<sup>` | paired | Superscripts: X²    |
 * | `<sub>` | paired | Subscripts: H₂O     |
 * | `<kbd>` | paired | Keyboard keys       |
 * | `<br>`  | void   | Explicit line break |
 *
 * ## How remark/rehype represents inline HTML
 * After `remark-rehype`, each inline HTML token becomes a `raw` hast node whose
 * `value` is the literal tag string (e.g. `"<sup>"`, `"</sup>"`).  For a paired
 * tag the opening and closing appear as *separate* siblings with the content
 * nodes in between — they are NOT already nested.
 *
 * This plugin walks every parent node's `children` array and re-assembles
 * matching open/close raw pairs into a proper element with the intervening
 * nodes as children.  Void elements (`<br>`) are converted in-place.
 * Unmatched or non-whitelisted raw nodes are left untouched (rendered as text
 * by react-markdown, as before).
 *
 * ## Security
 * - Only tag *names* from the whitelist are accepted; no attributes pass through.
 * - The tag strings are matched with simple regexes; no HTML parsing is done.
 * - Any raw node that does not match is left as-is (text).
 */

// ── Types (hast subset we need) ───────────────────────────────────────────────

type HastNode = HastElement | HastText | HastRaw | HastRoot | HastOther;

interface HastRoot   { type: 'root';    children: HastNode[] }
interface HastElement{ type: 'element'; tagName: string; properties: Record<string, unknown>; children: HastNode[] }
interface HastText   { type: 'text';    value: string }
interface HastRaw    { type: 'raw';     value: string }
interface HastOther  { type: string;    children?: HastNode[] }

// ── Whitelist regexes ─────────────────────────────────────────────────────────

/** Matches `<br>`, `<br/>`, `<br />` (case-insensitive, no attributes). */
const VOID_RE = /^<br\s*\/?>$/i;

/** Matches an opening whitelisted paired tag with no attributes: `<sup>` etc. */
const OPEN_RE = /^<(sup|sub|kbd)>$/i;

/** Matches a closing whitelisted paired tag: `</sup>` etc. */
const CLOSE_RE = /^<\/(sup|sub|kbd)>$/i;

// ── Core helpers ──────────────────────────────────────────────────────────────

function makeElement(tagName: string, children: HastNode[]): HastElement {
    return { type: 'element', tagName, properties: {}, children };
}

/**
 * Process a flat children array: converts whitelisted raw nodes to elements.
 * Returns a new array — the input is not mutated.
 */
function processChildren(children: HastNode[]): HastNode[] {
    const out: HastNode[] = [];
    let i = 0;
    while (i < children.length) {
        const node = children[i];

        if (node.type !== 'raw') {
            out.push(node);
            i++;
            continue;
        }

        const raw = node as HastRaw;

        // Void element: <br>
        if (VOID_RE.test(raw.value)) {
            out.push(makeElement('br', []));
            i++;
            continue;
        }

        // Opening paired tag: look forward for a matching close
        const openMatch = raw.value.match(OPEN_RE);
        if (openMatch) {
            const tag = openMatch[1].toLowerCase();
            const closeTag = `</${tag}>`;
            // Search for the matching close tag among remaining siblings
            let j = i + 1;
            while (j < children.length) {
                if (
                    children[j].type === 'raw' &&
                    (children[j] as HastRaw).value.toLowerCase() === closeTag
                ) break;
                j++;
            }
            if (j < children.length) {
                // Found: wrap everything between open and close as element children
                const inner = processChildren(children.slice(i + 1, j));
                out.push(makeElement(tag, inner));
                i = j + 1; // skip past the closing raw node
            } else {
                // No matching close found — leave the raw node as-is
                out.push(raw);
                i++;
            }
            continue;
        }

        // Orphan closing tag or non-whitelisted tag — leave as-is
        out.push(node);
        i++;
    }
    return out;
}

/**
 * Recursively process a node and all its descendants.
 * Mutates `node.children` in-place (but processChildren creates a new array).
 */
function processNode(node: HastNode): void {
    const n = node as HastOther;
    if (!Array.isArray(n.children)) return;
    n.children = processChildren(n.children);
    // Recurse into the (possibly new) children so nested tags are handled too
    for (const child of n.children) {
        processNode(child);
    }
}

// ── Plugin export ─────────────────────────────────────────────────────────────

/**
 * Rehype plugin.  Drop into the `rehypePlugins` array of `<ReactMarkdown>`:
 *
 * ```tsx
 * rehypePlugins={[rehypeSafeHtml, rehypeKatex, ...]}
 * ```
 *
 * Must run BEFORE rehypeKatex (which may wrap math in elements that contain
 * raw nodes).
 */
export function rehypeSafeHtml() {
    return (tree: HastRoot) => {
        processNode(tree);
    };
}
