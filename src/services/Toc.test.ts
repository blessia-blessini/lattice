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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { Toc, TOC_OPEN_MARKER, TOC_CLOSE_MARKER } from './Toc';

// The global setup file (src/test/setup.ts) already mocks
// `@tauri-apps/api/core` with a vi.fn(). We just override its return value
// per-test.
const mockedInvoke = vi.mocked(invoke);

describe('Toc service', () => {
    beforeEach(() => {
        mockedInvoke.mockReset();
    });

    it('forwards the document text to the update_toc command', async () => {
        mockedInvoke.mockResolvedValueOnce('updated content');

        const result = await Toc.update('original content');

        expect(mockedInvoke).toHaveBeenCalledTimes(1);
        expect(mockedInvoke).toHaveBeenCalledWith('update_toc', {
            content: 'original content',
        });
        expect(result).toBe('updated content');
    });

    it('returns the backend response unchanged (passthrough when no TOC blocks)', async () => {
        // The Rust backend returns the input verbatim when the document has
        // no TOC markers. We forward that through.
        const noTocDoc = '# Title\nbody\n';
        mockedInvoke.mockResolvedValueOnce(noTocDoc);

        const result = await Toc.update(noTocDoc);
        expect(result).toBe(noTocDoc);
    });

    it('propagates backend errors so callers can decide what to do', async () => {
        mockedInvoke.mockRejectedValueOnce(new Error('IPC went sideways'));

        await expect(Toc.update('whatever')).rejects.toThrow('IPC went sideways');
    });
});

describe('TOC marker constants', () => {
    it('exports the literal strings the Rust backend recognises', () => {
        // Hard-coded assertions on purpose: if either side changes the marker
        // shape, this test should fail loudly so the other side is updated.
        expect(TOC_OPEN_MARKER).toBe('<!-- TOC -->');
        expect(TOC_CLOSE_MARKER).toBe('<!-- /TOC -->');
    });
});
