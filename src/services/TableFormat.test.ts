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
import { TableFormat } from './TableFormat';

// `@tauri-apps/api/core` is mocked globally in src/test/setup.ts. Per-test we
// override the resolved value to simulate what the Rust command would return.
const mockedInvoke = vi.mocked(invoke);

describe('TableFormat service', () => {
    beforeEach(() => {
        mockedInvoke.mockReset();
    });

    it('forwards the document text to the pad_tables command', async () => {
        mockedInvoke.mockResolvedValueOnce('padded document');

        const result = await TableFormat.pad('original document');

        expect(mockedInvoke).toHaveBeenCalledTimes(1);
        // The Rust handler binds its argument as `content: String`, so the
        // JS-side argument key must be exactly `content` — guard against
        // accidental rename on either side.
        expect(mockedInvoke).toHaveBeenCalledWith('pad_tables', {
            content: 'original document',
        });
        expect(result).toBe('padded document');
    });

    it('returns the backend response unchanged when there are no tables', async () => {
        // The Rust backend returns the input verbatim when the document has
        // no detectable pipe tables. The wrapper must not transform the
        // result.
        const noTablesDoc = '# Title\nbody\n';
        mockedInvoke.mockResolvedValueOnce(noTablesDoc);

        const result = await TableFormat.pad(noTablesDoc);
        expect(result).toBe(noTablesDoc);
    });

    it('propagates backend errors so callers can decide what to do', async () => {
        mockedInvoke.mockRejectedValueOnce(new Error('IPC blew up'));

        await expect(TableFormat.pad('whatever')).rejects.toThrow('IPC blew up');
    });
});
