// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PRINT_STYLE_ID,
    PRINT_UNTITLED,
    printTitleFor,
    buildPrintStyleCss,
    applyPrintStyle,
    removePrintStyle,
} from './print-style';

describe('printTitleFor', () => {
    it('takes the bare file name from a POSIX path', () => {
        expect(printTitleFor('/vault/notes/my-note.md')).toBe('my-note.md');
    });

    it('takes the bare file name from a Windows path', () => {
        expect(printTitleFor('C:\\vault\\notes\\my-note.md')).toBe('my-note.md');
    });

    it('returns the name unchanged when there is no directory part', () => {
        expect(printTitleFor('my-note.md')).toBe('my-note.md');
    });

    it('falls back to Untitled for an unsaved buffer', () => {
        expect(printTitleFor(null)).toBe(PRINT_UNTITLED);
        expect(printTitleFor(undefined)).toBe(PRINT_UNTITLED);
        expect(printTitleFor('')).toBe(PRINT_UNTITLED);
    });

    it('falls back to Untitled for a path that ends in a separator', () => {
        // Defensive: `split().pop()` yields '' here, which would print an
        // empty running header rather than a usable one.
        expect(printTitleFor('/vault/notes/')).toBe(PRINT_UNTITLED);
    });
});

describe('buildPrintStyleCss', () => {
    it('puts the file name in the @page running header', () => {
        const css = buildPrintStyleCss('my-note.md', 100);
        expect(css).toContain('@top-center');
        expect(css).toContain('content: "my-note.md"');
    });

    it('scales the body point size from the 11pt baseline by the zoom level', () => {
        expect(buildPrintStyleCss('a.md', 100)).toContain('font-size: 11.00pt');
        expect(buildPrintStyleCss('a.md', 200)).toContain('font-size: 22.00pt');
        expect(buildPrintStyleCss('a.md', 50)).toContain('font-size: 5.50pt');
    });

    it('escapes backslashes and quotes so a name cannot break out of the CSS string', () => {
        const css = buildPrintStyleCss('C:\\odd "name".md', 100);
        expect(css).toContain('content: "C:\\\\odd \\"name\\".md"');
        // The literal must still be closed exactly once — an unescaped quote
        // would leave the rest of the sheet inside a string.
        expect(css.match(/content: "/g)).toHaveLength(1);
    });

    it('falls back to 100% for a missing or nonsensical zoom', () => {
        // Would otherwise emit "NaNpt" / a negative size and void the rule.
        expect(buildPrintStyleCss('a.md', NaN)).toContain('font-size: 11.00pt');
        expect(buildPrintStyleCss('a.md', 0)).toContain('font-size: 11.00pt');
        expect(buildPrintStyleCss('a.md', -5)).toContain('font-size: 11.00pt');
    });
});

describe('applyPrintStyle / removePrintStyle', () => {
    beforeEach(() => {
        removePrintStyle(document);
        document.title = '';
    });

    it('injects the style element and sets the document title', () => {
        applyPrintStyle(document, '/vault/my-note.md', 100);

        const style = document.getElementById(PRINT_STYLE_ID);
        expect(style).not.toBeNull();
        expect(style!.textContent).toContain('my-note.md');
        expect(document.title).toBe('my-note.md');
    });

    it('is idempotent — two calls leave exactly one element', () => {
        applyPrintStyle(document, '/vault/a.md', 100);
        applyPrintStyle(document, '/vault/b.md', 150);

        const all = document.querySelectorAll('#' + PRINT_STYLE_ID);
        expect(all).toHaveLength(1);
        // and it carries the latest values, not the first ones
        expect(all[0].textContent).toContain('b.md');
        expect(all[0].textContent).toContain('font-size: 16.50pt');
    });

    it('removes the element again', () => {
        applyPrintStyle(document, '/vault/a.md', 100);
        removePrintStyle(document);
        expect(document.getElementById(PRINT_STYLE_ID)).toBeNull();
    });

    it('removing without a matching apply is a no-op', () => {
        expect(() => removePrintStyle(document)).not.toThrow();
        expect(document.getElementById(PRINT_STYLE_ID)).toBeNull();
    });
});
