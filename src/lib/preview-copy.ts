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
 * IMPL-LTTCE-MRC-00002 — preview-pane copy: carrying Mermaid diagrams across
 * the clipboard.
 *
 * A rendered diagram is an inline `<svg>` in the preview. The WebView happily
 * puts that markup in the clipboard's `text/html` flavour — and then nearly
 * every receiving application drops it, because inline SVG in pasted HTML is
 * not something Word, Outlook, Gmail or Slack render. The user sees a hole
 * where the picture was. There is no image flavour on the clipboard either, so
 * applications that paste pictures have nothing to work with at all.
 *
 * The fix is to hand those applications a raster image instead: each diagram
 * is rasterised to a PNG when it renders (see `svg-raster.ts`, and the
 * `Mermaid` component that caches the result on the container), and a copy of
 * the selection has every diagram swapped for an `<img src="data:image/png…">`
 * before it reaches the clipboard.
 *
 * **Interception is deliberately narrow.** REQ-LTTCE-CPY-00001 guarantees that
 * `==highlight==` survives a copy into legacy HTML readers *without* the
 * application touching clipboard events — the colour rides along as an inline
 * style, through whichever copy path the WebView offers. A selection with no
 * diagram in it is therefore left entirely alone: no `preventDefault`, no
 * rewriting, the native path exactly as before. Only a selection that actually
 * contains a diagram is rewritten, and then by cloning the live nodes — inline
 * styles and all — so the highlight guarantee still holds by construction.
 */

/**
 * Attribute holding a diagram's cached PNG data URI.
 *
 * Written by the `Mermaid` component onto the container element, read here.
 * Shared through this module so the two sides cannot drift apart.
 */
export const DIAGRAM_PNG_ATTR = 'data-lattice-diagram-png';

/**
 * Attribute marking a diagram whose PNG could not be produced (the SVG had no
 * size, would not decode, or no canvas was available).
 *
 * REQ-LTTCE-XPT-00010 — without it such a diagram had neither a PNG nor an
 * error block and looked "still rendering" forever, so only a timeout could
 * end an export's wait. Written by `Mermaid.tsx`, read here.
 */
export const DIAGRAM_PNG_FAILED_ATTR = 'data-lattice-diagram-png-failed';

/**
 * Attribute on `<html>` marking a headless export window (value: the export
 * format). Set by `App.tsx` before the document loads; read by `Mermaid.tsx`
 * to rasterise at once instead of in an idle slot (REQ-LTTCE-XPT-00010).
 */
export const EXPORT_MODE_ATTR = 'data-lattice-export';

/**
 * Attribute on a code block's `<code>` while the parser for its language is
 * still loading, so its syntax highlighting has not been applied yet.
 *
 * REQ-LTTCE-XPT-00014 — highlighting is asynchronous (each language parser is
 * loaded lazily), so an export that does not wait for it can write plain,
 * uncoloured code: a document without diagrams settles at once. Written by
 * `HighlightedCode.tsx` and removed once the load resolves — highlighted,
 * unknown language or failed load alike, so it can never stay forever.
 */
export const HIGHLIGHT_PENDING_ATTR = 'data-lattice-highlight-pending';

/** Alt text given to the substituted image. */
const DIAGRAM_ALT = 'Mermaid diagram';

/**
 * Accept only PNG data URIs produced by our raster path.
 * This prevents reinterpreting arbitrary DOM text as HTML-bearing URL content.
 */
function isSafePngDataUri(value: string): boolean {
    return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}


//******************************************************************************
// fragmentHasDiagram
//******************************************************************************
/**
 * Does this cloned selection contain at least one diagram we can substitute?
 *
 * Answering `false` is the signal to leave the copy alone entirely — see the
 * note on narrow interception above.
 */
export function fragmentHasDiagram(fragment: DocumentFragment): boolean {
    return fragment.querySelector(`[${DIAGRAM_PNG_ATTR}]`) !== null;
}
// fragmentHasDiagram END ******************************************************


//******************************************************************************
// substituteDiagrams
//******************************************************************************
/**
 * Replace every diagram container in `fragment` with an `<img>` carrying the
 * cached PNG. Mutates the fragment (it is a throw-away clone) and returns the
 * number of substitutions made.
 *
 * The image keeps the diagram's on-screen size in CSS pixels so it pastes at
 * the size the user saw, independent of the raster scale factor.
 */
export function substituteDiagrams(fragment: DocumentFragment): number {
    const containers = fragment.querySelectorAll(`[${DIAGRAM_PNG_ATTR}]`);
    let count = 0;

    containers.forEach((container) => {
        const png = container.getAttribute(DIAGRAM_PNG_ATTR);
        if (!png || !isSafePngDataUri(png)) return;

        const img = container.ownerDocument.createElement('img');
        img.setAttribute('src', png);
        img.setAttribute('alt', DIAGRAM_ALT);

        // Width/height come from the source SVG when it recorded them; without
        // them a high-DPI raster would paste at twice its on-screen size.
        const width = container.getAttribute('data-lattice-diagram-width');
        const height = container.getAttribute('data-lattice-diagram-height');
        if (width) img.setAttribute('width', width);
        if (height) img.setAttribute('height', height);

        container.replaceWith(img);
        count++;
    });

    return count;
} // substituteDiagrams END ****************************************************


//******************************************************************************
// buildCopyHtml
//******************************************************************************
/**
 * Serialise a cloned selection to the HTML that should go on the clipboard,
 * with diagrams already substituted. Returns `null` when the selection holds
 * no diagram — the caller must then not intercept the copy at all.
 */
export function buildCopyHtml(fragment: DocumentFragment): string | null {
    if (!fragmentHasDiagram(fragment)) return null;
    if (substituteDiagrams(fragment) === 0) return null;

    const host = fragment.ownerDocument.createElement('div');
    host.appendChild(fragment);
    return host.innerHTML;
} // buildCopyHtml END *********************************************************


/** Settle budget used when the caller supplies none (e.g. an export window
 *  launched by an older backend that does not send `exportSettleMs`). */
export const DEFAULT_SETTLE_TIMEOUT_MS = 8000;

/** Outcome of `waitForPreviewSettled`, out of `total` diagrams:
 *  `pending` had reached no final state when the wait ended; `failed` had
 *  reached one, but it is "could not be rasterised" (`DIAGRAM_PNG_FAILED_ATTR`).
 *  `codePending` code blocks were still waiting for their highlighting
 *  (`HIGHLIGHT_PENDING_ATTR`). */
export interface PreviewSettleResult {
    pending: number;
    failed: number;
    total: number;
    codePending: number;
}


//******************************************************************************
// waitForPreviewSettled
//******************************************************************************
/**
 * IMPL-LTTCE-XPT-00001 — REQ-LTTCE-XPT-00001 / 00009 / 00010 / 00014 — waits until every diagram
 * container currently under `root` has reached a final state: its cached PNG
 * (`DIAGRAM_PNG_ATTR`, written by `Mermaid.tsx`), a render error (an `.error`
 * block in its place), or a rasterisation failure (`DIAGRAM_PNG_FAILED_ATTR`) —
 * and every code block has its highlighting (no `HIGHLIGHT_PENDING_ATTR` left,
 * REQ-LTTCE-XPT-00014). The export below therefore never fires while a diagram
 * is still an unrasterised `<svg>` or a code block is still plain text.
 *
 * Event-driven (REQ-LTTCE-XPT-00010): a `MutationObserver` re-checks whenever
 * one of those attributes or the subtree changes, so the wait ends the moment
 * the last diagram settles. It used to poll on a 100 ms `setTimeout`, and a
 * timer is exactly what WebKit throttles in a hidden page — the export window
 * is one. Observer callbacks are microtasks and are not throttled.
 *
 * `timeoutMs` remains only as a backstop against a renderer that never answers
 * at all; it is never the normal way out. When it fires the result *reports*
 * what was still pending rather than resolving as though all were done —
 * treating a timeout as success is what let an export write at most 2 of 4
 * diagrams and exit 0 (REQ-LTTCE-XPT-00009). The caller decides, via
 * `describeUnsettledPreview`, whether a result is a failure.
 */
export async function waitForPreviewSettled(
    root: Element,
    timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
): Promise<PreviewSettleResult> {
    const count = (): PreviewSettleResult => {
        const diagrams = Array.from(root.querySelectorAll('.mermaid'));
        let pending = 0;
        let failed = 0;
        for (const el of diagrams) {
            if (el.hasAttribute(DIAGRAM_PNG_ATTR) || el.querySelector('pre.error') !== null) continue;
            if (el.hasAttribute(DIAGRAM_PNG_FAILED_ATTR)) failed += 1;
            else pending += 1;
        }
        const codePending = root.querySelectorAll(`[${HIGHLIGHT_PENDING_ATTR}]`).length;
        return { pending, failed, total: diagrams.length, codePending };
    };
    const settled = (r: PreviewSettleResult) => r.pending === 0 && r.codePending === 0;

    const initial = count();
    if (settled(initial)) return initial;

    return new Promise<PreviewSettleResult>((resolve) => {
        let backstop: ReturnType<typeof setTimeout> | undefined;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            observer.disconnect();
            clearTimeout(backstop);
            resolve(count());
        };
        // Observing starts synchronously after `initial`, so no change can
        // slip in between the first count and the first callback.
        const observer = new MutationObserver(() => {
            if (settled(count())) finish();
        });
        observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [DIAGRAM_PNG_ATTR, DIAGRAM_PNG_FAILED_ATTR, HIGHLIGHT_PENDING_ATTR],
        });
        backstop = setTimeout(finish, timeoutMs);
    });
} // waitForPreviewSettled END ************************************************


//******************************************************************************
// resolveSettleTimeout
//******************************************************************************
/**
 * IMPL-LTTCE-XPT-00001 — REQ-LTTCE-XPT-00009 — validates the settle budget
 * Rust hands over in `__LATTICE_INIT_DATA__.exportSettleMs`. Anything that is
 * not a positive, finite number of milliseconds (absent, `null`, a string,
 * `NaN`) falls back to `DEFAULT_SETTLE_TIMEOUT_MS` rather than turning into a
 * zero-length or endless wait.
 */
export function resolveSettleTimeout(raw: unknown): number {
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
        ? raw
        : DEFAULT_SETTLE_TIMEOUT_MS;
} // resolveSettleTimeout END **************************************************


//******************************************************************************
// describeUnsettledPreview
//******************************************************************************
/**
 * IMPL-LTTCE-XPT-00001 — REQ-LTTCE-XPT-00009 / 00010 — turns a settle result into the
 * failure message an export must report, or `null` when every diagram
 * settled. The message names how many diagrams were missing and the budget
 * that elapsed, so "renderer too slow" can be told apart from "budget too
 * tight" in a log (the same reasoning as REQ-LTTCE-XPT-00008).
 */
export function describeUnsettledPreview(
    result: PreviewSettleResult,
    timeoutMs: number,
): string | null {
    // REQ-LTTCE-XPT-00010 — checked first: a rasterisation failure is known
    // the moment it happens and names its own cause; it must not be reported
    // as though the budget had run out.
    if (result.failed > 0) {
        return `${result.failed} of ${result.total} diagram(s) could not be converted to an image `
            + `— refusing to export an incomplete document`;
    }
    const seconds = Math.round(timeoutMs / 1000);
    if (result.pending > 0) {
        return `${result.pending} of ${result.total} diagram(s) had not finished rendering after `
            + `${seconds}s — refusing to export an incomplete document`;
    }
    // REQ-LTTCE-XPT-00014 — uncoloured code is an incomplete document too.
    if (result.codePending > 0) {
        return `${result.codePending} code block(s) had not been syntax-highlighted after `
            + `${seconds}s — refusing to export an incomplete document`;
    }
    return null;
} // describeUnsettledPreview END *********************************************


//******************************************************************************
// buildExportHtml
//******************************************************************************
/**
 * REQ-LTTCE-XPT-00001 — serialises the *whole* rendered preview (`root`,
 * normally the `.preview-pane__body` node) to the same HTML a clipboard copy
 * of the whole document would carry: diagrams substituted for their cached
 * PNG exactly as `buildCopyHtml` does for a selection, everything else
 * (inline highlight styling per REQ-LTTCE-CPY-00001, syntax highlighting,
 * tables) left as the WebView rendered it.
 *
 * Unlike `buildCopyHtml`, this never returns `null` for a diagram-free
 * document — a whole-document export is always wanted, where a clipboard
 * interception is deliberately opt-in (REQ-LTTCE-MRC-00003).
 */
export function buildExportHtml(root: Element): string {
    const clone = root.cloneNode(true) as HTMLElement;
    const fragment = clone.ownerDocument.createDocumentFragment();
    fragment.appendChild(clone);
    substituteDiagrams(fragment);
    return clone.innerHTML;
} // buildExportHtml END *******************************************************
