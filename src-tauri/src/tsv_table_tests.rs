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

//! UTST for the spreadsheet-paste conversion (REQ-LTTCE-TBL-00003 …
//! REQ-LTTCE-TBL-00007, IMPL-LTTCE-TBL-00001).
//!
//! Every case here is a real clipboard payload shape: what Excel actually puts
//! on the clipboard (CRLF row breaks, quoted multi-line cells, doubled quotes)
//! rather than an idealised TSV.

use super::*;

//******************************************************************************
// helpers
//******************************************************************************
/// Convenience: the markdown produced for a payload known to be tabular.
fn md(text: &str) -> String {
    let r = analyze_tabular_paste(text);
    assert!(r.tabular, "expected tabular payload: {text:?}");
    r.markdown
}
// helpers END *****************************************************************

//******************************************************************************
// detection
//******************************************************************************
mod detection {
    use super::*;

    #[test]
    fn plain_prose_is_not_tabular() {
        let r = analyze_tabular_paste("just some pasted prose\nwith two lines");
        assert!(!r.tabular);
        assert_eq!(r.rows, 0);
        assert_eq!(r.columns, 0);
        assert!(r.markdown.is_empty());
    }

    #[test]
    fn empty_payload_is_not_tabular() {
        assert!(!analyze_tabular_paste("").tabular);
    }

    #[test]
    fn single_column_multi_row_is_not_tabular() {
        // A copied spreadsheet column: row breaks but no TAB.
        assert!(!analyze_tabular_paste("alpha\r\nbeta\r\ngamma\r\n").tabular);
    }

    #[test]
    fn single_row_two_columns_is_tabular() {
        let r = analyze_tabular_paste("a\tb");
        assert!(r.tabular);
        assert_eq!(r.rows, 1);
        assert_eq!(r.columns, 2);
    }

    #[test]
    fn tab_only_inside_a_quoted_cell_is_not_tabular() {
        // One cell whose content happens to contain a TAB — not a grid.
        let r = analyze_tabular_paste("\"a\tb\"\r\n\"c\td\"\r\n");
        assert!(!r.tabular, "quoted TAB must not be read as a delimiter");
    }

    #[test]
    fn existing_markdown_table_is_not_re_wrapped() {
        // Copied out of another Lattice window: pipes + separator + a stray TAB.
        let text = "| a | b |\n| --- | --- |\n| 1\t | 2 |";
        assert!(!analyze_tabular_paste(text).tabular);
    }

    #[test]
    fn row_and_column_counts_are_reported() {
        let r = analyze_tabular_paste("h1\th2\th3\r\n1\t2\t3\r\n4\t5\t6\r\n");
        assert!(r.tabular);
        assert_eq!(r.rows, 3, "header + 2 body rows");
        assert_eq!(r.columns, 3);
    }
}
// detection END ***************************************************************

//******************************************************************************
// conversion
//******************************************************************************
mod conversion {
    use super::*;

    #[test]
    fn first_row_becomes_the_header_with_a_separator_below() {
        let out = md("Name\tQty\r\nBolt\t12\r\n");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "| Name | Qty |");
        assert_eq!(lines[1], "| ---- | --- |");
        assert_eq!(lines[2], "| Bolt | 12  |");
    }

    #[test]
    fn columns_are_padded_to_the_widest_cell() {
        let out = md("a\tlonger-header\r\nlonger-value\tb\r\n");
        for line in out.lines() {
            assert_eq!(
                line.chars().count(),
                out.lines().next().unwrap().chars().count(),
                "all rows must be the same width: {out}"
            );
        }
    }

    #[test]
    fn trailing_row_break_does_not_add_an_empty_row() {
        let out = md("a\tb\r\n1\t2\r\n");
        assert_eq!(out.lines().count(), 3, "header + separator + one body row");
        assert!(!out.ends_with('\n'));
    }

    #[test]
    fn lf_only_row_breaks_are_accepted() {
        // Google Sheets / Numbers on macOS emit LF, not CRLF.
        let out = md("a\tb\n1\t2");
        assert_eq!(out.lines().count(), 3);
    }

    #[test]
    fn short_rows_are_extended_with_empty_cells() {
        let out = md("a\tb\tc\r\n1\t2\r\n");
        let body = out.lines().nth(2).unwrap();
        assert_eq!(
            body.matches('|').count(),
            4,
            "3 columns → 4 pipes, even though the row had 2 cells: {body}"
        );
    }

    #[test]
    fn empty_cells_survive_as_empty_columns() {
        // Widths are floored at the GFM three-dash minimum, so every column
        // here renders three wide.
        let out = md("a\t\tc\r\n1\t2\t3\r\n");
        assert_eq!(out.lines().next().unwrap(), "| a   |     | c   |");
        assert_eq!(out.lines().nth(1).unwrap(), "| --- | --- | --- |");
    }

    #[test]
    fn a_single_row_paste_still_gets_a_separator() {
        let out = md("only\theader");
        assert_eq!(out.lines().count(), 2);
        assert_eq!(out.lines().nth(1).unwrap(), "| ---- | ------ |");
    }
}
// conversion END **************************************************************

//******************************************************************************
// sanitation
//******************************************************************************
mod sanitation {
    use super::*;

    #[test]
    fn pipes_in_cells_are_escaped() {
        let out = md("a|b\tc\r\n1\t2\r\n");
        assert!(out.contains(r"a\|b"), "pipe must be escaped: {out}");
        // 2 columns → exactly 3 *delimiter* pipes per row; the escaped one is
        // preceded by a backslash and must not be counted as a delimiter.
        let header = out.lines().next().unwrap();
        assert_eq!(header.replace(r"\|", "").matches('|').count(), 3);
    }

    #[test]
    fn backslashes_are_escaped_before_pipes() {
        // A Windows path ending in a backslash: escaped as `\\`, so the
        // backslash cannot swallow the closing delimiter pipe.
        let out = md("C:\\path\\\tx\r\n1\t2\r\n");
        assert!(out.contains(r"C:\\path\\"), "got: {out}");
        assert!(out.lines().next().unwrap().ends_with('|'));
    }

    #[test]
    fn newlines_inside_a_quoted_cell_become_br() {
        let text = "note\tqty\r\n\"line one\r\nline two\"\t3\r\n";
        let out = md(text);
        assert!(out.contains("line one<br>line two"), "got: {out}");
        assert_eq!(out.lines().count(), 3, "the cell break must not split the row");
    }

    #[test]
    fn doubled_quotes_become_one_literal_quote() {
        let text = "a\tb\r\n\"he said \"\"hi\"\"\"\t2\r\n";
        let out = md(text);
        assert!(out.contains(r#"he said "hi""#), "got: {out}");
    }

    #[test]
    fn cell_whitespace_is_trimmed() {
        let out = md("  spaced  \tb\r\n1\t2\r\n");
        assert_eq!(out.lines().next().unwrap(), "| spaced | b   |");
    }

    #[test]
    fn unterminated_quote_keeps_the_content() {
        // Malformed clipboard — defensive: never silently drop user data.
        let out = md("a\t\"unterminated\r\n1\t2");
        assert!(out.contains("unterminated"), "got: {out}");
    }

    #[test]
    fn non_ascii_content_is_preserved() {
        let out = md("Größe\tPreis\r\nklein\t3 €\r\n");
        assert!(out.contains("Größe"));
        assert!(out.contains("3 €"));
    }
}
// sanitation END **************************************************************

//******************************************************************************
// command wrapper
//******************************************************************************
mod command {
    use super::*;

    #[test]
    fn command_forwards_to_the_pure_function() {
        let text = "a\tb\r\n1\t2\r\n";
        assert_eq!(
            analyze_tabular_paste_cmd(text.to_string()),
            analyze_tabular_paste(text)
        );
    }

    #[test]
    fn non_tabular_command_result_is_inert() {
        let r = analyze_tabular_paste_cmd("no tabs here".to_string());
        assert!(!r.tabular);
        assert!(r.markdown.is_empty());
    }
}
// command wrapper END *********************************************************
