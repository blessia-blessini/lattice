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
//
// UTST for IMPL-LTTCE-PRV-00005 (REQ-LTTCE-PRV-00004 / 00005 / 00006) — the copy buttons.

import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CodeBlock, COPY_FEEDBACK_MS, COPY_CODE_LABEL, COPY_SVG_LABEL } from './CodeBlock';
import { PREVIEW_UI_ATTR } from '../lib/preview-copy';
import { setClipboard } from '../test/clipboard-mock';

describe('CodeBlock', () => {
    let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
    const originalExec = (document as any).execCommand;

    beforeEach(() => {
        writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
        setClipboard({ writeText });
    });
    afterEach(() => {
        setClipboard(undefined);
        vi.useRealTimers();
        (document as any).execCommand = originalExec;
    });

    const renderBlock = () => render(
        <CodeBlock text="let a = 1;" data-source-line="3" className="x">
            <code className="language-js">{'let a = 1;\n'}</code>
        </CodeBlock>,
    );

    it('keeps the <pre> and its attributes, and adds one copy button in a marked bar', () => {
        const { container } = renderBlock();
        const pre = container.querySelector('.code-block > pre')!;
        expect(pre.getAttribute('data-source-line')).toBe('3');
        expect(pre.className).toBe('x');
        const bar = container.querySelector('.code-block > .code-copy-bar')!;
        expect(bar.hasAttribute(PREVIEW_UI_ATTR)).toBe(true);
        const buttons = bar.querySelectorAll('button.code-copy-btn');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].getAttribute('aria-label')).toBe(COPY_CODE_LABEL);
        // No text of its own, so a plain-text selection copy is unaffected.
        expect(bar.textContent).toBe('');
    });

    it('copies the text it was given and shows success', async () => {
        const { container } = renderBlock();
        const btn = container.querySelector('button')!;
        await act(async () => { fireEvent.click(btn); });
        expect(writeText).toHaveBeenCalledWith('let a = 1;');
        expect(btn.getAttribute('data-state')).toBe('copied');
        expect(btn.getAttribute('title')).toBe('Copied');
    });

    it('shows failure when no clipboard route works', async () => {
        setClipboard(undefined);
        (document as any).execCommand = vi.fn(() => false);
        const { container } = renderBlock();
        const btn = container.querySelector('button')!;
        await act(async () => { fireEvent.click(btn); });
        expect(btn.getAttribute('data-state')).toBe('failed');
    });

    it('returns to the idle icon after the feedback time', async () => {
        vi.useFakeTimers();
        const { container } = renderBlock();
        const btn = container.querySelector('button')!;
        await act(async () => { fireEvent.click(btn); });
        expect(btn.getAttribute('data-state')).toBe('copied');
        await act(async () => { vi.advanceTimersByTime(COPY_FEEDBACK_MS); });
        expect(btn.getAttribute('data-state')).toBe('idle');
    });

    it('restarts the feedback time on a repeated click with the same outcome', async () => {
        vi.useFakeTimers();
        const { container } = renderBlock();
        const btn = container.querySelector('button')!;
        await act(async () => { fireEvent.click(btn); });
        await act(async () => { vi.advanceTimersByTime(COPY_FEEDBACK_MS - 200); });
        await act(async () => { fireEvent.click(btn); });
        // Past the first click's deadline, within the second's.
        await act(async () => { vi.advanceTimersByTime(400); });
        expect(btn.getAttribute('data-state')).toBe('copied');
        await act(async () => { vi.advanceTimersByTime(COPY_FEEDBACK_MS); });
        expect(btn.getAttribute('data-state')).toBe('idle');
    });

    it('does not take the focus or selection on mouse-down', () => {
        const { container } = renderBlock();
        const btn = container.querySelector('button')!;
        // fireEvent returns false when the default action was prevented.
        expect(fireEvent.mouseDown(btn)).toBe(false);
    });
});

// UTST for IMPL-LTTCE-PRV-00005 (REQ-LTTCE-PRV-00006) — "Copy SVG" on a diagram.
describe('CodeBlock — diagram', () => {
    let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

    beforeEach(() => {
        writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
        setClipboard({ writeText });
    });
    afterEach(() => { setClipboard(undefined); });

    /** A diagram block as App renders it: the Mermaid container inside the <pre>. */
    const renderDiagram = (inner: string) => render(
        <CodeBlock text="graph TD; A-->B" diagram>
            <div className="mermaid" dangerouslySetInnerHTML={{ __html: inner }} />
        </CodeBlock>,
    );

    const button = (container: HTMLElement, label: string) =>
        container.querySelector(`.code-copy-btn[aria-label="${label}"]`) as HTMLButtonElement;

    it('has "Copy SVG" before "Copy code"', () => {
        const { container } = renderDiagram('<svg><g/></svg>');
        const labels = Array.from(container.querySelectorAll('.code-copy-btn'))
            .map(b => b.getAttribute('aria-label'));
        expect(labels).toEqual([COPY_SVG_LABEL, COPY_CODE_LABEL]);
    });

    it('"Copy SVG" copies the rendered diagram as a standalone SVG', async () => {
        const { container } = renderDiagram('<svg id="d1"><g><text>A</text></g></svg>');
        const btn = button(container, COPY_SVG_LABEL);
        await act(async () => { fireEvent.click(btn); });
        const copied = writeText.mock.calls[0][0];
        expect(copied).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
        expect(copied).toContain('<text>A</text>');
        expect(btn.getAttribute('data-state')).toBe('copied');
    });

    it('"Copy code" on a diagram still copies the source text', async () => {
        const { container } = renderDiagram('<svg><g/></svg>');
        await act(async () => { fireEvent.click(button(container, COPY_CODE_LABEL)); });
        expect(writeText).toHaveBeenCalledWith('graph TD; A-->B');
    });

    it('"Copy SVG" reports failure, without copying, when the diagram did not render', async () => {
        const { container } = renderDiagram('<pre class="error">Failed to render diagram</pre>');
        const btn = button(container, COPY_SVG_LABEL);
        await act(async () => { fireEvent.click(btn); });
        expect(writeText).not.toHaveBeenCalled();
        expect(btn.getAttribute('data-state')).toBe('failed');
    });
});
