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
// ITST for REQ-LTTCE-MRC-00002 / REQ-LTTCE-MRC-00003 (IMPL-LTTCE-MRC-00002) —
// the preview pane's copy listener, wired into the real App.
//
// The point of these tests is the *boundary*: a selection containing a diagram
// is rewritten, and a selection without one is not intercepted at all. The
// second half is what protects REQ-LTTCE-CPY-00001 — highlights survive a copy
// because the WebView's own copy path handles it, and that path must keep
// handling every selection that has no diagram in it.
// ---------------------------------------------------------------------------

import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { DIAGRAM_PNG_ATTR } from './lib/preview-copy';

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

const PNG = 'data:image/png;base64,AAAA';

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────
const renderApp = async () => {
    vi.mocked(TauriCore.invoke).mockImplementation((cmd: string) => {
        if (cmd === 'find_vault_settings_file') return Promise.resolve('/vault/.lattice/settings.json');
        if (cmd === 'load_settings') return Promise.resolve({});
        if (cmd === 'get_version_string') return Promise.resolve('0.0.0-TEST');
        return Promise.resolve(null);
    });
    const utils = render(<App />);
    await waitFor(() => expect(utils.container.querySelector('[data-testid="mock-editor"]')).toBeTruthy());
    const preview = utils.container.querySelector('.preview-pane') as HTMLElement;
    expect(preview).not.toBeNull();
    return { ...utils, preview };
};

/**
 * Put `html` in the preview pane and select all of it.
 *
 * The diagram markup is injected rather than rendered because rasterising an
 * SVG needs a canvas, which jsdom does not have — the cached PNG is exactly
 * what a real render would have left behind (see `Mermaid.tsx`).
 */
const selectInPreview = (preview: HTMLElement, html: string) => {
    const body = preview.querySelector('.preview-pane__body') as HTMLElement;
    body.innerHTML = html;
    const range = document.createRange();
    range.selectNodeContents(body);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
};

/** Fire a copy on the preview pane with a recording clipboardData. */
const fireCopy = async (preview: HTMLElement) => {
    const written: Record<string, string> = {};
    let prevented = false;
    await act(async () => {
        prevented = !fireEvent.copy(preview, {
            clipboardData: { setData: (type: string, value: string) => { written[type] = value; } },
        });
    });
    return { written, prevented };
};

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    delete (window as any).__LATTICE_INIT_DATA__;
});

describe('App — copying a preview selection that contains a diagram', () => {

    it('replaces the diagram with an img in the html flavour', async () => {
        const { preview } = await renderApp();
        selectInPreview(preview,
            `<p>before</p><div class="mermaid" ${DIAGRAM_PNG_ATTR}="${PNG}"><svg></svg></div>`);

        const { written, prevented } = await fireCopy(preview);

        expect(prevented).toBe(true);
        expect(written['text/html']).toContain(`<img src="${PNG}"`);
        expect(written['text/html']).toContain('<p>before</p>');
        expect(written['text/html']).not.toContain('<svg');
    });

    it('still puts the plain text on the clipboard', async () => {
        // Taking the event over means owning both flavours; a plain-text paste
        // must not come out empty.
        const { preview } = await renderApp();
        selectInPreview(preview,
            `<p>readable text</p><div class="mermaid" ${DIAGRAM_PNG_ATTR}="${PNG}"><svg></svg></div>`);

        const { written } = await fireCopy(preview);
        expect(written['text/plain']).toContain('readable text');
    });
});

describe('App — copying a preview selection with no diagram', () => {

    it('does not intercept the copy at all', async () => {
        const { preview } = await renderApp();
        selectInPreview(preview, '<p>just <em>prose</em> here</p>');

        const { written, prevented } = await fireCopy(preview);

        expect(prevented).toBe(false);
        expect(written).toEqual({});
    });

    it('leaves a highlighted selection to the native copy path', async () => {
        // REQ-LTTCE-CPY-00001 — the inline style is what carries the colour
        // into MS Word, and it does so without us touching the event.
        const { preview } = await renderApp();
        selectInPreview(preview, '<p><span style="background-color:#ffe000">lit</span></p>');

        const { written, prevented } = await fireCopy(preview);

        expect(prevented).toBe(false);
        expect(written).toEqual({});
    });

    it('ignores a copy fired with nothing selected', async () => {
        const { preview } = await renderApp();
        window.getSelection()!.removeAllRanges();

        const { written, prevented } = await fireCopy(preview);

        expect(prevented).toBe(false);
        expect(written).toEqual({});
    });
});
