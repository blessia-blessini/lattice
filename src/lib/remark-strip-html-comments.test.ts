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
import {
    isHtmlCommentOnly,
    remarkStripHtmlComments,
} from './remark-strip-html-comments';

// Synthetic mdast builders. We don't pull in real mdast types — the plugin
// is `any`-typed (matches the rehypeAddSourceLines / rehypeAddHeadingIds
// style elsewhere in this project).
const html = (value: string) => ({ type: 'html', value });
const text = (value: string) => ({ type: 'text', value });
const heading = (depth: number, children: any[]) => ({ type: 'heading', depth, children });
const paragraph = (children: any[]) => ({ type: 'paragraph', children });
const root = (children: any[]) => ({ type: 'root', children });

const transform = (tree: any) => {
    remarkStripHtmlComments()(tree);
    return tree;
};

describe('isHtmlCommentOnly', () => {
    it.each([
        ['<!-- TOC -->', true],
        ['<!-- /TOC -->', true],
        ['<!-- TOC minLevel=2 maxLevel=4 -->', true],
        ['  <!-- TOC -->  ', true],
        ['<!--\n multi-line\n comment\n-->', true],
    ])('treats %j as a pure comment', (input, expected) => {
        expect(isHtmlCommentOnly(input)).toBe(expected);
    });

    it.each([
        ['<div>x</div>', false],
        ['<!-- a --><div>x</div>', false], // not pure
        ['hello', false],
        ['', false],
    ])('rejects %j', (input, expected) => {
        expect(isHtmlCommentOnly(input)).toBe(expected);
    });

    it('returns false for non-string input', () => {
        expect(isHtmlCommentOnly(undefined)).toBe(false);
        expect(isHtmlCommentOnly(null)).toBe(false);
        expect(isHtmlCommentOnly(42)).toBe(false);
    });
});

describe('remarkStripHtmlComments', () => {
    it('removes a top-level TOC opener html node', () => {
        const tree = root([
            heading(1, [text('Title')]),
            html('<!-- TOC -->'),
            paragraph([text('body')]),
            html('<!-- /TOC -->'),
        ]);
        transform(tree);
        // Both comment nodes gone; heading and paragraph remain.
        expect(tree.children).toHaveLength(2);
        expect(tree.children[0].type).toBe('heading');
        expect(tree.children[1].type).toBe('paragraph');
    });

    it('removes an opener with options', () => {
        const tree = root([html('<!-- TOC minLevel=2 maxLevel=4 -->')]);
        transform(tree);
        expect(tree.children).toHaveLength(0);
    });

    it('removes a multi-line html comment', () => {
        const tree = root([html('<!--\n big\n comment\n-->')]);
        transform(tree);
        expect(tree.children).toHaveLength(0);
    });

    it('keeps html nodes that are not purely comments', () => {
        // Mixed content (comment + element) is left alone — the user is
        // doing something deliberate with raw HTML and we shouldn't second-
        // guess them. They will still render as literal text in this
        // project (no rehype-raw), but at least the plugin isn't lying
        // about what was in the source.
        const mixed = '<!-- note --><div>x</div>';
        const tree = root([html(mixed)]);
        transform(tree);
        expect(tree.children).toHaveLength(1);
        expect(tree.children[0].value).toBe(mixed);
    });

    it('does not touch non-html nodes', () => {
        const para = paragraph([text('plain text')]);
        const tree = root([para]);
        transform(tree);
        expect(tree.children).toHaveLength(1);
        expect(tree.children[0]).toBe(para);
    });

    it('strips inline html comment nodes from inside paragraphs', () => {
        // CommonMark allows raw HTML inline — a comment inside a paragraph
        // becomes an inline html child of the paragraph. We strip those too
        // (the surrounding text is preserved).
        const para = paragraph([
            text('before '),
            html('<!-- note -->'),
            text(' after'),
        ]);
        const tree = root([para]);
        transform(tree);
        expect(tree.children[0].children).toHaveLength(2);
        expect(tree.children[0].children[0].value).toBe('before ');
        expect(tree.children[0].children[1].value).toBe(' after');
    });

    it('walks nested wrappers, not just root', () => {
        // Block quotes, list items, etc. wrap children. The walker must
        // recurse into every node that has a children array.
        const blockquote = {
            type: 'blockquote',
            children: [
                paragraph([text('quoted')]),
                html('<!-- nested -->'),
            ],
        };
        const tree = root([blockquote]);
        transform(tree);
        expect(blockquote.children).toHaveLength(1);
        expect(blockquote.children[0].type).toBe('paragraph');
    });
});
