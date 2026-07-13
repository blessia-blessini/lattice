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

// IMPL-LTTCE-WSP-00009 — tabify / untabify leading whitespace (pure logic)
//
// Converts ONLY line-start (leading) whitespace between tabs and spaces,
// column-accurate with respect to `tab_size`:
//   - a tab advances the column to the next multiple of `tab_size`;
//   - tabify re-emits the leading region as `width / tab_size` tabs followed
//     by `width % tab_size` spaces (the remainder stays as spaces, so the
//     visual indentation is byte-for-byte identical in rendered columns);
//   - untabify re-emits the leading region as `width` spaces.
// Everything after the first non-whitespace character is left untouched,
// as are line endings (the functions operate per line on `\n` boundaries
// and preserve a trailing `\r` pairing by never touching non-leading text).

use crate::settings::{TAB_SIZE_MAX, TAB_SIZE_MIN};

//**************************************************************
// leading_width
//**************************************************************
/// Returns `(visual_width, byte_len)` of the leading whitespace run of
/// `line`, where a tab advances to the next multiple of `tab_size` and a
/// space advances by one column. Stops at the first character that is
/// neither a space nor a tab.
fn leading_width(line: &str, tab_size: u32) -> (u32, usize) {
    let tab = tab_size.max(1); // guard: never divide/step by zero
    let mut width: u32 = 0;
    let mut bytes: usize = 0;
    for ch in line.chars() {
        match ch {
            ' ' => width += 1,
            '\t' => width = (width / tab + 1) * tab,
            _ => break,
        }
        bytes += ch.len_utf8(); // ' ' and '\t' are 1 byte, kept explicit
    }
    (width, bytes)
}
// leading_width END *******************************************

//**************************************************************
// convert_leading
//**************************************************************
/// Shared engine for both directions. Rewrites the leading whitespace of
/// every line whose 1-based index is inside `[start_line, end_line]`
/// (`None` = the whole document). `to_tabs` selects the direction.
fn convert_leading(
    content: &str,
    tab_size: u32,
    line_range: Option<(usize, usize)>,
    to_tabs: bool,
) -> String {
    // Defensive clamp — mirrors the settings loader so a rogue IPC value
    // cannot produce absurd indentation.
    let tab = tab_size.clamp(TAB_SIZE_MIN, TAB_SIZE_MAX);

    let mut out = String::with_capacity(content.len());
    for (idx, line) in content.split('\n').enumerate() {
        if idx > 0 {
            out.push('\n');
        }
        let line_no = idx + 1; // 1-based, matching CodeMirror line numbers
        let in_range = match line_range {
            Some((start, end)) => line_no >= start && line_no <= end,
            None => true,
        };
        if !in_range {
            out.push_str(line);
            continue;
        }
        let (width, bytes) = leading_width(line, tab);
        if bytes == 0 {
            out.push_str(line);
            continue;
        }
        if to_tabs {
            for _ in 0..(width / tab) {
                out.push('\t');
            }
            for _ in 0..(width % tab) {
                out.push(' ');
            }
        } else {
            for _ in 0..width {
                out.push(' ');
            }
        }
        out.push_str(&line[bytes..]);
    }
    out
}
// convert_leading END *****************************************

//**************************************************************
// tabify_leading
//**************************************************************
/// Convert the leading whitespace of the selected lines (1-based inclusive
/// range; `None` = whole document) from spaces to tabs, column-accurate.
pub fn tabify_leading(content: &str, tab_size: u32, line_range: Option<(usize, usize)>) -> String {
    convert_leading(content, tab_size, line_range, true)
}
// tabify_leading END ******************************************

//**************************************************************
// untabify_leading
//**************************************************************
/// Convert the leading whitespace of the selected lines (1-based inclusive
/// range; `None` = whole document) from tabs to spaces, column-accurate.
pub fn untabify_leading(
    content: &str,
    tab_size: u32,
    line_range: Option<(usize, usize)>,
) -> String {
    convert_leading(content, tab_size, line_range, false)
}
// untabify_leading END ****************************************

//**************************************************************
// tabify_text (Tauri command)
//**************************************************************
/// Tauri command wrapper (IMPL-LTTCE-WSP-00009). `start_line`/`end_line`
/// are 1-based inclusive; pass 0/0 to convert the whole document.
#[tauri::command]
pub fn tabify_text(content: String, tab_size: u32, start_line: usize, end_line: usize) -> String {
    let range = if start_line == 0 || end_line == 0 {
        None
    } else {
        Some((start_line, end_line))
    };
    tabify_leading(&content, tab_size, range)
}
// tabify_text END *********************************************

//**************************************************************
// untabify_text (Tauri command)
//**************************************************************
/// Tauri command wrapper (IMPL-LTTCE-WSP-00009). Same contract as
/// `tabify_text`, opposite direction.
#[tauri::command]
pub fn untabify_text(content: String, tab_size: u32, start_line: usize, end_line: usize) -> String {
    let range = if start_line == 0 || end_line == 0 {
        None
    } else {
        Some((start_line, end_line))
    };
    untabify_leading(&content, tab_size, range)
}
// untabify_text END *******************************************

#[cfg(test)]
#[path = "tabify_tests.rs"]
mod tests;
