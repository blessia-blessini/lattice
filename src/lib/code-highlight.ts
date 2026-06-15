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

// IMPL-LTTCE-PRV-00001
//
// Pure logic for Preview Code Syntax Highlighting (Chapter PRV):
// resolve a fenced-code-block language tag to the SAME Lezer parser the
// edit pane uses (@codemirror/language-data), and tokenise code into
// (text, CSS-classes) pairs via @lezer/highlight's classHighlighter.
//
// Deliberately DOM-free and React-free so the logic is unit-testable
// headless. The React glue lives in components/HighlightedCode.tsx
// (IMPL-LTTCE-PRV-00002).

import { LanguageDescription, type LanguageSupport, type Language } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode, classHighlighter } from '@lezer/highlight';

/** One highlighted slice of a code block. `classes` is a space-separated
 *  list of `tok-*` class names emitted by Lezer's classHighlighter;
 *  empty string means "plain text" (no span needed). */
export interface HighlightToken {
    text: string;
    classes: string;
}

//******************************************************************************
// findCodeLanguage
//******************************************************************************
/**
 * Resolve a markdown fence language tag (e.g. `js`, `python`, `rust`) to a
 * LanguageDescription from the registry the editor pane already uses.
 * Matching includes aliases (`js` → JavaScript) and is case-insensitive.
 *
 * @returns the description, or `null` when the tag is unknown/empty.
 */
export function findCodeLanguage(tag: string | null | undefined): LanguageDescription | null {
    // Guard clause: empty or non-string tags can never match.
    if (!tag || typeof tag !== 'string') return null;
    return LanguageDescription.matchLanguageName(languages, tag, true) ?? null;
}
// findCodeLanguage END ********************************************************


//******************************************************************************
// loadCodeLanguage
//******************************************************************************
/**
 * Asynchronously load the parser bundle for a fence language tag.
 * Bundles are lazy-loaded (dynamic import) exactly as in the edit pane,
 * so unused languages cost nothing.
 *
 * @returns the LanguageSupport, or `null` for unknown tags or load failures
 *          (a failure must degrade to a plain code block, never throw).
 */
export async function loadCodeLanguage(tag: string | null | undefined): Promise<LanguageSupport | null> {
    const desc = findCodeLanguage(tag);
    if (!desc) return null;
    try {
        return await desc.load();
    } catch (err) {
        // Defensive: a broken/missing bundle must not break the preview.
        console.error(`code-highlight: failed to load language "${tag}":`, err);
        return null;
    }
}
// loadCodeLanguage END ********************************************************


//******************************************************************************
// highlightTokens
//******************************************************************************
/**
 * Tokenise `code` with the given Lezer language and return flat
 * (text, classes) pairs, line breaks included as `{ text: '\n', classes: '' }`.
 * Uses classHighlighter, so classes are stable `tok-*` names that App.css
 * themes for light and dark preview modes.
 */
export function highlightTokens(code: string, language: Language): HighlightToken[] {
    // Guard clause: nothing to do for empty input.
    if (!code) return [];
    const tokens: HighlightToken[] = [];
    const tree = language.parser.parse(code);
    highlightCode(
        code,
        tree,
        classHighlighter,
        (text, classes) => { tokens.push({ text, classes }); },
        () => { tokens.push({ text: '\n', classes: '' }); },
    );
    return tokens;
}
// highlightTokens END *********************************************************
