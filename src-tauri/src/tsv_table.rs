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

//! Spreadsheet clipboard (TSV) → GFM[^gfm] pipe table conversion.
//!
//! When a range is copied out of Excel, LibreOffice Calc, Google Sheets or
//! Numbers, the *plain-text* clipboard flavour is a TSV[^tsv] grid: rows
//! separated by newlines, cells separated by TAB. This module turns that grid
//! into a Markdown table. It is pure logic — no DOM, no IPC, no file I/O — so
//! it lives in Rust behind a Tauri command with a thin TS wrapper, per project
//! policy, and is unit-tested directly at the bottom of this file.
//!
//! ## The dialect we accept
//!
//! Spreadsheets do **not** emit bare TSV: a cell whose content contains a TAB,
//! a newline or a double quote is wrapped in `"` and its internal quotes are
//! doubled — the same escaping rule as CSV, with TAB as the delimiter. So a
//! naive `split('\t')` over `split('\n')` mangles any multi-line cell. We run a
//! real character-level scanner instead (`parse_tsv_grid`).
//!
//! ## Sanitation
//!
//! A GFM table row is delimited by `|` and lives on exactly one line, so two
//! characters of cell content cannot survive verbatim:
//!   * `|`  → escaped as `\|` (GFM's documented escape inside table cells),
//!   * newline → replaced by `<br>` (the only line break GFM renders inside a
//!     cell; a literal newline would terminate the row).
//! Backslashes are escaped as well, otherwise a trailing `\` in a cell would
//! swallow the following pipe.
//!
//! ## Padding
//!
//! The emitted table is handed to [`crate::table_format::pad_tables_in_document`]
//! rather than padded here — one padding implementation, one set of alignment
//! and minimum-dash rules, for both the "Pad Tables" command and this one (DRY).

use serde::Serialize;

use crate::table_format::pad_tables_in_document;

/// Minimum number of columns a grid needs before we consider it "tabular".
/// One column means the user copied a single spreadsheet column (or ordinary
/// prose) — a one-column Markdown table is almost never what they want, and
/// silently offering one would make the dialog fire on plain multi-line text.
const MIN_TABULAR_COLUMNS: usize = 2;

//******************************************************************************
// TabularPaste
//******************************************************************************
/// Result of inspecting a clipboard text payload.
///
/// `tabular == false` means "this is not a spreadsheet grid, paste it
/// verbatim"; in that case `markdown` is empty and the counts are zero. The
/// counts are carried back to the UI so the confirmation dialog can say
/// *"3 rows × 4 columns"* without re-parsing the text in TypeScript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabularPaste {
    /// True iff the payload parsed into a grid of at least
    /// [`MIN_TABULAR_COLUMNS`] columns and at least one row.
    pub tabular: bool,
    /// Number of grid rows, header row included. Zero when not tabular.
    pub rows: usize,
    /// Number of columns (widest row wins). Zero when not tabular.
    pub columns: usize,
    /// The padded Markdown table, without a trailing newline. Empty when not
    /// tabular.
    pub markdown: String,
}
// TabularPaste END ************************************************************

//******************************************************************************
// parse_tsv_grid
//******************************************************************************
/// Scan a clipboard payload into a rectangular-ish grid of raw cell strings.
///
/// Honours the spreadsheet quoting dialect described in the module docs:
/// a cell that starts with `"` is read until the closing `"`, with `""`
/// meaning one literal `"`; TAB and newline inside the quotes are content, not
/// delimiters. Unquoted cells end at the next TAB or newline.
///
/// Line endings are normalised (CRLF and lone CR both count as one row break).
/// A trailing row break does not produce a phantom empty row — spreadsheets
/// terminate the last row with one, so keeping it would add an empty body row
/// to every pasted table.
fn parse_tsv_grid(text: &str) -> Vec<Vec<String>> {
    let mut grid: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut chars = text.chars().peekable();
    // True while the scanner sits inside a `"…"` quoted cell.
    let mut in_quotes = false;
    // True while the current cell is still empty *and* unquoted, i.e. a `"`
    // seen right now opens a quoted cell rather than being literal content.
    let mut at_cell_start = true;

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    // Doubled quote — one literal `"`, stay inside the cell.
                    chars.next();
                    cell.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cell.push(c);
            }
            continue;
        }

        match c {
            '"' if at_cell_start => {
                in_quotes = true;
                at_cell_start = false;
            }
            '\t' => {
                row.push(std::mem::take(&mut cell));
                at_cell_start = true;
            }
            '\r' | '\n' => {
                // Collapse CRLF into a single row break.
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut cell));
                grid.push(std::mem::take(&mut row));
                at_cell_start = true;
            }
            _ => {
                cell.push(c);
                at_cell_start = false;
            }
        }
    }

    // Flush whatever the scanner was still holding. An unterminated quoted
    // cell (malformed clipboard) is kept rather than dropped — defensive:
    // losing user data is worse than an odd-looking last cell.
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        grid.push(row);
    }

    grid
}
// parse_tsv_grid END **********************************************************

//******************************************************************************
// escape_cell
//******************************************************************************
/// Make one raw cell safe to place between two `|` delimiters.
///
/// Order matters: backslashes are escaped first, otherwise the backslash we
/// insert in front of a `|` would itself be escaped on a second pass and the
/// pipe would come back to life.
fn escape_cell(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.push_str("\\\\"),
            '|' => out.push_str("\\|"),
            '\r' => {
                // CRLF inside a quoted cell — emit one break, not two.
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str("<br>");
            }
            '\n' => out.push_str("<br>"),
            _ => out.push(c),
        }
    }
    out.trim().to_string()
}
// escape_cell END *************************************************************

//******************************************************************************
// grid_to_markdown
//******************************************************************************
/// Render a parsed grid as a padded GFM table.
///
/// Row 0 becomes the header, an all-default alignment separator row is
/// inserted below it, and the remaining rows become the body. Short rows are
/// right-extended with empty cells so every row has the same pipe count.
///
/// The unpadded table is deliberately built in the canonical `| a | b |` shape
/// so that `pad_tables_in_document` recognises it as a table on the first pass
/// and only has to widen the columns.
fn grid_to_markdown(grid: &[Vec<String>]) -> String {
    if grid.is_empty() {
        return String::new();
    }
    let columns = grid.iter().map(|r| r.len()).max().unwrap_or(0);
    if columns == 0 {
        return String::new();
    }

    let render = |cells: &[String]| -> String {
        let mut line = String::from("|");
        for i in 0..columns {
            line.push(' ');
            line.push_str(&cells.get(i).map(|c| escape_cell(c)).unwrap_or_default());
            line.push(' ');
            line.push('|');
        }
        line
    };

    let mut lines: Vec<String> = Vec::with_capacity(grid.len() + 1);
    lines.push(render(&grid[0]));
    // Separator: no `:` markers — the user never asked for an alignment, and
    // `pad_tables_in_document` widens `---` to the column width for us.
    lines.push(format!("|{}", " --- |".repeat(columns)));
    for row in grid.iter().skip(1) {
        lines.push(render(row));
    }

    let table = lines.join("\n");
    // Reuse the one padding implementation (DRY) — see module docs.
    pad_tables_in_document(&table)
}
// grid_to_markdown END ********************************************************

//******************************************************************************
// looks_like_markdown_table
//******************************************************************************
/// `true` when the payload already *is* a Markdown table (a `|` row followed
/// by an alignment-separator row). Copying a table out of one Lattice window
/// into another must paste verbatim, not get re-wrapped into a table whose
/// cells are pipes.
fn looks_like_markdown_table(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    lines.windows(2).any(|w| {
        w[0].trim().contains('|') && crate::table_format::is_table_separator_line(w[1])
    })
}
// looks_like_markdown_table END ***********************************************

//******************************************************************************
// analyze_tabular_paste
//******************************************************************************
/// Public entry point: decide whether `text` is a spreadsheet grid and, if so,
/// produce the Markdown table it should become.
///
/// Guard clauses first — an empty payload, a payload with no TAB at all, or a
/// payload that is already a Markdown table are all "not tabular" and pass
/// straight through to the normal paste path.
pub fn analyze_tabular_paste(text: &str) -> TabularPaste {
    let not_tabular = TabularPaste {
        tabular: false,
        rows: 0,
        columns: 0,
        markdown: String::new(),
    };

    if text.is_empty() || !text.contains('\t') || looks_like_markdown_table(text) {
        return not_tabular;
    }

    let grid = parse_tsv_grid(text);
    if grid.is_empty() {
        return not_tabular;
    }
    let columns = grid.iter().map(|r| r.len()).max().unwrap_or(0);
    if columns < MIN_TABULAR_COLUMNS {
        // The TAB(s) were inside quoted cells, or the payload is a single
        // column — not a grid.
        return not_tabular;
    }

    TabularPaste {
        tabular: true,
        rows: grid.len(),
        columns,
        markdown: grid_to_markdown(&grid),
    }
}
// analyze_tabular_paste END ***************************************************

//******************************************************************************
// analyze_tabular_paste_cmd (Tauri command)
//******************************************************************************
/// IMPL-LTTCE-TBL-00001 — Tauri command wrapper. Takes the clipboard's
/// `text/plain` flavour, returns the verdict plus the ready-to-insert
/// Markdown table. The frontend never re-implements any of this; it only
/// decides *whether the user wants* the table.
#[tauri::command]
pub fn analyze_tabular_paste_cmd(text: String) -> TabularPaste {
    analyze_tabular_paste(&text)
}
// analyze_tabular_paste_cmd END ***********************************************

#[cfg(test)]
#[path = "tsv_table_tests.rs"]
mod tests;
