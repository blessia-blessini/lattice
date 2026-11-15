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

// ITST for REQ-LTTCE-IMP-00002 — the frontend half of a picture paste the web
// engine withheld (IMPL-LTTCE-IMP-00002). The host read itself is Rust
// (`read_clipboard_image`, `platform::read_clipboard_png`); here the Tauri
// commands are mocked, so these tests assert the wiring: an empty paste asks
// the host, a picture it returns is saved and linked through the same path as
// any pasted picture, and every other paste is left alone.

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { Editor, EditorHandle } from './Editor';
import { NO_FILE_FOR_IMAGE_MESSAGE } from '../lib/paste-image';

const DOC_PATH = '/notes/doc.md';
const PNG_B64 = 'iVBORw0KGgo=';
const SAVED = 'doc_assets/img_1.png';

// ── Test helpers ──────────────────────────────────────────────────────────────
const renderEditor = (currentFilePath: string | null = DOC_PATH) => {
    const ref = React.createRef<EditorHandle>();
    const { container } = render(
        <Editor
            ref={ref}
            theme="light"
            wordWrap={false}
            fontSize={100}
            highlightMark={false}
            showWhitespace={false}
            tabSize={2}
            initialDoc=""
            currentFilePath={currentFilePath}
        />
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content).not.toBeNull();
    return { ref, content };
};

/** Fire a paste as WebKitGTK delivers a picture: nothing in it at all. */
const pasteNothing = async (content: HTMLElement) => {
    let prevented = false;
    await act(async () => {
        prevented = !fireEvent.paste(content, {
            clipboardData: { items: [], types: [], getData: () => '' },
        });
    });
    return prevented;
};

/** Backend mock: the host clipboard holds `clip`; saving answers SAVED. */
const mockHost = (clip: string | null) => {
    vi.mocked(TauriCore.invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'read_clipboard_image') return clip;
        if (cmd === 'save_image') return SAVED;
        return null;
    });
};

describe('Editor — picture paste the web engine withheld', () => {
    let alertSpy: ReturnType<typeof vi.spyOn>;
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.mocked(TauriCore.invoke).mockReset();
        alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        // Restored here, not inside a test, so a failing assertion cannot
        // leave the spies installed for the tests that follow.
        alertSpy.mockRestore();
        errSpy.mockRestore();
    });

    it('asks the host for the clipboard picture, saves it and links it', async () => {
        mockHost(PNG_B64);
        const { ref, content } = renderEditor();
        expect(await pasteNothing(content)).toBe(true);
        await waitFor(() => expect(ref.current!.getContent()).toBe(`![Image](${SAVED})`));
        expect(TauriCore.invoke).toHaveBeenCalledWith('read_clipboard_image');
        expect(TauriCore.invoke).toHaveBeenCalledWith('save_image', { filePath: DOC_PATH, imageData: PNG_B64 });
    });

    it('changes nothing when the host finds no picture either', async () => {
        mockHost(null);
        const { ref, content } = renderEditor();
        await pasteNothing(content);
        await waitFor(() => expect(TauriCore.invoke).toHaveBeenCalledWith('read_clipboard_image'));
        expect(TauriCore.invoke).not.toHaveBeenCalledWith('save_image', expect.anything());
        expect(ref.current!.getContent()).toBe('');
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('says why when the document has no file to save the picture beside', async () => {
        mockHost(PNG_B64);
        const { ref, content } = renderEditor(null);
        await pasteNothing(content);
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(NO_FILE_FOR_IMAGE_MESSAGE));
        expect(TauriCore.invoke).not.toHaveBeenCalledWith('save_image', expect.anything());
        expect(ref.current!.getContent()).toBe('');
    });

    it('survives a failing host read without touching the document', async () => {
        vi.mocked(TauriCore.invoke).mockRejectedValue(new Error('host down'));
        const { ref, content } = renderEditor();
        await pasteNothing(content);
        await waitFor(() => expect(errSpy).toHaveBeenCalled());
        expect(ref.current!.getContent()).toBe('');
    });

    it('does not ask the host for a text paste', async () => {
        mockHost(PNG_B64);
        const { ref, content } = renderEditor();
        await act(async () => {
            fireEvent.paste(content, {
                clipboardData: { items: [], types: ['text/plain'], getData: (t: string) => (t === 'text/plain' ? 'prose' : '') },
            });
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe('prose'));
        expect(TauriCore.invoke).not.toHaveBeenCalledWith('read_clipboard_image');
    });
});
