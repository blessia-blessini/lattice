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
import * as TauriCore from '@tauri-apps/api/core';
import { FileSystem } from './FileSystem';

// The global setup.ts already mocks @tauri-apps/api/core and
// @tauri-apps/api/webviewWindow.  We just override invoke return values
// per-test using mockResolvedValueOnce.

describe('FileSystem service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // readTextFile
    // -----------------------------------------------------------------------
    describe('readTextFile', () => {
        it('invokes "read_text_file" with the given path and the window label', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce({ content: 'hello', hash: 'abc' });
            const result = await FileSystem.readTextFile('/docs/file.md');

            expect(TauriCore.invoke).toHaveBeenCalledWith('read_text_file', {
                path: '/docs/file.md',
                window_label: undefined, // setup mock returns no label property
            });
            expect(result).toEqual({ content: 'hello', hash: 'abc' });
        });
    });

    // -----------------------------------------------------------------------
    // writeTextFile
    // -----------------------------------------------------------------------
    describe('writeTextFile', () => {
        it('invokes "write_text_file" with path and content', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce({
                path: '/docs/file.md',
                hash: 'newhash',
            });
            const result = await FileSystem.writeTextFile('/docs/file.md', 'new content');

            expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', {
                path: '/docs/file.md',
                content: 'new content',
            });
            expect(result).toEqual({ path: '/docs/file.md', hash: 'newhash' });
        });
    });

    // -----------------------------------------------------------------------
    // watchFile
    // -----------------------------------------------------------------------
    describe('watchFile', () => {
        it('invokes "watch_file" with the given path', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce(undefined);
            await FileSystem.watchFile('/docs/file.md');

            expect(TauriCore.invoke).toHaveBeenCalledWith('watch_file', {
                path: '/docs/file.md',
            });
        });
    });

    // -----------------------------------------------------------------------
    // findVaultSettingsFile
    // -----------------------------------------------------------------------
    describe('findVaultSettingsFile', () => {
        it('invokes "find_vault_settings_file" and returns the path when found', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce('/vault/.lattice/settings.json');
            const result = await FileSystem.findVaultSettingsFile('/docs/note.md');

            expect(TauriCore.invoke).toHaveBeenCalledWith('find_vault_settings_file', {
                filePath: '/docs/note.md',
            });
            expect(result).toBe('/vault/.lattice/settings.json');
        });

        it('returns null when the backend reports no vault found', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce(null);
            const result = await FileSystem.findVaultSettingsFile('/no/vault/here.md');
            expect(result).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // initVaultSettingsPath
    // -----------------------------------------------------------------------
    describe('initVaultSettingsPath', () => {
        it('invokes "initialize_vault_settings" and returns the created path', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce('/vault/.lattice/settings.json');
            const result = await FileSystem.initVaultSettingsPath('/vault/note.md');

            expect(TauriCore.invoke).toHaveBeenCalledWith('initialize_vault_settings', {
                filePath: '/vault/note.md',
            });
            expect(result).toBe('/vault/.lattice/settings.json');
        });
    });

    // -----------------------------------------------------------------------
    // saveImage
    // -----------------------------------------------------------------------
    describe('saveImage', () => {
        it('invokes "save_image" with filePath and imageData', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce('/vault/assets/img.png');
            const result = await FileSystem.saveImage('/vault/assets/img.png', 'base64encodeddata==');

            expect(TauriCore.invoke).toHaveBeenCalledWith('save_image', {
                filePath: '/vault/assets/img.png',
                imageData: 'base64encodeddata==',
            });
            expect(result).toBe('/vault/assets/img.png');
        });
    });

    // -----------------------------------------------------------------------
    // isDir
    // -----------------------------------------------------------------------
    describe('isDir', () => {
        it('invokes "is_dir" and returns true for a directory', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce(true);
            const result = await FileSystem.isDir('/some/folder');

            expect(TauriCore.invoke).toHaveBeenCalledWith('is_dir', { path: '/some/folder' });
            expect(result).toBe(true);
        });

        it('returns false for a regular file', async () => {
            vi.mocked(TauriCore.invoke).mockResolvedValueOnce(false);
            const result = await FileSystem.isDir('/some/file.md');
            expect(result).toBe(false);
        });
    });
});
