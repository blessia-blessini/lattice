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

// UTST for REQ-LTTCE-MRC-00001..00003 (IMPL-LTTCE-MRC-00002) — the clipboard
// transform that carries Mermaid diagrams into pasted HTML.

import { describe, it, expect } from 'vitest';
import { buildCopyHtml, fragmentHasDiagram, substituteDiagrams, DIAGRAM_PNG_ATTR } from './preview-copy';

const PNG = 'data:image/png;base64,AAAA';

// ── Test helper ───────────────────────────────────────────────────────────────
// Builds the kind of fragment `Range.cloneContents()` hands over: detached
// nodes, attributes intact.

const fragmentOf = (html: string): DocumentFragment => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
};

const diagram = (png = PNG, extra = '') =>
    `<div class="mermaid" ${DIAGRAM_PNG_ATTR}="${png}" ${extra}><svg><g>node</g></svg></div>`;

describe('preview copy — diagram detection', () => {

    it('finds a diagram that carries a cached PNG', () => {
        expect(fragmentHasDiagram(fragmentOf(`<p>text</p>${diagram()}`))).toBe(true);
    });

    it('reports no diagram for ordinary prose', () => {
        expect(fragmentHasDiagram(fragmentOf('<p>just <em>text</em></p>'))).toBe(false);
    });

    it('reports no diagram for an SVG that has not been rasterised yet', () => {
        // Rasterising is deferred to idle time, so a copy can land first.
        expect(fragmentHasDiagram(fragmentOf('<div class="mermaid"><svg></svg></div>'))).toBe(false);
    });
});

describe('preview copy — substitution', () => {

    it('replaces the diagram with an img carrying the PNG', () => {
        const fragment = fragmentOf(diagram());
        expect(substituteDiagrams(fragment)).toBe(1);

        const img = fragment.querySelector('img');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe(PNG);
        expect(img!.getAttribute('alt')).toBe('Mermaid diagram');
        expect(fragment.querySelector('svg')).toBeNull();
    });

    it('carries the on-screen size so the paste is not double-size', () => {
        const fragment = fragmentOf(
            diagram(PNG, 'data-lattice-diagram-width="320" data-lattice-diagram-height="180"')
        );
        substituteDiagrams(fragment);

        const img = fragment.querySelector('img')!;
        expect(img.getAttribute('width')).toBe('320');
        expect(img.getAttribute('height')).toBe('180');
    });

    it('handles several diagrams in one selection', () => {
        const fragment = fragmentOf(`${diagram()}<p>between</p>${diagram('data:image/png;base64,BBBB')}`);
        expect(substituteDiagrams(fragment)).toBe(2);

        const srcs = Array.from(fragment.querySelectorAll('img')).map(i => i.getAttribute('src'));
        expect(srcs).toEqual([PNG, 'data:image/png;base64,BBBB']);
    });

    it('leaves a diagram whose cached PNG is empty', () => {
        const fragment = fragmentOf(diagram(''));
        expect(substituteDiagrams(fragment)).toBe(0);
        expect(fragment.querySelector('svg')).not.toBeNull();
    });
});

describe('preview copy — HTML for the clipboard', () => {

    it('returns null when there is no diagram, so the copy is not intercepted', () => {
        // REQ-LTTCE-CPY-00001: an ordinary selection must reach the clipboard
        // through the WebView's own path, untouched.
        expect(buildCopyHtml(fragmentOf('<p>plain text</p>'))).toBeNull();
    });

    it('returns null when the only diagram has no usable PNG', () => {
        expect(buildCopyHtml(fragmentOf(diagram('')))).toBeNull();
    });

    it('emits html with the diagram as an img', () => {
        const html = buildCopyHtml(fragmentOf(`<p>before</p>${diagram()}<p>after</p>`));
        expect(html).not.toBeNull();
        expect(html).toContain('<p>before</p>');
        expect(html).toContain(`<img src="${PNG}"`);
        expect(html).toContain('<p>after</p>');
        expect(html).not.toContain('<svg');
    });

    it('preserves inline styles on the surrounding markup', () => {
        // The ==highlight== colour rides on an inline style (REQ-LTTCE-CPY-00001).
        // Rewriting a selection must not cost it that.
        const html = buildCopyHtml(fragmentOf(
            `<p><span style="background-color:#ffe000">lit</span></p>${diagram()}`
        ));
        expect(html).toContain('background-color:#ffe000');
        expect(html).toContain('<img');
    });

    it('keeps the surrounding text when a diagram is only part of the selection', () => {
        const html = buildCopyHtml(fragmentOf(
            `<h2>Title</h2>${diagram()}<ul><li>one</li><li>two</li></ul>`
        ));
        expect(html).toContain('<h2>Title</h2>');
        expect(html).toContain('<li>one</li>');
        expect(html).toContain('<li>two</li>');
    });
});
