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
 * Auto-generated Table of Contents support.
 *
 * When a document contains the marker pair
 *
 *   <!-- TOC -->
 *   ...any content...
 *   <!-- /TOC -->
 *
 * the content between the markers is replaced with a bullet list of
 * the document's headings, using standard Markdown internal links
 * (GitHub-style slugs: `[Heading Text](#heading-text)`).
 *
 * The opening marker may carry options:
 *
 *   <!-- TOC minLevel=2 maxLevel=4 -->
 *
 * Defaults are minLevel=2 maxLevel=6 (i.e. skip H1, include H2..H6).
 *
 * These functions are pure and knowingly string-based (no Markdown AST).
 * They intentionally mirror the small subset of behavior that the
 * VS Code "Markdown All in One" extension and similar tools provide.
 */

export interface TocOptions {
    /** Lowest heading level included in the TOC. Defaults to 2. */
    minLevel: number;
    /** Highest heading level included in the TOC. Defaults to 6. */
    maxLevel: number;
}

export interface ParsedHeading {
    /** 1..6 */
    level: number;
    /** Clean text as it should appear in the TOC (markdown formatting stripped). */
    text: string;
    /** GitHub-style slug (unique within the document via -1, -2 suffixes). */
    slug: string;
}

/** Default heading-level range when the open marker carries no options. */
export const DEFAULT_TOC_OPTIONS: TocOptions = { minLevel: 2, maxLevel: 6 };

// The opening marker may optionally contain key=value options before the closing `-->`.
// e.g. `<!-- TOC minLevel=2 maxLevel=4 -->`.
const OPEN_MARKER_RE = /<!--\s*TOC\b([^>]*?)-->/i;
const CLOSE_MARKER_RE = /<!--\s*\/TOC\s*-->/i;

/**
 * Parse `key=value` options from the opening marker's payload.
 * Unknown keys are ignored; invalid numbers fall back to defaults.
 */
export function parseTocOptions(raw: string): TocOptions {
    const out: TocOptions = { ...DEFAULT_TOC_OPTIONS };
    const re = /([A-Za-z]+)\s*=\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const key = m[1].toLowerCase();
        const val = parseInt(m[2], 10);
        if (!Number.isFinite(val)) continue;
        if (key === "minlevel") out.minLevel = clampLevel(val);
        else if (key === "maxlevel") out.maxLevel = clampLevel(val);
    }
    // If caller inverted them, treat as empty range but keep values sane.
    if (out.minLevel > out.maxLevel) {
        const { minLevel, maxLevel } = out;
        out.minLevel = maxLevel;
        out.maxLevel = minLevel;
    }
    return out;
}

function clampLevel(n: number): number {
    if (n < 1) return 1;
    if (n > 6) return 6;
    return n;
}

/**
 * Strip inline Markdown formatting from a heading's source so it reads cleanly
 * in the TOC: `Why \`useMemo\`?` -> `Why useMemo?`. Links keep their link text.
 */
function stripInlineFormatting(text: string): string {
    let t = text;
    // Fenced-less inline code: `code`
    t = t.replace(/`+([^`]*)`+/g, "$1");
    // Images: ![alt](url) -> alt
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Markdown links: [text](url) -> text
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Wiki links with alias: [[target|alias]] -> alias
    t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
    // Wiki links plain: [[target]] -> target
    t = t.replace(/\[\[([^\]]+)\]\]/g, "$1");
    // HTML tags
    t = t.replace(/<[^>]+>/g, "");
    // Bold / italic markers (** __ * _) - only the markers, keep the text.
    t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
    t = t.replace(/(\*|_)(.*?)\1/g, "$2");
    // Trailing ATX closing hashes, e.g. "## Title ##"
    t = t.replace(/\s+#+\s*$/, "");
    return t.trim();
}

/**
 * GitHub-style slug. Approximation of the algorithm that GitHub applies to
 * rendered headings:
 *   - lowercase
 *   - strip characters that are not letters, digits, spaces, hyphens, underscores
 *   - collapse runs of whitespace into single hyphens
 *
 * Unicode letters and digits are preserved (so non-English headings still
 * produce linkable slugs).
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
        .replace(/\s+/g, "-");
}

/**
 * Walk the document line by line and pull out headings that fall in the
 * requested level range. Headings inside fenced code blocks are ignored.
 *
 * Duplicate slugs are disambiguated by appending -1, -2, ... in order of
 * appearance (matching GitHub's behavior).
 */
export function extractHeadings(
    text: string,
    options: TocOptions = DEFAULT_TOC_OPTIONS,
): ParsedHeading[] {
    const { minLevel, maxLevel } = options;
    const out: ParsedHeading[] = [];
    const lines = text.split(/\r?\n/);
    const slugCounts = new Map<string, number>();

    let inFence = false;
    let fenceChar = "";
    let fenceLen = 0;

    for (const line of lines) {
        // Fence open/close detection. Indentation up to 3 spaces still counts.
        const fenceOpen = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fenceOpen) {
            const marker = fenceOpen[1];
            const ch = marker[0];
            if (!inFence) {
                inFence = true;
                fenceChar = ch;
                fenceLen = marker.length;
                continue;
            } else if (ch === fenceChar && marker.length >= fenceLen) {
                // Closing fence must be same character, at least as long, and
                // may not have an info string after it. A simple check suffices.
                if (/^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) {
                    inFence = false;
                    fenceChar = "";
                    fenceLen = 0;
                    continue;
                }
            }
        }
        if (inFence) continue;

        const h = line.match(/^(#{1,6})[ \t]+(.+?)\s*$/);
        if (!h) continue;
        const level = h[1].length;
        if (level < minLevel || level > maxLevel) continue;

        const cleanText = stripInlineFormatting(h[2]);
        if (!cleanText) continue;

        const baseSlug = slugify(cleanText);
        if (!baseSlug) continue;

        const count = slugCounts.get(baseSlug) ?? 0;
        slugCounts.set(baseSlug, count + 1);
        const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;

        out.push({ level, text: cleanText, slug });
    }
    return out;
}

/**
 * Render a list of headings to a bullet list. The shallowest heading sits at
 * indent zero; deeper headings are indented by 2 spaces per level below it.
 */
export function renderToc(headings: ParsedHeading[]): string {
    if (headings.length === 0) return "";
    const baseLevel = Math.min(...headings.map((h) => h.level));
    return headings
        .map((h) => {
            const indent = "  ".repeat(Math.max(0, h.level - baseLevel));
            return `${indent}- [${h.text}](#${h.slug})`;
        })
        .join("\n");
}

/**
 * If the document contains a well-formed `<!-- TOC -->` / `<!-- /TOC -->`
 * pair, regenerate the content between them from the document's headings.
 *
 * Returns the (possibly) updated text and a `changed` flag. When the markers
 * are absent, malformed (only one, or close before open), or the regenerated
 * block is byte-identical to the existing one, `changed` is `false` and the
 * original text is returned unchanged.
 */
export function updateTocInDocument(text: string): { text: string; changed: boolean } {
    const openMatch = OPEN_MARKER_RE.exec(text);
    if (!openMatch) return { text, changed: false };

    // Find the close marker AFTER the opening one.
    CLOSE_MARKER_RE.lastIndex = 0;
    const afterOpenIdx = openMatch.index + openMatch[0].length;
    const rest = text.slice(afterOpenIdx);
    const closeRel = rest.match(CLOSE_MARKER_RE);
    if (!closeRel || closeRel.index === undefined) return { text, changed: false };

    const openStart = openMatch.index;
    const openEnd = afterOpenIdx;
    const closeStart = afterOpenIdx + closeRel.index;
    const closeEnd = closeStart + closeRel[0].length;

    const options = parseTocOptions(openMatch[1] ?? "");

    // Extract headings from the document EXCEPT what's between the markers.
    // The TOC block itself contains link lines, not headings, so in practice
    // this matters little - but it also defends against a user pasting
    // headings inside the block by mistake.
    const outsideTocSource =
        text.slice(0, openStart) + "\n" + text.slice(closeEnd);
    const headings = extractHeadings(outsideTocSource, options);

    const tocBody = renderToc(headings);
    // Preserve the opening marker verbatim (keeps user's option config) and
    // emit a blank line on each side of the body when non-empty for readability.
    const openMarker = openMatch[0];
    const closeMarker = closeRel[0];
    const newBlock = tocBody.length > 0
        ? `${openMarker}\n${tocBody}\n${closeMarker}`
        : `${openMarker}\n${closeMarker}`;

    const newText = text.slice(0, openStart) + newBlock + text.slice(closeEnd);
    return { text: newText, changed: newText !== text };
}
