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

/** Alt text given to the substituted image. */
const DIAGRAM_ALT = 'Mermaid diagram';


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
        if (!png) return;

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
