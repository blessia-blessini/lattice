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

// IMPL-LTTCE-PRV-00002
//
// React glue for Preview Code Syntax Highlighting (Chapter PRV):
// renders a fenced code block's content as highlighted spans, lazy-loading
// the Lezer parser for the block's language tag. Falls back to plain text
// while loading and for unknown languages, so the preview never blocks.
// Pure logic lives in lib/code-highlight.ts (IMPL-LTTCE-PRV-00001).

import { useEffect, useState } from 'react';
import type { Language } from '@codemirror/language';
import { loadCodeLanguage, highlightTokens } from '../lib/code-highlight';

interface HighlightedCodeProps {
    /** Raw text content of the fenced code block. */
    code: string;
    /** Fence language tag (already stripped of the `language-` prefix). */
    languageTag: string;
    /** Original className from react-markdown (kept for CSS/theming). */
    className?: string;
}

// Module-level cache: language bundles are loaded once per session and
// shared by every code block (DRY — same lazy-load the editor pane uses).
const languageCache = new Map<string, Promise<Language | null>>();

//******************************************************************************
// getCachedLanguage
//******************************************************************************
/** Resolve (and memoise) the Lezer Language for a fence tag. */
function getCachedLanguage(tag: string): Promise<Language | null> {
    let cached = languageCache.get(tag);
    if (!cached) {
        cached = loadCodeLanguage(tag).then(sup => sup?.language ?? null);
        languageCache.set(tag, cached);
    }
    return cached;
}
// getCachedLanguage END *******************************************************


//******************************************************************************
// HighlightedCode
//******************************************************************************
/**
 * `<code>` replacement for the preview pane. Shows plain text immediately,
 * then swaps in highlighted `tok-*` spans once the language bundle is ready.
 */
export function HighlightedCode({ code, languageTag, className }: HighlightedCodeProps) {
    const [language, setLanguage] = useState<Language | null>(null);

    useEffect(() => {
        let cancelled = false;
        getCachedLanguage(languageTag).then(lang => {
            // Defensive: ignore late results after unmount or tag change.
            if (!cancelled) setLanguage(lang);
        });
        return () => { cancelled = true; };
    }, [languageTag]);

    // Plain fallback: unknown language, or bundle still loading.
    if (!language) {
        return <code className={className}>{code}</code>;
    }

    const tokens = highlightTokens(code, language);
    return (
        <code className={className}>
            {tokens.map((tok, i) =>
                tok.classes
                    ? <span key={i} className={tok.classes}>{tok.text}</span>
                    : tok.text
            )}
        </code>
    );
}
// HighlightedCode END *********************************************************
