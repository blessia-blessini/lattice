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
// ---------------------------------------------------------------------------
// ITST for REQ-LTTCE-PRV-00004 / 00005 / 00006 (ARCH-LTTCE-PRV-00003) — the code block
// copy button, wired into the real App's Markdown pipeline: which blocks get
// one, what a click puts on the clipboard, and that the HTML export of the
// same preview carries no button.
// ---------------------------------------------------------------------------

import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { answerTraceLog } from './test/trace-log-mock';
import { setClipboard } from './test/clipboard-mock';
import { buildExportHtml } from './lib/preview-copy';
import { COPY_CODE_LABEL, COPY_SVG_LABEL } from './components/CodeBlock';

vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((_props: any, ref: any) => {
        React.useImperativeHandle(ref, () => ({
            markAsSaved: vi.fn(), getContent: () => '', getScrollDOM: () => null,
            getTopVisibleLine: () => 1, scrollToLine: vi.fn(), undo: vi.fn(), redo: vi.fn(),
            toggleTaskAtLine: () => false, insertTocBlock: vi.fn(), updateToc: vi.fn(),
            padTables: vi.fn(),
        }));
        return <div data-testid="mock-editor" />;
    }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('mermaid', () => ({
    default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }) },
}));

const DOC = [
    'Inline `code` has no button.',
    '',
    '```js',
    'const a = 1;',
    'const b = 2;',
    '```',
    '',
    '```',
    'untagged fence',
    '```',
    '',
    '```mermaid',
    'graph TD; A-->B',
    '```',
].join('\n');

const renderPreview = async () => {
    (window as any).__LATTICE_INIT_DATA__ = { path: '/vault/doc.md', content: DOC };
    vi.mocked(TauriCore.invoke).mockImplementation((cmd: string) => {
        if (cmd === 'find_vault_settings_file') return Promise.resolve('/vault/.lattice/settings.json');
        if (cmd === 'load_settings') return Promise.resolve({});
        if (cmd === 'trace_log') return answerTraceLog();
        return Promise.resolve(null);
    });
    const utils = render(<App />);
    const select = await waitFor(() =>
        utils.container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement);
    await act(async () => { fireEvent.change(select, { target: { value: 'preview' } }); });
    const body = await waitFor(() => {
        const el = utils.container.querySelector('.preview-pane__body') as HTMLElement;
        expect(el.querySelectorAll('pre').length).toBeGreaterThanOrEqual(2);
        return el;
    });
    return { ...utils, body };
};

describe('App — copy button on preview code blocks', () => {
    let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
        setClipboard({ writeText });
    });
    afterEach(() => {
        setClipboard(undefined);
        delete (window as any).__LATTICE_INIT_DATA__;
    });

    /** aria-labels of the buttons on a block, in order. */
    const labelsOf = (block: Element) => Array.from(block.querySelectorAll('.code-copy-btn'))
        .map(b => b.getAttribute('aria-label'));

    /** The `.code-block` around the rendered diagram. */
    const diagramBlock = async (body: HTMLElement) => {
        await waitFor(() => expect(body.querySelector('.mermaid svg')).not.toBeNull());
        return body.querySelector('.mermaid')!.closest('.code-block')!;
    };

    it('gives code blocks "Copy code", the diagram also "Copy SVG", inline code nothing', async () => {
        const { body } = await renderPreview();
        const diagram = await diagramBlock(body);

        const blocks = Array.from(body.querySelectorAll('.code-block'));
        expect(blocks).toHaveLength(3);
        blocks.filter(b => b !== diagram)
            .forEach(b => expect(labelsOf(b)).toEqual([COPY_CODE_LABEL]));
        expect(labelsOf(diagram)).toEqual([COPY_SVG_LABEL, COPY_CODE_LABEL]);

        expect(body.querySelector('p > code')!.closest('.code-block')).toBeNull();
    });

    it('"Copy code" on a diagram copies its Mermaid source text, not the drawing', async () => {
        const { body } = await renderPreview();
        const btn = (await diagramBlock(body))
            .querySelector(`[aria-label="${COPY_CODE_LABEL}"]`) as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(writeText).toHaveBeenCalledWith('graph TD; A-->B');
    });

    it('"Copy SVG" on a diagram copies the rendered SVG', async () => {
        const { body } = await renderPreview();
        const btn = (await diagramBlock(body))
            .querySelector(`[aria-label="${COPY_SVG_LABEL}"]`) as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    });

    it('keeps the source-line attribute on the <pre> for scroll sync', async () => {
        const { body } = await renderPreview();
        const pre = body.querySelector('.code-block > pre')!;
        expect(pre.getAttribute('data-source-line')).toBe('3');
    });

    it('copies the highlighted block text exactly as written between the fences', async () => {
        const { body } = await renderPreview();
        const btn = body.querySelector('.code-block button') as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = 2;');
        expect(btn.getAttribute('data-state')).toBe('copied');
    });

    it('copies an untagged fence too', async () => {
        const { body } = await renderPreview();
        const btn = body.querySelectorAll('.code-block button')[1] as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(writeText).toHaveBeenCalledWith('untagged fence');
    });

    it('leaves the button out of the HTML export of the same preview', async () => {
        const { body } = await renderPreview();
        const html = buildExportHtml(body);
        expect(html).not.toContain('<button');
        expect(html).toContain('untagged fence');
    });
});
