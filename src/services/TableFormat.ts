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
 * Thin wrapper around the Rust `pad_tables` Tauri command.
 *
 * The detection + rewriting logic lives entirely in Rust (see
 * `src-tauri/src/table_format.rs`). The frontend role is just to:
 *   1. Hand the current document text to the backend.
 *   2. Receive the (possibly identical) result and let the caller decide
 *      whether to dispatch a CodeMirror replacement.
 *
 * Mirrors the shape of `Toc.update` so the editor's imperative-handle code
 * can treat both refresh-the-document operations identically.
 */
export const TableFormat = {
    /**
     * Send the document to Rust and receive a version with every detected
     * GFM pipe table re-emitted with space-padded columns. Documents with
     * no tables come back unchanged (string-equal to the input).
     */
    pad: async (content: string): Promise<string> => {
        return await invoke<string>('pad_tables', { content });
    },
};
