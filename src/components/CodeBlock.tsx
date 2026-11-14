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

// IMPL-LTTCE-PRV-00005
//
// React glue for the preview code block's copy buttons (REQ-LTTCE-PRV-00004 /
// 00005 / 00006): wraps a `<pre>` and lays its buttons over its top-right
// corner — "Copy code" on every block, plus "Copy SVG" on a Mermaid diagram.
// Showing them on hover and hiding them in print is CSS (App.css,
// IMPL-LTTCE-PRV-00006); the logic is in lib/code-block-copy.ts
// (IMPL-LTTCE-PRV-00004).

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { copyText, diagramSvgText } from '../lib/code-block-copy';
import { PREVIEW_UI_ATTR } from '../lib/preview-copy';

/** How long a button shows the outcome of a copy before it resets. */
export const COPY_FEEDBACK_MS = 1500;

type CopyState = 'idle' | 'copied' | 'failed';

/** Labels of the two kinds of button, in the idle state. */
export const COPY_CODE_LABEL = 'Copy code';
export const COPY_SVG_LABEL = 'Copy SVG';

/** Labels after a copy, shared by both buttons. */
const RESULT_LABELS = { copied: 'Copied', failed: 'Copy failed' } as const;

/** Stroke paths of the icons, drawn on a 16×16 grid. */
const ICON_PATHS = {
    code: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
    svg: 'M2.5 3.5h11v9h-11z M2.5 10.5l3.5-3.5 3 3 2-2 2.5 2.5 M10.5 6a.5.5 0 1 0 0 .01',
    copied: 'M3 8.5l3 3 7-7',
    failed: 'M4 4l8 8M12 4l-8 8',
} as const;


//******************************************************************************
// CopyButton
//******************************************************************************
/**
 * One copy button: puts the text `getText` returns on the clipboard and shows
 * for `COPY_FEEDBACK_MS` whether that worked. `getText` is asked at click
 * time; `null` (nothing to copy) counts as a failed copy.
 *
 * Holds no text of its own — label and tooltip are attributes, the icon is a
 * path — so a plain-text copy of a selection is unaffected by it.
 */
function CopyButton({ label, icon, getText }: {
    label: string;
    icon: keyof typeof ICON_PATHS;
    getText: () => string | null;
}) {
    // A new object per click, so a repeated outcome ('copied' twice) is still a
    // state change and restarts the reset timer below.
    const [feedback, setFeedback] = useState<{ state: CopyState }>({ state: 'idle' });
    const state = feedback.state;

    // Reset the feedback after a while; a new click restarts the timer.
    useEffect(() => {
        if (feedback.state === 'idle') return;
        const timer = setTimeout(() => setFeedback({ state: 'idle' }), COPY_FEEDBACK_MS);
        return () => clearTimeout(timer);
    }, [feedback]);

    const onCopy = async () => {
        const text = getText();
        // copyText's synchronous route runs before its first await, i.e.
        // still inside this click (see copyText).
        const ok = text !== null && await copyText(text);
        setFeedback({ state: ok ? 'copied' : 'failed' });
    };

    const shown = state === 'idle' ? label : RESULT_LABELS[state];
    return (
        <button
            type="button"
            className="code-copy-btn"
            data-state={state}
            aria-label={shown}
            title={shown}
            // Keep the user's text selection: a mouse-down on a button
            // would otherwise collapse it before the click.
            onMouseDown={e => e.preventDefault()}
            onClick={onCopy}
        >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
                fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round">
                <path d={ICON_PATHS[state === 'idle' ? icon : state]} />
            </svg>
        </button>
    );
}
// CopyButton END **************************************************************


//******************************************************************************
// CodeBlock
//******************************************************************************
/**
 * `<pre>` replacement for the preview pane: the block itself, unchanged, plus
 * a bar of copy buttons. "Copy code" copies `text`, the block's source text
 * (`fenceText`), the same for code and diagram blocks. With `diagram`, a
 * "Copy SVG" button copies the rendered diagram as SVG (`diagramSvgText`).
 *
 * The bar carries `PREVIEW_UI_ATTR`, so the serialisers in preview-copy.ts
 * drop it from exported and copied HTML (REQ-LTTCE-PRV-00005).
 */
export function CodeBlock({ text, diagram = false, children, ...preProps }:
    ComponentProps<'pre'> & { text: string; diagram?: boolean }) {
    const blockRef = useRef<HTMLDivElement>(null);
    const svgText = () => (blockRef.current ? diagramSvgText(blockRef.current) : null);

    return (
        <div className="code-block" ref={blockRef}>
            <pre {...preProps}>{children}</pre>
            <div className="code-copy-bar" {...{ [PREVIEW_UI_ATTR]: '' }}>
                {diagram && <CopyButton label={COPY_SVG_LABEL} icon="svg" getText={svgText} />}
                <CopyButton label={COPY_CODE_LABEL} icon="code" getText={() => text} />
            </div>
        </div>
    );
}
// CodeBlock END ***************************************************************
