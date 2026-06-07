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
// Preview link routing (IMPL-LTTCE-LNK-00001 / 00003 / 00004)
// Split from App.test.tsx so this suite can be run in isolation:
//   LATTICEBUILD_NO=test npx vitest run src/App.link-routing.test.tsx
// Both this file and App.test.tsx are included automatically by vitest's
// default glob discovery and are therefore both exercised by `npm run test:coverage`.
// ---------------------------------------------------------------------------
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { StaticRuntime } from '@services/StaticRuntime';
import { openUrl } from '@tauri-apps/plugin-opener';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(),
    open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: '<svg>mermaid-mock</svg>' }),
    },
}));

vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((_props, ref) => {
        const scrollDiv = React.useRef<HTMLDivElement>(null);
        React.useImperativeHandle(ref, () => ({
            markAsSaved: vi.fn(),
            getContent: () => 'mocked content',
            getScrollDOM: () => scrollDiv.current,
            getTopVisibleLine: () => 1,
            scrollToLine: vi.fn(),
            undo: vi.fn(),
            redo: vi.fn(),
            toggleTaskAtLine: vi.fn().mockReturnValue(false),
            insertTocBlock: vi.fn().mockResolvedValue(undefined),
            updateToc: vi.fn().mockResolvedValue(undefined),
            padTables: vi.fn().mockResolvedValue(undefined),
        }));
        return <div data-testid="mock-editor" ref={scrollDiv} style={{ overflowY: 'scroll', height: '100%' }} />;
    }),
}));

// ── Shared invoke mock ────────────────────────────────────────────────────────

const makeInvokeMock = (vaultPath: string | null = '/vault/.lattice/settings.json') =>
    (cmd: string, args: any) => {
        if (cmd === 'initialize_vault_settings') return Promise.resolve('settings.json');
        if (cmd === 'find_vault_settings_file') return Promise.resolve(vaultPath);
        if (cmd === 'read_text_file') return Promise.resolve({ content: '# Demo', hash: '123' });
        if (cmd === 'calc_base_path') return Promise.resolve();
        if (cmd === 'write_text_file') return Promise.resolve({ path: args?.path || 'unknown', hash: 'new-hash' });
        if (cmd === 'watch_file') return Promise.resolve();
        if (cmd === 'read_file_base64') return Promise.resolve('data:image/png;base64,iVBORw==');
        if (cmd === 'trace_log') {
            const time = new Date().toISOString().split('T')[1].replace('Z', '');
            StaticRuntime.log(`[MOCK_TRACE:${time}] ${args?.msg || ''}\n`);
            return Promise.resolve();
        }
        return Promise.resolve(null);
    };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('App — preview link routing', () => {
    const CONTENT_WITH_LINKS = [
        '[secure](https://example.com)',
        '[insecure](http://insecure.example.com)',
        '[local doc](./sibling.md)',
        '[plain text](../notes.txt)',
        '[non-doc](./image.png)',
        '[bare www](www.example.com)',
    ].join('\n\n');

    const renderWithLinks = async () => {
        (window as any).__LATTICE_INIT_DATA__ = {
            path: '/vault/current.md',
            content: CONTENT_WITH_LINKS,
        };
        vi.mocked(TauriCore.invoke).mockImplementation(makeInvokeMock());
        const result = render(<App />);
        // Switch to preview so ReactMarkdown renders the <a> elements
        const select = await waitFor(() =>
            result.container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement
        );
        await act(async () => { fireEvent.change(select, { target: { value: 'preview' } }); });
        return result;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        delete (window as any).__LATTICE_INIT_DATA__;
    });

    it('http:// link renders as a <span> (not <a>) — non-clickable blocked element', async () => {
        const { container } = await renderWithLinks();
        await waitFor(() => {
            const spans = Array.from(container.querySelectorAll('span'));
            const blocked = spans.find(s => s.textContent === 'insecure');
            expect(blocked, 'http link should render as <span>').toBeTruthy();
            expect(blocked!.style.cursor).toBe('not-allowed');
            expect(blocked!.style.textDecoration).toContain('line-through');
        });
    });

    it('http:// span carries the "intentionally blocked" title tooltip', async () => {
        const { container } = await renderWithLinks();
        await waitFor(() => {
            const spans = Array.from(container.querySelectorAll('span'));
            const blocked = spans.find(s => s.textContent === 'insecure');
            expect(blocked).toBeTruthy();
            expect(blocked!.getAttribute('title')).toMatch(/intentionally blocked/i);
        });
    });

    it('https:// link click calls openUrl and does not invoke open_new_window', async () => {
        const { container } = await renderWithLinks();
        const link = await waitFor(() => {
            const anchors = Array.from(container.querySelectorAll('a'));
            return anchors.find(a => a.textContent === 'secure');
        });
        expect(link).toBeTruthy();
        await act(async () => { fireEvent.click(link!); });
        expect(openUrl).toHaveBeenCalledWith('https://example.com');
        expect(TauriCore.invoke).not.toHaveBeenCalledWith('open_new_window', expect.anything());
    });

    it('local .md link click invokes open_new_window with resolved path', async () => {
        const { container } = await renderWithLinks();
        const link = await waitFor(() => {
            const anchors = Array.from(container.querySelectorAll('a'));
            return anchors.find(a => a.textContent === 'local doc');
        });
        expect(link).toBeTruthy();
        await act(async () => { fireEvent.click(link!); });
        await waitFor(() => {
            expect(TauriCore.invoke).toHaveBeenCalledWith(
                'open_new_window',
                { path: '/vault/sibling.md' }
            );
        });
    });

    it('local .txt link click invokes open_new_window with resolved path', async () => {
        const { container } = await renderWithLinks();
        const link = await waitFor(() => {
            const anchors = Array.from(container.querySelectorAll('a'));
            return anchors.find(a => a.textContent === 'plain text');
        });
        expect(link).toBeTruthy();
        await act(async () => { fireEvent.click(link!); });
        await waitFor(() => {
            expect(TauriCore.invoke).toHaveBeenCalledWith(
                'open_new_window',
                { path: '/notes.txt' }
            );
        });
    });

    it('non-document local link (.png) does NOT invoke open_new_window', async () => {
        const { container } = await renderWithLinks();
        const link = await waitFor(() => {
            const anchors = Array.from(container.querySelectorAll('a'));
            return anchors.find(a => a.textContent === 'non-doc');
        });
        expect(link).toBeTruthy();
        await act(async () => { fireEvent.click(link!); });
        await new Promise(r => setTimeout(r, 50));
        expect(TauriCore.invoke).not.toHaveBeenCalledWith('open_new_window', expect.anything());
    });

    // IMPL-LTTCE-LNK-00004 — schemeless www. link assumes https
    it('bare www. link click calls openUrl with https:// prefix', async () => {
        const { container } = await renderWithLinks();
        const link = await waitFor(() => {
            const anchors = Array.from(container.querySelectorAll('a'));
            return anchors.find(a => a.textContent === 'bare www');
        });
        expect(link).toBeTruthy();
        await act(async () => { fireEvent.click(link!); });
        expect(openUrl).toHaveBeenCalledWith('https://www.example.com');
        expect(TauriCore.invoke).not.toHaveBeenCalledWith('open_new_window', expect.anything());
    });
});
