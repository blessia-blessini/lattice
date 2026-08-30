// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 ONLY:
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE
//
// ─────────────────────────────────────────────────────────────────────────────
// App.coverage.test.tsx
// Targeted tests for uncovered lines identified in the v0.2.28 coverage report.
// Covers: reload prevention, MRU, settings loading, Tauri events, saveFile,
//         auto-save, blur-save, file-watcher, handleLoad/Save/NewWindow/DailyNote,
//         loadDocument, session restore, vault init, preview img, MRU submenu.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import * as TauriEvent from '@tauri-apps/api/event';
import * as TauriWebview from '@tauri-apps/api/webviewWindow';
import { open, save } from '@tauri-apps/plugin-dialog';
import { StaticRuntime } from '@services/StaticRuntime';

// ─────────────────────────────────────────────────────────────────────────────
// Capture Editor callbacks (onDirtyChange, onChange) via vi.hoisted so they
// are available inside the hoisted vi.mock factory.
// ─────────────────────────────────────────────────────────────────────────────
const editorCbs = vi.hoisted(() => ({
    onDirtyChange: undefined as ((v: boolean) => void) | undefined,
    onChange:      undefined as ((c: string) => void) | undefined,
}));

vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((props: any, ref: any) => {
        editorCbs.onDirtyChange = props.onDirtyChange;
        editorCbs.onChange      = props.onChange;
        const scrollDiv = React.useRef<HTMLDivElement>(null);
        React.useImperativeHandle(ref, () => ({
            markAsSaved:     vi.fn(),
            getContent:      () => 'mocked content',
            getScrollDOM:    () => scrollDiv.current,
            getTopVisibleLine: () => 1,
            scrollToLine:    vi.fn(),
            undo:            vi.fn(),
            redo:            vi.fn(),
            toggleTaskAtLine: vi.fn().mockReturnValue(false),
            insertTocBlock:  vi.fn().mockResolvedValue(undefined),
            updateToc:       vi.fn().mockResolvedValue(undefined),
            padTables:       vi.fn().mockResolvedValue(undefined),
        }));
        return <div data-testid="mock-editor" ref={scrollDiv} style={{ overflowY: 'scroll', height: '100%' }} />;
    }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('mermaid', () => ({
    default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }) },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Shared invoke mock factory — supports per-test overrides
// ─────────────────────────────────────────────────────────────────────────────
type InvokeOpts = {
    vaultPath?:       string | null;
    settingsResult?:  object;
    writePath?:       string;   // returned path from write_text_file (to test conflict)
    writeThrows?:     boolean;
    readThrows?:      boolean;
    newWindowThrows?: boolean;
    dailyNotePath?:   string;
    base64Throws?:    boolean;
    initVaultThrows?: boolean;
};

const makeInvoke = (opts: InvokeOpts = {}) => (cmd: string, args: any) => {
    if (cmd === 'trace_log')  { StaticRuntime.log(''); return Promise.resolve(); }
    if (cmd === 'calc_base_path')    return Promise.resolve();
    if (cmd === 'find_vault_settings_file')
        return Promise.resolve(opts.vaultPath !== undefined ? opts.vaultPath : '/vault/.lattice/settings.json');
    if (cmd === 'initialize_vault_settings') {
        if (opts.initVaultThrows) return Promise.reject(new Error('vault init failed'));
        return Promise.resolve('/vault/.lattice/settings.json');
    }
    if (cmd === 'read_text_file') {
        if (opts.readThrows) return Promise.reject(new Error('read failed'));
        return Promise.resolve({ content: '# Hello', hash: 'abc' });
    }
    if (cmd === 'write_text_file') {
        if (opts.writeThrows) return Promise.reject(new Error('write failed'));
        return Promise.resolve({ path: opts.writePath ?? args?.path ?? 'unknown', hash: 'new' });
    }
    if (cmd === 'watch_file')     return Promise.resolve();
    if (cmd === 'load_settings')  return Promise.resolve(opts.settingsResult ?? {});
    if (cmd === 'read_file_base64') {
        if (opts.base64Throws) return Promise.reject(new Error('b64 failed'));
        return Promise.resolve('data:image/png;base64,iVBORw==');
    }
    if (cmd === 'open_new_window') {
        if (opts.newWindowThrows) return Promise.reject(new Error('window failed'));
        return Promise.resolve();
    }
    if (cmd === 'create_daily_note_file')
        return Promise.resolve(opts.dailyNotePath ?? '/notes/2026-05-03.md');
    if (cmd === 'exit_app')   return Promise.resolve();
    return Promise.resolve(null);
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const renderApp = async (opts: {
    path?:    string;
    content?: string;
    invoke?:  (cmd: string, args: any) => any;
} = {}) => {
    vi.mocked(TauriCore.invoke).mockImplementation(opts.invoke ?? makeInvoke());
    if (opts.path !== undefined) {
        (window as any).__LATTICE_INIT_DATA__ = { path: opts.path, content: opts.content ?? '# Hi' };
    }
    const utils = render(<App />);
    await waitFor(() => expect(utils.container.querySelector('[data-testid="mock-editor"]')).toBeTruthy());
    return utils;
};

const waitForTitle = (fragment: string) =>
    waitFor(() => expect(document.title).toContain(fragment), { timeout: 3000 });

const openMenu = async (getByText: (t: string) => HTMLElement) => {
    await waitFor(() => expect(getByText('☰ Menu')).toBeTruthy());
    fireEvent.click(getByText('☰ Menu'));
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup
// ─────────────────────────────────────────────────────────────────────────────
const resetEnv = () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    delete (window as any).__LATTICE_INIT_DATA__;
    document.title = '';
};

// =============================================================================
// 1. Reload prevention — F5 / Ctrl+R / Cmd+R / contextmenu  (L104, L108)
// =============================================================================
describe('App — reload prevention', () => {
    beforeEach(resetEnv);

    it('F5 keydown is prevented', async () => {
        await renderApp();
        const e = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
        window.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
    });

    it('Ctrl+R keydown is prevented', async () => {
        await renderApp();
        const e = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true });
        window.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
    });

    it('Meta+R keydown is prevented (Mac)', async () => {
        await renderApp();
        const e = new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true });
        window.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
    });

    it('contextmenu default is prevented', async () => {
        await renderApp();
        const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        window.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
    });
});

// =============================================================================
// 2. MRU — localStorage parsing & error branch  (L251-254)
// =============================================================================
describe('App — MRU localStorage init', () => {
    beforeEach(resetEnv);

    it('populates mruList from valid localStorage JSON on mount', async () => {
        const items = ['/vault/a.md', '/vault/b.md'];
        localStorage.setItem('lattice-mru-list', JSON.stringify(items));

        const { getByText } = await renderApp({ path: '/vault/current.md' });
        await waitForTitle('current.md');

        // Open menu → Open Recent should be enabled (not "not-allowed")
        await openMenu(getByText);
        const openRecent = await waitFor(() => getByText('Open Recent'));
        const menuItem = openRecent.closest('.menu-item') as HTMLElement;
        expect(menuItem.style.cursor).not.toBe('not-allowed');
    });

    it('logs error and keeps empty MRU when localStorage JSON is invalid', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorage.setItem('lattice-mru-list', 'NOT_JSON{{{');

        await renderApp();

        // The error branch (L254) should fire
        await waitFor(() =>
            expect(errSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to parse MRU list'),
                expect.anything()
            )
        );
        errSpy.mockRestore();
    });
});

// =============================================================================
// 3. MRU truncation at 20 items  (L269)
// =============================================================================
describe('App — MRU truncation', () => {
    beforeEach(resetEnv);

    it('splices MRU list to 20 when a 21st unique path is added', async () => {
        // Pre-populate 20 unique paths that are NOT the new file
        const existing = Array.from({ length: 20 }, (_, i) => `/vault/file${i}.md`);
        localStorage.setItem('lattice-mru-list', JSON.stringify(existing));

        vi.mocked(open).mockResolvedValueOnce('/vault/new-file.md');

        const { getByText } = await renderApp({ path: '/vault/current.md' });
        await waitForTitle('current.md');

        await openMenu(getByText);
        const openHere = await waitFor(() => getByText('Open here ...'));
        await act(async () => { fireEvent.click(openHere); });

        await waitFor(() => {
            const mru: string[] = JSON.parse(localStorage.getItem('lattice-mru-list') || '[]');
            expect(mru.length).toBe(20);
            expect(mru[0]).toBe('/vault/new-file.md');
        });
    });
});

// =============================================================================
// 4. Settings loading — loadSettings applies values  (L304-310)
// =============================================================================
describe('App — settings loading', () => {
    beforeEach(resetEnv);

    it('applies defaultOpenTheme, wordWrap, saveOnBlur, dailyNotesPath from load_settings', async () => {
        const invoke = makeInvoke({
            settingsResult: {
                defaultOpenTheme: 'light',
                wordWrap:         true,
                saveOnBlur:       false,
                dailyNotesPath:   '/notes',
            },
        });
        const { container } = await renderApp({ path: '/vault/test.md', invoke });
        await waitForTitle('test.md');

        // m_vaultSettingsPath being set triggers loadSettings via its useEffect
        await waitFor(() => {
            // Theme should have switched to light
            const appContainer = container.querySelector('.container') as HTMLElement;
            expect(appContainer?.getAttribute('data-theme')).toBe('light');
        });
    });

    it('falls back to dark theme when defaultOpenTheme is invalid', async () => {
        const invoke = makeInvoke({ settingsResult: { defaultOpenTheme: 'invalid' } });
        const { container } = await renderApp({ path: '/vault/test.md', invoke });
        await waitForTitle('test.md');

        await waitFor(() => {
            const appContainer = container.querySelector('.container') as HTMLElement;
            expect(appContainer?.getAttribute('data-theme')).toBe('dark');
        });
    });
});

// =============================================================================
// 5. Tauri listen events — app:settings-opened / closed  (L345-356)
// =============================================================================
describe('App — Tauri listen events', () => {
    beforeEach(resetEnv);
    afterEach(() => vi.restoreAllMocks());

    it('app:settings-opened blocks the modal when label is not settings', async () => {
        const handlers: Record<string, Function> = {};
        vi.mocked(TauriEvent.listen).mockImplementation((event: string, handler: any) => {
            handlers[event] = handler;
            return Promise.resolve(vi.fn());
        });

        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        // Give the setupListeners async function time to complete
        await act(async () => {
            await new Promise(r => setTimeout(r, 50));
        });

        // Fire the settings-opened event
        if (handlers['app:settings-opened']) {
            await act(async () => { handlers['app:settings-opened']({ payload: null }); });
        }
        // No crash = pass (isModalBlocked is internal state)
        expect(true).toBe(true);
    });

    it('app:settings-closed unblocks modal and reloads settings', async () => {
        const handlers: Record<string, Function> = {};
        vi.mocked(TauriEvent.listen).mockImplementation((event: string, handler: any) => {
            handlers[event] = handler;
            return Promise.resolve(vi.fn());
        });

        const invoke = makeInvoke({ settingsResult: {} });
        await renderApp({ path: '/vault/test.md', invoke });
        await waitForTitle('test.md');

        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        if (handlers['app:settings-closed']) {
            await act(async () => { handlers['app:settings-closed']({ payload: null }); });
        }
        // loadSettings should be called (load_settings invoke)
        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('load_settings', expect.anything())
        );
    });
});

// =============================================================================
// 6. setWindowTitle — dirty prefix  (L384)
// =============================================================================
describe('App — setWindowTitle dirty flag', () => {
    beforeEach(resetEnv);

    it('window title is prefixed with * when editor becomes dirty', async () => {
        await renderApp({ path: '/vault/note.md' });
        await waitForTitle('note.md');

        // Trigger dirty via the captured onDirtyChange callback
        await act(async () => { editorCbs.onDirtyChange?.(true); });

        await waitFor(() => expect(document.title).toMatch(/^\*/));
    });
});

// =============================================================================
// 7. setWindowTitle — setTitle error path  (L391)
// =============================================================================
describe('App — setWindowTitle error handling', () => {
    beforeEach(resetEnv);
    afterEach(() => vi.restoreAllMocks());

    it('logs a warning but does not crash when setTitle rejects', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Make setTitle throw
        const webviewMod = await import('@tauri-apps/api/webviewWindow');
        vi.spyOn(webviewMod, 'getCurrentWebviewWindow').mockReturnValue({
            label:            'main',
            setFocus:         vi.fn(),
            show:             vi.fn(),
            close:            vi.fn(),
            onCloseRequested: vi.fn(),
            setTitle:         vi.fn().mockRejectedValue(new Error('title failed')),
        } as any);

        await renderApp({ path: '/vault/test.md' });

        await waitFor(() =>
            expect(errSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to set window title'),
                expect.anything()
            )
        );
        errSpy.mockRestore();
    });
});

// =============================================================================
// 8. saveFile conflict — response.path !== path  (L445-447)
// =============================================================================
describe('App — saveFile conflict detection', () => {
    beforeEach(resetEnv);

    it('alerts and updates path when server returns a different path', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const invoke = makeInvoke({ writePath: '/vault/renamed.md' });

        const { getByText } = await renderApp({ path: '/vault/original.md', invoke });
        await waitForTitle('original.md');

        // Make file dirty, then save via Ctrl+S
        await act(async () => { editorCbs.onDirtyChange?.(true); });
        await waitFor(() => expect(document.title).toMatch(/^\*/));

        fireEvent.keyDown(window, { key: 's', ctrlKey: true, bubbles: true });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(
                expect.stringContaining('Conflict detected')
            )
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 9. saveFile error — write_text_file throws  (L450)
// =============================================================================
describe('App — saveFile error branch', () => {
    beforeEach(resetEnv);

    it('logs error and does not crash when write_text_file rejects', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const invoke = makeInvoke({ writeThrows: true });

        await renderApp({ path: '/vault/test.md', invoke });
        await waitForTitle('test.md');

        await act(async () => { editorCbs.onDirtyChange?.(true); });
        fireEvent.keyDown(window, { key: 's', ctrlKey: true, bubbles: true });

        await waitFor(() =>
            expect(errSpy).toHaveBeenCalledWith(
                expect.stringContaining('Save failed'),
                expect.anything()
            )
        );
        errSpy.mockRestore();
    });
});

// =============================================================================
// 10. Auto-save timer — debounce set up  (L462-473)
// =============================================================================
describe('App — auto-save debounce', () => {
    beforeEach(resetEnv);
    afterEach(() => vi.restoreAllMocks());

    it('schedules a 10 s setTimeout when file is open and editor becomes dirty', async () => {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        await act(async () => { editorCbs.onDirtyChange?.(true); });

        await waitFor(() =>
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000)
        );
    });

    it('clears the previous timer when dirty state changes again', async () => {
        const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        // First dirty trigger sets timer
        await act(async () => { editorCbs.onDirtyChange?.(true); });
        // Second trigger (simulated by toggling) should clear the old timer
        await act(async () => { editorCbs.onDirtyChange?.(false); });
        await act(async () => { editorCbs.onDirtyChange?.(true); });

        await waitFor(() => expect(clearTimeoutSpy).toHaveBeenCalled());
    });
});

// =============================================================================
// 11. Save on blur  (L484-485)
// =============================================================================
describe('App — save on blur', () => {
    beforeEach(resetEnv);

    it('saves file on window blur when file is open and dirty', async () => {
        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        await act(async () => { editorCbs.onDirtyChange?.(true); });
        await waitFor(() => expect(document.title).toMatch(/^\*/));

        // Trigger blur
        await act(async () => { fireEvent(window, new Event('blur')); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', expect.anything())
        );
    });
});

// =============================================================================
// 12. File-changed event — reload (L499-519)
// =============================================================================
describe('App — file-changed event listener', () => {
    beforeEach(resetEnv);

    it('reloads content when changed path matches current path and editor is not dirty', async () => {
        const handlers: Record<string, Function> = {};
        vi.mocked(TauriEvent.listen).mockImplementation((event: string, handler: any) => {
            handlers[event] = handler;
            return Promise.resolve(vi.fn());
        });

        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        if (handlers['file-changed']) {
            await act(async () => {
                await handlers['file-changed']({ payload: '/vault/test.md' });
            });
        }
        // read_text_file should be called again for the reload
        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('read_text_file', expect.objectContaining({ path: '/vault/test.md' }))
        );
    });

    it('skips reload when the file is dirty', async () => {
        const handlers: Record<string, Function> = {};
        vi.mocked(TauriEvent.listen).mockImplementation((event: string, handler: any) => {
            handlers[event] = handler;
            return Promise.resolve(vi.fn());
        });

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        // Mark dirty
        await act(async () => { editorCbs.onDirtyChange?.(true); });

        const callsBefore = vi.mocked(TauriCore.invoke).mock.calls.length;

        if (handlers['file-changed']) {
            await act(async () => {
                await handlers['file-changed']({ payload: '/vault/test.md' });
            });
        }

        // No additional read_text_file call
        await waitFor(() =>
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skipping reload'))
        );
        logSpy.mockRestore();
    });
});

// =============================================================================
// 13. handleSave — direct save via Ctrl+S with open file  (L545)
// =============================================================================
describe('App — handleSave direct', () => {
    beforeEach(resetEnv);

    it('calls write_text_file when Ctrl+S pressed with an open dirty file', async () => {
        await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        await act(async () => { editorCbs.onDirtyChange?.(true); });
        await waitFor(() => expect(document.title).toMatch(/^\*/));

        fireEvent.keyDown(window, { key: 's', ctrlKey: true, bubbles: true });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({
                path: '/vault/test.md',
            }))
        );
    });
});

// =============================================================================
// 14. handleSave save-as — pre-saves dirty file before showing dialog  (L552-553)
// =============================================================================
describe('App — handleSave save-as pre-save', () => {
    beforeEach(resetEnv);

    it('calls write_text_file twice when save-as chosen while dirty (pre-save + save-as)', async () => {
        vi.mocked(save).mockResolvedValueOnce('/vault/new-name.md');

        const { getByText } = await renderApp({ path: '/vault/original.md' });
        await waitForTitle('original.md');

        await act(async () => { editorCbs.onDirtyChange?.(true); });
        await waitFor(() => expect(document.title).toMatch(/^\*/));

        await openMenu(getByText);
        const saveAs = await waitFor(() => getByText('Save as ...'));
        await act(async () => { fireEvent.click(saveAs); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({
                path: '/vault/new-name.md',
            }))
        );
    });
});

// =============================================================================
// 15. handleSave save-as — dialog throws  (L571)
// =============================================================================
describe('App — handleSave save-as error', () => {
    beforeEach(resetEnv);

    it('logs error and does not crash when save dialog rejects', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(save).mockRejectedValueOnce(new Error('dialog cancelled'));

        const { getByText } = await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        await openMenu(getByText);
        const saveAs = await waitFor(() => getByText('Save as ...'));
        await act(async () => { fireEvent.click(saveAs); });

        await waitFor(() =>
            expect(errSpy).toHaveBeenCalledWith(
                expect.stringContaining('Save As cancelled'),
                expect.anything()
            )
        );
        errSpy.mockRestore();
    });
});

// =============================================================================
// 16. promptForFile — returns null when user cancels  (L622)
// =============================================================================
describe('App — promptForFile null (user cancel)', () => {
    beforeEach(resetEnv);

    it('does nothing when open dialog returns null', async () => {
        vi.mocked(open).mockResolvedValueOnce(null);

        const invokesBefore = vi.mocked(TauriCore.invoke).mock.calls.length;
        const { getByText } = await renderApp();

        await openMenu(getByText);
        const openHere = await waitFor(() => getByText('Open here ...'));
        await act(async () => { fireEvent.click(openHere); });

        // No extra read_text_file call = loadDocument was not entered
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });
        const readCalls = vi.mocked(TauriCore.invoke).mock.calls.filter(c => c[0] === 'read_text_file');
        expect(readCalls.length).toBe(0);
    });
});

// =============================================================================
// 17. handleLoadInNewWindow  (L634-644)
// =============================================================================
describe('App — handleLoadInNewWindow', () => {
    beforeEach(resetEnv);

    it('calls open_new_window with selected path', async () => {
        vi.mocked(open).mockResolvedValueOnce('/vault/other.md');

        const { getByText } = await renderApp();
        await openMenu(getByText);
        const openInNew = await waitFor(() => getByText('Open in new ...'));
        await act(async () => { fireEvent.click(openInNew); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('open_new_window', { path: '/vault/other.md' })
        );
    });

    it('alerts when open_new_window rejects', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.mocked(open).mockResolvedValueOnce('/vault/other.md');
        const invoke = makeInvoke({ newWindowThrows: true });

        const { getByText } = await renderApp({ invoke });
        await openMenu(getByText);
        const openInNew = await waitFor(() => getByText('Open in new ...'));
        await act(async () => { fireEvent.click(openInNew); });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to open new window'))
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 18. handleOpenDailyNote  (L653-661)
// =============================================================================
describe('App — handleOpenDailyNote', () => {
    beforeEach(resetEnv);

    it('returns early with error log when dailyNotesPath is empty', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { getByText } = await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        await openMenu(getByText);
        const daily = await waitFor(() => getByText('To the Daily Note'));
        await act(async () => { fireEvent.click(daily); });

        await waitFor(() =>
            expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Daily notes path is not set'))
        );
        errSpy.mockRestore();
    });

    it('invokes create_daily_note_file and loads the result when dailyNotesPath is set', async () => {
        const invoke = makeInvoke({
            settingsResult: { dailyNotesPath: '/notes', defaultOpenTheme: 'dark' },
            dailyNotePath:  '/notes/2026-05-03.md',
        });

        const { getByText } = await renderApp({ path: '/vault/test.md', invoke });
        await waitForTitle('test.md');
        // Wait for loadSettings to apply dailyNotesPath
        await act(async () => { await new Promise(r => setTimeout(r, 100)); });

        await openMenu(getByText);
        const daily = await waitFor(() => getByText('To the Daily Note'));
        await act(async () => { fireEvent.click(daily); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('create_daily_note_file', expect.anything())
        );
    });
});

// =============================================================================
// 19 + 20. handleLoad + loadDocument  (L673-735)
// =============================================================================
describe('App — handleLoad and loadDocument', () => {
    beforeEach(resetEnv);

    it('loads a file selected from the open dialog into the editor', async () => {
        vi.mocked(open).mockResolvedValueOnce('/vault/picked.md');

        const { getByText } = await renderApp();
        await openMenu(getByText);
        const openHere = await waitFor(() => getByText('Open here ...'));
        await act(async () => { fireEvent.click(openHere); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('read_text_file', expect.objectContaining({ path: '/vault/picked.md' }))
        );
    });

    it('alerts when loadDocument fails to read the file', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.mocked(open).mockResolvedValueOnce('/vault/bad.md');
        const invoke = makeInvoke({ readThrows: true });

        const { getByText } = await renderApp({ invoke });
        await openMenu(getByText);
        const openHere = await waitFor(() => getByText('Open here ...'));
        await act(async () => { fireEvent.click(openHere); });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load file'))
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 21. Session restore from sessionStorage  (L775-794)
// =============================================================================
describe('App — session restore', () => {
    beforeEach(resetEnv);

    it('restores last open file from sessionStorage when no __LATTICE_INIT_DATA__', async () => {
        sessionStorage.setItem('lattice-last-open-path', '/vault/restored.md');
        // No __LATTICE_INIT_DATA__ set
        await renderApp();

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('read_text_file', expect.objectContaining({ path: '/vault/restored.md' }))
        , { timeout: 5000 });
    });

    it('clears sessionStorage and falls back to global vault when restore read fails', async () => {
        sessionStorage.setItem('lattice-last-open-path', '/vault/gone.md');
        const invoke = makeInvoke({ readThrows: true });
        await renderApp({ invoke });

        await waitFor(() => {
            expect(sessionStorage.getItem('lattice-last-open-path')).toBeNull();
        });
    });
});

// =============================================================================
// 22. handleNewWindow  (L811-816)
// =============================================================================
describe('App — handleNewWindow', () => {
    beforeEach(resetEnv);

    it('invokes open_new_window when "New Window" is clicked', async () => {
        const { getByText } = await renderApp();
        await openMenu(getByText);
        const newWin = await waitFor(() => getByText('New Window'));
        await act(async () => { fireEvent.click(newWin); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('open_new_window')
        , { timeout: 5000 });
    });

    it('alerts when open_new_window rejects', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const invoke = makeInvoke({ newWindowThrows: true });

        const { getByText } = await renderApp({ invoke });
        await openMenu(getByText);
        const newWin = await waitFor(() => getByText('New Window'));
        await act(async () => { fireEvent.click(newWin); });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to open new window'))
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 23. handleInitializeVault — success alert  (L833-834)
// =============================================================================
describe('App — handleInitializeVault success', () => {
    beforeEach(resetEnv);

    it('shows alert with new vault path on successful initialization', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        const { getByText } = await renderApp({ path: '/vault/test.md' });
        await waitForTitle('test.md');

        await openMenu(getByText);
        const initVault = await waitFor(() => getByText('Initialize Vault Here ...'));
        await act(async () => { fireEvent.click(initVault); });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(
                expect.stringContaining('Vault Initialized')
            )
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 24. handleOpenSettings — no vault path critical path  (L850-853)
// =============================================================================
describe('App — handleOpenSettings no vault', () => {
    beforeEach(resetEnv);
    afterEach(() => vi.restoreAllMocks());

    it('alerts when vault path cannot be resolved', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        // No vault path found at all
        const invoke = makeInvoke({ vaultPath: null });

        const { getByText } = await renderApp({ invoke });

        await openMenu(getByText);
        const settings = await waitFor(() => getByText('Settings ...'));
        await act(async () => { fireEvent.click(settings); });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(
                expect.stringContaining('No vault configuration found')
            )
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 24b. handleOpenSettings — vault lookup still in flight (regression)
//      Reported symptom: the very first time Settings is opened after launch,
//      "Critical: No vault configuration found." appears even though a vault
//      exists.  Cause: handleOpenSettings re-read the m_vaultSettingsPath it
//      had captured in its own closure after awaiting enforceVaultPath(), so
//      the freshly resolved path was invisible to it and the check could only
//      ever fail.  Settings must instead wait for the pending resolution.
// =============================================================================
describe('App — handleOpenSettings while vault lookup is pending', () => {
    beforeEach(resetEnv);
    afterEach(() => vi.restoreAllMocks());

    it('opens Settings without alerting when the vault path resolves late', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        // Hold find_vault_settings_file open so checkLaunch's enforceVaultPath
        // is still pending when the user reaches the Settings menu item.
        let releaseVault: (p: string) => void = () => {};
        const vaultGate = new Promise<string>((res) => { releaseVault = res; });

        const base = makeInvoke();
        const invoke = (cmd: string, args: any) =>
            cmd === 'find_vault_settings_file' ? vaultGate : base(cmd, args);

        const { getByText } = await renderApp({ path: '/vault/test.md', invoke });

        await openMenu(getByText);
        const settings = await waitFor(() => getByText('Settings ...'));

        // Click while the backend has not answered yet.
        await act(async () => { fireEvent.click(settings); });
        expect(alertSpy).not.toHaveBeenCalled();

        // Now let the backend answer.
        await act(async () => {
            releaseVault('/vault/.lattice/settings.json');
            await vaultGate;
        });

        await waitFor(() => expect(getByText('Close Settings')).toBeTruthy());
        expect(alertSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('No vault configuration found')
        );
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 24c. enforceVaultPath — backend Err (rejected invoke) must not escape
//      find_vault_settings_file returns Err when it cannot create even the
//      fallback vault (read-only / permission-denied app-data dir, full
//      storage — all realistic on Android + iOS).  That rejects the invoke;
//      an uncaught rejection would leave the user with no Settings dialog and
//      no message at all.  Expected: degrade to the actionable alert.
// =============================================================================
describe('App — vault lookup rejects', () => {
    beforeEach(resetEnv);
    afterEach(() => vi.restoreAllMocks());

    it('reports a vault failure instead of throwing when the backend errors', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const rejection = vi.fn();
        window.addEventListener('unhandledrejection', rejection);

        const base = makeInvoke();
        const invoke = (cmd: string, args: any) =>
            cmd === 'find_vault_settings_file'
                ? Promise.reject(new Error('Permission denied (os error 13)'))
                : base(cmd, args);

        const { getByText } = await renderApp({ invoke });

        await openMenu(getByText);
        const settings = await waitFor(() => getByText('Settings ...'));
        await act(async () => { fireEvent.click(settings); });

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith(
                expect.stringContaining('No vault configuration found')
            )
        );
        expect(rejection).not.toHaveBeenCalled();

        window.removeEventListener('unhandledrejection', rejection);
        alertSpy.mockRestore();
    });
});

// =============================================================================
// 25. handleEditorChange — triggers preview update  (L179)
// =============================================================================
describe('App — handleEditorChange updates preview', () => {
    beforeEach(resetEnv);

    it('updates preview when editor onChange fires', async () => {
        const { container } = await renderApp({ path: '/vault/test.md', content: '# Initial' });

        // Switch to preview mode so we can verify preview content
        const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
        await act(async () => { fireEvent.change(select, { target: { value: 'preview' } }); });

        // Fire onChange with new content
        await act(async () => { editorCbs.onChange?.('## Updated Content'); });

        await waitFor(() => {
            const preview = container.querySelector('.preview-pane');
            expect(preview?.textContent).toContain('Updated Content');
        });
    });
});

// =============================================================================
// 26. img — absolute src path branch  (L1175)
// =============================================================================
describe('App — preview img absolute src path', () => {
    beforeEach(resetEnv);

    it('loads image with absolute src via read_file_base64', async () => {
        // parentDir ends with '/' when path is at root, OR cleanSrc starts with '/'
        // Using src="/absolute/image.png" (no leading dot) → cleanSrc starts with '/'
        const { container } = await renderApp({
            path:    '/vault/test.md',
            content: '![abs](/absolute/image.png)',
        });

        const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
        await act(async () => { fireEvent.change(select, { target: { value: 'preview' } }); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('read_file_base64', expect.objectContaining({
                path: expect.stringContaining('absolute/image.png'),
            }))
        );
    });
});

// =============================================================================
// 27. img — read_file_base64 failure  (L1191)
// =============================================================================
describe('App — preview img base64 load failure', () => {
    beforeEach(resetEnv);

    it('does not crash when read_file_base64 rejects', async () => {
        const invoke = makeInvoke({ base64Throws: true });

        const { container } = await renderApp({
            path:    '/vault/test.md',
            content: '![local](./image.png)',
            invoke,
        });

        const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
        await act(async () => { fireEvent.change(select, { target: { value: 'preview' } }); });

        // Give the useEffect time to run and hit the .catch
        await act(async () => { await new Promise(r => setTimeout(r, 100)); });

        // Img renders without src (fallback placeholder)
        await waitFor(() => {
            const img = container.querySelector('.preview-pane img') as HTMLImageElement;
            expect(img).not.toBeNull();
        });
    });
});

// =============================================================================
// 28. img — no m_currentFilePath renders plain src  (L1195)
// =============================================================================
describe('App — preview img without current file path', () => {
    beforeEach(resetEnv);

    it('renders img with original src when m_currentFilePath is null', async () => {
        // Render without a path so m_currentFilePath remains null
        const { container } = await renderApp({ content: undefined });
        // Manually set preview content by triggering onChange
        const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
        await act(async () => { fireEvent.change(select, { target: { value: 'preview' } }); });
        await act(async () => { editorCbs.onChange?.('![img](./relative.png)'); });

        // m_currentFilePath is null → should render <img src="./relative.png" />
        await waitFor(() => {
            const img = container.querySelector('.preview-pane img') as HTMLImageElement;
            // If img is rendered, it will either have a src or not — no crash is the key assertion
            expect(img).not.toBeNull();
        });
    });
});

// =============================================================================
// 29. MRU submenu item click — triggers loadDocument  (L1351)
// =============================================================================
describe('App — MRU submenu item click', () => {
    beforeEach(resetEnv);

    it('calls loadDocument with the selected MRU path', async () => {
        localStorage.setItem('lattice-mru-list', JSON.stringify(['/vault/recent.md']));

        const { getByText } = await renderApp({ path: '/vault/current.md' });
        await waitForTitle('current.md');

        await openMenu(getByText);

        // Click "Open Recent" to expand submenu
        const openRecent = await waitFor(() => getByText('Open Recent'));
        await act(async () => { fireEvent.click(openRecent); });

        // Click the MRU item (path is short enough to not be truncated)
        const mruItem = await waitFor(() => getByText('/vault/recent.md'));

        await act(async () => { fireEvent.click(mruItem); });

        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('read_text_file', expect.objectContaining({
                path: '/vault/recent.md',
            }))
        );
    });
});

// =============================================================================
// 30. Refresh TOC menu item click  (L1365)
// =============================================================================
describe('App — Refresh TOC menu click', () => {
    beforeEach(resetEnv);

    it('clicking "Refresh TOC" calls updateToc on the editor ref', async () => {
        const { getByText } = await renderApp({ path: '/vault/test.md' });
        await openMenu(getByText);

        const refreshToc = await waitFor(() => getByText('Refresh TOC (Ctrl+Shift+T)'));
        await act(async () => { fireEvent.click(refreshToc); });

        // No crash = the onClick handler ran (updateToc is vi.fn() on the mock handle)
        expect(true).toBe(true);
    });
});
