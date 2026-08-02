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

// UTST for REQ-LTTCE-CPY-00001 (IMPL-LTTCE-CPY-00001)
// Preview copy fidelity: ==highlight== <mark> backgrounds must survive
// pasting into applications that ignore the HTML5 <mark> tag (Word/Outlook).

import { describe, it, expect, vi } from 'vitest';
import {
    HIGHLIGHT_COPY_BG,
    inlineMarkHighlights,
    buildCopyHtml,
    handlePreviewCopy,
    type PreviewCopyEvent,
} from './preview-copy';


//******************************************************************************
// helpers
//******************************************************************************

/** Build a detached container with the given innerHTML. */
function containerOf(html: string): HTMLDivElement {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
}

/** Build a Range spanning all children of the given element. */
function rangeOver(el: Element): Range {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range;
}

/** Minimal Selection stub over the given ranges. */
function selectionOf(ranges: Range[], text: string): Selection {
    return {
        isCollapsed: ranges.length === 0,
        rangeCount: ranges.length,
        getRangeAt: (i: number) => ranges[i],
        toString: () => text,
    } as unknown as Selection;
}

/** Clipboard-event stub recording setData calls. */
function eventStub(): PreviewCopyEvent & { data: Record<string, string>; prevented: boolean } {
    const data: Record<string, string> = {};
    const stub = {
        data,
        prevented: false,
        clipboardData: {
            setData: (type: string, value: string) => { data[type] = value; },
        } as unknown as Pick<DataTransfer, 'setData'>,
        preventDefault: () => { stub.prevented = true; },
    };
    return stub;
}
// helpers END *****************************************************************


//******************************************************************************
// inlineMarkHighlights tests
//******************************************************************************
describe('inlineMarkHighlights', () => {
    it('replaces a <mark> with an inline-styled <span>, preserving text', () => {
        const root = containerOf('<p>a <mark>hot</mark> topic</p>');
        const n = inlineMarkHighlights(root);
        expect(n).toBe(1);
        expect(root.querySelector('mark')).toBeNull();
        const span = root.querySelector('span')!;
        expect(span.getAttribute('style')).toContain(`background:${HIGHLIGHT_COPY_BG}`);
        expect(span.textContent).toBe('hot');
        expect(root.textContent).toBe('a hot topic');
    });

    it('preserves nested inline elements inside the mark', () => {
        const root = containerOf('<p><mark>keep <strong>bold</strong> here</mark></p>');
        inlineMarkHighlights(root);
        const span = root.querySelector('span')!;
        expect(span.querySelector('strong')?.textContent).toBe('bold');
        expect(span.textContent).toBe('keep bold here');
    });

    it('converts every mark and returns the count', () => {
        const root = containerOf('<ul><li><mark>a</mark></li><li>x <mark>b</mark></li></ul>');
        expect(inlineMarkHighlights(root)).toBe(2);
        expect(root.querySelectorAll('span[style]').length).toBe(2);
        expect(root.querySelectorAll('mark').length).toBe(0);
    });

    it('returns 0 and leaves the tree untouched when there is no mark', () => {
        const root = containerOf('<p>plain <em>text</em></p>');
        const before = root.innerHTML;
        expect(inlineMarkHighlights(root)).toBe(0);
        expect(root.innerHTML).toBe(before);
    });
});
// inlineMarkHighlights tests END **********************************************


//******************************************************************************
// buildCopyHtml tests
//******************************************************************************
describe('buildCopyHtml', () => {
    it('returns inlined HTML for a selection containing a mark', () => {
        const el = containerOf('<p>see <mark>this</mark> now</p>');
        document.body.appendChild(el);
        try {
            const html = buildCopyHtml([rangeOver(el)]);
            expect(html).not.toBeNull();
            expect(html).toContain(`background:${HIGHLIGHT_COPY_BG}`);
            expect(html).not.toContain('<mark>');
            expect(html).toContain('this');
        } finally {
            el.remove();
        }
    });

    it('returns null when the selection has no mark (default copy kept)', () => {
        const el = containerOf('<p>nothing special</p>');
        document.body.appendChild(el);
        try {
            expect(buildCopyHtml([rangeOver(el)])).toBeNull();
        } finally {
            el.remove();
        }
    });
});
// buildCopyHtml tests END *****************************************************


//******************************************************************************
// handlePreviewCopy tests
//******************************************************************************
describe('handlePreviewCopy', () => {
    it('rewrites clipboard html + plain text when selection contains a mark', () => {
        const el = containerOf('<p>a <mark>b</mark> c</p>');
        document.body.appendChild(el);
        try {
            const e = eventStub();
            const sel = selectionOf([rangeOver(el)], 'a b c');
            expect(handlePreviewCopy(e, sel)).toBe(true);
            expect(e.prevented).toBe(true);
            expect(e.data['text/html']).toContain(`background:${HIGHLIGHT_COPY_BG}`);
            expect(e.data['text/html']).not.toContain('<mark>');
            expect(e.data['text/plain']).toBe('a b c');
        } finally {
            el.remove();
        }
    });

    it('does nothing for a selection without marks', () => {
        const el = containerOf('<p>plain</p>');
        document.body.appendChild(el);
        try {
            const e = eventStub();
            expect(handlePreviewCopy(e, selectionOf([rangeOver(el)], 'plain'))).toBe(false);
            expect(e.prevented).toBe(false);
            expect(e.data['text/html']).toBeUndefined();
        } finally {
            el.remove();
        }
    });

    it('does nothing for a collapsed/empty or null selection', () => {
        const e = eventStub();
        expect(handlePreviewCopy(e, selectionOf([], ''))).toBe(false);
        expect(handlePreviewCopy(e, null)).toBe(false);
        expect(e.prevented).toBe(false);
    });

    it('does nothing when clipboardData is unavailable', () => {
        const el = containerOf('<p><mark>x</mark></p>');
        document.body.appendChild(el);
        try {
            const preventDefault = vi.fn();
            const e: PreviewCopyEvent = { clipboardData: null, preventDefault };
            expect(handlePreviewCopy(e, selectionOf([rangeOver(el)], 'x'))).toBe(false);
            expect(preventDefault).not.toHaveBeenCalled();
        } finally {
            el.remove();
        }
    });
});
// handlePreviewCopy tests END *************************************************
