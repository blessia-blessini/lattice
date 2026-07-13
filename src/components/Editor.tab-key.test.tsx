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

// UTST for REQ-LTTCE-WSP-00004 (IMPL-LTTCE-WSP-00005) — Tab key inserts a
// literal tab character in the edit pane instead of moving browser focus.

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Editor, EditorHandle } from './Editor';

// ── Test helper ───────────────────────────────────────────────────────────────
// Renders the real Editor component (full CM6 view incl. the production
// keymap) and returns the ref handle plus the CM6 content DOM node, so the
// Tab key is exercised through the same event path a real keystroke takes.

const renderEditor = (initialDoc: string) => {
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

describe('Editor — Tab key inserts a tab character', () => {
    it('inserts "\\t" at the cursor on Tab with an empty selection', async () => {
        const { ref, content } = renderEditor('');
        await act(async () => { fireEvent.keyDown(content, { key: 'Tab' }); });
        expect(ref.current!.getContent()).toBe('\t');
    });

    it('accumulates multiple tabs on repeated Tab presses', async () => {
        const { ref, content } = renderEditor('');
        await act(async () => {
            fireEvent.keyDown(content, { key: 'Tab' });
            fireEvent.keyDown(content, { key: 'Tab' });
        });
        expect(ref.current!.getContent()).toBe('\t\t');
    });

    it('consumes the Tab keydown (preventDefault) so focus does not leave the editor', async () => {
        const { content } = renderEditor('abc');
        let cancelled = false;
        await act(async () => {
            // fireEvent returns false when the handler called preventDefault —
            // i.e. the browser's default focus-move is suppressed.
            cancelled = !fireEvent.keyDown(content, { key: 'Tab' });
        });
        expect(cancelled).toBe(true);
    });

    it('does not consume unrelated keys (sanity: keymap stays selective)', async () => {
        const { content } = renderEditor('abc');
        let cancelled = false;
        await act(async () => {
            cancelled = !fireEvent.keyDown(content, { key: 'F13' });
        });
        expect(cancelled).toBe(false);
    });
});
