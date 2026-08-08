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
 * IMPL-LTTCE-MRC-00001 — SVG → PNG rasterisation, via the WebView's own image
 * decoder and canvas.
 *
 * Kept in its own module, and as small as it can be, because it is the one
 * piece of the diagram-copy feature that **cannot be unit-tested**: jsdom has
 * no layout engine, no SVG rasteriser and no canvas. Everything decidable is
 * in `preview-copy.ts`, which is fully covered; this file is the irreducible
 * browser dependency and is exercised by hand (and by the E2E build).
 *
 * Rasterising in Rust instead would mean adding an SVG renderer crate — a
 * heavy new dependency for something the WebView already does natively, and
 * one that would then have to match the WebView's font and layout decisions
 * to produce the picture the user actually saw. The general "pure logic goes
 * to Rust" preference does not apply to work whose whole point is to capture
 * what the browser rendered.
 */

/** Raster scale. 2× keeps text crisp when the paste target scales the image. */
const RASTER_SCALE = 2;

/** Upper bound on either raster dimension, so a huge diagram cannot blow up
 *  the clipboard payload (a data URI is ~4/3 the size of the raw PNG). */
const MAX_RASTER_PX = 4000;


//******************************************************************************
// svgIntrinsicSize
//******************************************************************************
/**
 * On-screen size of `svg` in CSS pixels.
 *
 * Mermaid emits a `viewBox` plus a `max-width` style rather than width/height
 * attributes, so the laid-out box is the honest answer; the `viewBox` is the
 * fallback for an SVG that has not been laid out (or is hidden).
 */
export function svgIntrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
    const rect = svg.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
    }

    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] };
        }
    }

    return { width: 0, height: 0 };
} // svgIntrinsicSize END ******************************************************


//******************************************************************************
// rasterizeSvg
//******************************************************************************
/**
 * Render `svg` to a PNG data URI at {@link RASTER_SCALE}, or `null` if it
 * cannot be done.
 *
 * `background` is painted first: a diagram is drawn on transparency, and paste
 * targets that do not composite alpha (Word among them) show transparency as
 * black. Passing the preview pane's own background keeps the picture looking
 * like the one on screen in both themes.
 *
 * Failure is always benign: the caller simply does not cache a PNG for that
 * diagram, and a copy containing it falls back to today's behaviour.
 *
 * The SVG is serialised and handed to the decoder as a `data:` URL rather than
 * an object URL — no lifetime to manage, and nothing to leak if the promise is
 * abandoned. A Mermaid SVG is self-contained (its CSS lives in an internal
 * `<style>` element), so the canvas is never tainted and `toDataURL` succeeds.
 */
export async function rasterizeSvg(
    svg: SVGSVGElement,
    background: string,
    size?: { width: number; height: number },
): Promise<string | null> {
    try {
        // `size` is for SVGs that were never laid out — an off-screen copy has
        // no box to measure, so the caller passes the on-screen one's.
        const { width, height } = size ?? svgIntrinsicSize(svg);
        if (width <= 0 || height <= 0) return null;

        const scale = Math.min(
            RASTER_SCALE,
            MAX_RASTER_PX / width,
            MAX_RASTER_PX / height,
        );

        // Serialise a clone carrying explicit dimensions: without them the
        // decoder has to guess, and guesses differently per platform.
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const markup = new XMLSerializer().serializeToString(clone);
        const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);

        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('SVG decode failed'));
            img.src = source;
        });

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL('image/png');
    } catch (err) {
        console.error('Diagram rasterisation failed', err);
        return null;
    }
} // rasterizeSvg END **********************************************************
