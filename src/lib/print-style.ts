// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

/**
 * The runtime half of Lattice's print stylesheet.
 *
 * IMPL-LTTCE-XPT-00006. Most print rules are static and live in `App.css`'s
 * `@media print` block. Two of them cannot be: the running page header carries
 * the file name, and the body point size is derived from the live zoom level.
 * They are therefore injected as a `<style>` element at print time.
 *
 * This module exists because there are now *two* callers that need that
 * element and they arrive by completely different routes:
 *
 *  - the interactive `beforeprint` / `afterprint` pair in `App.tsx` (Ctrl-P,
 *    "Save as PDF" from the system print dialog), and
 *  - the headless `--export-pdf` run, where the host WebView is driven
 *    straight to a file and **never fires `beforeprint`** — so the style has
 *    to be applied explicitly before the document is handed to the printer.
 *
 * Keeping the CSS in one place is what makes `--export-pdf` and Ctrl-P produce
 * the same page rather than two subtly different ones.
 */

/** `id` of the injected element — also how `removePrintStyle` finds it again. */
export const PRINT_STYLE_ID = 'lattice-print-dynamic';

/** Body point size at 100 % zoom; every other size scales from it. */
export const PRINT_BASE_PT = 11;

/** Shown as the running header when no file has been opened. */
export const PRINT_UNTITLED = 'Untitled';

/**
 * The four page margins of a PDF export, in millimetres — what Rust hands over
 * in `__LATTICE_INIT_DATA__.exportPageMarginsMm` (`export::ExportLaunch`).
 */
export interface PageMarginsMm {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** The sides of `PageMarginsMm`, in the order CSS's `margin` shorthand takes them. */
const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const;


//******************************************************************************
// resolvePageMargins
//******************************************************************************
/**
 * IMPL-LTTCE-XPT-00006 — REQ-LTTCE-XPT-00012 — validates the page margins Rust
 * hands over for a PDF export. Returns `null` — keep the stylesheet's own
 * `@page` margin — unless every side is a finite, non-negative number:
 * absent (an HTML export, or an older backend), `null`, a missing side, a
 * string or `NaN` must not become a `margin` that voids the whole rule.
 */
export function resolvePageMargins(raw: unknown): PageMarginsMm | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const rec = raw as Record<string, unknown>;
    const valid = MARGIN_SIDES.every((side) => {
        const v = rec[side];
        return typeof v === 'number' && Number.isFinite(v) && v >= 0;
    });
    if (!valid) return null;
    return {
        top: rec.top as number,
        right: rec.right as number,
        bottom: rec.bottom as number,
        left: rec.left as number,
    };
} // resolvePageMargins END ****************************************************


//******************************************************************************
// printTitleFor
//******************************************************************************
/**
 * The bare file name to print as the running header, given the open file's
 * path (or `null` for an unsaved buffer). Handles both separators, because a
 * path can reach here from either host.
 */
export function printTitleFor(filePath: string | null | undefined): string {
    if (!filePath) return PRINT_UNTITLED;
    return filePath.split(/[\\/]/).pop() || PRINT_UNTITLED;
} // printTitleFor END *********************************************************


//******************************************************************************
// buildPrintStyleCss
//******************************************************************************
/**
 * The CSS text for the injected print style.
 *
 * `fileName` is embedded in a CSS string literal, so backslashes and double
 * quotes are escaped — a Windows path fragment or a quoted file name must not
 * be able to terminate the literal and corrupt the rest of the sheet.
 *
 * With `margins`, the `@page` rule also sets the page margin. This element
 * comes after `App.css` in the document, so it overrides that sheet's 2 cm —
 * which matters on macOS, where WKWebView obeys the CSS margin rather than the
 * one given to its print API (REQ-LTTCE-XPT-00012). Without `margins` (an
 * interactive Ctrl-P) the stylesheet's own margin stands.
 *
 * @param fileName    running header text (see `printTitleFor`)
 * @param fontSizePct current zoom, in percent (100 = unzoomed)
 * @param margins     page margins to set, or `null` to keep the stylesheet's
 */
export function buildPrintStyleCss(
    fileName: string,
    fontSizePct: number,
    margins: PageMarginsMm | null = null,
): string {
    const esc = fileName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // Guard against a missing or nonsensical zoom rather than emitting "NaNpt",
    // which would silently void the whole rule.
    const pct = Number.isFinite(fontSizePct) && fontSizePct > 0 ? fontSizePct : 100;
    const printPt = ((PRINT_BASE_PT * pct) / 100).toFixed(2);
    const marginCss = margins
        ? '  margin: ' + MARGIN_SIDES.map((side) => margins[side] + 'mm').join(' ') + ';\n'
        : '';

    const pageCss = '@page {\n' + marginCss + '  @top-center {\n    content: "' + esc + '";\n'
        + '    font-size: 9pt;\n    font-family: Arial, Helvetica, sans-serif;\n'
        + '    color: #555;\n  }\n}\n';
    const zoomCss = '.preview-pane, .preview-pane__body, .markdown-body { font-size: ' + printPt + 'pt !important; }\n'
        + '.cm-content, .cm-line { font-size: ' + printPt + 'pt !important; }';
    return pageCss + zoomCss;
} // buildPrintStyleCss END ****************************************************


//******************************************************************************
// applyPrintStyle
//******************************************************************************
/**
 * Injects (or replaces) the print style element and sets the document title to
 * the bare file name, so the host's own header/footer shows that rather than
 * Lattice's decorated window title.
 *
 * Idempotent: calling it twice leaves exactly one element, so an interactive
 * print during an export — or two `beforeprint` events in a row — cannot
 * stack duplicates.
 *
 * `margins` is passed by the headless PDF export only (see
 * `buildPrintStyleCss`).
 */
export function applyPrintStyle(
    doc: Document,
    filePath: string | null | undefined,
    fontSizePct: number,
    margins: PageMarginsMm | null = null,
): void {
    const fileName = printTitleFor(filePath);
    doc.title = fileName;

    removePrintStyle(doc);
    const style = doc.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = buildPrintStyleCss(fileName, fontSizePct, margins);
    doc.head.appendChild(style);
} // applyPrintStyle END *******************************************************


//******************************************************************************
// removePrintStyle
//******************************************************************************
/**
 * Removes the injected print style, if present. A no-op otherwise — callers
 * (`afterprint`) may fire without a matching `beforeprint`.
 */
export function removePrintStyle(doc: Document): void {
    doc.getElementById(PRINT_STYLE_ID)?.remove();
} // removePrintStyle END ******************************************************
