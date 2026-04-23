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
import { invoke } from '@tauri-apps/api/core';

/**
 * Markers used by the Rust backend to locate TOC blocks.
 *
 * Kept in TS as constants because the editor (Insert TOC menu and the
 * cursor-position tooltip) needs to know what to insert and what to detect
 * without round-tripping through Rust just to learn the literal string.
 *
 * IMPORTANT: keep these in sync with src-tauri/src/toc.rs (the Rust side
 * matches markers case-insensitively but always emits uppercase, so changing
 * these constants does not require a Rust change as long as you stay within
 * the `<!-- TOC ... -->` / `<!-- /TOC -->` shape).
 */
export const TOC_OPEN_MARKER = '<!-- TOC -->';
export const TOC_CLOSE_MARKER = '<!-- /TOC -->';

export const Toc = {
    /**
     * Send the current document text to the Rust backend, which returns a
     * version with all `<!-- TOC ... -->` / `<!-- /TOC -->` blocks
     * regenerated. Documents with no TOC blocks come back unchanged.
     */
    update: async (content: string): Promise<string> => {
        return await invoke<string>('update_toc', { content });
    },
};
