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

import { slugify, disambiguateSlug } from './slug';

/**
 * Rehype plugin: assign GitHub-style `id` attributes to h1..h6 headings so the
 * in-document anchor links the Rust TOC backend emits — `[Heading](#heading)` —
 * actually scroll the preview to the right place.
 *
 * Why we don't use `rehype-slug`: its underlying `github-slugger` differs from
 * our backend on non-ASCII characters. The Rust function in
 * `src-tauri/src/toc.rs::slugify` is the source of truth, and `./slug.ts`
 * mirrors it. Keeping a tiny custom plugin here lets us reuse that mirror.
 *
 * Behavior:
 *   - Walks the tree, finds element nodes with tagName h1..h6.
 *   - Extracts the heading's plain text by recursing into its children.
 *   - Slugifies + disambiguates and writes `properties.id`.
 *   - If a heading already has an explicit `id`, it is left alone, but it IS
 *     registered in the seen-map so later auto-slugs won't collide with it.
 *   - Headings whose text slugifies to "" (e.g. "!!!") get no id at all
 *     rather than an empty id attribute.
 */
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Pull plain text out of a HAST subtree. Inlined rather than depending on
// `mdast-util-to-string` (or the hast equivalent) for ~10 lines of code.
export function headingText(node: any): string {
    if (node == null) return '';
    if (node.type === 'text') return typeof node.value === 'string' ? node.value : '';
    if (Array.isArray(node.children)) {
        return node.children.map(headingText).join('');
    }
    return '';
}

export const rehypeAddHeadingIds = () => (tree: any) => {
    const seen = new Map<string, number>();
    const walk = (node: any) => {
        if (node && node.type === 'element' && HEADING_TAGS.has(node.tagName)) {
            node.properties = node.properties || {};
            const existingId = node.properties.id;
            if (existingId == null || existingId === '') {
                const text = headingText(node);
                const base = slugify(text);
                if (base.length > 0) {
                    node.properties.id = disambiguateSlug(base, seen);
                }
            } else {
                // Reserve any explicit id so generated slugs don't collide.
                const existing = String(existingId);
                seen.set(existing, (seen.get(existing) ?? 0) + 1);
            }
        }
        if (node && Array.isArray(node.children)) {
            for (const child of node.children) walk(child);
        }
    };
    walk(tree);
};
