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

// UTST for REQ-LTTCE-WSP-00006 (frontend wiring of IMPL-LTTCE-WSP-00009):
// keymap + imperative-handle plumbing for Tabify/Untabify. The conversion
// logic itself lives in Rust (tabify.rs, tested in tabify_tests.rs); here
// the Rust command is mocked, so these tests assert the IPC contract
// (command name, tabSize, 0/0 = whole document) and the guarded dispatch.

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { Editor, EditorHandle } from './Editor';

// ── Test helper ───────────────────────────────────────────────────────────────
const renderEditor = (initialDoc: string, tabSize = 2) => {
    const ref = React.createRef<EditorHandle>();
    const { container } = render(
        <Editor
            ref={ref}
            theme="light"
            wordWrap={false}
            fontSize={100}
            highlightMark={false}
            showWhitespace={false}
            tabSize={tabSize}
            initialDoc={initialDoc}
        />
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content).not.toBeNull();
    return { ref, content };
};

// Mock only the two tabify commands; delegate everything else to a benign
// null resolve (same behaviour as the global setup mock).
const mockTabifyCommands = () => {
    vi.mocked(TauriCore.invoke).mockImplementation(async (cmd: string, args?: unknown) => {
        const a = args as { content: string } | undefined;
        if (cmd === 'tabify_text') return (a!.content as string).replace(/^ {2}/gm, '\t');
        if (cmd === 'untabify_text') return (a!.content as string).replace(/^\t/gm, '  ');
        return null;
    });
};

describe('Editor — Tabify/Untabify wiring', () => {
    beforeEach(() => {
        vi.mocked(TauriCore.invoke).mockClear();
        mockTabifyCommands();
    });

    it('Mod-Alt-t sends the doc to tabify_text with tabSize and whole-doc range', async () => {
        const { ref, content } = renderEditor('  a\n  b');
        await act(async () => {
            fireEvent.keyDown(content, { key: 't', ctrlKey: true, altKey: true });
        });
        await waitFor(() => {
            expect(TauriCore.invoke).toHaveBeenCalledWith('tabify_text', {
                content: '  a\n  b',
                tabSize: 2,
                startLine: 0, // empty selection → whole document
                endLine: 0,
            });
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe('\ta\n\tb'));
    });

    it('Mod-Alt-Shift-t sends the doc to untabify_text', async () => {
        const { ref, content } = renderEditor('\ta');
        await act(async () => {
            // Real browsers deliver key:'T' + keyCode:84 for Shift+T; CM6
            // resolves Shift- bindings through the keyCode base name, so the
            // event must carry both for the shifted binding to match.
            fireEvent.keyDown(content, { key: 'T', keyCode: 84, ctrlKey: true, altKey: true, shiftKey: true });
        });
        await waitFor(() => {
            expect(TauriCore.invoke).toHaveBeenCalledWith('untabify_text', expect.objectContaining({
                content: '\ta',
                tabSize: 2,
            }));
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe('  a'));
    });

    it('passes the configured tabSize through the IPC call', async () => {
        const { ref } = renderEditor('  x', 4);
        await act(async () => { await ref.current!.tabifyIndentation(); });
        expect(TauriCore.invoke).toHaveBeenCalledWith('tabify_text', expect.objectContaining({
            tabSize: 4,
        }));
    });

    it('imperative handle tabifyIndentation returns true and updates the doc', async () => {
        const { ref } = renderEditor('  x');
        let changed = false;
        await act(async () => { changed = await ref.current!.tabifyIndentation(); });
        expect(changed).toBe(true);
        expect(ref.current!.getContent()).toBe('\tx');
    });

    it('returns false and leaves the doc alone when nothing converts', async () => {
        const { ref } = renderEditor('plain');
        let changed = true;
        await act(async () => { changed = await ref.current!.untabifyIndentation(); });
        expect(changed).toBe(false);
        expect(ref.current!.getContent()).toBe('plain');
    });

    it('returns false when the backend rejects (graceful failure)', async () => {
        vi.mocked(TauriCore.invoke).mockRejectedValueOnce(new Error('ipc down'));
        const { ref } = renderEditor('  x');
        let changed = true;
        await act(async () => { changed = await ref.current!.tabifyIndentation(); });
        expect(changed).toBe(false);
        expect(ref.current!.getContent()).toBe('  x');
    });
});
