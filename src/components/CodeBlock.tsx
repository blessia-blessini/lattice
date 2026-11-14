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
// 00005 / 00006 / 00007): wraps a `<pre>` and lays its buttons over its
// top-right corner — "Copy code" on every block, plus "Copy PNG image" and
// "Copy SVG" on a Mermaid diagram.
// Showing them on hover and hiding them in print is CSS (App.css,
// IMPL-LTTCE-PRV-00006); the logic is in lib/code-block-copy.ts
// (IMPL-LTTCE-PRV-00004).

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { copyText, copyDiagramImage, diagramSvgText } from '../lib/code-block-copy';
import { PREVIEW_UI_ATTR } from '../lib/preview-copy';

/** How long a button shows the outcome of a copy before it resets. */
export const COPY_FEEDBACK_MS = 1500;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Accessible names (`aria-label`) of the buttons in the idle state — short,
 * because a screen reader speaks them on every focus.
 *
 * Paired with `COPY_DIAGRAM_BUTTONS` in `src-tauri/examples/e2e_harness.rs`,
 * which repeats the three diagram names (it cannot import TypeScript):
 * change one, change the other, or the `copy_diagram` E2E scenario fails.
 */
export const COPY_CODE_LABEL = 'Copy code';
/** "Copy code" on a Mermaid diagram, where it copies the Mermaid source. */
export const COPY_MERMAID_CODE_LABEL = 'Copy Mermaid Code';
export const COPY_SVG_LABEL = 'Copy SVG';
export const COPY_IMAGE_LABEL = 'Copy PNG image';

/**
 * Tooltips (`title`) where they say more than the name: what to do with the
 * copy. A button without one shows its name as the tooltip.
 */
export const COPY_SVG_TOOLTIP = 'Copy SVG (Vector Graphics to be pasted to a txt file with extension .svg)';
export const COPY_IMAGE_TOOLTIP = 'Copy PNG image (can be pasted anywhere)';

/**
 * Attribute naming what a button copies (`code`, `svg`, `image`). Unlike its
 * label it does not change with the feedback state, so tests and the E2E
 * driver can find a button whatever it currently shows.
 */
export const COPY_KIND_ATTR = 'data-copy';

/** Labels after a copy, shared by all buttons. */
const RESULT_LABELS = { copied: 'Copied', failed: 'Copy failed' } as const;

/** Stroke paths of the icons, drawn on a 16×16 grid. */
const ICON_PATHS = {
    code: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
    // A curve between two anchor points: the vector drawing, not the picture.
    svg: 'M3.5 10.5C4.5 4.5 11.5 4.5 12.5 10.5 M2 10.5h3v3H2z M11 10.5h3v3h-3z',
    image: 'M2.5 3.5h11v9h-11z M2.5 10.5l3.5-3.5 3 3 2-2 2.5 2.5 M10.5 6a.5.5 0 1 0 0 .01',
    copied: 'M3 8.5l3 3 7-7',
    failed: 'M4 4l8 8M12 4l-8 8',
} as const;


//******************************************************************************
// CopyButton
//******************************************************************************
/**
 * One copy button: runs `copy` on click and shows for `COPY_FEEDBACK_MS`
 * whether it worked (its resolved flag). `copy` is called synchronously in
 * the click handler, so its clipboard routes start inside the user gesture.
 *
 * `label` is the accessible name, `tooltip` the hover text (default: the
 * name); after a copy both show the outcome.
 *
 * Holds no text of its own — label and tooltip are attributes, the icon is a
 * path — so a plain-text copy of a selection is unaffected by it.
 */
function CopyButton({ label, tooltip = label, icon, copy }: {
    label: string;
    tooltip?: string;
    icon: keyof typeof ICON_PATHS;
    copy: () => Promise<boolean>;
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
        // The copy functions start their routes before their first await,
        // i.e. still inside this click (see copyText, copyDiagramImage).
        const ok = await copy();
        setFeedback({ state: ok ? 'copied' : 'failed' });
    };

    const shown = state === 'idle' ? label : RESULT_LABELS[state];
    const hover = state === 'idle' ? tooltip : RESULT_LABELS[state];
    return (
        <button
            type="button"
            className="code-copy-btn"
            {...{ [COPY_KIND_ATTR]: icon }}
            data-state={state}
            aria-label={shown}
            title={hover}
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
 * (`fenceText`), the same for code and diagram blocks — on a diagram it is
 * labelled "Copy Mermaid Code". With `diagram`, a "Copy PNG image" button
 * copies the rendered diagram as a picture (`copyDiagramImage`) and a "Copy
 * SVG" button as SVG text (`diagramSvgText`).
 * No SVG or picture to copy counts as a failed copy.
 *
 * The bar carries `PREVIEW_UI_ATTR`, so the serialisers in preview-copy.ts
 * drop it from exported and copied HTML (REQ-LTTCE-PRV-00005).
 */
export function CodeBlock({ text, diagram = false, children, ...preProps }:
    ComponentProps<'pre'> & { text: string; diagram?: boolean }) {
    const blockRef = useRef<HTMLDivElement>(null);
    const copySvg = () => {
        const svg = blockRef.current ? diagramSvgText(blockRef.current) : null;
        return svg === null ? Promise.resolve(false) : copyText(svg);
    };
    const copyImage = () =>
        (blockRef.current ? copyDiagramImage(blockRef.current) : Promise.resolve(false));

    return (
        <div className="code-block" ref={blockRef}>
            <pre {...preProps}>{children}</pre>
            <div className="code-copy-bar" {...{ [PREVIEW_UI_ATTR]: '' }}>
                {diagram && <CopyButton label={COPY_IMAGE_LABEL} tooltip={COPY_IMAGE_TOOLTIP} icon="image"
                    copy={copyImage} />}
                {diagram && <CopyButton label={COPY_SVG_LABEL} tooltip={COPY_SVG_TOOLTIP} icon="svg"
                    copy={copySvg} />}
                <CopyButton label={diagram ? COPY_MERMAID_CODE_LABEL : COPY_CODE_LABEL} icon="code"
                    copy={() => copyText(text)} />
            </div>
        </div>
    );
}
// CodeBlock END ***************************************************************
