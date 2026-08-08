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
// UTST for REQ-LTTCE-FWT-00002 (IMPL-LTTCE-FWT-00002) — the `file-changed`
// listener must never reload the document out from under someone who is
// typing.
//
// Regression cover for the "typing jumps to the top of the file" defect. The
// listener used to be re-registered on every dirty transition; because
// `listen()` resolves asynchronously, the callback that actually fired was
// often the previous one, still convinced the document was clean. It reloaded
// mid-keystroke, which reset the editor state — caret to offset 0, undo
// history gone, un-saved keystrokes discarded.
//
// The assertions here are all about `docEpoch`: App bumps it exactly once per
// genuine load, and only an epoch bump lets the editor discard its state
// (see Editor.external-load.test.tsx).
// ---------------------------------------------------------------------------

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import * as TauriEvent from '@tauri-apps/api/event';

// ─────────────────────────────────────────────────────────────────────────────
// Editor stub — records the props App feeds it and lets each test dictate what
// the "user's editor" currently contains.
// ─────────────────────────────────────────────────────────────────────────────
const editorState = vi.hoisted(() => ({
    onDirtyChange: undefined as ((v: boolean) => void) | undefined,
    docEpoch: undefined as number | undefined,
    initialDoc: undefined as string | undefined,
    content: 'on disk',           // what getContent() reports
    markAsSaved: undefined as any,
}));

vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((props: any, ref: any) => {
        editorState.onDirtyChange = props.onDirtyChange;
        editorState.docEpoch = props.docEpoch;
        editorState.initialDoc = props.initialDoc;
        React.useImperativeHandle(ref, () => ({
            markAsSaved: editorState.markAsSaved,
            getContent: () => editorState.content,
            getScrollDOM: () => null,
            getTopVisibleLine: () => 1,
            scrollToLine: vi.fn(),
            undo: vi.fn(),
            redo: vi.fn(),
            toggleTaskAtLine: vi.fn().mockReturnValue(false),
            insertTocBlock: vi.fn().mockResolvedValue(undefined),
            updateToc: vi.fn().mockResolvedValue(undefined),
            padTables: vi.fn().mockResolvedValue(undefined),
        }));
        return <div data-testid="mock-editor" />;
    }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('mermaid', () => ({
    default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }) },
}));

const FILE = '/vault/test.md';
const DISK_ORIGINAL = 'on disk';

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────
type Harness = {
    /** Fire a backend `file-changed` event for `path` and flush React. */
    fireChange: (path?: string) => Promise<void>;
    /** Same, but not wrapped in `act` — for tests that need to interleave. */
    fireChangeRaw: (path?: string) => Promise<void> | undefined;
    /** Epoch currently seen by the editor. */
    epoch: () => number | undefined;
    /** Text currently handed to the editor as `initialDoc`. */
    loaded: () => string | undefined;
    /** How many times a `file-changed` listener has been registered. */
    listenCount: () => number;
};

/** Content `read_text_file` will return; tests reassign it. */
let diskContent = DISK_ORIGINAL;
/** Resolver used by the "goes dirty during the read" test; null = resolve now. */
let readGate: (() => void) | null = null;

const renderApp = async (): Promise<Harness> => {
    const handlers: Record<string, Function> = {};
    let fileChangedRegistrations = 0;
    vi.mocked(TauriEvent.listen).mockImplementation((event: string, handler: any) => {
        if (event === 'file-changed') fileChangedRegistrations++;
        handlers[event] = handler;
        return Promise.resolve(vi.fn());
    });

    vi.mocked(TauriCore.invoke).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'calc_base_path') return Promise.resolve();
        if (cmd === 'find_vault_settings_file') return Promise.resolve('/vault/.lattice/settings.json');
        if (cmd === 'load_settings') return Promise.resolve({});
        if (cmd === 'watch_file') return Promise.resolve();
        if (cmd === 'get_version_string') return Promise.resolve('0.0.0-TEST');
        if (cmd === 'read_text_file') {
            if (readGate) {
                return new Promise(resolve => {
                    readGate = () => resolve({ content: diskContent, hash: 'h' });
                });
            }
            return Promise.resolve({ content: diskContent, hash: 'h' });
        }
        if (cmd === 'write_text_file') return Promise.resolve({ path: args?.path, hash: 'h' });
        return Promise.resolve(null);
    });

    (window as any).__LATTICE_INIT_DATA__ = { path: FILE, content: DISK_ORIGINAL };
    const utils = render(<App />);
    await waitFor(() => expect(utils.container.querySelector('[data-testid="mock-editor"]')).toBeTruthy());
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    return {
        fireChange: async (path = FILE) => {
            await act(async () => { await handlers['file-changed']?.({ payload: path }); });
        },
        fireChangeRaw: (path = FILE) => handlers['file-changed']?.({ payload: path }),
        epoch: () => editorState.docEpoch,
        loaded: () => editorState.initialDoc,
        listenCount: () => fileChangedRegistrations,
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    diskContent = DISK_ORIGINAL;
    readGate = null;
    editorState.content = DISK_ORIGINAL;
    editorState.markAsSaved = vi.fn();
    sessionStorage.clear();
    delete (window as any).__LATTICE_INIT_DATA__;
});

describe('App — file-changed never clobbers an in-progress edit', () => {

    it('reloads (bumps the epoch) on a genuine external change', async () => {
        const h = await renderApp();
        const before = h.epoch()!;

        diskContent = 'changed by another program';
        editorState.content = DISK_ORIGINAL;   // user has not typed
        await h.fireChange();

        await waitFor(() => expect(h.epoch()).toBe(before + 1));
        expect(editorState.initialDoc).toBe('changed by another program');
    });

    it('does NOT reload when the file is dirty', async () => {
        const h = await renderApp();
        const before = h.epoch();

        await act(async () => { editorState.onDirtyChange?.(true); });
        editorState.content = 'on disk + typing';
        diskContent = 'changed by another program';

        await h.fireChange();
        expect(h.loaded()).toBe(DISK_ORIGINAL);
        expect(h.epoch()).toBe(before);
    });

    it('registers the listener exactly once, however often the dirty flag flips', async () => {
        // The listener must not be re-registered per dirty transition: since
        // `listen()` resolves asynchronously, re-registration leaves a window
        // in which the previous callback — created while the document was
        // clean — is still the live one. Registering once and reading the
        // flag through a ref removes the window entirely.
        const h = await renderApp();
        // Baseline: App's own listener plus the E2E probe in StaticRuntime.
        const atMount = h.listenCount();

        await act(async () => { editorState.onDirtyChange?.(true); });
        await act(async () => { editorState.onDirtyChange?.(false); });
        await act(async () => { editorState.onDirtyChange?.(true); });

        expect(h.listenCount()).toBe(atMount);
    });

    it('does NOT reload when the file goes dirty DURING the read', async () => {
        const h = await renderApp();
        const before = h.epoch();

        // Autosave has already written the user's earlier text to disk, so the
        // disk copy differs from what App last loaded — a reload would take.
        diskContent = 'on disk, autosaved';

        readGate = () => { }; // arm the gate: the next read hangs
        const fired = h.fireChangeRaw();

        // User types while the read is still in flight.
        await act(async () => { editorState.onDirtyChange?.(true); });
        editorState.content = 'on disk, autosaved + typed during read';

        await act(async () => {
            readGate?.();      // let the (now stale) read complete
            await fired;
        });

        expect(h.loaded()).toBe(DISK_ORIGINAL);
        expect(h.epoch()).toBe(before);
    });

    it('does NOT reload when the disk copy is identical to the editor (autosave echo)', async () => {
        // The reported defect, end to end: the user typed, autosave wrote it
        // out and marked the document clean, and the OS reported Lattice's own
        // write. Disk and editor agree; only App's last *loaded* copy is
        // older. Reloading here is what cost people their undo history.
        const h = await renderApp();
        const before = h.epoch();

        diskContent = 'on disk + what the user typed';
        editorState.content = 'on disk + what the user typed';

        await h.fireChange();

        expect(h.loaded()).toBe(DISK_ORIGINAL);
        expect(h.epoch()).toBe(before);
    });

    it('ignores events for a different file', async () => {
        const h = await renderApp();
        const before = h.epoch()!;

        diskContent = 'someone else changed';
        await h.fireChange('/vault/other.md');

        expect(h.epoch()).toBe(before);
    });
});
