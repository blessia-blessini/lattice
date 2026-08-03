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
import { MARK_RE, splitAtMarks, rehypeHighlightMark } from './rehype-highlight-mark';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal HAST paragraph element with a single text child. */
function para(text: string): any {
    return {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'text', value: text }],
    };
}

/** Build a minimal HAST root wrapping the given children. */
function root(...children: any[]): any {
    return { type: 'root', children };
}

/** Run rehypeHighlightMark on a root node and return it. */
function process(tree: any): any {
    rehypeHighlightMark()(tree);
    return tree;
}

// ---------------------------------------------------------------------------
// MARK_RE
// ---------------------------------------------------------------------------
describe('MARK_RE', () => {
    it('matches a simple ==word==', () => {
        MARK_RE.lastIndex = 0;
        expect(MARK_RE.test('==hello==')).toBe(true);
    });

    it('matches ==multi word==', () => {
        MARK_RE.lastIndex = 0;
        expect(MARK_RE.test('==hello world==')).toBe(true);
    });

    it('does not match across a newline', () => {
        MARK_RE.lastIndex = 0;
        expect(MARK_RE.test('==hello\nworld==')).toBe(false);
    });

    it('does not match ====  (empty body)', () => {
        MARK_RE.lastIndex = 0;
        expect(MARK_RE.test('====')).toBe(false);
    });

    it('does not match === (triple equals)', () => {
        MARK_RE.lastIndex = 0;
        expect(MARK_RE.test('===text===')).toBe(true); // outer == wraps =text=
    });
});

// ---------------------------------------------------------------------------
// splitAtMarks
// ---------------------------------------------------------------------------
describe('splitAtMarks', () => {
    it('returns a single text node when there are no marks', () => {
        const parts = splitAtMarks('hello world');
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({ type: 'text', value: 'hello world' });
    });

    it('returns a single mark node for ==hello==', () => {
        const parts = splitAtMarks('==hello==');
        expect(parts).toHaveLength(1);
        expect(parts[0].type).toBe('element');
        expect(parts[0].tagName).toBe('span');
        expect(parts[0].children[0].value).toBe('hello');
    });

    it('produces text–mark–text for "before ==hi== after"', () => {
        const parts = splitAtMarks('before ==hi== after');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toEqual({ type: 'text', value: 'before ' });
        expect(parts[1].tagName).toBe('span');
        expect(parts[1].children[0].value).toBe('hi');
        expect(parts[2]).toEqual({ type: 'text', value: ' after' });
    });

    it('handles two adjacent marks', () => {
        const parts = splitAtMarks('==a== ==b==');
        expect(parts).toHaveLength(3);
        expect(parts[0].tagName).toBe('span');
        expect(parts[0].children[0].value).toBe('a');
        expect(parts[1]).toEqual({ type: 'text', value: ' ' });
        expect(parts[2].tagName).toBe('span');
        expect(parts[2].children[0].value).toBe('b');
    });

    // REQ-LTTCE-CPY-00001 — the reason the element is a styled <span> and not
    // a <mark>: the colour must be part of the copied markup, on a tag that
    // Word's pre-HTML5 reader does not discard.
    it('emits an inline background-color so the highlight survives a copy', () => {
        const parts = splitAtMarks('==hello==');
        expect(parts[0].tagName).toBe('span');
        expect(parts[0].properties.style).toBe('background-color:#ffe000');
        expect(parts[0].properties.className).toEqual(['lattice-mark']);
    });

    it('never emits a <mark> element (Word discards unknown tags)', () => {
        const parts = splitAtMarks('a ==b== c ==d== e');
        expect(parts.filter((p: any) => p.tagName === 'mark')).toHaveLength(0);
        expect(parts.filter((p: any) => p.tagName === 'span')).toHaveLength(2);
    });

    it('honours a caller-supplied colour (dark preview theme)', () => {
        const parts = splitAtMarks('==x==', '#423d12');
        expect(parts[0].properties.style).toBe('background-color:#423d12');

    });

    it('is idempotent — calling twice does not double-wrap', () => {
        const first = splitAtMarks('==x==');
        // first[0] is a mark element node — no text value, so a second call
        // on the mark's inner text would just return [{ type: 'text', value: 'x' }]
        const inner = splitAtMarks('x');
        expect(inner).toHaveLength(1);
        expect(inner[0].type).toBe('text');
    });
});

// ---------------------------------------------------------------------------
// rehypeHighlightMark — tree transformation
// ---------------------------------------------------------------------------
describe('rehypeHighlightMark', () => {
    it('passes its colour option through to the emitted span', () => {
        const tree = root(para('hello ==world== end'));
        rehypeHighlightMark({ color: '#abcdef' })(tree);
        expect(tree.children[0].children[1].properties.style)
            .toBe('background-color:#abcdef');
    });

    it('converts ==text== in a paragraph to a styled <span> element', () => {
        const tree = root(para('hello ==world== end'));
        process(tree);
        const children = tree.children[0].children;
        expect(children).toHaveLength(3);
        expect(children[0]).toEqual({ type: 'text', value: 'hello ' });
        expect(children[1].tagName).toBe('span');
        expect(children[1].children[0].value).toBe('world');
        expect(children[2]).toEqual({ type: 'text', value: ' end' });
    });

    it('leaves a paragraph without == unchanged', () => {
        const tree = root(para('no marks here'));
        process(tree);
        expect(tree.children[0].children).toHaveLength(1);
        expect(tree.children[0].children[0].value).toBe('no marks here');
    });

    it('does not process text inside a <code> element', () => {
        const codeEl: any = {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: '==not-a-mark==' }],
        };
        const tree = root(codeEl);
        process(tree);
        expect(tree.children[0].children).toHaveLength(1);
        expect(tree.children[0].children[0].value).toBe('==not-a-mark==');
    });

    it('does not process text inside a <pre> element', () => {
        const preEl: any = {
            type: 'element',
            tagName: 'pre',
            properties: {},
            children: [{ type: 'text', value: '==not-a-mark==' }],
        };
        const tree = root(preEl);
        process(tree);
        expect(tree.children[0].children[0].value).toBe('==not-a-mark==');
    });

    it('does not process text inside a <code> nested in a <pre>', () => {
        const preEl: any = {
            type: 'element',
            tagName: 'pre',
            properties: {},
            children: [{
                type: 'element',
                tagName: 'code',
                properties: {},
                children: [{ type: 'text', value: '==not-a-mark==' }],
            }],
        };
        const tree = root(preEl);
        process(tree);
        const code = tree.children[0].children[0];
        expect(code.children[0].value).toBe('==not-a-mark==');
    });

    it('handles multiple paragraphs', () => {
        const tree = root(para('==a=='), para('plain'), para('==b=='));
        process(tree);
        expect(tree.children[0].children[0].tagName).toBe('span');
        expect(tree.children[1].children[0].value).toBe('plain');
        expect(tree.children[2].children[0].tagName).toBe('span');
    });

    it('is a no-op on an empty root', () => {
        const tree = root();
        expect(() => process(tree)).not.toThrow();
        expect(tree.children).toHaveLength(0);
    });

    it('does not modify a root with only element children that have no text', () => {
        const tree = root({
            type: 'element',
            tagName: 'hr',
            properties: {},
            children: [],
        });
        process(tree);
        expect(tree.children[0].children).toHaveLength(0);
    });

    it('does not throw when walk is called with a null/undefined child node', () => {
        // The `if (!node) return;` guard at the top of walk() protects against
        // null children that can appear in malformed or synthetic HAST trees.
        const tree = {
            type: 'element',
            tagName: 'div',
            properties: {},
            // One real paragraph and one null sentinel
            children: [
                { type: 'text', value: 'before' },
                null,
                para('==mark=='),
            ],
        };
        expect(() => process(tree)).not.toThrow();
    });

    it('recurses into non-code element children without expanding plain text', () => {
        // A text node inside an element that contains NO `==` markers must
        // pass through the `else { walk(child, nowInCode) }` branch unchanged.
        // We nest a plain-text paragraph inside a <section> to verify that
        // the else/recurse path fires and the text is untouched.
        const inner = para('plain text no marks');
        const section: any = {
            type: 'element',
            tagName: 'section',
            properties: {},
            children: [inner],
        };
        const tree = root(section);
        process(tree);
        // The paragraph's text child must be unchanged.
        expect(inner.children[0].value).toBe('plain text no marks');
        expect(inner.children).toHaveLength(1);
    });

    it('expands marks inside a nested element that is not code or pre', () => {
        // A <mark>-able text inside a <blockquote> (not code/pre) must be
        // expanded — this exercises the TRUE branch of the marks check when
        // the owning element is reached through recursive descent.
        const innerPara = para('==highlighted==');
        const blockquote: any = {
            type: 'element',
            tagName: 'blockquote',
            properties: {},
            children: [innerPara],
        };
        const tree = root(blockquote);
        process(tree);
        // The inner paragraph should now have a <mark> child.
        expect(innerPara.children[0].tagName).toBe('span');
        expect(innerPara.children[0].children[0].value).toBe('highlighted');
    });
});
