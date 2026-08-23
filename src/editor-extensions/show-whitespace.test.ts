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

// UTST for REQ-LTTCE-WSP-00001 / REQ-LTTCE-WSP-00003 (IMPL-LTTCE-WSP-00001)

import { describe, it, expect, afterEach } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { showWhitespaceExtension } from './show-whitespace';

// ── Test helper ───────────────────────────────────────────────────────────────
// Creates a real CM6 EditorView (same pattern as gfm-linter.test.ts) so the
// whitespace decorations are exercised through CodeMirror's public rendering
// path rather than through internals.

const views: EditorView[] = [];

function makeView(doc: string, extensions: unknown[] = [showWhitespaceExtension]): EditorView {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = EditorState.create({ doc, extensions: extensions as never });
    const view = new EditorView({ state, parent: container });
    views.push(view);
    return view;
}

afterEach(() => {
    for (const v of views) {
        v.destroy();
        v.dom.parentNode?.removeChild(v.dom);
    }
    views.length = 0;
});

describe('showWhitespaceExtension', () => {
    it('marks stretches of spaces with .cm-highlightSpace', () => {
        const view = makeView('a b  c');
        const spaceMarks = view.dom.querySelectorAll('.cm-highlightSpace');
        expect(spaceMarks.length).toBeGreaterThan(0);
    });

    it('marks tab characters with .cm-highlightTab', () => {
        const view = makeView('a\tb');
        const tabMarks = view.dom.querySelectorAll('.cm-highlightTab');
        expect(tabMarks.length).toBe(1);
    });

    it('marks each tab individually', () => {
        const view = makeView('a\t\tb\tc');
        const tabMarks = view.dom.querySelectorAll('.cm-highlightTab');
        expect(tabMarks.length).toBe(3);
    });

    it('does not alter the document text (decoration only)', () => {
        const doc = 'line one\n\tindented  double-spaced\ntrailing ';
        const view = makeView(doc);
        expect(view.state.doc.toString()).toBe(doc);
        // The rendered text content must still contain the original characters
        expect(view.contentDOM.textContent).toContain('indented');
    });

    it('produces no whitespace marks when the extension is absent', () => {
        const view = makeView('a b\tc', []);
        expect(view.dom.querySelectorAll('.cm-highlightSpace').length).toBe(0);
        expect(view.dom.querySelectorAll('.cm-highlightTab').length).toBe(0);
    });

    it('does not mark non-whitespace characters', () => {
        const view = makeView('abc');
        expect(view.dom.querySelectorAll('.cm-highlightSpace').length).toBe(0);
        expect(view.dom.querySelectorAll('.cm-highlightTab').length).toBe(0);
    });

    it('can be toggled off and on via a compartment without losing content', () => {
        // Mirrors the Editor.tsx wiring: a compartment holding the extension
        // (or the empty extension) reconfigured at runtime — REQ-LTTCE-WSP-00002.
        const compartment = new Compartment();
        const view = makeView('a b\tc', [compartment.of(showWhitespaceExtension)]);
        expect(view.dom.querySelectorAll('.cm-highlightTab').length).toBe(1);

        view.dispatch({ effects: compartment.reconfigure([]) });
        expect(view.dom.querySelectorAll('.cm-highlightTab').length).toBe(0);
        expect(view.dom.querySelectorAll('.cm-highlightSpace').length).toBe(0);

        view.dispatch({ effects: compartment.reconfigure(showWhitespaceExtension) });
        expect(view.dom.querySelectorAll('.cm-highlightTab').length).toBe(1);
        expect(view.state.doc.toString()).toBe('a b\tc');
    });
});

// ── Invisible / exotic whitespace (REQ-LTTCE-WSP-00007, IMPL-LTTCE-WSP-0000A) ─
//
// Written as escapes on purpose — a raw invisible glyph in a fixture is exactly
// as unreadable here as it is in a user's document.
const NBSP = '\u00a0';
const ZWSP = '\u200b';
const IDEO = '\u3000';   // IDEOGRAPHIC SPACE

describe('showWhitespaceExtension — invisible characters', () => {
    it('marks a no-break space with .cm-invisibleChar', () => {
        const view = makeView(`- [ ]${NBSP}(note)`);
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(1);
    });

    it('marks each invisible character separately', () => {
        const view = makeView(`a${NBSP}b${NBSP}c${IDEO}d`);
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(3);
    });

    it('tags a zero-width character with the zero-width variant class', () => {
        const view = makeView(`a${ZWSP}b`);
        const marks = view.dom.querySelectorAll('.cm-invisibleChar-zeroWidth');
        expect(marks.length).toBe(1);
    });

    it('does not tag a width-carrying invisible as zero-width', () => {
        const view = makeView(`a${NBSP}b`);
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(1);
        expect(view.dom.querySelectorAll('.cm-invisibleChar-zeroWidth').length).toBe(0);
    });

    it('names the character in a title attribute', () => {
        const view = makeView(`a${NBSP}b`);
        const mark = view.dom.querySelector('.cm-invisibleChar');
        expect(mark?.getAttribute('title')).toBe('U+00A0 NO-BREAK SPACE');
    });

    it('does NOT mark ordinary spaces or tabs as invisible characters', () => {
        const view = makeView('a b\tc');
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(0);
    });

    it('does not alter the document text', () => {
        const doc = `- [ ]${NBSP}(note)`;
        const view = makeView(doc);
        expect(view.state.doc.toString()).toBe(doc);
    });

    it('produces no invisible marks when the extension is absent', () => {
        const view = makeView(`a${NBSP}b`, []);
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(0);
    });

    it('updates the marks when the document changes', () => {
        const view = makeView('a b');
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(0);
        view.dispatch({ changes: { from: 1, to: 2, insert: NBSP } });
        expect(view.dom.querySelectorAll('.cm-invisibleChar').length).toBe(1);
    });
});
