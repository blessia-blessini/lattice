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
 * Thin wrapper around the Rust `tabify_text` / `untabify_text` Tauri
 * commands (IMPL-LTTCE-WSP-00009 lives in `src-tauri/src/tabify.rs`).
 *
 * Both commands rewrite ONLY line-start whitespace, column-accurate for
 * the given tab size. `startLine`/`endLine` are 1-based inclusive; pass
 * 0/0 to convert the whole document. Mirrors the `TableFormat.pad` shape
 * so the editor's snapshot → IPC → guarded-dispatch flow treats all
 * document-rewriting operations identically.
 */
export const Tabify = {
    /** Leading spaces → tabs (remainder columns stay as spaces). */
    toTabs: async (content: string, tabSize: number, startLine = 0, endLine = 0): Promise<string> => {
        return await invoke<string>('tabify_text', { content, tabSize, startLine, endLine });
    },
    /** Leading tabs → the equivalent number of space columns. */
    toSpaces: async (content: string, tabSize: number, startLine = 0, endLine = 0): Promise<string> => {
        return await invoke<string>('untabify_text', { content, tabSize, startLine, endLine });
    },
};
