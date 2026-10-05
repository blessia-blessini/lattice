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

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    buildCopyHtml,
    buildExportHtml,
    fragmentHasDiagram,
    substituteDiagrams,
    waitForPreviewSettled,
    describeUnsettledPreview,
    resolveSettleTimeout,
    DEFAULT_SETTLE_TIMEOUT_MS,
    DIAGRAM_PNG_ATTR,
    DIAGRAM_PNG_FAILED_ATTR,
    HIGHLIGHT_PENDING_ATTR,
} from './preview-copy';

const PNG = 'data:image/png;base64,AAAA';

// ── Test helper ───────────────────────────────────────────────────────────────
// Builds the kind of fragment `Range.cloneContents()` hands over: detached
// nodes, attributes intact.

const fragmentOf = (html: string): DocumentFragment => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
};

// buildExportHtml/waitForPreviewSettled walk a live root element (the
// preview body), not a detached selection fragment — this builds that.
const elementOf = (html: string): HTMLElement => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
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

// UTST for REQ-LTTCE-XPT-00001 — the whole-document export used by
// `lattice --export-html`.
describe('preview copy — HTML for CLI export', () => {

    it('serialises a diagram-free document unmodified (unlike buildCopyHtml, never null)', () => {
        const html = buildExportHtml(elementOf('<p>plain text</p>'));
        expect(html).toBe('<p>plain text</p>');
    });

    it('substitutes a diagram exactly as the clipboard copy does', () => {
        const html = buildExportHtml(elementOf(`<p>before</p>${diagram()}<p>after</p>`));
        expect(html).toContain('<p>before</p>');
        expect(html).toContain(`<img src="${PNG}"`);
        expect(html).toContain('<p>after</p>');
        expect(html).not.toContain('<svg');
    });

    it('does not mutate the live root it was passed', () => {
        const root = elementOf(diagram());
        buildExportHtml(root);
        expect(root.querySelector('svg')).not.toBeNull();
        expect(root.querySelector('img')).toBeNull();
    });
});

describe('preview copy — waiting for diagrams to settle', () => {

    it('resolves immediately when there is no diagram', async () => {
        const start = Date.now();
        await waitForPreviewSettled(elementOf('<p>plain text</p>'), 500);
        expect(Date.now() - start).toBeLessThan(400);
    });

    it('resolves immediately once every diagram already has a cached PNG', async () => {
        const start = Date.now();
        await waitForPreviewSettled(elementOf(`${diagram()}${diagram('data:image/png;base64,BBBB')}`), 500);
        expect(Date.now() - start).toBeLessThan(400);
    });

    it('resolves immediately for a diagram that failed to render', async () => {
        const root = elementOf('<div class="mermaid"><pre class="error">boom</pre></div>');
        const start = Date.now();
        await waitForPreviewSettled(root, 500);
        expect(Date.now() - start).toBeLessThan(400);
    });

    it('gives up after the timeout rather than hanging forever', async () => {
        // The <svg> has no cached PNG and no .error — never settles.
        const root = elementOf('<div class="mermaid"><svg></svg></div>');
        const start = Date.now();
        await waitForPreviewSettled(root, 250);
        expect(Date.now() - start).toBeGreaterThanOrEqual(200);
    });

    it('reports a timeout as still-pending diagrams, not as settled (REQ-LTTCE-XPT-00009)', async () => {
        // Regression (CI run 36260972990, 2026-09-26): the wait used to resolve
        // void on timeout, indistinguishable from success, so the export wrote
        // at most 2 of 4 diagrams and reported success. The result must say so.
        const root = elementOf(
            `${diagram()}<div class="mermaid"><svg></svg></div>`
            + `<div class="mermaid"><pre class="error">boom</pre></div>`
            + `<div class="mermaid"><svg></svg></div>`,
        );
        const result = await waitForPreviewSettled(root, 250);
        expect(result).toEqual({ pending: 2, failed: 0, total: 4, codePending: 0 });
    });

    it('reports nothing pending once every diagram settled', async () => {
        const result = await waitForPreviewSettled(elementOf(`${diagram()}${diagram()}`), 500);
        expect(result).toEqual({ pending: 0, failed: 0, total: 2, codePending: 0 });
    });

    it('reports an empty document as settled with zero diagrams', async () => {
        const result = await waitForPreviewSettled(elementOf('<p>plain text</p>'), 500);
        expect(result).toEqual({ pending: 0, failed: 0, total: 0, codePending: 0 });
    });

    it('resolves once a still-rendering diagram later gets its PNG', async () => {
        const root = elementOf('<div class="mermaid"><svg></svg></div>');
        const container = root.querySelector('.mermaid')!;
        setTimeout(() => container.setAttribute(DIAGRAM_PNG_ATTR, PNG), 150);

        const start = Date.now();
        const result = await waitForPreviewSettled(root, 5000);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(100);
        expect(elapsed).toBeLessThan(5000);
        expect(result.pending).toBe(0);
    });
});

// UTST for REQ-LTTCE-XPT-00010 — the wait ends on the diagrams' own state
// changes, never on a timer, and a diagram that cannot be rasterised is a
// final state rather than "still rendering".
describe('preview copy — settling is event-driven, not timed', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('settles on the PNG write alone, with every timer frozen', async () => {
        // Fake timers freeze setTimeout: a polling wait could never observe
        // the change and would hang here. The observer sees it as a microtask.
        vi.useFakeTimers();
        const root = elementOf('<div class="mermaid"><svg></svg></div>');
        document.body.appendChild(root);
        try {
            const wait = waitForPreviewSettled(root, 60_000);
            root.querySelector('.mermaid')!.setAttribute(DIAGRAM_PNG_ATTR, PNG);
            await expect(wait).resolves.toEqual({ pending: 0, failed: 0, total: 1, codePending: 0 });
        } finally {
            root.remove();
        }
    });

    it('settles on a render-error block appearing, with every timer frozen', async () => {
        vi.useFakeTimers();
        const root = elementOf('<div class="mermaid"><svg></svg></div>');
        const wait = waitForPreviewSettled(root, 60_000);
        root.querySelector('.mermaid')!.innerHTML = '<pre class="error">boom</pre>';
        await expect(wait).resolves.toEqual({ pending: 0, failed: 0, total: 1, codePending: 0 });
    });

    it('treats a rasterisation failure as final and reports it', async () => {
        vi.useFakeTimers();
        const root = elementOf(`${diagram()}<div class="mermaid"><svg></svg></div>`);
        const wait = waitForPreviewSettled(root, 60_000);
        root.querySelectorAll('.mermaid')[1].setAttribute(DIAGRAM_PNG_FAILED_ATTR, '');
        await expect(wait).resolves.toEqual({ pending: 0, failed: 1, total: 2, codePending: 0 });
    });

    it('reports an already-failed diagram without waiting at all', async () => {
        const root = elementOf(`<div class="mermaid" ${DIAGRAM_PNG_FAILED_ATTR}=""><svg></svg></div>`);
        await expect(waitForPreviewSettled(root, 60_000)).resolves.toEqual({ pending: 0, failed: 1, total: 1, codePending: 0 });
    });

    it('counts a PNG as settled even beside a stale failure mark', async () => {
        const root = elementOf(diagram(PNG, `${DIAGRAM_PNG_FAILED_ATTR}=""`));
        await expect(waitForPreviewSettled(root, 60_000)).resolves.toEqual({ pending: 0, failed: 0, total: 1, codePending: 0 });
    });

    it('keeps waiting while only some diagrams have settled', async () => {
        vi.useFakeTimers();
        const root = elementOf('<div class="mermaid"><svg></svg></div><div class="mermaid"><svg></svg></div>');
        const [first, second] = Array.from(root.querySelectorAll('.mermaid'));
        let settled = false;
        const wait = waitForPreviewSettled(root, 60_000).then((r) => { settled = true; return r; });

        first.setAttribute(DIAGRAM_PNG_ATTR, PNG);
        await Promise.resolve(); await Promise.resolve();
        expect(settled).toBe(false);

        second.setAttribute(DIAGRAM_PNG_ATTR, PNG);
        await expect(wait).resolves.toEqual({ pending: 0, failed: 0, total: 2, codePending: 0 });
    });

    it('still ends on the backstop when nothing ever changes', async () => {
        vi.useFakeTimers();
        const root = elementOf('<div class="mermaid"><svg></svg></div>');
        const wait = waitForPreviewSettled(root, 60_000);
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(wait).resolves.toEqual({ pending: 1, failed: 0, total: 1, codePending: 0 });
    });
});

// UTST for REQ-LTTCE-XPT-00009 — an export whose diagrams did not all settle
// must fail with a message that names what was missing and the elapsed budget.
describe('preview copy — unsettled diagrams are an export failure', () => {

    it('returns null when every diagram settled', () => {
        expect(describeUnsettledPreview({ pending: 0, failed: 0, total: 5, codePending: 0 }, 40_000)).toBeNull();
        expect(describeUnsettledPreview({ pending: 0, failed: 0, total: 0, codePending: 0 }, 40_000)).toBeNull();
    });

    it('names the missing count, the total and the budget in seconds', () => {
        const msg = describeUnsettledPreview({ pending: 3, failed: 0, total: 5, codePending: 0 }, 85_000);
        expect(msg).toContain('3 of 5');
        expect(msg).toContain('85s');
        expect(msg).toContain('incomplete');
    });

    it('reports a rasterisation failure as its own cause, not as a budget overrun (REQ-LTTCE-XPT-00010)', () => {
        const msg = describeUnsettledPreview({ pending: 0, failed: 1, total: 4, codePending: 0 }, 80_000);
        expect(msg).toContain('1 of 4');
        expect(msg).toContain('could not be converted to an image');
        expect(msg).not.toContain('80s');
    });

    it('names the failure even while other diagrams are still pending', () => {
        const msg = describeUnsettledPreview({ pending: 2, failed: 1, total: 4, codePending: 0 }, 80_000);
        expect(msg).toContain('could not be converted to an image');
    });

    it('accepts the budget Rust sends and falls back for anything else', () => {
        expect(resolveSettleTimeout(40_000)).toBe(40_000);
        for (const bad of [undefined, null, 0, -1, NaN, Infinity, '40000', {}]) {
            expect(resolveSettleTimeout(bad)).toBe(DEFAULT_SETTLE_TIMEOUT_MS);
        }
    });
});

// UTST for REQ-LTTCE-XPT-00014 — an export also waits for every code block's
// syntax highlighting: a document with no diagrams used to settle at once and
// could be written while its code was still plain text.
describe('preview copy — the settle wait covers code highlighting', () => {
    afterEach(() => { vi.useRealTimers(); });

    const pendingCode = `<pre><code ${HIGHLIGHT_PENDING_ATTR}="">fn main() {}</code></pre>`;

    it('waits for a pending code block even with no diagram in the document', async () => {
        vi.useFakeTimers();
        const root = elementOf(pendingCode);
        let settled = false;
        const wait = waitForPreviewSettled(root, 60_000).then((r) => { settled = true; return r; });
        await Promise.resolve(); await Promise.resolve();
        expect(settled).toBe(false);

        root.querySelector('code')!.removeAttribute(HIGHLIGHT_PENDING_ATTR);
        await expect(wait).resolves.toEqual({ pending: 0, failed: 0, total: 0, codePending: 0 });
    });

    it('needs both: diagrams settled and code highlighted', async () => {
        vi.useFakeTimers();
        const root = elementOf(`<div class="mermaid"><svg></svg></div>${pendingCode}`);
        let settled = false;
        const wait = waitForPreviewSettled(root, 60_000).then((r) => { settled = true; return r; });

        root.querySelector('code')!.removeAttribute(HIGHLIGHT_PENDING_ATTR);
        await Promise.resolve(); await Promise.resolve();
        expect(settled).toBe(false);

        root.querySelector('.mermaid')!.setAttribute(DIAGRAM_PNG_ATTR, PNG);
        await expect(wait).resolves.toEqual({ pending: 0, failed: 0, total: 1, codePending: 0 });
    });

    it('reports code still pending at the backstop', async () => {
        vi.useFakeTimers();
        const wait = waitForPreviewSettled(elementOf(pendingCode + pendingCode), 60_000);
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(wait).resolves.toEqual({ pending: 0, failed: 0, total: 0, codePending: 2 });
    });

    it('turns unhighlighted code into an export failure naming the count and budget', () => {
        const msg = describeUnsettledPreview({ pending: 0, failed: 0, total: 0, codePending: 2 }, 80_000);
        expect(msg).toContain('2 code block(s)');
        expect(msg).toContain('80s');
        expect(msg).toContain('incomplete');
    });

    it('names pending diagrams first when both are missing', () => {
        const msg = describeUnsettledPreview({ pending: 1, failed: 0, total: 2, codePending: 3 }, 80_000);
        expect(msg).toContain('1 of 2 diagram(s)');
    });
});
