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
 * Tests for rehype-safe-html (IMPL-LTTCE-PRV-00002 / REQ-LTTCE-LNT-0000D)
 *
 * Strategy: build minimal hast trees that match what remark-rehype produces for
 * inline HTML (open/close as separate `raw` siblings), run the plugin, and assert
 * the tree is reshaped into proper element nodes.
 *
 * We do NOT go through the full remark→rehype pipeline here — that would couple
 * these tests to remark internals.  The plugin operates purely on hast nodes, so
 * constructing them directly keeps tests fast and focused.
 */

import { describe, it, expect } from 'vitest';
import { rehypeSafeHtml } from './rehype-safe-html';

// ── Helper ────────────────────────────────────────────────────────────────────

type HastNode = Record<string, unknown>;

function raw(value: string): HastNode {
    return { type: 'raw', value };
}
function text(value: string): HastNode {
    return { type: 'text', value };
}
function el(tagName: string, children: HastNode[] = []): HastNode {
    return { type: 'element', tagName, properties: {}, children };
}
function root(children: HastNode[]): HastNode {
    return { type: 'root', children };
}

/** Run the plugin on a root node and return it (mutated in-place). */
function run(tree: HastNode): HastNode {
    const plugin = rehypeSafeHtml();
    (plugin as (t: unknown) => void)(tree);
    return tree;
}

// ── Paired tag: <sup> ────────────────────────────────────────────────────────

describe('rehypeSafeHtml — <sup>', () => {
    it('converts open+close raw nodes into a sup element', () => {
        const tree = root([
            el('p', [text('X'), raw('<sup>'), text('2'), raw('</sup>')])
        ]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        const pChildren = result.children[0].children;
        expect(pChildren).toHaveLength(2); // text('X') + el('sup', ...)
        expect(pChildren[0]).toEqual(text('X'));
        expect(pChildren[1]).toMatchObject({ type: 'element', tagName: 'sup', children: [text('2')] });
    });

    it('handles uppercase tag names (case-insensitive)', () => {
        const tree = root([el('p', [raw('<SUP>'), text('n'), raw('</SUP>')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        expect(result.children[0].children[0]).toMatchObject({ tagName: 'sup' });
    });
});

// ── Paired tag: <sub> ────────────────────────────────────────────────────────

describe('rehypeSafeHtml — <sub>', () => {
    it('converts <sub>…</sub> into a sub element', () => {
        const tree = root([el('p', [text('H'), raw('<sub>'), text('2'), raw('</sub>'), text('O')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        const p = result.children[0].children as HastNode[];
        expect(p).toHaveLength(3);
        expect(p[1]).toMatchObject({ type: 'element', tagName: 'sub', children: [text('2')] });
        expect(p[2]).toEqual(text('O'));
    });
});

// ── Paired tag: <kbd> ────────────────────────────────────────────────────────

describe('rehypeSafeHtml — <kbd>', () => {
    it('converts <kbd>…</kbd> into a kbd element', () => {
        const tree = root([el('p', [raw('<kbd>'), text('Ctrl'), raw('</kbd>')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        expect(result.children[0].children[0]).toMatchObject({
            type: 'element', tagName: 'kbd', children: [text('Ctrl')]
        });
    });
});

// ── Void element: <br> ───────────────────────────────────────────────────────

describe('rehypeSafeHtml — <br>', () => {
    it('converts <br> to a br element', () => {
        const tree = root([el('p', [text('line1'), raw('<br>'), text('line2')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        expect(result.children[0].children[1]).toMatchObject({ type: 'element', tagName: 'br', children: [] });
    });

    it('converts self-closing <br/> to a br element', () => {
        const tree = root([el('p', [raw('<br/>')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        expect(result.children[0].children[0]).toMatchObject({ type: 'element', tagName: 'br' });
    });

    it('converts <br /> (space before slash) to a br element', () => {
        const tree = root([el('p', [raw('<br />')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        expect(result.children[0].children[0]).toMatchObject({ type: 'element', tagName: 'br' });
    });
});

// ── Non-whitelisted tag → left as raw ────────────────────────────────────────

describe('rehypeSafeHtml — non-whitelisted tags', () => {
    it('leaves <div> raw nodes untouched', () => {
        const tree = root([el('p', [raw('<div>'), text('x'), raw('</div>')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        const p = result.children[0].children as HastNode[];
        // All three nodes stay as-is
        expect(p).toHaveLength(3);
        expect(p[0]).toEqual(raw('<div>'));
    });

    it('leaves <span> raw nodes untouched', () => {
        const tree = root([el('p', [raw('<span class="x">'), text('y'), raw('</span>')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        expect((result.children[0] as { children: HastNode[] }).children[0]).toEqual(
            raw('<span class="x">')
        );
    });
});

// ── Unmatched open tag (no closing) ──────────────────────────────────────────

describe('rehypeSafeHtml — unmatched open tag', () => {
    it('leaves <sup> with no closing tag as a raw node', () => {
        const tree = root([el('p', [raw('<sup>'), text('2')])]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        // Both children remain untransformed
        expect(result.children[0].children[0]).toEqual(raw('<sup>'));
    });
});

// ── Nested whitelisted tags ───────────────────────────────────────────────────

describe('rehypeSafeHtml — nested tags', () => {
    it('handles <kbd><sup>…</sup></kbd>', () => {
        const tree = root([
            el('p', [
                raw('<kbd>'),
                raw('<sup>'), text('2'), raw('</sup>'),
                raw('</kbd>')
            ])
        ]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        const kbdEl = result.children[0].children[0] as { tagName: string; children: HastNode[] };
        expect(kbdEl.tagName).toBe('kbd');
        expect(kbdEl.children[0]).toMatchObject({ tagName: 'sup', children: [text('2')] });
    });
});

// ── Multiple tags in same paragraph ──────────────────────────────────────────

describe('rehypeSafeHtml — multiple tags', () => {
    it('converts two independent sup/sub tags in one paragraph', () => {
        const tree = root([
            el('p', [
                text('X'),
                raw('<sup>'), text('2'), raw('</sup>'),
                text(' and H'),
                raw('<sub>'), text('2'), raw('</sub>'),
                text('O'),
            ])
        ]);
        const result = run(tree) as { children: { children: HastNode[] }[] };
        const p = result.children[0].children as HastNode[];
        expect(p).toHaveLength(5);
        expect(p[1]).toMatchObject({ tagName: 'sup' });
        expect(p[3]).toMatchObject({ tagName: 'sub' });
    });
});
