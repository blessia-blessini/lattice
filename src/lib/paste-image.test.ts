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

// UTST for REQ-LTTCE-IMP-00001 / 00002 — the pure rules of a picture paste.

import { describe, it, expect } from 'vitest';
import { imageMarkdown, isEmptyPaste } from './paste-image';

/** A stand-in for the paste event's DataTransfer. */
const transfer = (opts: { items?: unknown[]; types?: string[]; text?: string; html?: string }) =>
    ({
        items: opts.items ?? [],
        types: opts.types ?? [],
        getData: (type: string) =>
            type === 'text/plain' ? opts.text ?? '' : type === 'text/html' ? opts.html ?? '' : '',
    }) as unknown as DataTransfer;

describe('isEmptyPaste', () => {
    it('is true for the paste WebKitGTK delivers for a picture: no item, type or text', () => {
        expect(isEmptyPaste(transfer({}))).toBe(true);
    });

    it('is false when the web engine handed over an item (a picture on Windows or macOS)', () => {
        expect(isEmptyPaste(transfer({ items: [{ kind: 'file', type: 'image/png' }], types: ['Files'] }))).toBe(false);
    });

    it('is false for text, whether announced in types or only readable through getData', () => {
        expect(isEmptyPaste(transfer({ types: ['text/plain'], text: 'a' }))).toBe(false);
        expect(isEmptyPaste(transfer({ text: 'a' }))).toBe(false);
        expect(isEmptyPaste(transfer({ html: '<b>a</b>' }))).toBe(false);
    });

    it('is false when the event has no clipboard data at all', () => {
        expect(isEmptyPaste(null)).toBe(false);
        expect(isEmptyPaste(undefined)).toBe(false);
    });
});

describe('imageMarkdown', () => {
    it('links the saved picture relative to the document', () => {
        expect(imageMarkdown('doc_assets/img_1.png')).toBe('![Image](doc_assets/img_1.png)');
    });
});
