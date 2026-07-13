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

// UTST for REQ-LTTCE-WSP-00006 (IMPL-LTTCE-WSP-00009)

use super::*;

// -----------------------------------------------------------------------
// tabify — basic conversion
// -----------------------------------------------------------------------
#[test]
fn tabify_converts_leading_spaces_to_tabs() {
    // tab_size 2: four spaces = two tabs
    assert_eq!(tabify_leading("    x", 2, None), "\t\tx");
    // tab_size 4: four spaces = one tab
    assert_eq!(tabify_leading("    x", 4, None), "\tx");
}

#[test]
fn tabify_keeps_remainder_as_spaces() {
    // 5 spaces at tab_size 2 = 2 tabs + 1 space
    assert_eq!(tabify_leading("     x", 2, None), "\t\t x");
    // 3 spaces at tab_size 4 = 0 tabs + 3 spaces (below one tab stop)
    assert_eq!(tabify_leading("   x", 4, None), "   x");
}

#[test]
fn tabify_handles_mixed_leading_whitespace_column_accurately() {
    // " \t" at tab_size 4: space (col 1) + tab jumps to col 4 → width 4 → one tab
    assert_eq!(tabify_leading(" \tx", 4, None), "\tx");
    // "\t " at tab_size 4: tab (col 4) + space → width 5 → one tab + one space
    assert_eq!(tabify_leading("\t x", 4, None), "\t x");
}

#[test]
fn tabify_touches_only_line_start_whitespace() {
    // Interior and trailing spaces must survive untouched
    assert_eq!(tabify_leading("  a  b  ", 2, None), "\ta  b  ");
    // A line with no leading whitespace is returned verbatim
    assert_eq!(tabify_leading("a    b", 2, None), "a    b");
}

// -----------------------------------------------------------------------
// untabify — basic conversion
// -----------------------------------------------------------------------
#[test]
fn untabify_converts_leading_tabs_to_spaces() {
    assert_eq!(untabify_leading("\tx", 2, None), "  x");
    assert_eq!(untabify_leading("\t\tx", 4, None), "        x");
}

#[test]
fn untabify_is_column_accurate_for_mixed_whitespace() {
    // " \t" at tab_size 4 occupies 4 columns → 4 spaces
    assert_eq!(untabify_leading(" \tx", 4, None), "    x");
    // "\t " at tab_size 2 occupies 3 columns → 3 spaces
    assert_eq!(untabify_leading("\t x", 2, None), "   x");
}

#[test]
fn untabify_touches_only_line_start_whitespace() {
    assert_eq!(untabify_leading("\ta\tb", 2, None), "  a\tb");
}

// -----------------------------------------------------------------------
// round-trip stability
// -----------------------------------------------------------------------
#[test]
fn tabify_then_untabify_preserves_visual_columns() {
    let original = "      deep\n  shallow\nnone\n";
    let tabified = tabify_leading(original, 2, None);
    assert_eq!(tabified, "\t\t\tdeep\n\tshallow\nnone\n");
    let back = untabify_leading(&tabified, 2, None);
    assert_eq!(back, original);
}

// -----------------------------------------------------------------------
// line ranges (selection scope) and document structure
// -----------------------------------------------------------------------
#[test]
fn range_limits_conversion_to_selected_lines() {
    let doc = "  one\n  two\n  three";
    // Only line 2 selected
    assert_eq!(tabify_leading(doc, 2, Some((2, 2))), "  one\n\ttwo\n  three");
    // Lines 2..=3
    assert_eq!(tabify_leading(doc, 2, Some((2, 3))), "  one\n\ttwo\n\tthree");
}

#[test]
fn whole_document_when_range_is_none() {
    let doc = "  one\n\ttwo";
    assert_eq!(untabify_leading(doc, 2, None), "  one\n  two");
}

#[test]
fn preserves_line_count_and_empty_lines() {
    let doc = "\n\n  x\n\n";
    let out = tabify_leading(doc, 2, None);
    assert_eq!(out, "\n\n\tx\n\n");
    assert_eq!(out.matches('\n').count(), doc.matches('\n').count());
}

#[test]
fn empty_document_stays_empty() {
    assert_eq!(tabify_leading("", 2, None), "");
    assert_eq!(untabify_leading("", 2, None), "");
}

// -----------------------------------------------------------------------
// Tauri command wrappers (range encoding: 0 = whole document)
// -----------------------------------------------------------------------
#[test]
fn command_wrappers_treat_zero_as_whole_document() {
    assert_eq!(tabify_text("  x\n  y".to_string(), 2, 0, 0), "\tx\n\ty");
    assert_eq!(untabify_text("\tx\n\ty".to_string(), 2, 0, 0), "  x\n  y");
}

#[test]
fn command_wrappers_respect_explicit_range() {
    assert_eq!(tabify_text("  x\n  y".to_string(), 2, 1, 1), "\tx\n  y");
}

// -----------------------------------------------------------------------
// defensive clamping of tab_size (out-of-range IPC values)
// -----------------------------------------------------------------------
#[test]
fn out_of_range_tab_size_is_clamped() {
    // tab_size 0/1 behaves as TAB_SIZE_MIN (2)
    assert_eq!(tabify_leading("    x", 0, None), "\t\tx");
    assert_eq!(tabify_leading("    x", 1, None), "\t\tx");
    // tab_size 99 behaves as TAB_SIZE_MAX (8)
    assert_eq!(untabify_leading("\tx", 99, None), "        x");
}

// -----------------------------------------------------------------------
// idempotence
// -----------------------------------------------------------------------
#[test]
fn tabify_is_idempotent() {
    let doc = "    a\n\tb\n  c";
    let once = tabify_leading(doc, 2, None);
    let twice = tabify_leading(&once, 2, None);
    assert_eq!(once, twice);
}

#[test]
fn untabify_is_idempotent() {
    let doc = "    a\n\tb\n  c";
    let once = untabify_leading(doc, 2, None);
    let twice = untabify_leading(&once, 2, None);
    assert_eq!(once, twice);
}
