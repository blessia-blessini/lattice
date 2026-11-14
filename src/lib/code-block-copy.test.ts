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
    copyDiagramImage,
    defaultImageClipboardRoutes,
    pngBlob,
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

// UTST for IMPL-LTTCE-PRV-00004 (REQ-LTTCE-PRV-00007) — "Copy image" logic.
describe('copyDiagramImage', () => {
    // A 1×1 PNG; any base64 the safety check accepts would do.
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const blockWith = (attrs: string, inner = '<svg></svg>') => {
        const block = document.createElement('div');
        block.innerHTML = `<pre><div class="mermaid" ${attrs}>${inner}</div></pre>`;
        return block;
    };
    const ready = () => blockWith(
        `data-lattice-diagram-png="${PNG}" data-lattice-diagram-width="120" data-lattice-diagram-height="80"`);

    it('starts both routes inside the click: the <img> HTML copy, then the PNG item', () => {
        const execHtmlCopy = vi.fn().mockReturnValue(true);
        const writePng = vi.fn().mockResolvedValue(undefined);
        // Not awaited: both must have been called when it returns to the click handler.
        void copyDiagramImage(ready(), { execHtmlCopy, writePng });

        expect(execHtmlCopy).toHaveBeenCalledTimes(1);
        const [plain, html] = execHtmlCopy.mock.calls[0];
        expect(plain).toBe('Mermaid diagram');
        expect(html).toContain(`src="${PNG}"`);
        expect(html).toContain('width="120"');
        expect(html).toContain('height="80"');

        expect(writePng).toHaveBeenCalledTimes(1);
        const blob = writePng.mock.calls[0][0] as Blob;
        expect(blob.type).toBe('image/png');
        expect(blob.size).toBe(atob(PNG.split(',')[1]).length);
        expect(execHtmlCopy.mock.invocationCallOrder[0]).toBeLessThan(writePng.mock.invocationCallOrder[0]);
    });

    it('succeeds on the PNG item alone when the HTML copy fails', async () => {
        const writePng = vi.fn().mockResolvedValue(undefined);
        expect(await copyDiagramImage(ready(), { execHtmlCopy: () => { throw new Error('x'); }, writePng })).toBe(true);
    });

    it('keeps the HTML copy as the result when the PNG item is refused or unavailable', async () => {
        const refused = () => Promise.reject(new Error('no images'));
        expect(await copyDiagramImage(ready(), { execHtmlCopy: () => true, writePng: refused })).toBe(true);
        expect(await copyDiagramImage(ready(), { execHtmlCopy: () => true })).toBe(true);
        expect(await copyDiagramImage(ready(), { execHtmlCopy: () => false, writePng: refused })).toBe(false);
    });

    it('fails without touching the clipboard when the diagram has no PNG', async () => {
        const execHtmlCopy = vi.fn().mockReturnValue(true);
        const writePng = vi.fn().mockResolvedValue(undefined);
        const routes = { execHtmlCopy, writePng };
        // Not rasterised yet, rasterising failed, a render error, no diagram at all.
        expect(await copyDiagramImage(blockWith(''), routes)).toBe(false);
        expect(await copyDiagramImage(blockWith('data-lattice-diagram-png-failed=""'), routes)).toBe(false);
        expect(await copyDiagramImage(blockWith('', '<pre class="error">bad</pre>'), routes)).toBe(false);
        expect(await copyDiagramImage(blockWith('data-lattice-diagram-png="javascript:alert(1)"'), routes)).toBe(false);
        const plain = document.createElement('div');
        plain.innerHTML = '<pre><code>x</code></pre>';
        expect(await copyDiagramImage(plain, routes)).toBe(false);
        expect(execHtmlCopy).not.toHaveBeenCalled();
        expect(writePng).not.toHaveBeenCalled();
    });
});

describe('pngBlob', () => {
    it('decodes the base64 payload into an image/png Blob', async () => {
        const blob = pngBlob('data:image/png;base64,AAEC/w==');
        expect(blob.type).toBe('image/png');
        expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([0, 1, 2, 255]);
    });
});

describe('execCommandCopy with HTML', () => {
    const original = (document as any).execCommand;
    afterEach(() => { (document as any).execCommand = original; });

    /** Stand-in for the copy command: fires a `copy` event, with or without clipboardData. */
    const fireCopy = (data: Record<string, string> | null) => vi.fn(() => {
        const ev = new Event('copy', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', {
            value: data && { setData: (type: string, value: string) => { data[type] = value; } },
        });
        document.querySelector('textarea')!.dispatchEvent(ev);
        return true;
    });

    it('fills the text and HTML flavours itself', () => {
        const data: Record<string, string> = {};
        (document as any).execCommand = fireCopy(data);
        expect(execCommandCopy('alt', document, '<img src="x">')).toBe(true);
        expect(data).toEqual({ 'text/plain': 'alt', 'text/html': '<img src="x">' });
    });

    it('reports failure when the WebView offers no clipboardData to write the HTML into', () => {
        (document as any).execCommand = fireCopy(null);
        expect(execCommandCopy('alt', document, '<img src="x">')).toBe(false);
    });

    it('leaves later copies alone', () => {
        (document as any).execCommand = fireCopy({});
        execCommandCopy('alt', document, '<img src="x">');
        const later: Record<string, string> = {};
        (document as any).execCommand = fireCopy(later);
        execCommandCopy('plain only');
        expect(later).toEqual({});
    });
});

describe('defaultImageClipboardRoutes', () => {
    const g = globalThis as { ClipboardItem?: unknown };
    const originalItem = g.ClipboardItem;
    afterEach(() => { setClipboard(undefined); g.ClipboardItem = originalItem; });

    it('writes an image/png ClipboardItem when the WebView supports one', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        setClipboard({ write });
        g.ClipboardItem = class { constructor(public items: Record<string, Blob>) {} };
        const png = new Blob([new Uint8Array([1])], { type: 'image/png' });
        await defaultImageClipboardRoutes().writePng!(png);
        const [[items]] = write.mock.calls;
        expect((items[0] as { items: Record<string, Blob> }).items).toEqual({ 'image/png': png });
    });

    it('offers only the HTML route without ClipboardItem or clipboard.write', () => {
        setClipboard({ write: vi.fn() });
        g.ClipboardItem = undefined;
        expect(defaultImageClipboardRoutes().writePng).toBeUndefined();
        setClipboard({ writeText: vi.fn() });
        g.ClipboardItem = class {};
        expect(defaultImageClipboardRoutes().writePng).toBeUndefined();
    });
});
