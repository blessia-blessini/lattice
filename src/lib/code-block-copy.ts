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

// IMPL-LTTCE-PRV-00004
//
// Pure logic behind the preview code block's copy buttons (REQ-LTTCE-PRV-00004
// / 00006 / 00007): what they copy, and how it reaches the clipboard. The React
// glue is `components/CodeBlock.tsx` (IMPL-LTTCE-PRV-00005).

import { diagramImage } from './preview-copy';

/** Minimal shape of the hast node react-markdown passes to a `pre` renderer. */
export interface HastLike {
    type?: string;
    tagName?: string;
    value?: string;
    properties?: { className?: unknown };
    children?: HastLike[];
}

/** Fence class of a block rendered as a Mermaid diagram. */
const MERMAID_FENCE_CLASS = 'language-mermaid';

/** Selector of the element `Mermaid.tsx` renders the diagram into. */
const DIAGRAM_CONTAINER_SELECTOR = '.mermaid';



//******************************************************************************
// hastText
//******************************************************************************
/** Concatenated text of every text node below `node`, in document order. */
function hastText(node: HastLike): string {
    if (node.type === 'text') return node.value ?? '';
    return (node.children ?? []).map(hastText).join('');
}
// hastText END ****************************************************************


//******************************************************************************
// fenceText
//******************************************************************************
/**
 * The text a copy of a code block carries: the content between the fences,
 * without the single line break Markdown puts after the last line.
 *
 * Taken from the parsed Markdown (the `<pre>`'s hast node), not from the DOM,
 * because the DOM does not always hold the source: a Mermaid fence shows a
 * diagram there, and a highlighted fence has had its text split into
 * `tok-*` spans. The hast node is the same for every kind of block.
 */
export function fenceText(pre: HastLike | undefined): string {
    if (!pre) return '';
    const code = pre.children?.find(c => c.type === 'element' && c.tagName === 'code');
    return hastText(code ?? pre).replace(/\n$/, '');
}
// fenceText END ***************************************************************


//******************************************************************************
// isMermaidFence
//******************************************************************************
/**
 * Is this `<pre>` a Mermaid fence? Those are rendered as a diagram and get
 * two more buttons, "Copy PNG image" and "Copy SVG" (REQ-LTTCE-PRV-00007 / 00006).
 */
export function isMermaidFence(pre: HastLike | undefined): boolean {
    const code = pre?.children?.find(c => c.type === 'element' && c.tagName === 'code');
    const cls = code?.properties?.className;
    return Array.isArray(cls) && cls.includes(MERMAID_FENCE_CLASS);
}
// isMermaidFence END **********************************************************


//******************************************************************************
// serializeSvg
//******************************************************************************
/**
 * `svg` as a standalone SVG document: XML serialisation (not `outerHTML`),
 * so the HTML Mermaid puts in its labels comes out well-formed (`<br />`, not
 * `<br>`). Works on a clone.
 *
 * The serialiser declares each element's namespace itself — the SVG one on
 * the root, XHTML on the label `<div>`s — from the namespace the element is
 * *in*. A literal `xmlns="…"` *attribute* (Mermaid writes one on its label
 * `<div>`s; the HTML parser keeps it as an ordinary attribute) would be
 * written as well, giving a duplicate attribute and an SVG no reader opens.
 * So those attributes are removed from the clone first.
 */
export function serializeSvg(svg: Element): string {
    const clone = svg.cloneNode(true) as Element;
    for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
        el.removeAttributeNS(null, 'xmlns');
    }
    return new XMLSerializer().serializeToString(clone);
}
// serializeSvg END ************************************************************


// The SVG a diagram's "Copy SVG" puts on the clipboard, per diagram container.
// Written by Mermaid.tsx when it prepares the clipboard copy of the diagram —
// the same SVG the PNG is rasterised from, so both follow the "Copy Diagrams
// On Light Background" setting (REQ-LTTCE-MRC-00005). Weak: a container that
// leaves the DOM takes its entry with it.
const g_diagramCopySvg = new WeakMap<Element, string>();


//******************************************************************************
// rememberDiagramSvg / forgetDiagramSvg
//******************************************************************************
/** Record `svg` as the copy SVG of the diagram in `container`. */
export function rememberDiagramSvg(container: Element, svg: Element): void {
    g_diagramCopySvg.set(container, serializeSvg(svg));
}

/** Drop the copy SVG of `container` — its diagram is being re-rendered. */
export function forgetDiagramSvg(container: Element): void {
    g_diagramCopySvg.delete(container);
}
// rememberDiagramSvg / forgetDiagramSvg END ***********************************


//******************************************************************************
// diagramSvgText
//******************************************************************************
/**
 * The SVG text "Copy SVG" puts on the clipboard for the diagram inside
 * `block`: the recorded copy SVG, or — before it has been prepared (it is
 * made in an idle slot) — the SVG on screen. `null` when there is no rendered
 * diagram, e.g. after a Mermaid syntax error.
 */
export function diagramSvgText(block: Element): string | null {
    const container = block.querySelector(DIAGRAM_CONTAINER_SELECTOR);
    if (!container) return null;
    const recorded = g_diagramCopySvg.get(container);
    if (recorded) return recorded;
    const onScreen = container.querySelector('svg');
    return onScreen ? serializeSvg(onScreen) : null;
}
// diagramSvgText END **********************************************************


/** Clipboard routes `copyText` tries, injectable for tests. */
export interface ClipboardRoutes {
    /** Legacy route — select a scratch textarea and run the copy command. */
    execCopy: (text: string) => boolean;
    /** Async Clipboard API — `navigator.clipboard.writeText`, when present. */
    writeText?: (text: string) => Promise<void>;
}


//******************************************************************************
// execCommandCopy
//******************************************************************************
/**
 * Legacy clipboard route: copy `text` through an off-screen textarea and
 * `document.execCommand('copy')`. Synchronous, so it runs inside the click
 * that asked for it — WebKit honours the copy command only during a user
 * gesture.
 *
 * Leaves the page as it found it: the textarea is focused only for the copy,
 * then removed, and the focus and text selection the user had before are put
 * back (CodeBlock keeps the selection through the mouse-down; this keeps it
 * through the copy).
 *
 * The textarea goes on `document.body`, outside the preview pane, so the
 * pane's own `copy` listener (IMPL-LTTCE-MRC-00002) never sees this copy.
 *
 * With `html`, the copy carries that HTML as well as `text`: a `copy`
 * listener on the textarea itself — the copy command's target, so no other
 * copy can reach it — fills both flavours. It reports success only when
 * that listener could write them — a WebView without `clipboardData` would
 * otherwise copy the plain text alone and still say "copied".
 */
export function execCommandCopy(text: string, doc: Document = document, html?: string): boolean {
    const selection = doc.getSelection();
    const savedRanges = selection
        ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i))
        : [];
    const savedFocus = doc.activeElement as HTMLElement | null;

    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    doc.body.appendChild(area);

    let htmlWritten = false;
    const fillHtml = (e: Event) => {
        const data = (e as ClipboardEvent).clipboardData;
        if (!data || html === undefined) return;
        data.setData('text/plain', text);
        data.setData('text/html', html);
        e.preventDefault();
        htmlWritten = true;
    };
    if (html !== undefined) area.addEventListener('copy', fillHtml);
    try {
        area.focus({ preventScroll: true });
        area.select();
        return doc.execCommand('copy') && (html === undefined || htmlWritten);
    } catch {
        return false;
    } finally {
        if (html !== undefined) area.removeEventListener('copy', fillHtml);
        area.remove();
        savedFocus?.focus?.({ preventScroll: true });
        if (selection) {
            selection.removeAllRanges();
            savedRanges.forEach(r => selection.addRange(r));
        }
    }
}
// execCommandCopy END *********************************************************


//******************************************************************************
// defaultClipboardRoutes
//******************************************************************************
/** The routes of the running WebView. */
export function defaultClipboardRoutes(): ClipboardRoutes {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    return {
        execCopy: (t: string) => execCommandCopy(t),
        writeText: clip?.writeText ? (t: string) => clip.writeText(t) : undefined,
    };
}
// defaultClipboardRoutes END **************************************************


//******************************************************************************
// copyText
//******************************************************************************
/**
 * Put `text` on the clipboard as plain text. Resolves `true` when one route
 * reported success; never rejects.
 *
 * The synchronous legacy route goes **first**, before anything is awaited:
 * called from a click handler, it then still runs inside the user gesture,
 * which WebKit (WKWebView, WebKitGTK) requires for the copy command. Trying
 * the Async Clipboard API first and falling back after its rejection would
 * reach the copy command only after an `await` — possibly after the gesture
 * has expired. The Async Clipboard API is the fallback for a WebView where the
 * copy command does not work (it is deprecated and may one day be removed).
 */
export async function copyText(
    text: string,
    routes: ClipboardRoutes = defaultClipboardRoutes(),
): Promise<boolean> {
    try {
        if (routes.execCopy(text)) return true;
    } catch {
        // Unsupported — try the Async Clipboard API below.
    }
    if (!routes.writeText) return false;
    try {
        await routes.writeText(text);
        return true;
    } catch {
        return false;
    }
}
// copyText END ****************************************************************


/** Clipboard routes `copyDiagramImage` tries, injectable for tests. */
export interface ImageClipboardRoutes {
    /** Legacy route — the copy command, carrying `<img>` HTML (`execCommandCopy`). */
    execHtmlCopy: (text: string, html: string) => boolean;
    /** Async Clipboard API — `navigator.clipboard.write` with an `image/png` item, when present. */
    writePng?: (png: Blob) => Promise<void>;
}


//******************************************************************************
// defaultImageClipboardRoutes
//******************************************************************************
/** The image routes of the running WebView. */
export function defaultImageClipboardRoutes(): ImageClipboardRoutes {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    return {
        execHtmlCopy: (t: string, h: string) => execCommandCopy(t, document, h),
        writePng: clip?.write && Item
            ? (png: Blob) => clip.write([new Item({ [png.type]: png })])
            : undefined,
    };
}
// defaultImageClipboardRoutes END *********************************************


//******************************************************************************
// pngBlob
//******************************************************************************
/** The bytes of a `data:image/png;base64,…` URI as an `image/png` Blob. Synchronous. */
export function pngBlob(dataUri: string): Blob {
    const binary = atob(dataUri.slice(dataUri.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
}
// pngBlob END *****************************************************************


//******************************************************************************
// copyDiagramImage
//******************************************************************************
/**
 * IMPL-LTTCE-PRV-00004 — REQ-LTTCE-PRV-00007 — put the diagram inside `block`
 * on the clipboard as a picture: its cached PNG (IMPL-LTTCE-MRC-00001), the
 * same image a selection copy carries. Resolves `true` when one route
 * reported success; `false` without touching the clipboard when the diagram
 * has no PNG (not rendered, failed, or not rasterised yet). Never rejects.
 *
 * Both routes are *started* before anything is awaited, so both run inside
 * the click (WebKit requires the user gesture for each):
 *   1. the copy command with an `<img>` in the HTML flavour — what a selection
 *      copy carries; Word, Outlook and mail clients paste it as a picture;
 *   2. the Async Clipboard API with a real `image/png` item, which replaces
 *      the first and is what image editors and chat apps need.
 * Route 2 failing (e.g. a WebView without image support on the clipboard)
 * leaves route 1's copy in place, so the result is the better of the two.
 */
export async function copyDiagramImage(
    block: Element,
    routes: ImageClipboardRoutes = defaultImageClipboardRoutes(),
): Promise<boolean> {
    const container = block.querySelector(DIAGRAM_CONTAINER_SELECTOR);
    const img = container ? diagramImage(container) : null;
    if (!img) return false;

    let htmlOk = false;
    try {
        htmlOk = routes.execHtmlCopy(img.getAttribute('alt') ?? '', img.outerHTML);
    } catch {
        // Unsupported — the Async Clipboard API below may still work.
    }
    if (!routes.writePng) return htmlOk;
    try {
        await routes.writePng(pngBlob(img.getAttribute('src') ?? ''));
        return true;
    } catch {
        return htmlOk;
    }
}
// copyDiagramImage END ********************************************************
