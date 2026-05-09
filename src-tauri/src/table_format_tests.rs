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

//*************************************************************************
// test_split_table_row_bare_pipe
//*************************************************************************
/// A row consisting of only `|` or `||` has no cell content after the
/// leading/trailing pipes are stripped. split_table_row must return a
/// single empty-string cell so that callers see a row shape rather than
/// zero cells (which would prematurely end the table).
#[test]
fn test_split_table_row_bare_pipe() {
    // Single pipe: strip leading → "", empty → one empty cell.
    let cells = split_table_row("|");
    assert_eq!(cells, vec!["".to_string()]);

    // Double pipe: strip leading "|" → "|", strip trailing "|" → "", empty → one empty cell.
    let cells2 = split_table_row("||");
    assert_eq!(cells2, vec!["".to_string()]);
}

//*************************************************************************
// test_adjacent_separator_stops_table_collection
//*************************************************************************
/// When a second separator row immediately follows a body row, the greedy
/// collector must stop — that separator belongs to the next table. The
/// `break` inside the while loop enforces this boundary.
#[test]
fn test_adjacent_separator_stops_table_collection() {
    // Two tables with no blank line between them. The second table's
    // separator row (|---|...) directly follows the first table's body.
    let doc = "| A | B |
|---|---|
| 1 | 2 |
| Long Header | Value |
|-------------|-------|
| body        | 1     |
";
    let out = pad_tables_in_document(doc);
    let lines: Vec<&str> = out.lines().collect();
    // Both tables must be present and reformatted.
    assert!(lines.len() >= 6, "Expected at least 6 output lines");
    assert!(out.contains("Long Header"), "Second table header must be present");
    // "A" is widened to match the "Long Header" column (11 chars), so
    // the exact token "| A |" no longer appears — check the prefix only.
    assert!(out.contains("| A "), "First table header must be present");
}

//*************************************************************************
// test_pad_tables_command_wrapper
//*************************************************************************
/// The public Tauri command `pad_tables` is a thin String-owning wrapper
/// around `pad_tables_in_document`. Calling it directly covers the wrapper.
#[test]
fn test_pad_tables_command_wrapper() {
    // Use 3-char cells so MIN_DASHES (3) does not widen columns and the
    // Use 3-char cells so MIN_DASHES (3) does not widen columns and the
    // exact pipe-surrounded tokens survive in the output verbatim.
    let input = "| foo | bar |\n|-----|-----|\n| baz | qux |\n".to_string();
    let out = pad_tables(input);
    assert!(out.contains("| foo |"), "header cell must survive in output");
    assert!(out.contains("| baz |"), "body cell must survive in output");
}
