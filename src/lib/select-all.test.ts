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

// UTST for REQ-LTTCE-SEL-00001 / 00002 / 00003

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    isNativeTextField,
    isSelectAllChord,
    resolveSelectAllScope,
    selectElementContents,
} from './select-all';

// ── DOM fixture: the application's shape in miniature ────────────────────────
// chrome (toolbar + file name) | editor pane (CM contenteditable) | preview pane
let root: HTMLElement;
let chrome: HTMLElement;
let fileName: HTMLElement;
let editorPane: HTMLElement;
let cmContent: HTMLElement;
let previewPane: HTMLElement;
let previewBody: HTMLElement;

beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
        <div class="toolbar"><span class="file-name">secret-plan.md</span></div>
        <div class="editor-pane"><div class="cm-content" contenteditable="true">source</div></div>
        <div class="preview-pane"><div class="preview-pane__body"><p>rendered</p></div></div>
    `;
    document.body.appendChild(root);
    chrome = root.querySelector('.toolbar') as HTMLElement;
    fileName = root.querySelector('.file-name') as HTMLElement;
    editorPane = root.querySelector('.editor-pane') as HTMLElement;
    cmContent = root.querySelector('.cm-content') as HTMLElement;
    previewPane = root.querySelector('.preview-pane') as HTMLElement;
    previewBody = root.querySelector('.preview-pane__body') as HTMLElement;
});

afterEach(() => {
    window.getSelection()?.removeAllRanges();
    root.remove();
});

const ctx = (target: Element | null, over: Partial<{ editorVisible: boolean; previewVisible: boolean }> = {}) => ({
    target,
    editorPane,
    previewPane,
    editorVisible: over.editorVisible ?? true,
    previewVisible: over.previewVisible ?? true,
});

// ── isSelectAllChord ─────────────────────────────────────────────────────────

describe('isSelectAllChord', () => {
    const chord = (o: Partial<KeyboardEvent>) => isSelectAllChord({
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'a', ...o,
    } as KeyboardEvent);

    it('accepts Ctrl+A and Cmd+A, upper or lower case', () => {
        expect(chord({ ctrlKey: true })).toBe(true);
        expect(chord({ metaKey: true })).toBe(true);
        expect(chord({ ctrlKey: true, key: 'A' })).toBe(true);
    });

    it('rejects a bare "a"', () => {
        expect(chord({})).toBe(false);
    });

    it('rejects Shift and Alt variants — those belong to other shortcuts', () => {
        expect(chord({ ctrlKey: true, shiftKey: true })).toBe(false);
        expect(chord({ ctrlKey: true, altKey: true })).toBe(false);
    });

    it('rejects other keys held with Ctrl', () => {
        expect(chord({ ctrlKey: true, key: 's' })).toBe(false);
    });
});

// ── isNativeTextField ────────────────────────────────────────────────────────

describe('isNativeTextField', () => {
    const input = (type?: string) => {
        const el = document.createElement('input');
        if (type !== undefined) el.type = type;
        return el;
    };

    it('is true for a textarea and for text-bearing input types', () => {
        expect(isNativeTextField(document.createElement('textarea'))).toBe(true);
        for (const t of ['text', 'search', 'url', 'tel', 'email', 'password', 'number']) {
            expect(isNativeTextField(input(t)), t).toBe(true);
        }
        expect(isNativeTextField(input()), 'no type attribute').toBe(true);
    });

    it('is false for non-text inputs', () => {
        for (const t of ['checkbox', 'radio', 'button', 'range', 'color', 'file']) {
            expect(isNativeTextField(input(t)), t).toBe(false);
        }
    });

    it('is false for CodeMirror\'s contenteditable surface', () => {
        // The edit pane must be reached by containment, not mistaken for an
        // input — otherwise Select All in the editor would be left to the WebView.
        expect(isNativeTextField(cmContent)).toBe(false);
    });

    it('is false for null and for ordinary elements', () => {
        expect(isNativeTextField(null)).toBe(false);
        expect(isNativeTextField(chrome)).toBe(false);
    });
});

// ── resolveSelectAllScope ────────────────────────────────────────────────────

describe('resolveSelectAllScope', () => {
    it('scopes to the editor when focus is inside the edit pane', () => {
        expect(resolveSelectAllScope(ctx(cmContent))).toBe('editor');
        expect(resolveSelectAllScope(ctx(editorPane))).toBe('editor');
    });

    it('scopes to the preview when focus is inside the preview pane', () => {
        expect(resolveSelectAllScope(ctx(previewBody))).toBe('preview');
        expect(resolveSelectAllScope(ctx(previewPane))).toBe('preview');
        expect(resolveSelectAllScope(ctx(previewBody.querySelector('p')))).toBe('preview');
    });

    it('falls back to the editor when focus is on the chrome and the edit pane is visible', () => {
        // This is the reported defect: focus on the toolbar / file name used to
        // mean "select the whole application".
        expect(resolveSelectAllScope(ctx(chrome))).toBe('editor');
        expect(resolveSelectAllScope(ctx(fileName))).toBe('editor');
        expect(resolveSelectAllScope(ctx(document.body))).toBe('editor');
        expect(resolveSelectAllScope(ctx(null))).toBe('editor');
    });

    it('falls back to the preview in preview-only view', () => {
        const preview = { editorVisible: false, previewVisible: true };
        expect(resolveSelectAllScope(ctx(chrome, preview))).toBe('preview');
        expect(resolveSelectAllScope(ctx(null, preview))).toBe('preview');
    });

    it('keeps a pane scoped even when the other one is also on screen', () => {
        // Dual view: containment decides, not the fallback.
        expect(resolveSelectAllScope(ctx(previewBody))).toBe('preview');
        expect(resolveSelectAllScope(ctx(cmContent))).toBe('editor');
    });

    it('leaves a real text field to the platform, wherever it sits', () => {
        const field = document.createElement('input');
        field.type = 'text';
        editorPane.appendChild(field);
        expect(resolveSelectAllScope(ctx(field))).toBe('native');

        const dialogField = document.createElement('textarea');
        chrome.appendChild(dialogField);
        expect(resolveSelectAllScope(ctx(dialogField))).toBe('native');
    });

    it('returns none when neither pane is visible', () => {
        expect(resolveSelectAllScope(ctx(chrome, { editorVisible: false, previewVisible: false })))
            .toBe('none');
    });

    it('tolerates panes that are not mounted yet', () => {
        expect(resolveSelectAllScope({
            target: document.body, editorPane: null, previewPane: null,
            editorVisible: true, previewVisible: true,
        })).toBe('editor');
    });
});

// ── selectElementContents ────────────────────────────────────────────────────

describe('selectElementContents', () => {
    it('selects everything inside the element', () => {
        expect(selectElementContents(previewBody)).toBe(true);
        expect(window.getSelection()?.toString()).toContain('rendered');
    });

    it('does not reach the file name or any other chrome', () => {
        selectElementContents(previewBody);
        const text = window.getSelection()?.toString() ?? '';
        expect(text).not.toContain('secret-plan.md');
        expect(text).not.toContain('source');
    });

    it('replaces a previous selection rather than adding to it', () => {
        selectElementContents(chrome);
        selectElementContents(previewBody);
        expect(window.getSelection()?.rangeCount).toBe(1);
        expect(window.getSelection()?.toString()).not.toContain('secret-plan.md');
    });

    it('returns false for a missing element instead of throwing', () => {
        expect(selectElementContents(null)).toBe(false);
    });
});
