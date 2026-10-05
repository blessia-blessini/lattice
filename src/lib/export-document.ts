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
 * IMPL-LTTCE-XPT-00008 — REQ-LTTCE-XPT-00013 — wraps the serialised preview
 * of an `--export-html` run in a complete, self-contained HTML document.
 *
 * KaTeX writes every formula twice: a MathML copy for screen readers
 * (`.katex-mathml`) and the visible HTML/SVG layout (`.katex-html`). Its
 * stylesheet is what hides the first and lays out the second — including
 * clipping the 400em-wide SVG a `\sqrt` bar is drawn with. Without that sheet
 * a browser shows the formula twice, the second copy as a garbled line of
 * text, and every root bar as a rule across the whole page (v0.3.32 demo
 * export). The preview has the sheet because `App.tsx` imports it; a file on
 * disk has nothing but what is written into it.
 *
 * So the sheet goes in, with its fonts as `data:` URLs: the file must render
 * offline and must not make a viewer's browser fetch anything. Only the woff2
 * fonts are embedded — every browser that renders KaTeX reads woff2 — and the
 * woff/ttf fallbacks in KaTeX's `src:` lists are dropped, since a relative
 * `fonts/...` URL would point nowhere beside an exported file.
 *
 * This module carries ~350 KB of font data, so `App.tsx` loads it with a
 * dynamic `import()` on the export path only; an interactive launch never
 * parses it.
 */

import katexCss from 'katex/dist/katex.min.css?raw';

/**
 * The woff2 fonts KaTeX ships, as `data:` URLs, keyed by Vite with their
 * project-root path (`/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2`).
 * `exhaustive` is needed for a glob inside `node_modules`; the scan is confined
 * to the static prefix, one directory of 20 files.
 */
const KATEX_WOFF2_DATA_URLS = import.meta.glob<string>(
    '/node_modules/katex/dist/fonts/*.woff2',
    { query: '?url&inline', import: 'default', eager: true, exhaustive: true },
);

/**
 * One `src:` declaration of a KaTeX `@font-face` rule: the woff2 URL (group 1
 * is the font's base name) followed by its woff/ttf fallbacks, up to the `;`
 * or `}` that ends the declaration.
 */
const KATEX_FONT_SRC_RE = /src:\s*url\(\s*["']?fonts\/([\w-]+)\.woff2["']?\s*\)\s*format\(\s*["']woff2["']\s*\)[^;}]*/g;


//******************************************************************************
// fontDataUrlsByName
//******************************************************************************
/**
 * Re-keys Vite's glob result by bare font name (`KaTeX_Main-Regular`), the
 * form KaTeX's stylesheet refers to them by.
 */
export function fontDataUrlsByName(globbed: Record<string, string>): Map<string, string> {
    const byName = new Map<string, string>();
    for (const [path, url] of Object.entries(globbed)) {
        const base = path.split('/').pop() ?? '';
        byName.set(base.replace(/\.woff2$/, ''), url);
    }
    return byName;
} // fontDataUrlsByName END ****************************************************


//******************************************************************************
// inlineKatexFonts
//******************************************************************************
/**
 * Rewrites every `@font-face` `src:` of KaTeX's stylesheet to the embedded
 * woff2 `data:` URL of that font, dropping the woff/ttf fallbacks.
 *
 * Throws when the sheet names a font that is not embedded. The sheet and the
 * fonts come from the same package at build time, so this cannot happen in a
 * consistent build — and if a KaTeX upgrade ever makes it happen, the export
 * fails loudly (REQ-LTTCE-XPT-00003) instead of writing a file that silently
 * falls back to the reader's system fonts.
 */
export function inlineKatexFonts(css: string, fonts: ReadonlyMap<string, string>): string {
    return css.replace(KATEX_FONT_SRC_RE, (_match, name: string) => {
        const url = fonts.get(name);
        if (!url) {
            throw new Error(`KaTeX font ${name}.woff2 is not embedded — cannot build a self-contained export`);
        }
        return `src:url(${url}) format("woff2")`;
    });
} // inlineKatexFonts END ******************************************************


//******************************************************************************
// escapeHtmlText
//******************************************************************************
/**
 * Escapes text for an HTML text node (here: `<title>`). A file name may hold
 * `&` or `<`, which must not open an entity or a tag in the exported head.
 */
export function escapeHtmlText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
} // escapeHtmlText END ********************************************************


/** KaTeX's stylesheet with its fonts embedded — built once, on first export. */
let g_exportCss: string | null = null;


//******************************************************************************
// exportStylesheet
//******************************************************************************
/**
 * The stylesheet every exported document carries: KaTeX's, fonts embedded.
 */
export function exportStylesheet(): string {
    if (g_exportCss === null) {
        g_exportCss = inlineKatexFonts(katexCss, fontDataUrlsByName(KATEX_WOFF2_DATA_URLS));
    }
    return g_exportCss;
} // exportStylesheet END ******************************************************


//******************************************************************************
// buildExportDocument
//******************************************************************************
/**
 * IMPL-LTTCE-XPT-00008 — REQ-LTTCE-XPT-00013 — the complete file
 * `--export-html` writes: `bodyHtml` (the preview, exactly as
 * `buildExportHtml` serialised it — REQ-LTTCE-XPT-00001) inside a document
 * whose head declares UTF-8, names it `title` and carries
 * `exportStylesheet()`.
 *
 * @param bodyHtml the serialised preview, placed in `<body>` unchanged
 * @param title    the document title, normally the source file name
 */
export function buildExportDocument(bodyHtml: string, title: string): string {
    return '<!DOCTYPE html>\n'
        + '<html>\n'
        + '<head>\n'
        + '<meta charset="utf-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + `<title>${escapeHtmlText(title)}</title>\n`
        + `<style>\n${exportStylesheet()}\n</style>\n`
        + '</head>\n'
        + '<body>\n'
        + bodyHtml
        + '\n</body>\n'
        + '</html>\n';
} // buildExportDocument END ***************************************************
