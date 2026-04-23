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

import { describe, it, expect } from 'vitest';
import { rehypeAddHeadingIds, headingText } from './rehype-heading-ids';

// Tiny helpers for building synthetic HAST nodes. We don't depend on the real
// `hast` types here because the plugin is intentionally `any`-typed (matches
// the existing `rehypeAddSourceLines` style in App.tsx).
const text = (value: string) => ({ type: 'text', value });
const elem = (tagName: string, children: any[] = [], properties: any = {}) => ({
    type: 'element',
    tagName,
    properties,
    children,
});
const root = (children: any[]) => ({ type: 'root', children });

const transform = (tree: any) => {
    rehypeAddHeadingIds()(tree);
    return tree;
};

describe('headingText', () => {
    it('returns empty string for null/undefined nodes', () => {
        expect(headingText(null)).toBe('');
        expect(headingText(undefined)).toBe('');
    });

    it('returns text node value verbatim', () => {
        expect(headingText(text('Hello'))).toBe('Hello');
    });

    it('concatenates nested text from children', () => {
        const h2 = elem('h2', [
            text('Why '),
            elem('code', [text('useMemo')]),
            text('?'),
        ]);
        expect(headingText(h2)).toBe('Why useMemo?');
    });

    it('returns empty string for elements with no text descendants', () => {
        expect(headingText(elem('h2', [elem('img', [], { src: 'x' })]))).toBe('');
    });
});

describe('rehypeAddHeadingIds', () => {
    it('assigns id to h1..h6 derived from heading text', () => {
        const tree = root([
            elem('h1', [text('Hello World')]),
            elem('h2', [text('Pontosense from Canada')]),
            elem('h3', [text('Why '), elem('code', [text('useMemo')]), text('?')]),
        ]);

        transform(tree);

        expect(tree.children[0].properties.id).toBe('hello-world');
        // The exact bug the user reported: this id must equal the link the
        // Rust TOC backend emits as `[Pontosense from Canada](#pontosense-from-canada)`.
        expect(tree.children[1].properties.id).toBe('pontosense-from-canada');
        expect(tree.children[2].properties.id).toBe('why-usememo');
    });

    it('does not touch non-heading elements', () => {
        const p = elem('p', [text('paragraph text')]);
        const tree = root([p]);
        transform(tree);
        expect(p.properties.id).toBeUndefined();
    });

    it('disambiguates duplicate headings with -1, -2, ... in document order', () => {
        const tree = root([
            elem('h2', [text('Setup')]),
            elem('h2', [text('Setup')]),
            elem('h2', [text('Setup')]),
        ]);
        transform(tree);
        expect(tree.children[0].properties.id).toBe('setup');
        expect(tree.children[1].properties.id).toBe('setup-1');
        expect(tree.children[2].properties.id).toBe('setup-2');
    });

    it('preserves an explicit id and reserves it against later collisions', () => {
        // First heading already has an explicit id="setup"; the next auto-slug
        // for "Setup" must therefore skip "setup" and go straight to "setup-1".
        const tree = root([
            elem('h2', [text('Setup')], { id: 'setup' }),
            elem('h2', [text('Setup')]),
        ]);
        transform(tree);
        expect(tree.children[0].properties.id).toBe('setup');
        expect(tree.children[1].properties.id).toBe('setup-1');
    });

    it('skips assignment when the slug would be empty', () => {
        // Heading text "!!!" slugifies to "" — better to leave the id off than
        // emit an empty id="" which is invalid HTML.
        const h = elem('h2', [text('!!!')]);
        const tree = root([h]);
        transform(tree);
        expect(h.properties.id).toBeUndefined();
    });

    it('walks nested element trees, not just top-level children', () => {
        // Headings often live inside section/article wrappers; the walker must
        // recurse, not stop at the root's direct children.
        const inner = elem('h2', [text('Inside')]);
        const tree = root([elem('section', [elem('div', [inner])])]);
        transform(tree);
        expect(inner.properties.id).toBe('inside');
    });

    it('uses a fresh seen-map per invocation (no state leaks across calls)', () => {
        const make = () => root([elem('h2', [text('Setup')])]);
        const a = make();
        const b = make();
        transform(a);
        transform(b);
        // If state leaked, the second call would assign "setup-1".
        expect(a.children[0].properties.id).toBe('setup');
        expect(b.children[0].properties.id).toBe('setup');
    });
});
