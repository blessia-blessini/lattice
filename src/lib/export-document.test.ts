// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// UTST for IMPL-LTTCE-XPT-00008 — REQ-LTTCE-XPT-00013. The stylesheet tests
// run against the KaTeX sheet and fonts this build actually bundles, so a
// KaTeX upgrade that adds, renames or re-quotes a font fails here, not in a
// user's browser.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    buildExportDocument,
    escapeHtmlText,
    exportPageCss,
    exportStylesheet,
    fontDataUrlsByName,
    inlineKatexFonts,
    joinStylesheets,
    resolveExportTheme,
} from './export-document';
import { PREVIEW_THEME_COLORS } from './preview-theme';

/** KaTeX's stylesheet as shipped, read straight from the package. */
const SHIPPED_KATEX_CSS = readFileSync(
    resolve(__dirname, '../../node_modules/katex/dist/katex.min.css'),
    'utf8',
);

/** The preview's own stylesheets, read straight from disk. */
const PREVIEW_THEME_CSS = readFileSync(resolve(__dirname, '../preview-theme.css'), 'utf8');
const GITHUB_MARKDOWN_CSS = readFileSync(
    resolve(__dirname, '../../node_modules/github-markdown-css/github-markdown.css'),
    'utf8',
);

/** Every font the shipped sheet names in a woff2 `url(...)`. */
const FONTS_NAMED_BY_SHEET = [...SHIPPED_KATEX_CSS.matchAll(/fonts\/([\w-]+)\.woff2/g)].map((m) => m[1]);

describe('exportStylesheet (the bundled KaTeX sheet)', () => {
    const css = exportStylesheet();

    it('keeps the rule that hides the MathML copy — otherwise every formula shows twice', () => {
        expect(css).toMatch(/\.katex \.katex-mathml\{[^}]*position:absolute/);
    });

    it('keeps the rule that clips root-bar SVGs — otherwise \\sqrt draws a line across the page', () => {
        expect(css).toMatch(/\.katex \.hide-tail\{[^}]*overflow:hidden/);
    });

    it('embeds every font the sheet names, and leaves no relative font URL behind', () => {
        expect(FONTS_NAMED_BY_SHEET.length).toBeGreaterThan(0);
        const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
        expect(faces).toHaveLength(FONTS_NAMED_BY_SHEET.length);
        for (const face of faces) {
            expect(face).toMatch(/src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)/);
        }
        expect(css).not.toMatch(/url\(\s*["']?fonts\//);
        expect(css).not.toContain('.woff)');
        expect(css).not.toContain('.ttf)');
    });

    it('is built once and reused', () => {
        expect(exportStylesheet()).toBe(css);
    });
});

describe('fontDataUrlsByName', () => {
    it('keys Vite glob results by bare font name', () => {
        const byName = fontDataUrlsByName({
            '/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2': 'data:a',
            '/node_modules/katex/dist/fonts/KaTeX_AMS-Regular.woff2': 'data:b',
        });
        expect(byName.get('KaTeX_Main-Regular')).toBe('data:a');
        expect(byName.get('KaTeX_AMS-Regular')).toBe('data:b');
        expect(byName.size).toBe(2);
    });

    it('takes the bare name from a backslash-separated key too', () => {
        const byName = fontDataUrlsByName({ 'C:\\katex\\fonts\\KaTeX_Main-Bold.woff2': 'data:c' });
        expect([...byName.keys()]).toEqual(['KaTeX_Main-Bold']);
    });

    it('returns an empty map for an empty glob', () => {
        expect(fontDataUrlsByName({}).size).toBe(0);
    });
});

describe('inlineKatexFonts', () => {
    const FONTS = new Map([['KaTeX_X-Regular', 'data:font/woff2;base64,AAAA']]);

    it('replaces the whole src list with the embedded woff2 and keeps the rest of the rule', () => {
        const css = '@font-face{font-family:KaTeX_X;src:url(fonts/KaTeX_X-Regular.woff2) format("woff2"),'
            + 'url(fonts/KaTeX_X-Regular.woff) format("woff"),url(fonts/KaTeX_X-Regular.ttf) format("truetype")}'
            + '.katex{font:normal 1.21em KaTeX_Main}';
        expect(inlineKatexFonts(css, FONTS)).toBe(
            '@font-face{font-family:KaTeX_X;src:url(data:font/woff2;base64,AAAA) format("woff2")}'
            + '.katex{font:normal 1.21em KaTeX_Main}',
        );
    });

    it('stops at the semicolon that ends the src declaration', () => {
        const css = '@font-face{src:url(fonts/KaTeX_X-Regular.woff2) format("woff2"),url(x.woff) format("woff");font-style:normal}';
        expect(inlineKatexFonts(css, FONTS)).toBe(
            '@font-face{src:url(data:font/woff2;base64,AAAA) format("woff2");font-style:normal}',
        );
    });

    it('accepts quoted URLs and formats, as an unminified sheet writes them', () => {
        const css = "@font-face{src: url('fonts/KaTeX_X-Regular.woff2') format('woff2')}";
        expect(inlineKatexFonts(css, FONTS)).toBe(
            '@font-face{src:url(data:font/woff2;base64,AAAA) format("woff2")}',
        );
    });

    it('fails loudly for a font that is not embedded', () => {
        const css = '@font-face{src:url(fonts/KaTeX_Y-Bold.woff2) format("woff2")}';
        expect(() => inlineKatexFonts(css, FONTS)).toThrow(/KaTeX_Y-Bold\.woff2 is not embedded/);
    });

    it('leaves a sheet without font faces unchanged', () => {
        expect(inlineKatexFonts('.katex{display:inline}', FONTS)).toBe('.katex{display:inline}');
    });
});

describe('escapeHtmlText', () => {
    it('escapes the characters that would open an entity or a tag', () => {
        expect(escapeHtmlText('a & b <c> d')).toBe('a &amp; b &lt;c&gt; d');
    });

    it('escapes an ampersand before the others, so nothing is escaped twice', () => {
        expect(escapeHtmlText('&lt;')).toBe('&amp;lt;');
    });
});

describe('resolveExportTheme', () => {
    it('keeps dark', () => {
        expect(resolveExportTheme('dark')).toBe('dark');
    });

    it('falls back to light for light, absent, empty or unknown values', () => {
        for (const raw of ['light', null, undefined, '', 'Dark', 'solarized']) {
            expect(resolveExportTheme(raw)).toBe('light');
        }
    });
});

describe('exportPageCss', () => {
    it('paints the page in the preview pane\'s background for each theme', () => {
        expect(exportPageCss('light')).toContain(`background-color: ${PREVIEW_THEME_COLORS.light.backgroundColor}`);
        expect(exportPageCss('dark')).toContain(`background-color: ${PREVIEW_THEME_COLORS.dark.backgroundColor}`);
    });

    it('frames the article as a centred reading column', () => {
        expect(exportPageCss('light')).toMatch(/\.markdown-body \{[^}]*max-width: 980px;[^}]*margin: 0 auto;/);
    });
});

describe('joinStylesheets', () => {
    it('joins in the order given', () => {
        expect(joinStylesheets(['a{}', 'b{}'])).toBe('a{}\nb{}');
    });

    it('refuses a sheet that would close the <style> element early', () => {
        expect(() => joinStylesheets(['a{}', 'b{content:"</STYLE>"}'])).toThrow(/<\/style/);
    });
});

describe('exportStylesheet (the preview\'s look — REQ-LTTCE-XPT-00014)', () => {
    const css = exportStylesheet();

    it('carries preview-theme.css, KaTeX and github-markdown-css, in the order App.tsx imports them', () => {
        const theme = css.indexOf(PREVIEW_THEME_CSS.trim());
        const katex = css.indexOf('.katex .katex-mathml{');
        const github = css.indexOf(GITHUB_MARKDOWN_CSS.trim());
        expect(theme).toBeGreaterThanOrEqual(0);
        expect(katex).toBeGreaterThan(theme);
        expect(github).toBeGreaterThan(katex);
    });

    it('carries the code-token palette of both themes — the syntax highlighting', () => {
        expect(css).toMatch(/\.markdown-body\[data-theme="light"\] \{\s*& \.tok-keyword/);
        expect(css).toMatch(/\.markdown-body\[data-theme="dark"\] \{\s*& \.tok-keyword/);
    });
});

describe('buildExportDocument', () => {
    const BODY = '<h1 data-source-line="1">Title</h1><pre><code><span class="tok-keyword">fn</span></code></pre>'
        + '<p><span class="katex">x</span></p>';
    const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

    it('is a standards-mode document that declares UTF-8', () => {
        const html = buildExportDocument(BODY, 'notes.md', 'light');
        expect(html.startsWith('<!DOCTYPE html>\n')).toBe(true);
        expect(html).toContain('<meta charset="utf-8">');
        expect(html.trimEnd().endsWith('</html>')).toBe(true);
    });

    it('carries the body exactly as the preview serialised it, inside one .markdown-body article', () => {
        const doc = parse(buildExportDocument(BODY, 'notes.md', 'light'));
        expect(doc.body.children).toHaveLength(1);
        const article = doc.body.children[0];
        expect(article.tagName).toBe('ARTICLE');
        expect(article.className).toBe('markdown-body');
        expect(article.innerHTML.trim()).toBe(BODY);
    });

    it.each(['light', 'dark'] as const)('styles the %s theme the preview showed', (theme) => {
        const doc = parse(buildExportDocument(BODY, 'notes.md', theme));
        expect(doc.querySelector('article')!.getAttribute('data-theme')).toBe(theme);
        const style = doc.head.querySelector('style')!.textContent!;
        expect(style).toContain(exportPageCss(theme));
    });

    it('carries every stylesheet in a single <style> in the head', () => {
        const doc = parse(buildExportDocument(BODY, 'notes.md', 'light'));
        const styles = doc.head.querySelectorAll('style');
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toContain(exportStylesheet().trim());
        expect(doc.body.querySelectorAll('style')).toHaveLength(0);
    });

    it('a highlighted token in the export is reached by the palette\'s selector', () => {
        // jsdom does not resolve nested CSS or compute colours, so this checks
        // the flattened selector the nested rule stands for against the
        // exported markup — the match the v0.3.32 export could never make.
        const doc = parse(buildExportDocument(BODY, 'notes.md', 'light'));
        expect(doc.querySelector('.markdown-body[data-theme="light"] .tok-keyword')).not.toBeNull();
    });

    it('titles the document with the escaped file name', () => {
        const doc = parse(buildExportDocument(BODY, 'a<b>&c.md', 'light'));
        expect(doc.title).toBe('a<b>&c.md');
        expect(doc.querySelector('article')!.innerHTML.trim()).toBe(BODY);
    });
});
