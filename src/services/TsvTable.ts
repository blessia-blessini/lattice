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
 * Verdict returned by the backend for one clipboard text payload.
 * Mirrors the Rust `TabularPaste` struct (`src-tauri/src/tsv_table.rs`),
 * which serialises with `rename_all = "camelCase"`.
 */
export interface TabularPaste {
    /** True when the payload is a spreadsheet grid worth offering as a table. */
    tabular: boolean;
    /** Grid row count, header row included. Zero when not tabular. */
    rows: number;
    /** Grid column count (widest row wins). Zero when not tabular. */
    columns: number;
    /** Ready-to-insert, column-padded Markdown table. Empty when not tabular. */
    markdown: string;
}

/**
 * Cheap synchronous pre-filter, applied inside the CodeMirror `paste` handler.
 *
 * The handler has to decide *synchronously* whether to call
 * `preventDefault()` — it cannot await the backend first. So the gate here is
 * deliberately the weakest possible test that no ordinary text paste can
 * fail: "does the payload contain a TAB at all". Everything beyond that (is it
 * really a grid, how many columns, is it already a Markdown table) stays in
 * Rust; if the backend then says "not tabular" the frontend inserts the raw
 * text itself, so the user sees a normal paste either way.
 *
 * This is not a duplicate of the backend's detection — it is a superset of it,
 * and intentionally so.
 */
export const mayBeTabular = (text: string): boolean => text.includes('\t');

/**
 * IMPL-LTTCE-TBL-00004 — thin wrapper around the Rust
 * `analyze_tabular_paste_cmd` Tauri command.
 *
 * The detection, TSV parsing, escaping and padding all live in Rust (see
 * `src-tauri/src/tsv_table.rs`). The frontend's only job is to ask the user
 * whether they want the table.
 */
export const TsvTable = {
    /**
     * Send a clipboard text payload to the backend and receive the verdict
     * plus, when tabular, the padded Markdown table to insert.
     */
    analyze: async (text: string): Promise<TabularPaste> => {
        return await invoke<TabularPaste>('analyze_tabular_paste_cmd', { text });
    },
};
