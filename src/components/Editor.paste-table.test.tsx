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

// UTST for REQ-LTTCE-TBL-00001, -00002, -00007 and -00008 — the frontend half
// of the spreadsheet paste (IMPL-LTTCE-TBL-00003). The conversion itself lives
// in Rust (tsv_table.rs, tested in tsv_table_tests.rs); here the Tauri command
// is mocked, so these tests assert the *wiring*: the synchronous pre-filter,
// the IPC contract, which paths insert what, and that ordinary pastes are left
// entirely to CodeMirror.

import React from 'react';
import { render, fireEvent, act, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { Editor, EditorHandle } from './Editor';

const TSV = 'Name\tQty\nBolt\t12';
const TABLE = '| Name | Qty |\n| ---- | --- |\n| Bolt | 12  |';

// ── Test helpers ──────────────────────────────────────────────────────────────
const renderEditor = (initialDoc = '') => {
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
            initialDoc={initialDoc}
        />
    );
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content).not.toBeNull();
    return { ref, content };
};

/** Fire a paste carrying only a `text/plain` flavour, as Excel does. */
const pasteText = async (content: HTMLElement, text: string) => {
    let prevented = false;
    await act(async () => {
        prevented = !fireEvent.paste(content, {
            clipboardData: {
                items: [],
                getData: (type: string) => (type === 'text/plain' ? text : ''),
            },
        });
    });
    return prevented;
};

/** Backend mock: tabular verdict for the fixture, inert for anything else. */
const mockAnalyze = (verdict?: Record<string, unknown>) => {
    vi.mocked(TauriCore.invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'analyze_tabular_paste_cmd') {
            return verdict ?? { tabular: true, rows: 2, columns: 2, markdown: TABLE };
        }
        return null;
    });
};

describe('Editor — spreadsheet paste', () => {
    beforeEach(() => {
        vi.mocked(TauriCore.invoke).mockClear();
        mockAnalyze();
    });

    //**************************************************************************
    // pre-filter
    //**************************************************************************
    it('leaves a paste with no TAB entirely to CodeMirror', async () => {
        // Note: CodeMirror's own paste handling calls preventDefault for every
        // paste it services, so "was the event prevented" says nothing here.
        // What matters is that our branch never ran: no IPC, no dialog, and the
        // text arrives in the document by the ordinary route.
        const { ref, content } = renderEditor();
        await pasteText(content, 'just some prose');
        expect(TauriCore.invoke).not.toHaveBeenCalledWith(
            'analyze_tabular_paste_cmd',
            expect.anything()
        );
        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(() => expect(ref.current!.getContent()).toBe('just some prose'));
    });

    it('intercepts a TAB-carrying paste and asks the backend', async () => {
        const { content } = renderEditor();
        const prevented = await pasteText(content, TSV);
        expect(prevented).toBe(true);
        await waitFor(() =>
            expect(TauriCore.invoke).toHaveBeenCalledWith('analyze_tabular_paste_cmd', {
                text: TSV,
            })
        );
    });

    //**************************************************************************
    // the dialog and its three outcomes
    //**************************************************************************
    it('shows the dialog with the grid size the backend reported', async () => {
        const { content } = renderEditor();
        await pasteText(content, TSV);
        const dialog = await screen.findByRole('dialog');
        expect(dialog.textContent).toContain('2 rows × 2 columns');
    });

    it('"Insert as Markdown table" inserts the backend markdown', async () => {
        const { ref, content } = renderEditor();
        await pasteText(content, TSV);
        await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /insert as markdown table/i }));
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe(TABLE));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('"Insert as plain text" inserts the original clipboard payload', async () => {
        const { ref, content } = renderEditor();
        await pasteText(content, TSV);
        await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /insert as plain text/i }));
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe(TSV));
    });

    it('"Cancel" leaves the document untouched', async () => {
        const { ref, content } = renderEditor('unchanged');
        await pasteText(content, TSV);
        await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(ref.current!.getContent()).toBe('unchanged');
    });

    //**************************************************************************
    // block placement
    //**************************************************************************
    it('breaks the line so the table never fuses with existing text', async () => {
        // A fresh view puts the cursor at offset 0, so the table lands *before*
        // "prefix" and must be separated from it. The line-break rule itself is
        // unit-tested in block-insert.test.ts; this asserts the editor applies
        // it for the table path (REQ-LTTCE-TBL-00008).
        const { ref, content } = renderEditor('prefix');
        await pasteText(content, TSV);
        await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /insert as markdown table/i }));
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe(`${TABLE}\nprefix`));
    });

    it('does not break the line for the plain-text path', async () => {
        const { ref, content } = renderEditor('prefix');
        await pasteText(content, TSV);
        await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /insert as plain text/i }));
        });
        await waitFor(() => expect(ref.current!.getContent()).toBe(`${TSV}prefix`));
    });

    //**************************************************************************
    // fall-backs
    //**************************************************************************
    it('inserts the raw text when the backend says "not a grid"', async () => {
        mockAnalyze({ tabular: false, rows: 0, columns: 0, markdown: '' });
        const { ref, content } = renderEditor();
        await pasteText(content, TSV);
        await waitFor(() => expect(ref.current!.getContent()).toBe(TSV));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('inserts the raw text when the IPC call fails', async () => {
        vi.mocked(TauriCore.invoke).mockRejectedValue(new Error('backend down'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const { ref, content } = renderEditor();
        await pasteText(content, TSV);
        await waitFor(() => expect(ref.current!.getContent()).toBe(TSV));
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});
