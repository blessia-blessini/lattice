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
 * REQ-LTTCE-XPT-00014 — the same holds for everything else the preview styles:
 * code blocks are highlighted as `<span class="tok-…">` tokens whose colours
 * are CSS rules scoped to `.markdown-body[data-theme]`, and headings, tables and
 * code blocks take their look from github-markdown-css. So the document also
 * carries github-markdown-css and `preview-theme.css` — the very files the
 * preview loads — and wraps the body in a `.markdown-body` element with the
 * preview's theme, so those rules match exactly as they do in the pane.
 *
 * This module carries ~350 KB of font data, so `App.tsx` loads it with a
 * dynamic `import()` on the export path only; an interactive launch never
 * parses it.
 */

import katexCss from 'katex/dist/katex.min.css?raw';
import githubMarkdownCss from 'github-markdown-css/github-markdown.css?raw';
import previewThemeCss from '../preview-theme.css?raw';
import { PREVIEW_THEME_COLORS, type PreviewTheme } from './preview-theme';

/**
 * The woff2 fonts KaTeX ships, as `data:` URLs, keyed by Vite with their
 * project-root path (`/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2`).
 * `exhaustive` is needed for a glob inside `node_modules`; the scan is confined
 * to the static prefix, one directory of 20 files.
 *
 * The pattern is anchored at the Vite root, because a glob cannot follow
 * Node's package resolution: were `katex` ever hoisted to a parent
 * `node_modules` (a workspace layout), it would match nothing. That cannot pass
 * unnoticed — `inlineKatexFonts` throws for the first font the sheet names, so
 * the unit tests fail in the build gate and an export fails loudly.
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
        // Vite writes keys with '/', but split on both separators anyway, as
        // `printTitleFor` does: a backslash key must not yield a whole path.
        const base = path.split(/[\\/]/).pop() ?? '';
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


//******************************************************************************
// resolveExportTheme
//******************************************************************************
/**
 * The preview theme to export with, from the preview root's `data-theme`.
 * Anything but `dark` — absent, empty, unknown — is `light`, the theme the
 * preview itself starts in, so a malformed value can never select no theme.
 */
export function resolveExportTheme(raw: string | null | undefined): PreviewTheme {
    return raw === 'dark' ? 'dark' : 'light';
} // resolveExportTheme END ****************************************************


//******************************************************************************
// exportPageCss
//******************************************************************************
/**
 * Page layout around the `.markdown-body` article: the page takes the theme's
 * background (`PREVIEW_THEME_COLORS`, the value the preview pane paints), and
 * the article is a centred reading column — github-markdown-css's own
 * recommended frame, which the app does not need because the pane frames it.
 */
export function exportPageCss(theme: PreviewTheme): string {
    return `body { margin: 0; background-color: ${PREVIEW_THEME_COLORS[theme].backgroundColor}; }\n`
        + '.markdown-body { box-sizing: border-box; min-width: 200px; max-width: 980px;'
        + ' margin: 0 auto; padding: 45px; }\n'
        + '@media (max-width: 767px) { .markdown-body { padding: 15px; } }';
} // exportPageCss END *********************************************************


//******************************************************************************
// joinStylesheets
//******************************************************************************
/**
 * Joins stylesheets for one `<style>` element, in the order given.
 *
 * Throws if any contains `</style` — it would end the element early and spill
 * the rest into the body. None of the shipped sheets does; the guard keeps a
 * future dependency update from silently doing so.
 */
export function joinStylesheets(sheets: readonly string[]): string {
    const css = sheets.join('\n');
    if (/<\/style/i.test(css)) {
        throw new Error('an embedded stylesheet contains "</style" — cannot place it in a <style> element');
    }
    return css;
} // joinStylesheets END *******************************************************


/** The theme-independent stylesheets with fonts embedded — built once, on first export. */
let g_exportCss: string | null = null;


//******************************************************************************
// exportStylesheet
//******************************************************************************
/**
 * The stylesheets every exported document carries, in the order `App.tsx`
 * imports them, so equal-specificity rules resolve as they do in the preview:
 * the preview theme with the code-token palette, KaTeX's with its fonts
 * embedded, then github-markdown-css.
 */
export function exportStylesheet(): string {
    if (g_exportCss === null) {
        const katex = inlineKatexFonts(katexCss, fontDataUrlsByName(KATEX_WOFF2_DATA_URLS));
        g_exportCss = joinStylesheets([previewThemeCss, katex, githubMarkdownCss]);
    }
    return g_exportCss;
} // exportStylesheet END ******************************************************


//******************************************************************************
// buildExportDocument
//******************************************************************************
/**
 * IMPL-LTTCE-XPT-00008 — REQ-LTTCE-XPT-00013 / 00014 — the complete file
 * `--export-html` writes: `bodyHtml` (the preview, exactly as
 * `buildExportHtml` serialised it — REQ-LTTCE-XPT-00001) inside an
 * `<article class="markdown-body" data-theme>` — the class and attribute the
 * preview root carries, which every preview style rule is scoped to — in a
 * document whose head declares UTF-8, names it `title` and carries
 * `exportStylesheet()` and `exportPageCss(theme)`.
 *
 * @param bodyHtml the serialised preview, placed in the article unchanged
 * @param title    the document title, normally the source file name
 * @param theme    the preview theme the document is styled in
 */
export function buildExportDocument(bodyHtml: string, title: string, theme: PreviewTheme): string {
    return '<!DOCTYPE html>\n'
        + '<html>\n'
        + '<head>\n'
        + '<meta charset="utf-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + `<title>${escapeHtmlText(title)}</title>\n`
        + `<style>\n${exportStylesheet()}\n${exportPageCss(theme)}\n</style>\n`
        + '</head>\n'
        + '<body>\n'
        + `<article class="markdown-body" data-theme="${theme}">\n`
        + bodyHtml
        + '\n</article>\n'
        + '</body>\n'
        + '</html>\n';
} // buildExportDocument END ***************************************************
