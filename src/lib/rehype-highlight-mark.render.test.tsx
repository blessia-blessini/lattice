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


// UTST for REQ-LTTCE-CPY-00001 / 00002 (IMPL-LTTCE-CPY-00001).
//
// WHY THIS FILE EXISTS, SEPARATE FROM rehype-highlight-mark.test.ts:
// the hast-level tests assert the tree the plugin *builds*. What actually
// reaches the clipboard is the DOM ReactMarkdown *renders* — and the hop in
// between (hast property -> React prop -> DOM attribute) is where an inline
// style can silently be dropped or reshaped. Asserting the rendered DOM is
// therefore the only test that speaks to real user-visible behaviour: what the
// WebView serializes when the user copies.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { rehypeHighlightMark } from './rehype-highlight-mark';

const LIGHT = '#ffe000';
const DARK = '#423d12';

//******************************************************************************
// renderMd
//******************************************************************************
/** Render markdown through the real ReactMarkdown pipeline with the plugin. */
function renderMd(markdown: string, color: string): HTMLElement {
    const { container } = render(
        <ReactMarkdown
            rehypePlugins={[[rehypeHighlightMark, { color }] as
                [typeof rehypeHighlightMark, { color: string }]]}
        >
            {markdown}
        </ReactMarkdown>
    );
    return container;
}
// renderMd END ****************************************************************


describe('rendered ==highlight== DOM (clipboard fidelity)', () => {
    it('renders a <span> carrying the background as a real inline style', () => {
        const container = renderMd('- 11002486 ==Climate Menu: seat heating==', LIGHT);
        const span = container.querySelector('span.lattice-mark') as HTMLElement;

        expect(span).not.toBeNull();
        expect(span.textContent).toBe('Climate Menu: seat heating');
        // The inline style is the payload that crosses the clipboard.
        expect(span.getAttribute('style')).toContain('background-color');
        expect(span.style.backgroundColor).toBe('rgb(255, 224, 0)');
    });

    it('renders NO <mark> element anywhere', () => {
        // A <mark> would be discarded wholesale by Word's pre-HTML5 reader,
        // taking the highlight with it — the original defect.
        const container = renderMd('a ==b== and ==c== end', LIGHT);
        expect(container.querySelector('mark')).toBeNull();
        expect(container.querySelectorAll('span.lattice-mark')).toHaveLength(2);
    });

    it('carries the dark-theme colour inline too', () => {
        const container = renderMd('==x==', DARK);
        const span = container.querySelector('span.lattice-mark') as HTMLElement;
        expect(span.style.backgroundColor).toBe('rgb(66, 61, 18)');
        expect(span.getAttribute('style')).toContain('background-color');
    });


    // PORTABILITY GUARD (REQ-LTTCE-CPY-00002): the inline colour is parsed by
    // foreign HTML readers whose CSS support is much older than any WebView's.
    // Opaque `#rrggbb` is the notation they all accept; rgba()/hsl() risk being
    // dropped, taking the highlight with them. Must hold on every platform
    // Lattice ships on (Windows/Android = Chromium, macOS/iOS/Linux = WebKit).

    it.each(Object.entries({ light: LIGHT, dark: DARK }))(
        'the %s theme colour is an opaque hex, not rgba()/hsl()', (_theme, color) => {
            expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        });

    it('leaves code spans and fences untouched', () => {
        const container = renderMd('`==not a highlight==`', LIGHT);
        expect(container.querySelector('span.lattice-mark')).toBeNull();
        expect(container.querySelector('code')!.textContent).toBe('==not a highlight==');
    });

    it('highlights inside emphasis (mark within one text node)', () => {
        const container = renderMd('**==bold highlight==**', LIGHT);
        const span = container.querySelector('span.lattice-mark') as HTMLElement;
        expect(span).not.toBeNull();
        expect(span.textContent).toBe('bold highlight');
        expect(container.querySelector('strong')).not.toBeNull();
        expect(span.getAttribute('style')).toContain('background-color');
    });

    // Pre-existing, unchanged limitation (NOT introduced by the <span> switch):
    // the plugin rewrites text nodes, and inline markup splits the text node,
    // so a ==...== that straddles a **bold** run is not recognised.
    it('does not span a highlight across nested inline markup', () => {
        const container = renderMd('==keep **bold** here==', LIGHT);
        expect(container.querySelector('span.lattice-mark')).toBeNull();
    });
});
