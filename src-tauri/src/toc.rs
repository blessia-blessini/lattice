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

//! Table-of-Contents (TOC) generation.
//!
//! This module is a pure, side-effect-free string transformation. It scans
//! a Markdown document for one or more pairs of `<!-- TOC ... -->` and
//! `<!-- /TOC -->` marker comments and replaces the body between each pair
//! with a freshly generated bulleted list of the document's headings.
//!
//! Options in the opening marker (space-separated `key=value` pairs):
//!   * `minLevel=N`  — lowest heading level to include (1..=6). Default 2.
//!   * `maxLevel=N`  — highest heading level to include (1..=6). Default 6.
//!
//! Example:
//!   `<!-- TOC minLevel=2 maxLevel=3 -->`
//!
//! Link targets use GitHub-style slugs: lowercase, non-alphanumerics stripped,
//! spaces to hyphens. Duplicate headings are disambiguated with `-1`, `-2`, ...
//!
//! Headings inside fenced code blocks (``` or ~~~) are ignored, and headings
//! that happen to sit between the TOC markers themselves are also ignored
//! (so the generated list never references its own entries).

use std::collections::HashMap;

const DEFAULT_MIN_LEVEL: u8 = 2;
const DEFAULT_MAX_LEVEL: u8 = 6;

//******************************************************************************
// TocOptions
//******************************************************************************
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TocOptions {
    pub min_level: u8,
    pub max_level: u8,
}

impl Default for TocOptions {
    fn default() -> Self {
        TocOptions {
            min_level: DEFAULT_MIN_LEVEL,
            max_level: DEFAULT_MAX_LEVEL,
        }
    }
}
// TocOptions END *************************************************************

//******************************************************************************
// parse_toc_options
//******************************************************************************
/// Parse the opening-marker line (e.g. `<!-- TOC minLevel=2 maxLevel=4 -->`)
/// into a `TocOptions`. Unknown keys are silently ignored so the feature can
/// evolve without breaking older docs. Invalid values fall back to defaults.
fn parse_toc_options(open_marker_line: &str) -> TocOptions {
    let mut opts = TocOptions::default();

    // Strip the surrounding `<!--` / `-->` and the `TOC` keyword.
    let inner = open_marker_line
        .trim()
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim();

    // Split off the leading "TOC" token (case-insensitive).
    let rest = match inner.split_once(char::is_whitespace) {
        Some((head, tail)) if head.eq_ignore_ascii_case("TOC") => tail,
        Some(_) => inner, // doesn't start with TOC — still try to parse options
        None => "",       // just `<!-- TOC -->` with no options
    };

    for token in rest.split_whitespace() {
        if let Some((key, value)) = token.split_once('=') {
            match key {
                "minLevel" | "min_level" => {
                    if let Ok(n) = value.parse::<u8>()
                        && (1..=6).contains(&n)
                    {
                        opts.min_level = n;
                    }
                }
                "maxLevel" | "max_level" => {
                    if let Ok(n) = value.parse::<u8>()
                        && (1..=6).contains(&n)
                    {
                        opts.max_level = n;
                    }
                }
                _ => {} // ignore unknown keys
            }
        }
    }

    // Enforce sanity: min <= max.
    if opts.min_level > opts.max_level {
        std::mem::swap(&mut opts.min_level, &mut opts.max_level);
    }

    opts
}
// parse_toc_options END ******************************************************

//******************************************************************************
// Heading
//******************************************************************************
#[derive(Debug, Clone, PartialEq, Eq)]
struct Heading {
    level: u8,
    text: String,
    line_index: usize, // 0-based line number in the original document
}
// Heading END ****************************************************************

//******************************************************************************
// collect_headings
//******************************************************************************
/// Scan the document for ATX-style headings (`#`..`######`) outside of fenced
/// code blocks. Returns headings in document order.
///
/// NOTE: We intentionally do not support Setext headings (underline with `===`
/// or `---`) to keep the implementation predictable. Markdown editors that
/// support auto-TOCs generally restrict themselves to ATX.
fn collect_headings(content: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut fence_char: Option<char> = None;

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();

        // Track fenced code blocks (``` or ~~~). Opening and closing fences
        // must use the same character; minimum three of the fence char.
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let ch = trimmed.chars().next().unwrap();
            if !in_fence {
                in_fence = true;
                fence_char = Some(ch);
            } else if Some(ch) == fence_char {
                in_fence = false;
                fence_char = None;
            }
            continue;
        }
        if in_fence {
            continue;
        }

        // ATX heading: 1..=6 `#` followed by at least one whitespace, then text.
        // Optional trailing `#`s are stripped.
        if let Some(h) = parse_atx_heading(line, i) {
            out.push(h);
        }
    }

    out
}
// collect_headings END *******************************************************

//******************************************************************************
// parse_atx_heading
//******************************************************************************
fn parse_atx_heading(line: &str, line_index: usize) -> Option<Heading> {
    let s = line.trim_start_matches([' ', '\t']);
    let mut chars = s.chars();

    let mut level: u8 = 0;
    while let Some('#') = chars.clone().next() {
        chars.next();
        level += 1;
        if level > 6 {
            return None; // too many #'s — not a heading
        }
    }
    if level == 0 {
        return None;
    }

    // Must be followed by whitespace then text.
    match chars.next() {
        Some(c) if c.is_whitespace() => {}
        _ => return None,
    }

    let raw_text: String = chars.collect();
    let text = strip_trailing_hashes(raw_text.trim()).to_string();
    if text.is_empty() {
        return None;
    }

    Some(Heading {
        level,
        text,
        line_index,
    })
}
// parse_atx_heading END ******************************************************

//******************************************************************************
// strip_trailing_hashes
//******************************************************************************
fn strip_trailing_hashes(s: &str) -> &str {
    // A trailing `#` run that is preceded by whitespace is ornamental per the
    // CommonMark spec. We strip it. If there's no whitespace before the run,
    // we leave it alone (it's part of the heading text, e.g. "C#").
    let trimmed = s.trim_end();
    let without_hashes = trimmed.trim_end_matches('#');
    if without_hashes.len() == trimmed.len() {
        return s;
    }
    // Require whitespace between the text and the stripped `#`s.
    if without_hashes
        .chars()
        .last()
        .map(char::is_whitespace)
        .unwrap_or(true)
    {
        without_hashes.trim_end()
    } else {
        s
    }
}
// strip_trailing_hashes END **************************************************

//******************************************************************************
// slugify
//******************************************************************************
/// Build a GitHub-style anchor slug for a heading's display text.
///
///   * Lowercase
///   * Strip backticks (inline code)
///   * Keep letters/digits/hyphens/underscores; drop the rest
///   * Collapse runs of whitespace to a single hyphen
///
/// NB: react-markdown's default `rehype-slug` produces the same anchors, so
/// the generated `#slug` links work against the rendered preview.
fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_hyphen = false;

    for ch in text.chars() {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() || lowered == '_' {
            out.push(lowered);
            prev_hyphen = false;
        } else if (lowered == '-' || lowered.is_whitespace())
            && !prev_hyphen
            && !out.is_empty()
        {
            out.push('-');
            prev_hyphen = true;
        }
        // everything else is dropped
    }

    // trim a trailing hyphen
    if out.ends_with('-') {
        out.pop();
    }

    out
}
// slugify END ****************************************************************

//******************************************************************************
// disambiguate_slug
//******************************************************************************
/// Suffix duplicate slugs with `-1`, `-2`, ... (matches GitHub behavior).
fn disambiguate_slug(base: &str, seen: &mut HashMap<String, u32>) -> String {
    let count = seen.entry(base.to_string()).or_insert(0);
    let slug = if *count == 0 {
        base.to_string()
    } else {
        format!("{}-{}", base, count)
    };
    *count += 1;
    slug
}
// disambiguate_slug END ******************************************************

//******************************************************************************
// render_toc
//******************************************************************************
/// Build the bullet list body that goes between the TOC markers, given a set
/// of headings already filtered to the configured level range.
fn render_toc(headings: &[Heading], opts: TocOptions) -> String {
    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut lines = Vec::with_capacity(headings.len());

    for h in headings {
        let indent_level = h.level.saturating_sub(opts.min_level) as usize;
        let indent = "  ".repeat(indent_level);
        let base_slug = slugify(&h.text);
        let slug = disambiguate_slug(&base_slug, &mut seen);
        lines.push(format!("{}- [{}](#{})", indent, h.text, slug));
    }

    lines.join("\n")
}
// render_toc END *************************************************************

//******************************************************************************
// TocBlock
//******************************************************************************
/// A located `<!-- TOC ... --> … <!-- /TOC -->` pair in the document.
///
/// Line indices are 0-based and identify the **marker** lines themselves.
/// The replaceable body sits on `open_line+1..=close_line-1`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TocBlock {
    open_line: usize,
    close_line: usize,
    opts: TocOptions,
}
// TocBlock END ***************************************************************

//******************************************************************************
// find_toc_blocks
//******************************************************************************
/// Locate every well-formed `<!-- TOC … -->` / `<!-- /TOC -->` pair in the
/// document. A dangling opener with no closer is ignored (we never guess).
///
/// Marker detection is line-based: the marker comment must be the *only*
/// non-whitespace content on its line. This avoids surprising users whose
/// prose happens to contain the string "<!-- TOC -->".
fn find_toc_blocks(content: &str) -> Vec<TocBlock> {
    let mut blocks = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if is_toc_open_marker(trimmed) {
            // Scan forward for the matching close marker.
            let opts = parse_toc_options(trimmed);
            let mut j = i + 1;
            while j < lines.len() {
                let t = lines[j].trim();
                if is_toc_close_marker(t) {
                    blocks.push(TocBlock {
                        open_line: i,
                        close_line: j,
                        opts,
                    });
                    i = j;
                    break;
                }
                // A nested opener aborts this pair — we don't support nesting.
                if is_toc_open_marker(t) {
                    break;
                }
                j += 1;
            }
        }
        i += 1;
    }

    blocks
}

fn is_toc_open_marker(line: &str) -> bool {
    // Must start with `<!--`, contain a whole-word `TOC` token (not `/TOC`),
    // and end with `-->`.
    if !line.starts_with("<!--") || !line.ends_with("-->") {
        return false;
    }
    let inner = line
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim();
    // First token must be exactly `TOC` (case-insensitive).
    match inner.split_whitespace().next() {
        Some(first) => first.eq_ignore_ascii_case("TOC"),
        None => false,
    }
}

fn is_toc_close_marker(line: &str) -> bool {
    if !line.starts_with("<!--") || !line.ends_with("-->") {
        return false;
    }
    let inner = line
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim();
    inner.eq_ignore_ascii_case("/TOC")
}
// find_toc_blocks END ********************************************************

//******************************************************************************
// update_toc_in_document
//******************************************************************************
/// Entry point: return a version of `content` in which every TOC block has
/// been regenerated from the current headings. If the document contains no
/// well-formed TOC blocks, the input is returned unchanged.
///
/// The function preserves the document's line-ending style (LF vs CRLF) by
/// detecting it once and reusing it when splicing in the regenerated block.
pub fn update_toc_in_document(content: &str) -> String {
    let blocks = find_toc_blocks(content);
    if blocks.is_empty() {
        return content.to_string();
    }

    let newline = detect_newline(content);
    let lines: Vec<&str> = content.lines().collect();

    // Collect headings once. We filter per-block by each block's options, and
    // we exclude any heading that falls inside a TOC block body so the list
    // never references itself.
    let all_headings = collect_headings(content);
    let in_any_toc = |line_index: usize| -> bool {
        blocks
            .iter()
            .any(|b| line_index > b.open_line && line_index < b.close_line)
    };

    // Rebuild the document line-by-line, replacing each block body in turn.
    let mut out = String::with_capacity(content.len());
    let mut i = 0;
    let mut block_iter = blocks.iter();
    let mut next_block = block_iter.next();

    while i < lines.len() {
        if let Some(block) = next_block
            && i == block.open_line
        {
            // Emit the opening marker verbatim.
            out.push_str(lines[i]);
            out.push_str(newline);

            // Emit the regenerated body.
            let filtered: Vec<Heading> = all_headings
                .iter()
                .filter(|h| {
                    h.level >= block.opts.min_level
                        && h.level <= block.opts.max_level
                        && !in_any_toc(h.line_index)
                })
                .cloned()
                .collect();
            let body = render_toc(&filtered, block.opts);
            if !body.is_empty() {
                out.push_str(&body);
                out.push_str(newline);
            }

            // Emit the closing marker.
            out.push_str(lines[block.close_line]);
            // Only emit a trailing newline if there is more content OR the
            // original doc ended with a newline after this marker.
            if block.close_line + 1 < lines.len() || ends_with_newline(content) {
                out.push_str(newline);
            }

            i = block.close_line + 1;
            next_block = block_iter.next();
            continue;
        }

        out.push_str(lines[i]);
        // Preserve newline after every line except possibly the last.
        if i + 1 < lines.len() || ends_with_newline(content) {
            out.push_str(newline);
        }
        i += 1;
    }

    out
}
// update_toc_in_document END *************************************************

//******************************************************************************
// detect_newline
//******************************************************************************
fn detect_newline(content: &str) -> &'static str {
    if content.contains("\r\n") { "\r\n" } else { "\n" }
}

fn ends_with_newline(content: &str) -> bool {
    content.ends_with('\n')
}
// detect_newline END *********************************************************

//******************************************************************************
// update_toc (Tauri command)
//******************************************************************************
/// Tauri command wrapper. Accepts the full document text, returns the updated
/// text. The frontend owns the decision of whether to actually replace the
/// editor buffer (it will only dispatch a CodeMirror transaction when the
/// string differs from the current doc).
#[tauri::command]
pub fn update_toc(content: String) -> String {
    update_toc_in_document(&content)
}

#[cfg(test)]
#[path = "toc_tests.rs"]
mod tests;
