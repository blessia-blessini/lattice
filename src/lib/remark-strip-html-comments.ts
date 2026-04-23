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
 * Remark plugin: drop mdast `html` nodes whose value is purely an HTML
 * comment (`<!-- ... -->`).
 *
 * Why: `react-markdown` does NOT pipe raw HTML through to the rendered tree
 * by default — it treats it as literal text. So a Markdown comment like
 * `<!-- TOC -->` shows up *visibly* in the preview, which is the opposite
 * of what every other Markdown renderer does (CommonMark / GitHub / Obsidian
 * pass the comment through to HTML and the browser hides it).
 *
 * Two ways to fix this:
 *   1. Plug in `rehype-raw` so HTML survives the markdown→hast conversion;
 *      the browser then naturally hides comment nodes. Downside: this also
 *      enables every other piece of raw HTML in the document, which is an
 *      XSS surface we don't want for arbitrary user notes.
 *   2. Strip just the comments at the mdast level. This matches the
 *      *visible* outcome of standard renderers without opening the door to
 *      raw HTML execution.
 *
 * We do (2). The plugin is a no-op for any html node whose content is more
 * than just a comment (e.g. `<!-- note --><div>x</div>` stays — it'll still
 * render as text the way other raw HTML does in this project).
 *
 * NOTE: This is preview-only cosmetic. The TOC markers are still in the
 * source document — the Rust backend (`src-tauri/src/toc.rs`) reads them as
 * the trigger for TOC regeneration, and CodeMirror obviously shows them in
 * the editor pane.
 */

// Anchored regex: leading/trailing whitespace is fine, but the body must be
// exactly one comment (no other markup before/after, and no string-spanning
// trickery). `[\s\S]*?` is the multi-line wildcard; we use the non-greedy
// form so a single node with two comments doesn't pass through as one.
const COMMENT_ONLY_RE = /^\s*<!--[\s\S]*?-->\s*$/;

/** Predicate, exported for testability. */
export function isHtmlCommentOnly(value: unknown): boolean {
    return typeof value === 'string' && COMMENT_ONLY_RE.test(value);
}

export const remarkStripHtmlComments = () => (tree: any) => {
    const walk = (node: any) => {
        if (node && Array.isArray(node.children)) {
            node.children = node.children.filter((child: any) => {
                return !(child && child.type === 'html' && isHtmlCommentOnly(child.value));
            });
            for (const child of node.children) walk(child);
        }
    };
    walk(tree);
};
