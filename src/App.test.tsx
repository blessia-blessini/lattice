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
import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { StaticRuntime } from "@services/StaticRuntime";
import { save } from '@tauri-apps/plugin-dialog';

// Mock dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn()
}));

// Mock the Editor to ensure refs and imperative handles work reliably in JSDOM
vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((_props, ref) => {
        const scrollDiv = React.useRef<HTMLDivElement>(null);
        React.useImperativeHandle(ref, () => ({
            markAsSaved: vi.fn(),
            getContent: () => "mocked content",
            getScrollDOM: () => scrollDiv.current,
            getTopVisibleLine: () => 1,
            scrollToLine: vi.fn(),
            undo: vi.fn(),
            redo: vi.fn(),
            toggleTaskAtLine: vi.fn().mockReturnValue(false),
        }));
        return <div data-testid="mock-editor" ref={scrollDiv} style={{ overflowY: 'scroll', height: '100%' }}></div>;
    })
}));

// Mock invoke return values
vi.mocked(TauriCore.invoke).mockImplementation((cmd, args: any) => {
    if (cmd === 'initialize_vault_settings') {
        return Promise.resolve('settings.json');
    }
    if (cmd === 'find_vault_settings_file') {
        return Promise.resolve(null);
    }
    if (cmd === 'read_text_file') {
        return Promise.resolve({ content: '# Demo', hash: '123' });
    }
    if (cmd === 'calc_base_path') {
        return Promise.resolve();
    }
    if (cmd === 'write_text_file') {
        return Promise.resolve({ path: args?.path || 'unknown', hash: 'new-hash' });
    }
    if (cmd === 'watch_file') {
        return Promise.resolve();
    }
    if (cmd === 'trace_log') {
        const time = new Date().toISOString().split('T')[1].replace('Z', '');
        // Use process.stdout to avoid recursion with patched console.error
        StaticRuntime.log(`[MOCK_TRACE:${time}] ${args?.msg || ''}\n`);
        return Promise.resolve();
    }
    return Promise.resolve(null);
});

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        delete (window as any).__LATTICE_INIT_DATA__;
    });

    const selectViewMode = async (container: HTMLElement, value: string) => {
        const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
        expect(select).toBeTruthy();
        await act(async () => {
            fireEvent.change(select, { target: { value } });
        });
    };

    it('renders without crashing', () => {
        render(<App />);
        expect(document.body).toBeTruthy();
    });

    it('preview pane has light theme colors by default (independent of app theme)', async () => {
        const { container } = render(<App />);

        await waitFor(() => {
            const previewPane = container.querySelector('.preview-pane');
            expect(previewPane).toBeTruthy();
            // data-preview-theme defaults to light
            expect(previewPane!.getAttribute('data-preview-theme')).toBe('light');
            // inline style must carry the light theme colors
            const style = (previewPane as HTMLElement).style;
            expect(style.backgroundColor).toBe('rgb(255, 255, 255)');
            expect(style.color).toBe('rgb(36, 41, 46)');
            expect(style.colorScheme).toBe('light');
        });
    });

    it('preview pane light theme is independent of dark editor theme', async () => {
        const { container, getByText } = render(<App />);

        await waitFor(() => expect(getByText('🌙')).toBeTruthy());

        // Toggle editor theme to light via toolbar button (☀️ / 🌙)
        fireEvent.click(getByText('🌙'));

        // Editor container should now be light
        await waitFor(() => {
            const appContainer = container.querySelector('.container') as HTMLElement;
            expect(appContainer.getAttribute('data-theme')).toBe('light');
        });

        // Preview pane must remain on its own independent theme (light by default)
        const previewPane = container.querySelector('.preview-pane') as HTMLElement;
        expect(previewPane.getAttribute('data-preview-theme')).toBe('light');
        expect(previewPane.style.backgroundColor).toBe('rgb(255, 255, 255)');
        expect(previewPane.style.colorScheme).toBe('light');
    });

    const DUAL_MODES = ['dual', 'dual-swap', 'dual-top', 'dual-bottom'];

    DUAL_MODES.forEach(mode => {
        it(`${mode}: both editor and preview panes are visible`, async () => {
            const { container } = render(<App />);
            await waitFor(() => expect(container.querySelector('select')).toBeTruthy());

            await selectViewMode(container, mode);

            await waitFor(() => {
                const editor  = container.querySelector('.editor-pane')  as HTMLElement;
                const preview = container.querySelector('.preview-pane') as HTMLElement;
                expect(editor.style.display,  `editor hidden in ${mode}` ).not.toBe('none');
                expect(preview.style.display, `preview hidden in ${mode}`).not.toBe('none');
            });
        });
    });

    it('dual-top: main-content has column flex direction', async () => {
        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('select')).toBeTruthy());
        await selectViewMode(container, 'dual-top');
        await waitFor(() => {
            const main = container.querySelector('.main-content') as HTMLElement;
            expect(main.style.flexDirection).toBe('column');
        });
    });

    it('dual-bottom: main-content has column-reverse flex direction', async () => {
        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('select')).toBeTruthy());
        await selectViewMode(container, 'dual-bottom');
        await waitFor(() => {
            const main = container.querySelector('.main-content') as HTMLElement;
            expect(main.style.flexDirection).toBe('column-reverse');
        });
    });

    it('dual-top/bottom: pane heights are auto (100% breaks column flex split)', async () => {
        for (const mode of ['dual-top', 'dual-bottom']) {
            const { container } = render(<App />);
            await waitFor(() => expect(container.querySelector('select')).toBeTruthy());
            await selectViewMode(container, mode);
            await waitFor(() => {
                const editor  = container.querySelector('.editor-pane')  as HTMLElement;
                const preview = container.querySelector('.preview-pane') as HTMLElement;
                expect(editor.style.height,  `editor height wrong in ${mode}` ).toBe('auto');
                expect(preview.style.height, `preview height wrong in ${mode}`).toBe('auto');
            });
        }
    });

    it('dual/dual-swap: pane heights are 100% (needed for horizontal flex split)', async () => {
        for (const mode of ['dual', 'dual-swap']) {
            const { container } = render(<App />);
            await waitFor(() => expect(container.querySelector('select')).toBeTruthy());
            await selectViewMode(container, mode);
            await waitFor(() => {
                const editor  = container.querySelector('.editor-pane')  as HTMLElement;
                const preview = container.querySelector('.preview-pane') as HTMLElement;
                expect(editor.style.height,  `editor height wrong in ${mode}` ).toBe('100%');
                expect(preview.style.height, `preview height wrong in ${mode}`).toBe('100%');
            });
        }
    });

    it('horizontal dual: preview pane remains visible after loading file content', async () => {
        (window as any).__LATTICE_INIT_DATA__ = {
            path: 'test-file.md',
            content: 'A'.repeat(200) + '\n' + 'B'.repeat(200) // long lines that expand CodeMirror
        };

        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('select')).toBeTruthy());

        for (const mode of ['dual', 'dual-swap']) {
            await selectViewMode(container, mode);
            await waitFor(() => {
                const preview = container.querySelector('.preview-pane') as HTMLElement;
                expect(preview.style.display, `preview hidden in ${mode} after file load`).not.toBe('none');
            });
        }
    });

    it('editor-pane has overflow:hidden (prevents CodeMirror content overflowing into preview)', () => {
        const css = readFileSync(resolve(import.meta.dirname, 'App.css'), 'utf-8');
        const editorPaneBlock = (() => {
            const start = css.indexOf('.editor-pane');
            let depth = 0, i = css.indexOf('{', start);
            const s = i;
            for (; i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}' && --depth === 0) return css.slice(s, i + 1);
            }
            return '';
        })();
        expect(editorPaneBlock).toMatch(/overflow\s*:\s*hidden/);
    });

    it('draggable divider: resizes panes when dragged horizontally', async () => {
        // JSDOM does not execute requestAnimationFrame callbacks — run them synchronously
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });

        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('select')).toBeTruthy());
        await selectViewMode(container, 'dual');

        const divider = await waitFor(() => {
            const el = container.querySelector('[data-testid="pane-divider"]');
            expect(el).toBeTruthy();
            return el as HTMLElement;
        });
        expect(divider.style.cursor).toBe('col-resize');

        const mainContent = container.querySelector('.main-content') as HTMLElement;
        Object.defineProperty(mainContent, 'getBoundingClientRect', {
            value: () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 }),
            configurable: true,
        });

        await act(async () => {
            fireEvent.mouseDown(divider, { clientX: 570, clientY: 300 });
            fireEvent.mouseMove(window, { clientX: 670, clientY: 300 }); // +100px on 1000px = +10%
            fireEvent.mouseUp(window);
        });

        await waitFor(() => {
            const editorPane = container.querySelector('.editor-pane') as HTMLElement;
            expect(editorPane.style.flex).toMatch(/67/);
        });

        rafSpy.mockRestore();
    });

    it('draggable divider: has row-resize cursor in vertical dual modes', async () => {
        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('select')).toBeTruthy());
        await selectViewMode(container, 'dual-top');

        const divider = await waitFor(() => {
            const el = container.querySelector('[data-testid="pane-divider"]');
            expect(el).toBeTruthy();
            return el as HTMLElement;
        });
        expect(divider.style.cursor).toBe('row-resize');
    });

    it('triggers save dialog and writes file when "Save as ..." is clicked', async () => {
        // Initialize the app with an open file so that "Save as ..." is enabled
        (window as any).__LATTICE_INIT_DATA__ = {
            path: 'mocked-initial.md',
            content: 'init content'
        };

        vi.mocked(save).mockResolvedValueOnce('mocked-new-file.md');
        const { getByText } = render(<App />);

        // Wait for render to settle
        await waitFor(() => expect(getByText('☰ Menu')).toBeTruthy());

        // Open menu
        fireEvent.click(getByText('☰ Menu'));

        // Click Save As ...
        const saveAsButton = await waitFor(() => getByText('Save as ...'));
        fireEvent.click(saveAsButton);

        // Verify save plugin was called
        await waitFor(() => expect(save).toHaveBeenCalled());

        // Verify Tauri write command was executed with the new path
        await waitFor(() => {
            expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({
                path: 'mocked-new-file.md',
                content: 'mocked content'
            }));
        });
    });
});

// ---------------------------------------------------------------------------
// CSS regression guards
// These tests read App.css directly and assert structural invariants that are
// invisible to jsdom (which does not apply stylesheets) but that silently broke
// rendering in the real WebView2/WebKit engine when violated.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// CSS regression guards
// These tests read App.css and github-markdown-css directly and assert
// structural invariants that are invisible to jsdom but silently broke
// rendering in WebView2/WebKit when violated.
// ---------------------------------------------------------------------------
describe('App.css invariants', () => {
    const css       = readFileSync(resolve(import.meta.dirname, 'App.css'), 'utf-8');
    const githubCss = readFileSync(
        resolve(import.meta.dirname, '../node_modules/github-markdown-css/github-markdown.css'), 'utf-8'
    );

    it(':root must not declare color-scheme: light dark (breaks WebView2 preview pane)', () => {
        const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(rootBlock).not.toMatch(/color-scheme\s*:\s*light\s+dark/);
    });

    it('body must not declare color-scheme: light dark (breaks WebView2 preview pane)', () => {
        const bodyBlocks = [...css.matchAll(/\bbody\b\s*\{([^}]*)\}/g)].map(m => m[1]).join('');
        expect(bodyBlocks).not.toMatch(/color-scheme\s*:\s*light\s+dark/);
    });

    it('App.css overrides use current github-markdown-css variable names (not stale ones)', () => {
        // Extract which CSS variables github-markdown-css actually defines in its dark block
        const darkMediaBlock = githubCss.match(/@media\s*\(prefers-color-scheme:\s*dark\)[^{]*\{([\s\S]*?)\}\s*\}/)?.[1] ?? '';
        const libVars = [...darkMediaBlock.matchAll(/--([\w-]+)\s*:/g)].map(m => `--${m[1]}`);

        // Key background/foreground vars that must be present in our dark override
        // Only assert the vars that directly affect background and body text
        const requiredVars = libVars.filter(v =>
            v === '--bgColor-default' || v === '--bgColor-muted' ||
            v === '--fgColor-default' || v === '--fgColor-muted'
        );

        // Extract block including nested rules — find the opening brace and collect until balanced close
        const darkStart = css.indexOf('.markdown-body[data-theme="dark"]');
        let ourDarkBlock = '';
        if (darkStart !== -1) {
            let depth = 0, i = css.indexOf('{', darkStart);
            const start = i;
            for (; i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}' && --depth === 0) { ourDarkBlock = css.slice(start, i + 1); break; }
            }
        }
        for (const varName of requiredVars) {
            expect(ourDarkBlock, `App.css must override ${varName} (used by github-markdown-css)`).toContain(varName);
        }
    });
});
