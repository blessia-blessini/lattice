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

//! Markdown table padding ("pretty-print") for GFM tables.
//!
//! This module is a pure, side-effect-free string transformation. It scans the
//! document for blocks of consecutive lines that form a GFM-style pipe table
//! (header row + alignment-separator row + zero or more body rows) and rewrites
//! them so that every column is space-padded to the width of its widest cell.
//! Tables that already happen to be perfectly padded are returned unchanged.
//!
//! Why this lives in Rust:
//!   * It's pure logic — no DOM, no IPC, no file I/O — so it pairs naturally
//!     with the `#[cfg(test)]` block at the bottom of this file and stays
//!     trivially unit-testable.
//!   * Doing the same work in TypeScript would mean re-implementing the same
//!     parser inside the editor; per project policy we default new pure-logic
//!     features to Rust + a Tauri command + a thin TS wrapper.
//!
//! Detection rules (kept deliberately conservative so prose containing pipes
//! never gets accidentally rewritten):
//!   * A "table candidate" is a run of consecutive non-blank lines where:
//!       - the first line contains at least one `|`,
//!       - the second line is an alignment-separator row, i.e. every cell is
//!         `:?-+:?` (with optional surrounding whitespace),
//!       - subsequent lines also contain at least one `|`.
//!   * Lines inside fenced code blocks (``` or ~~~) are skipped.
//!
//! Output rules:
//!   * Each row is emitted in the canonical `| cell | cell |` shape — leading
//!     and trailing pipes are always present, internal pipes are surrounded by
//!     a single space.
//!   * Cell content is trimmed and then padded with spaces. Padding side is
//!     determined by the alignment marker on that column (see `Alignment`).
//!   * The separator row is regenerated using `-` characters of the right
//!     length, with `:` markers preserved on the appropriate side(s).
//!   * Rows with too few cells are right-extended with empty cells; rows with
//!     too many cells keep their extra cells (with their own width).
//!
//! Width is measured in `char` count, not byte count or visual width — that's
//! a reasonable approximation for the typical Markdown table (mostly ASCII,
//! occasional accented Latin or em-dashes, all of which render as one cell).
//! We deliberately don't pull in `unicode-width` for now: the dependency cost
//! outweighs the marginal benefit for this editor's expected content.

const MIN_DASHES: usize = 3;

//******************************************************************************
// Alignment
//******************************************************************************
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Alignment {
    /// No explicit marker — `---`. Renders cells left-aligned but the separator
    /// keeps no `:` glyphs (preserves the user's original "I didn't ask for
    /// alignment" intent).
    Default,
    /// `:---` — left-aligned. Stored separately from `Default` so we can emit
    /// the leading `:` back when the user explicitly asked for it.
    Left,
    /// `---:` — right-aligned.
    Right,
    /// `:---:` — center-aligned.
    Center,
}
// Alignment END *************************************************************

//******************************************************************************
// parse_alignment
//******************************************************************************
/// Convert a single separator cell (e.g. `:---:`, `---`, ` :--- `) into an
/// `Alignment`. The cell is assumed to have already been validated by
/// `is_alignment_cell`; we only inspect the colons here.
fn parse_alignment(cell: &str) -> Alignment {
    let t = cell.trim();
    let starts_colon = t.starts_with(':');
    let ends_colon = t.ends_with(':');
    match (starts_colon, ends_colon) {
        (true, true) => Alignment::Center,
        (true, false) => Alignment::Left,
        (false, true) => Alignment::Right,
        (false, false) => Alignment::Default,
    }
}
// parse_alignment END *******************************************************

//******************************************************************************
// is_alignment_cell
//******************************************************************************
/// `true` iff `cell` is a well-formed GFM alignment-separator cell, e.g.
/// `---`, `:--`, `--:`, `:-:`. At least one `-` is required, optional `:`
/// markers may sit at either end. Empty cells and cells containing other
/// characters are rejected.
fn is_alignment_cell(cell: &str) -> bool {
    let t = cell.trim();
    if t.is_empty() {
        return false;
    }
    let bytes = t.as_bytes();
    let start = if bytes[0] == b':' { 1 } else { 0 };
    let end = if bytes[bytes.len() - 1] == b':' {
        bytes.len() - 1
    } else {
        bytes.len()
    };
    if start >= end {
        // strings like ":" or "::" — no dashes between the colons
        return false;
    }
    // Use byte-walk because ASCII-only content is guaranteed for the body.
    bytes[start..end].iter().all(|&b| b == b'-')
}
// is_alignment_cell END *****************************************************

//******************************************************************************
// split_table_row
//******************************************************************************
/// Split a row into raw (un-trimmed) cell strings, stripping a single leading
/// and/or trailing pipe if present. A line with no `|` returns a single cell.
///
/// We deliberately don't try to escape `\|` inside cells: standard Markdown
/// tables don't permit literal pipes in cells (you have to use `&#124;`), and
/// supporting backslash-escapes here would require a full tokenizer.
fn split_table_row(line: &str) -> Vec<String> {
    let mut s = line.trim();
    if s.starts_with('|') {
        s = &s[1..];
    }
    if s.ends_with('|') {
        s = &s[..s.len() - 1];
    }
    if s.is_empty() {
        // A bare `||` or `|` line: emit one empty cell so callers see a row
        // shape, not zero cells (which would otherwise terminate the table).
        return vec![String::new()];
    }
    s.split('|').map(|c| c.to_string()).collect()
}
// split_table_row END *******************************************************

//******************************************************************************
// is_table_separator_line
//******************************************************************************
/// `true` iff `line` is a GFM alignment-separator row — i.e. every one of its
/// cells (after stripping the optional leading/trailing pipes) is a valid
/// alignment cell.
fn is_table_separator_line(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.contains('|') {
        return false;
    }
    let cells = split_table_row(trimmed);
    if cells.is_empty() {
        return false;
    }
    cells.iter().all(|c| is_alignment_cell(c))
}
// is_table_separator_line END ***********************************************

//******************************************************************************
// looks_like_table_row
//******************************************************************************
/// A row that *might* belong to a table: non-blank and contains at least one
/// `|`. Used during the lookahead that decides whether to keep growing a
/// table block downward.
fn looks_like_table_row(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && t.contains('|')
}
// looks_like_table_row END **************************************************

//******************************************************************************
// pad_cell
//******************************************************************************
/// Pad `content` with spaces on the appropriate side(s) to reach the given
/// width. If the content is already at or above the target width, it's
/// returned untouched (we never truncate user content).
fn pad_cell(content: &str, width: usize, align: Alignment) -> String {
    let len = content.chars().count();
    if len >= width {
        return content.to_string();
    }
    let pad = width - len;
    match align {
        Alignment::Default | Alignment::Left => {
            let mut s = String::with_capacity(content.len() + pad);
            s.push_str(content);
            for _ in 0..pad {
                s.push(' ');
            }
            s
        }
        Alignment::Right => {
            let mut s = String::with_capacity(content.len() + pad);
            for _ in 0..pad {
                s.push(' ');
            }
            s.push_str(content);
            s
        }
        Alignment::Center => {
            // Rounding bias: extra space goes on the right (consistent with
            // most pretty-printers, including pandoc's `pipe_tables` writer).
            let left = pad / 2;
            let right = pad - left;
            let mut s = String::with_capacity(content.len() + pad);
            for _ in 0..left {
                s.push(' ');
            }
            s.push_str(content);
            for _ in 0..right {
                s.push(' ');
            }
            s
        }
    }
}
// pad_cell END **************************************************************

//******************************************************************************
// render_separator_cell
//******************************************************************************
/// Build the inside of a separator cell — the alignment markers plus dashes —
/// at the requested width. `width` is at least `MIN_DASHES` to satisfy the GFM
/// minimum-three-dashes rule even when the column's content is narrower.
fn render_separator_cell(width: usize, align: Alignment) -> String {
    let w = width.max(MIN_DASHES);
    match align {
        Alignment::Default => "-".repeat(w),
        Alignment::Left => {
            let mut s = String::with_capacity(w);
            s.push(':');
            for _ in 1..w {
                s.push('-');
            }
            s
        }
        Alignment::Right => {
            let mut s = String::with_capacity(w);
            for _ in 1..w {
                s.push('-');
            }
            s.push(':');
            s
        }
        Alignment::Center => {
            // Need room for both colons; widen if the user squeezed a width
            // smaller than 3 (which would have already been bumped by `max`).
            let mut s = String::with_capacity(w);
            s.push(':');
            for _ in 0..w.saturating_sub(2) {
                s.push('-');
            }
            s.push(':');
            s
        }
    }
}
// render_separator_cell END *************************************************

//******************************************************************************
// render_row
//******************************************************************************
/// Emit a single table row in canonical `| ... | ... |` form. The pipes are
/// fixed; the surrounding spaces and the cell contents are derived from
/// `widths` / `aligns`.
///
/// `is_separator` switches the cell renderer between user content (padded
/// with spaces) and the dashed alignment marker.
fn render_row(
    cells: &[String],
    widths: &[usize],
    aligns: &[Alignment],
    is_separator: bool,
) -> String {
    // let n = widths.len();
    let mut out = String::from("|");
    for (i, &w) in widths.iter().enumerate() { //for i in 0..n {
        let a = aligns.get(i).copied().unwrap_or(Alignment::Default);
        out.push(' ');
        if is_separator {
            out.push_str(&render_separator_cell(w, a));
        } else {
            // Missing cells (short rows) become empty cells, padded to width.
            let raw = cells.get(i).map(|s| s.as_str()).unwrap_or("");
            let trimmed = raw.trim();
            out.push_str(&pad_cell(trimmed, w, a));
        }
        out.push(' ');
        out.push('|');
    }
    out
}
// render_row END ************************************************************

//******************************************************************************
// format_table_block
//******************************************************************************
/// Take a contiguous slice of lines that together form a single table (header +
/// separator + body rows) and produce the padded replacement, one rendered
/// line per input line.
///
/// Pre-condition: callers have already verified that `lines.len() >= 2` and
/// that `lines[1]` is a separator row — see `pad_tables_in_document`.
fn format_table_block(lines: &[&str]) -> Vec<String> {
    debug_assert!(lines.len() >= 2);

    // Parse every row into raw (un-trimmed) cells. Trimming happens at render
    // time so we can compute correct widths regardless of incidental padding.
    let parsed: Vec<Vec<String>> = lines.iter().map(|l| split_table_row(l)).collect();

    // Alignment is dictated entirely by the separator row.
    let separator_cells = &parsed[1];
    let n_cols = parsed
        .iter()
        .map(|row| row.len())
        .max()
        .unwrap_or(separator_cells.len())
        .max(separator_cells.len());

    let aligns: Vec<Alignment> = (0..n_cols)
        .map(|i| {
            separator_cells
                .get(i)
                .map(|c| parse_alignment(c))
                .unwrap_or(Alignment::Default)
        })
        .collect();

    // Compute per-column max content width, ignoring the separator row (its
    // dashes shouldn't dictate column width — that would create stair-step
    // tables on subsequent passes).
    let mut widths = vec![0usize; n_cols];
    for (row_index, row) in parsed.iter().enumerate() {
        if row_index == 1 {
            continue;
        }
        for (col_index, cell) in row.iter().enumerate() {
            let w = cell.trim().chars().count();
            if w > widths[col_index] {
                widths[col_index] = w;
            }
        }
    }
    // Enforce GFM minimum dash count. Empty columns still get a 3-wide
    // separator, which matches every renderer we care about.
    for w in widths.iter_mut() {
        if *w < MIN_DASHES {
            *w = MIN_DASHES;
        }
    }

    let mut out = Vec::with_capacity(parsed.len());
    for (i, row) in parsed.iter().enumerate() {
        out.push(render_row(row, &widths, &aligns, i == 1));
    }
    out
}
// format_table_block END ****************************************************

//******************************************************************************
// pad_tables_in_document
//******************************************************************************
/// Public entry point: walk the document line-by-line, find every GFM-style
/// pipe table, and replace it with a padded version. Non-table content is
/// emitted verbatim, and the document's line-ending style (LF vs CRLF) is
/// preserved.
pub fn pad_tables_in_document(content: &str) -> String {
    if content.is_empty() {
        return String::new();
    }

    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = content.lines().collect();

    let mut out_lines: Vec<String> = Vec::with_capacity(lines.len());
    let mut in_fence = false;
    let mut fence_char: Option<char> = None;

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed_start = line.trim_start();

        // Track fenced code blocks. ``` and ~~~ open / close in pairs of the
        // same character; tables inside fences are user-authored content and
        // must be left alone.
        if trimmed_start.starts_with("```") || trimmed_start.starts_with("~~~") {
            let ch = trimmed_start.chars().next().unwrap();
            if !in_fence {
                in_fence = true;
                fence_char = Some(ch);
            } else if Some(ch) == fence_char {
                in_fence = false;
                fence_char = None;
            }
            out_lines.push(line.to_string());
            i += 1;
            continue;
        }
        if in_fence {
            out_lines.push(line.to_string());
            i += 1;
            continue;
        }

        // Look ahead one line: a real table needs a separator immediately
        // after the header row. Without that requirement, paragraphs that
        // happen to contain pipes (e.g. command-line examples) would be
        // mistaken for tables.
        let next = lines.get(i + 1).copied();
        if looks_like_table_row(line)
            && next.map(is_table_separator_line).unwrap_or(false)
        {
            // Found a table starting at i. Greedy-collect body rows.
            let start = i;
            let mut end = i + 2;
            while end < lines.len() && looks_like_table_row(lines[end]) {
                // Don't gobble a *second* separator row — that's the start
                // of an adjacent table, not part of this one.
                if is_table_separator_line(lines[end]) {
                    break;
                }
                end += 1;
            }

            let block = &lines[start..end];
            let formatted = format_table_block(block);
            for fl in formatted {
                out_lines.push(fl);
            }
            i = end;
            continue;
        }

        out_lines.push(line.to_string());
        i += 1;
    }

    let mut result = out_lines.join(newline);
    // Preserve a trailing newline if the original had one. `lines()` drops it,
    // so we need to add it back explicitly.
    if content.ends_with('\n') {
        result.push_str(newline);
    }
    result
}
// pad_tables_in_document END ************************************************

//******************************************************************************
// pad_tables (Tauri command)
//******************************************************************************
/// Tauri command wrapper. Accepts the full document text, returns the version
/// with all detected pipe tables space-padded into a uniform shape. Documents
/// with no tables come back unchanged.
#[tauri::command]
pub fn pad_tables(content: String) -> String {
    pad_tables_in_document(&content)
}
// pad_tables END ************************************************************

//******************************************************************************
// TESTS
//******************************************************************************
#[cfg(test)]
mod tests {
    use super::*;

    //*************************************************************************
    // test_no_table_is_passthrough
    //*************************************************************************
    #[test]
    fn test_no_table_is_passthrough() {
        let doc = "# Hello\n\nJust prose with a | character that is not a table.\n";
        assert_eq!(pad_tables_in_document(doc), doc);
    }

    //*************************************************************************
    // test_empty_document
    //*************************************************************************
    #[test]
    fn test_empty_document() {
        assert_eq!(pad_tables_in_document(""), "");
    }

    //*************************************************************************
    // test_pads_two_column_table
    //*************************************************************************
    #[test]
    fn test_pads_two_column_table() {
        // Mirrors the Audi-contacts example from the screenshots: short
        // header cells, much wider body cells. Every column should snap to
        // the width of its widest entry.
        let doc = "\
| Who | Role |
|-----|------|
| **Thomas Endres** | Audi I/EI-B1 — colleague |
| **Christian Huber** | Audi I/PH-3B |
| **Joel Andres Gonzalez-Ramirez** | Audi I/EB-I4 |
";
        let out = pad_tables_in_document(doc);
        let expected = "\
| Who                              | Role                     |
| -------------------------------- | ------------------------ |
| **Thomas Endres**                | Audi I/EI-B1 — colleague |
| **Christian Huber**              | Audi I/PH-3B             |
| **Joel Andres Gonzalez-Ramirez** | Audi I/EB-I4             |
";
        assert_eq!(out, expected);
    }

    //*************************************************************************
    // test_idempotent
    //*************************************************************************
    #[test]
    fn test_idempotent() {
        // Running the formatter on its own output must be a no-op.
        let doc = "\
| a | b |
|---|---|
| 1 | 2 |
";
        let once = pad_tables_in_document(doc);
        let twice = pad_tables_in_document(&once);
        assert_eq!(once, twice);
    }

    //*************************************************************************
    // test_preserves_alignment_markers
    //*************************************************************************
    #[test]
    fn test_preserves_alignment_markers() {
        // Widths come from the body row (left=4, center=6, right=5). The
        // separator marker `:` glyphs must survive on the same side they
        // started on, with the correct number of `-` dashes filling the rest.
        let doc = "\
| L | C | R |
|:--|:-:|--:|
| left | center | right |
";
        let out = pad_tables_in_document(doc);
        let separator_line = out.lines().nth(1).unwrap();
        assert_eq!(separator_line, "| :--- | :----: | ----: |");
    }

    //*************************************************************************
    // test_right_alignment_pads_left
    //*************************************************************************
    #[test]
    fn test_right_alignment_pads_left() {
        // Forces a column wider than its body cell to confirm the pad lands
        // on the *left* side for right-aligned columns.
        let doc = "\
| Long Header |
|-----------:|
| 1 |
";
        let out = pad_tables_in_document(doc);
        let body = out.lines().nth(2).unwrap();
        // The 1 should be flush right inside its cell.
        // Shape: `|` + ' ' + (lots of spaces) + '1' + ' ' + `|`
        assert!(body.ends_with("1 |"));
        assert!(body.starts_with("|  ")); // at least two leading spaces (' ' + pad)
    }

    //*************************************************************************
    // test_center_alignment_balances
    //*************************************************************************
    #[test]
    fn test_center_alignment_balances() {
        let doc = "\
| Long Header |
|:----------:|
| 1 |
";
        let out = pad_tables_in_document(doc);
        let body = out.lines().nth(2).unwrap();
        // The cell is 11 chars wide ("Long Header"), the content is 1, so we
        // pad with 5 spaces on the left, 5 on the right (left-bias rounding).
        assert_eq!(body, "| Long Header |".replace("Long Header", "     1     "));
    }

    //*************************************************************************
    // test_skips_table_inside_code_fence
    //*************************************************************************
    #[test]
    fn test_skips_table_inside_code_fence() {
        let doc = "\
```
| a | b |
|---|---|
| 1 | 2 |
```
";
        let out = pad_tables_in_document(doc);
        // Inside the fence, content is verbatim — no padding.
        assert_eq!(out, doc);
    }

    //*************************************************************************
    // test_handles_table_at_end_of_doc_without_trailing_newline
    //*************************************************************************
    #[test]
    fn test_handles_table_at_end_of_doc_without_trailing_newline() {
        let doc = "| a | b |\n|---|---|\n| 1 | 2 |";
        let out = pad_tables_in_document(doc);
        // No trailing newline should be invented.
        assert!(!out.ends_with('\n'));
        // But the table should still be padded.
        assert!(out.contains("| a "));
    }

    //*************************************************************************
    // test_preserves_crlf_newlines
    //*************************************************************************
    #[test]
    fn test_preserves_crlf_newlines() {
        let doc = "| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n";
        let out = pad_tables_in_document(doc);
        assert!(out.contains("\r\n"));
        // No bare LF lines should be introduced.
        let lf_only = out.replace("\r\n", "");
        assert!(!lf_only.contains('\n'));
    }

    //*************************************************************************
    // test_normalises_missing_leading_or_trailing_pipe
    //*************************************************************************
    #[test]
    fn test_normalises_missing_leading_or_trailing_pipe() {
        // A "borderless" GFM table — pipes only between cells. We always
        // emit canonical bordered form for readability.
        let doc = "\
a | b
---|---
1 | 2
";
        let out = pad_tables_in_document(doc);
        let lines: Vec<&str> = out.lines().collect();
        assert!(lines[0].starts_with("| "));
        assert!(lines[0].ends_with(" |"));
        assert!(lines[1].starts_with("| "));
        assert!(lines[1].ends_with(" |"));
        assert!(lines[2].starts_with("| "));
        assert!(lines[2].ends_with(" |"));
    }

    //*************************************************************************
    // test_pads_multiple_tables_independently
    //*************************************************************************
    #[test]
    fn test_pads_multiple_tables_independently() {
        let doc = "\
| a | b |
|---|---|
| 1 | 2 |

| longheader | x |
|------------|---|
| q | 9 |
";
        let out = pad_tables_in_document(doc);
        let chunks: Vec<&str> = out.split("\n\n").collect();
        // Two tables, separated by the blank line.
        assert_eq!(chunks.len(), 2);
        // Second table uses its own widths, not first table's.
        assert!(chunks[1].contains("| longheader |"));
    }

    //*************************************************************************
    // test_short_row_gets_empty_cells_appended
    //*************************************************************************
    #[test]
    fn test_short_row_gets_empty_cells_appended() {
        // Body row only has one cell; header has two. We don't drop the row,
        // we just emit an empty (padded) second cell.
        let doc = "\
| a | b |
|---|---|
| only |
";
        let out = pad_tables_in_document(doc);
        let body_line = out.lines().nth(2).unwrap();
        // The synthesized empty cell must be present and width-3 minimum.
        assert!(body_line.starts_with("| only "));
        assert!(body_line.ends_with("|     |") || body_line.ends_with("|   |"));
    }

    //*************************************************************************
    // test_does_not_eat_following_paragraph
    //*************************************************************************
    #[test]
    fn test_does_not_eat_following_paragraph() {
        // The first line that doesn't look like a table row terminates the
        // table; subsequent prose is left untouched.
        let doc = "\
| a | b |
|---|---|
| 1 | 2 |

A paragraph after the table.
";
        let out = pad_tables_in_document(doc);
        assert!(out.contains("\nA paragraph after the table.\n"));
    }

    //*************************************************************************
    // test_is_alignment_cell_accepts_known_shapes
    //*************************************************************************
    #[test]
    fn test_is_alignment_cell_accepts_known_shapes() {
        assert!(is_alignment_cell("---"));
        assert!(is_alignment_cell(":--"));
        assert!(is_alignment_cell("--:"));
        assert!(is_alignment_cell(":-:"));
        assert!(is_alignment_cell(" --- "));
        assert!(is_alignment_cell("-")); // single dash still passes
    }

    //*************************************************************************
    // test_is_alignment_cell_rejects_garbage
    //*************************************************************************
    #[test]
    fn test_is_alignment_cell_rejects_garbage() {
        assert!(!is_alignment_cell(""));
        assert!(!is_alignment_cell(":"));
        assert!(!is_alignment_cell("::"));
        assert!(!is_alignment_cell("abc"));
        assert!(!is_alignment_cell("- -"));
        assert!(!is_alignment_cell("-x-"));
    }

    //*************************************************************************
    // test_parse_alignment_classifies_correctly
    //*************************************************************************
    #[test]
    fn test_parse_alignment_classifies_correctly() {
        assert_eq!(parse_alignment("---"), Alignment::Default);
        assert_eq!(parse_alignment(":---"), Alignment::Left);
        assert_eq!(parse_alignment("---:"), Alignment::Right);
        assert_eq!(parse_alignment(":---:"), Alignment::Center);
        // surrounding whitespace must not change classification
        assert_eq!(parse_alignment(" :---: "), Alignment::Center);
    }

    //*************************************************************************
    // test_pad_cell_left_default_pads_right
    //*************************************************************************
    #[test]
    fn test_pad_cell_left_default_pads_right() {
        assert_eq!(pad_cell("a", 5, Alignment::Default), "a    ");
        assert_eq!(pad_cell("a", 5, Alignment::Left), "a    ");
    }

    //*************************************************************************
    // test_pad_cell_right_pads_left
    //*************************************************************************
    #[test]
    fn test_pad_cell_right_pads_left() {
        assert_eq!(pad_cell("a", 5, Alignment::Right), "    a");
    }

    //*************************************************************************
    // test_pad_cell_center_balances_with_right_bias
    //*************************************************************************
    #[test]
    fn test_pad_cell_center_balances_with_right_bias() {
        // Even pad: split evenly.
        assert_eq!(pad_cell("a", 5, Alignment::Center), "  a  ");
        // Odd pad: the extra space goes to the right side. (1 left, 2 right)
        assert_eq!(pad_cell("a", 4, Alignment::Center), " a  ");
    }

    //*************************************************************************
    // test_pad_cell_no_truncation
    //*************************************************************************
    #[test]
    fn test_pad_cell_no_truncation() {
        // Content wider than width: returned untouched (we never truncate).
        assert_eq!(pad_cell("hello", 3, Alignment::Default), "hello");
    }

    //*************************************************************************
    // test_render_separator_cell_min_width_three
    //*************************************************************************
    #[test]
    fn test_render_separator_cell_min_width_three() {
        // Even when the column content is 1 char, separator dashes are >= 3.
        assert_eq!(render_separator_cell(1, Alignment::Default), "---");
        assert_eq!(render_separator_cell(2, Alignment::Center), ":-:");
        assert_eq!(render_separator_cell(3, Alignment::Left), ":--");
        assert_eq!(render_separator_cell(3, Alignment::Right), "--:");
    }
}
// tests END *****************************************************************
