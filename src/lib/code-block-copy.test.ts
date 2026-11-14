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
//
// UTST for IMPL-LTTCE-PRV-00004 (REQ-LTTCE-PRV-00004) — code block copy logic.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    fenceText,
    copyText,
    execCommandCopy,
    defaultClipboardRoutes,
    type HastLike,
    isMermaidFence,
    serializeSvg,
    diagramSvgText,
    rememberDiagramSvg,
    forgetDiagramSvg,
} from './code-block-copy';
import { setClipboard } from '../test/clipboard-mock';

const text = (value: string): HastLike => ({ type: 'text', value });
const el = (tagName: string, ...children: HastLike[]): HastLike =>
    ({ type: 'element', tagName, children });

describe('fenceText', () => {
    it('returns the code text without the closing line break', () => {
        expect(fenceText(el('pre', el('code', text('a\nb\n'))))).toBe('a\nb');
    });

    it('drops only one trailing line break, keeping intended blank lines', () => {
        expect(fenceText(el('pre', el('code', text('a\n\n'))))).toBe('a\n');
    });

    it('gives a mermaid fence its source text, like any other block', () => {
        expect(fenceText(el('pre', el('code', text('graph TD; A-->B\n'))))).toBe('graph TD; A-->B');
    });

    it('joins text split over nested elements, in order', () => {
        const pre = el('pre', el('code', el('span', text('let')), text(' x = '), el('span', text('1')), text(';')));
        expect(fenceText(pre)).toBe('let x = 1;');
    });

    it('skips text beside the <code> and reads the <code> only', () => {
        expect(fenceText(el('pre', text('\n'), el('code', text('only this\n'))))).toBe('only this');
    });

    it('falls back to the <pre> text when there is no <code>', () => {
        expect(fenceText(el('pre', text('raw text')))).toBe('raw text');
    });

    it('is empty for no node and for an empty block', () => {
        expect(fenceText(undefined)).toBe('');
        expect(fenceText(el('pre', el('code')))).toBe('');
        expect(fenceText({ type: 'text' })).toBe('');
    });
});

describe('copyText', () => {
    it('uses the synchronous copy command first, without touching the Async API', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const execCopy = vi.fn().mockReturnValue(true);
        expect(await copyText('x', { writeText, execCopy })).toBe(true);
        expect(execCopy).toHaveBeenCalledWith('x');
        expect(writeText).not.toHaveBeenCalled();
    });

    it('runs the copy command before anything is awaited — inside the user gesture', () => {
        // The promise is deliberately not awaited: the copy must already have
        // happened when copyText returns to the click handler.
        const execCopy = vi.fn().mockReturnValue(true);
        void copyText('x', { execCopy });
        expect(execCopy).toHaveBeenCalledTimes(1);
    });

    it('falls back to the Async Clipboard API when the copy command fails', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        expect(await copyText('x', { writeText, execCopy: () => false })).toBe(true);
        expect(writeText).toHaveBeenCalledWith('x');
    });

    it('falls back to the Async Clipboard API when the copy command throws', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        expect(await copyText('x', { writeText, execCopy: () => { throw new Error('gone'); } })).toBe(true);
        expect(writeText).toHaveBeenCalledWith('x');
    });

    it('reports failure, without throwing, when every route fails', async () => {
        expect(await copyText('x', { execCopy: () => false })).toBe(false);
        expect(await copyText('x', {
            execCopy: () => { throw new Error('boom'); },
            writeText: () => Promise.reject(new Error('denied')),
        })).toBe(false);
    });
});

describe('execCommandCopy', () => {
    const original = (document as any).execCommand;
    afterEach(() => {
        (document as any).execCommand = original;
        document.body.innerHTML = '';
    });

    it('copies the text from a focused scratch textarea and removes it again', () => {
        let copied = '';
        let focused = false;
        // Stand-in for the WebView's copy command: record what is on offer.
        (document as any).execCommand = vi.fn(() => {
            const area = document.querySelector('textarea');
            copied = area?.value ?? '';
            focused = document.activeElement === area;
            return true;
        });
        expect(execCommandCopy('hello')).toBe(true);
        expect(copied).toBe('hello');
        expect(focused).toBe(true);
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('puts the selection and focus the user had back afterwards', () => {
        document.body.innerHTML = '<p id="p">some selected text</p><input id="field">';
        const field = document.getElementById('field') as HTMLInputElement;
        field.focus();
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('p')!);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);
        (document as any).execCommand = vi.fn(() => true);

        execCommandCopy('hello');

        expect(document.activeElement).toBe(field);
        expect(document.getSelection()!.toString()).toBe('some selected text');
    });

    it('reports failure when the copy command throws, and still cleans up', () => {
        (document as any).execCommand = vi.fn(() => { throw new Error('no'); });
        expect(execCommandCopy('hello')).toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
    });
});

describe('defaultClipboardRoutes', () => {
    afterEach(() => { setClipboard(undefined); });

    it('offers the Async Clipboard API when the WebView has one', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        setClipboard({ writeText });
        const routes = defaultClipboardRoutes();
        await routes.writeText!('y');
        expect(writeText).toHaveBeenCalledWith('y');
    });

    it('offers only the legacy route without it', () => {
        setClipboard(undefined);
        expect(defaultClipboardRoutes().writeText).toBeUndefined();
    });
});

// UTST for IMPL-LTTCE-PRV-00004 (REQ-LTTCE-PRV-00006) — "Copy SVG" logic.
describe('isMermaidFence', () => {
    const fence = (className: unknown): HastLike => ({
        type: 'element', tagName: 'pre',
        children: [{ type: 'element', tagName: 'code', properties: { className } }],
    });

    it('is true only for a mermaid fence', () => {
        expect(isMermaidFence(fence(['language-mermaid']))).toBe(true);
        expect(isMermaidFence(fence(['language-js']))).toBe(false);
        expect(isMermaidFence(fence(undefined))).toBe(false);
        expect(isMermaidFence(undefined)).toBe(false);
        expect(isMermaidFence({ type: 'element', tagName: 'pre', children: [text('x')] })).toBe(false);
    });
});

describe('serializeSvg', () => {
    const svgFrom = (html: string): Element => {
        const host = document.createElement('div');
        host.innerHTML = html;
        return host.querySelector('svg')!;
    };

    it('declares the SVG namespace and leaves the live element alone', () => {
        const svg = svgFrom('<svg id="d"><g/></svg>');
        const out = serializeSvg(svg);
        expect(out).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
        expect(svg.parentElement).not.toBeNull();
    });

    it('writes Mermaid-shaped markup as well-formed XML', () => {
        // As Mermaid emits it: xmlns on the root, HTML labels in a
        // foreignObject with an xmlns attribute of their own. outerHTML would
        // leave the <br> unclosed; a naive serialisation would declare xmlns
        // twice. Either makes an SVG no reader opens.
        const svg = svgFrom('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            + '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">a<br>b</div></foreignObject></svg>');
        const out = serializeSvg(svg);
        expect(out).toContain('<br />');
        expect(out.match(/ xmlns="/g)).toHaveLength(2); // once on <svg>, once on the <div>
        const parsed = new DOMParser().parseFromString(out, 'image/svg+xml');
        expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
        expect(parsed.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });
});

describe('diagramSvgText', () => {
    const blockWith = (inner: string): { block: HTMLElement; container: Element | null } => {
        const block = document.createElement('div');
        block.innerHTML = inner;
        return { block, container: block.querySelector('.mermaid') };
    };

    it('is null without a diagram, and for a diagram that failed to render', () => {
        expect(diagramSvgText(blockWith('<pre><code>x</code></pre>').block)).toBeNull();
        expect(diagramSvgText(blockWith('<div class="mermaid"><pre class="error">bad</pre></div>').block)).toBeNull();
    });

    it('falls back to the SVG on screen until a copy SVG is recorded', () => {
        const { block } = blockWith('<div class="mermaid"><svg id="screen"></svg></div>');
        expect(diagramSvgText(block)).toContain('id="screen"');
    });

    it('prefers the recorded copy SVG, and forgets it again', () => {
        const { block, container } = blockWith('<div class="mermaid"><svg id="screen"></svg></div>');
        const light = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        light.setAttribute('id', 'light');
        rememberDiagramSvg(container!, light);
        expect(diagramSvgText(block)).toContain('id="light"');
        forgetDiagramSvg(container!);
        expect(diagramSvgText(block)).toContain('id="screen"');
    });
});
