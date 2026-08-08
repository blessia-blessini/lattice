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

// UTST for REQ-LTTCE-FWT-00002 (IMPL-LTTCE-FWT-00003) — the editor replaces
// its document only when the owner bumps `docEpoch`.
//
// Regression cover for the "typing jumps to the top of the file" defect: a
// stale `initialDoc` arriving mid-edit used to rebuild the CodeMirror state,
// which reset the caret to offset 0 and wiped the undo history.

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Editor, EditorHandle } from './Editor';

// ── Test helper ───────────────────────────────────────────────────────────────
// Renders the real Editor (full CM6 view + production keymap) and exposes a
// `reload` that re-renders with new props, exactly as App does.

const FILE_A = '/vault/a.md';
const FILE_B = '/vault/b.md';

const renderEditor = (initialDoc: string, docEpoch = 0, onDirtyChange?: (d: boolean) => void) => {
    const ref = React.createRef<EditorHandle>();
    const props = (doc: string, epoch: number, path: string | null = FILE_A) => (
        <Editor
            ref={ref}
            theme="light"
            wordWrap={false}
            fontSize={100}
            highlightMark={false}
            showWhitespace={false}
            tabSize={2}
            initialDoc={doc}
            docEpoch={epoch}
            currentFilePath={path}
            onDirtyChange={onDirtyChange}
        />
    );
    const { container, rerender } = render(props(initialDoc, docEpoch));
    const contentNode = () => container.querySelector('.cm-content') as HTMLElement;
    expect(contentNode()).not.toBeNull();

    // The live CM6 view, so the caret can be placed and read exactly.
    // Keystrokes are a poor probe here: `Tab` indents the whole line, so the
    // resulting text says nothing about where the caret was.
    const view = () => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;

    return {
        ref,
        contentNode,
        view,
        caret: () => view().state.selection.main.anchor,
        putCaret: async (offset: number) => {
            await act(async () => { view().dispatch({ selection: { anchor: offset } }); });
        },
        // Push new props at the editor. `epoch` unchanged = an ordinary
        // re-render; `epoch` bumped = a genuine load from disk. `path` defaults
        // to the file already open, i.e. a reload rather than a new file.
        rerender: async (doc: string, epoch: number, path: string | null = FILE_A) => {
            await act(async () => { rerender(props(doc, epoch, path)); });
        },
        // Tab is the cheapest keystroke that goes through the real keymap and
        // creates a real undo entry.
        typeTab: async () => {
            await act(async () => { fireEvent.keyDown(contentNode(), { key: 'Tab' }); });
        },
    };
};

describe('Editor — external document load is gated on docEpoch', () => {

    it('ignores a changed initialDoc while the epoch stays the same', async () => {
        // THE regression: App re-renders with text from disk that no longer
        // matches what the user has typed, without announcing a new load.
        const { ref, rerender, typeTab } = renderEditor('hello', 1);
        await typeTab();
        expect(ref.current!.getContent()).toBe('\thello');

        await rerender('hello from disk', 1); // stale prop, no new load
        expect(ref.current!.getContent()).toBe('\thello');
    });

    it('keeps the undo history across a same-epoch re-render', async () => {
        const { ref, rerender, typeTab } = renderEditor('hello', 1);
        await typeTab();
        await rerender('hello from disk', 1);

        await act(async () => { ref.current!.undo(); });
        expect(ref.current!.getContent()).toBe('hello');
    });

    it('leaves the caret where the user left it after a same-epoch re-render', async () => {
        const { rerender, putCaret, caret } = renderEditor('hello world', 1);
        await putCaret(7);
        await rerender('something else entirely', 1);
        expect(caret()).toBe(7);
    });

    it('replaces the document when the epoch is bumped', async () => {
        const { ref, rerender } = renderEditor('old text', 1);
        await rerender('brand new text', 2);
        expect(ref.current!.getContent()).toBe('brand new text');
    });

    it('preserves the caret offset when the SAME file is reloaded', async () => {
        // The headline symptom: after a reload the next keystroke used to land
        // at the top of the file.
        const { ref, rerender, putCaret, caret } = renderEditor('hello world', 1);
        await putCaret(7);
        await rerender('abcdefghijklm', 2);    // same path — external edit
        expect(ref.current!.getContent()).toBe('abcdefghijklm');
        expect(caret()).toBe(7);
    });

    it('clamps the caret when the reloaded document is shorter', async () => {
        const { ref, rerender, putCaret, caret } = renderEditor('a very long line', 1);
        await putCaret(12);
        await rerender('ab', 2);               // offset 12 no longer exists
        expect(ref.current!.getContent()).toBe('ab');
        expect(caret()).toBe(2);
    });

    it('starts at the top when a DIFFERENT file is opened', async () => {
        // A new document is not the one the caret belonged to; dropping the
        // user somewhere in its middle would be meaningless.
        const { ref, rerender, putCaret, caret } = renderEditor('hello world', 1);
        await putCaret(7);
        await rerender('a different document entirely', 2, FILE_B);
        expect(ref.current!.getContent()).toBe('a different document entirely');
        expect(caret()).toBe(0);
    });

    it('keeps the caret across a rename (Save As) followed by a reload', async () => {
        // Save As changes the path without loading anything: same document,
        // new name — so a later reload of that name must still keep the place.
        const { rerender, putCaret, caret } = renderEditor('hello world', 1);
        await putCaret(7);
        await rerender('hello world', 1, FILE_B);   // rename, no load
        expect(caret()).toBe(7);

        await rerender('hello world, edited', 2, FILE_B); // reload of the same doc
        expect(caret()).toBe(7);
    });

    it('reports the reloaded document as clean', async () => {
        const onDirtyChange = vi.fn();
        const { rerender, typeTab } = renderEditor('hello', 1, onDirtyChange);
        await typeTab();
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        onDirtyChange.mockClear();
        await rerender('fresh from disk', 2);
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('does nothing when the epoch bumps but the text is identical', async () => {
        // Belt and braces: even an authorised load must not throw away undo
        // history it has no reason to touch.
        const { ref, rerender, typeTab } = renderEditor('hello', 1);
        await typeTab();
        await rerender('\thello', 2);

        await act(async () => { ref.current!.undo(); });
        expect(ref.current!.getContent()).toBe('hello');
    });
});
