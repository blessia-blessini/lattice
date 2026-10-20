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

// UTST for IMPL-LTTCE-FOS-00003 (REQ-LTTCE-FOS-00003): a read-only document —
// the bundled third-party notices — cannot be changed by the user or by the
// editor's own programmatic edits, and becomes editable again when the prop
// is lifted.

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { EditorState } from '@codemirror/state';
import { Editor, EditorHandle, readOnlyExtensions } from './Editor';

const DOC = '- [ ] task\n  indented';

//******************************************************************************
// renderEditor
//******************************************************************************
const renderEditor = (readOnly: boolean) => {
    const ref = React.createRef<EditorHandle>();
    const props = {
        theme: 'light' as const, wordWrap: false, fontSize: 100, highlightMark: false,
        showWhitespace: false, tabSize: 2, initialDoc: DOC,
    };
    const result = render(<Editor ref={ref} {...props} readOnly={readOnly} />);
    const rerender = (ro: boolean) => result.rerender(<Editor ref={ref} {...props} readOnly={ro} />);
    const content = result.container.querySelector('.cm-content') as HTMLElement;
    return { ref, content, rerender };
};
// renderEditor END ************************************************************


describe('readOnlyExtensions', () => {
    it('adds nothing when off', () => {
        expect(readOnlyExtensions(false)).toEqual([]);
    });

    it('marks the state read-only and filters out every change', () => {
        const state = EditorState.create({ doc: 'abc', extensions: readOnlyExtensions(true) });
        expect(state.readOnly).toBe(true);
        expect(state.update({ changes: { from: 0, insert: 'x' } }).state.doc.toString()).toBe('abc');
    });
});

describe('Editor — read-only document', () => {
    beforeEach(() => {
        vi.mocked(TauriCore.invoke).mockReset();
        vi.mocked(TauriCore.invoke).mockImplementation(async (cmd: string, args?: unknown) => {
            if (cmd === 'tabify_text') return (args as { content: string }).content.replace(/^ {2}/gm, '\t');
            return null;
        });
    });

    it('ignores a task toggle from the preview', () => {
        const { ref } = renderEditor(true);
        act(() => {
            ref.current!.toggleTaskAtLine(1);
        });
        expect(ref.current!.getContent()).toBe(DOC);
    });

    it('ignores a backend rewrite (tabify)', async () => {
        const { ref, content } = renderEditor(true);
        await act(async () => {
            fireEvent.keyDown(content, { key: 't', ctrlKey: true, altKey: true });
        });
        await act(async () => {
            await ref.current!.tabifyIndentation();
        });
        expect(ref.current!.getContent()).toBe(DOC);
    });

    it('swallows a paste', () => {
        const { ref, content } = renderEditor(true);
        const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
        event.clipboardData = { items: [], getData: () => 'pasted' };
        act(() => {
            content.dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(true);
        expect(ref.current!.getContent()).toBe(DOC);
    });

    it('is editable without the prop, and again once it is lifted', () => {
        const { ref, rerender } = renderEditor(true);
        rerender(false);
        act(() => {
            ref.current!.toggleTaskAtLine(1);
        });
        expect(ref.current!.getContent()).toBe('- [x] task\n  indented');
    });
});
