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
// ITST for REQ-LTTCE-SEL-00001 / 00002 / 00003 (IMPL-LTTCE-SEL-00004) —
// Ctrl/Cmd+A wired into the real App.
//
// The defect being locked down: Lattice is one DOM tree, so the WebView's own
// Select All used to take the toolbar and the file-path display with it. These
// tests assert the scoping from the outside — what the user would see in the
// selection — rather than the internals of the resolver, which has its own
// unit tests in `lib/select-all.test.ts`.
// ---------------------------------------------------------------------------

import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';

const editorSelectAll = vi.fn(() => true);

vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((_props: any, ref: any) => {
        React.useImperativeHandle(ref, () => ({
            markAsSaved: vi.fn(), getContent: () => '', getScrollDOM: () => null,
            getTopVisibleLine: () => 1, scrollToLine: vi.fn(), undo: vi.fn(), redo: vi.fn(),
            toggleTaskAtLine: () => false, insertTocBlock: vi.fn(), updateToc: vi.fn(),
            padTables: vi.fn(),
            selectAll: editorSelectAll,
        }));
        // Stands in for CodeMirror's contenteditable surface, so that
        // "focus is inside the edit pane" can be exercised.
        return <div data-testid="mock-editor" contentEditable />;
    }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('mermaid', () => ({
    default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }) },
}));

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
    return {
        ...utils,
        filePath: utils.container.querySelector('.file-path-display') as HTMLElement,
        editorPane: utils.container.querySelector('.editor-pane') as HTMLElement,
        previewBody: utils.container.querySelector('.preview-pane__body') as HTMLElement,
        viewSelect: utils.container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement,
    };
};

/** Ctrl+A on a specific element; returns whether the default was prevented. */
const ctrlA = (target: Element | Window) =>
    !fireEvent.keyDown(target as Element, { key: 'a', ctrlKey: true, bubbles: true });

const setView = async (select: HTMLSelectElement, mode: string) => {
    await act(async () => { fireEvent.change(select, { target: { value: mode } }); });
};

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.getSelection()?.removeAllRanges();
});

afterEach(() => {
    window.getSelection()?.removeAllRanges();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('App — Ctrl/Cmd+A scoping (REQ-LTTCE-SEL-00001)', () => {
    it('selects the document when focus is on the file-path display', async () => {
        // The reported defect, exactly: chrome has the focus, Ctrl+A used to
        // select the application including this element's text.
        const { filePath } = await renderApp();
        expect(ctrlA(filePath)).toBe(true);
        expect(editorSelectAll).toHaveBeenCalledTimes(1);
    });

    it('selects the document when nothing in particular has focus', async () => {
        await renderApp();
        expect(ctrlA(document.body)).toBe(true);
        expect(editorSelectAll).toHaveBeenCalledTimes(1);
    });

    it('leaves no DOM selection behind when it routes to the editor', async () => {
        // The editor owns its own selection; the document selection must not
        // also be spanning application chrome.
        const { filePath } = await renderApp();
        ctrlA(filePath);
        expect(window.getSelection()?.toString() ?? '').toBe('');
    });

    it('stands down when CodeMirror has already handled the chord', async () => {
        const { editorPane } = await renderApp();
        const swallow = (e: KeyboardEvent) => e.preventDefault();
        window.addEventListener('keydown', swallow, true);
        try {
            ctrlA(editorPane);
            expect(editorSelectAll).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', swallow, true);
        }
    });

    it('ignores chords that are not Select All', async () => {
        const { filePath } = await renderApp();
        fireEvent.keyDown(filePath, { key: 'a', ctrlKey: true, shiftKey: true, bubbles: true });
        fireEvent.keyDown(filePath, { key: 'a', bubbles: true });
        expect(editorSelectAll).not.toHaveBeenCalled();
    });
});

describe('App — Ctrl/Cmd+A in the preview pane (REQ-LTTCE-SEL-00002)', () => {
    it('selects the rendered body and nothing else', async () => {
        const { previewBody } = await renderApp();
        await act(async () => { previewBody.innerHTML = '<p>rendered paragraph</p>'; });

        expect(ctrlA(previewBody)).toBe(true);
        expect(editorSelectAll).not.toHaveBeenCalled();

        const selected = window.getSelection();
        expect(selected?.rangeCount).toBe(1);
        expect(selected?.toString()).toContain('rendered paragraph');
    });

    it('never reaches the file-path display or the toolbar', async () => {
        const { previewBody, filePath } = await renderApp();
        await act(async () => { previewBody.innerHTML = '<p>rendered paragraph</p>'; });
        ctrlA(previewBody);

        const text = window.getSelection()?.toString() ?? '';
        expect(filePath.textContent).toBeTruthy();
        expect(text).not.toContain(filePath.textContent as string);

        // Stronger form: the selected range must be contained by the body.
        const range = window.getSelection()!.getRangeAt(0);
        expect(previewBody.contains(range.commonAncestorContainer)).toBe(true);
    });

    it('routes chrome-focused Select All to the preview in preview-only view', async () => {
        const { filePath, previewBody, viewSelect } = await renderApp();
        await setView(viewSelect, 'preview');
        await act(async () => { previewBody.innerHTML = '<p>rendered paragraph</p>'; });

        expect(ctrlA(filePath)).toBe(true);
        expect(editorSelectAll).not.toHaveBeenCalled();
        expect(window.getSelection()?.toString()).toContain('rendered paragraph');
    });

    it('still prefers the edit pane in dual view when the chrome has focus', async () => {
        const { filePath, viewSelect } = await renderApp();
        await setView(viewSelect, 'dual');
        expect(ctrlA(filePath)).toBe(true);
        expect(editorSelectAll).toHaveBeenCalledTimes(1);
    });
});
