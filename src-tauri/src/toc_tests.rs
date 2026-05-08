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
// test_no_markers_is_passthrough
//*************************************************************************
#[test]
fn test_no_markers_is_passthrough() {
    let doc = "# Hello\n\nSome text\n\n## World\n";
    assert_eq!(update_toc_in_document(doc), doc);
}

//*************************************************************************
// test_empty_document
//*************************************************************************
#[test]
fn test_empty_document() {
    assert_eq!(update_toc_in_document(""), "");
}

//*************************************************************************
// test_dangling_opener_is_ignored
//*************************************************************************
#[test]
fn test_dangling_opener_is_ignored() {
    let doc = "<!-- TOC -->\n## Heading\n";
    // No closer -> no changes at all.
    assert_eq!(update_toc_in_document(doc), doc);
}

//*************************************************************************
// test_populates_empty_block
//*************************************************************************
#[test]
fn test_populates_empty_block() {
    let doc = "\
# Title
<!-- TOC -->
<!-- /TOC -->
## Intro
text
## Setup
### Requirements
## Usage
";
    let out = update_toc_in_document(doc);
    let expected = "\
# Title
<!-- TOC -->
- [Intro](#intro)
- [Setup](#setup)
  - [Requirements](#requirements)
- [Usage](#usage)
<!-- /TOC -->
## Intro
text
## Setup
### Requirements
## Usage
";
    assert_eq!(out, expected);
}

//*************************************************************************
// test_refreshes_populated_block
//*************************************************************************
#[test]
fn test_refreshes_populated_block() {
    // The stale content between the markers must be dropped.
    let doc = "\
<!-- TOC -->
- [old stuff](#old-stuff)
  - stale line
<!-- /TOC -->
## New Section
";
    let out = update_toc_in_document(doc);
    let expected = "\
<!-- TOC -->
- [New Section](#new-section)
<!-- /TOC -->
## New Section
";
    assert_eq!(out, expected);
}

//*************************************************************************
// test_options_limit_levels
//*************************************************************************
#[test]
fn test_options_limit_levels() {
    let doc = "\
<!-- TOC minLevel=2 maxLevel=2 -->
<!-- /TOC -->
# H1
## H2a
### H3 (should be skipped)
## H2b
";
    let out = update_toc_in_document(doc);
    let expected = "\
<!-- TOC minLevel=2 maxLevel=2 -->
- [H2a](#h2a)
- [H2b](#h2b)
<!-- /TOC -->
# H1
## H2a
### H3 (should be skipped)
## H2b
";
    assert_eq!(out, expected);
}

//*************************************************************************
// test_options_include_h1
//*************************************************************************
#[test]
fn test_options_include_h1() {
    let doc = "\
<!-- TOC minLevel=1 maxLevel=2 -->
<!-- /TOC -->
# Top
## Sub
";
    let out = update_toc_in_document(doc);
    assert!(out.contains("- [Top](#top)"));
    assert!(out.contains("  - [Sub](#sub)"));
}

//*************************************************************************
// test_skips_headings_inside_code_fence
//*************************************************************************
#[test]
fn test_skips_headings_inside_code_fence() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## Real Heading
```
## Not A Heading
```
## Another Real
";
    let out = update_toc_in_document(doc);
    assert!(out.contains("- [Real Heading](#real-heading)"));
    assert!(out.contains("- [Another Real](#another-real)"));
    assert!(!out.contains("(#not-a-heading)"));
}

//*************************************************************************
// test_skips_tilde_fence
//*************************************************************************
#[test]
fn test_skips_tilde_fence() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
~~~
## Not A Heading
~~~
## Visible
";
    let out = update_toc_in_document(doc);
    assert!(out.contains("- [Visible](#visible)"));
    assert!(!out.contains("(#not-a-heading)"));
}

//*************************************************************************
// test_self_references_excluded
//*************************************************************************
#[test]
fn test_self_references_excluded() {
    // Somehow a heading is inside the TOC body (edge case) — it must not
    // end up in the regenerated list.
    let doc = "\
<!-- TOC -->
## Ghost Heading Inside Block
<!-- /TOC -->
## Real
";
    let out = update_toc_in_document(doc);
    assert!(!out.contains("(#ghost-heading-inside-block)"));
    assert!(out.contains("- [Real](#real)"));
}

//*************************************************************************
// test_duplicate_headings_disambiguated
//*************************************************************************
#[test]
fn test_duplicate_headings_disambiguated() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## Setup
## Setup
## Setup
";
    let out = update_toc_in_document(doc);
    assert!(out.contains("- [Setup](#setup)"));
    assert!(out.contains("- [Setup](#setup-1)"));
    assert!(out.contains("- [Setup](#setup-2)"));
}

//*************************************************************************
// test_idempotent
//*************************************************************************
#[test]
fn test_idempotent() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## A
## B
";
    let once = update_toc_in_document(doc);
    let twice = update_toc_in_document(&once);
    assert_eq!(once, twice);
}

//*************************************************************************
// test_multiple_blocks
//*************************************************************************
#[test]
fn test_multiple_blocks() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## A
<!-- TOC maxLevel=3 -->
<!-- /TOC -->
## B
### B1
";
    let out = update_toc_in_document(doc);
    // Both blocks should be populated with the same headings (each block
    // sees every heading outside *all* toc bodies — they're not partitioned).
    let block_count = out.matches("<!-- /TOC -->").count();
    assert_eq!(block_count, 2);
    assert!(out.contains("- [A](#a)"));
    assert!(out.contains("- [B](#b)"));
}

//*************************************************************************
// test_preserves_crlf_newlines
//*************************************************************************
#[test]
fn test_preserves_crlf_newlines() {
    let doc = "<!-- TOC -->\r\n<!-- /TOC -->\r\n## Heading\r\n";
    let out = update_toc_in_document(doc);
    assert!(out.contains("\r\n"));
    assert!(!out.contains("\n\n")); // no stray LF-only lines
}

//*************************************************************************
// test_slugify_edge_cases
//*************************************************************************
#[test]
fn test_slugify_edge_cases() {
    assert_eq!(slugify("Hello World"), "hello-world");
    assert_eq!(slugify("Why `useMemo`?"), "why-usememo");
    assert_eq!(slugify("  leading and trailing  "), "leading-and-trailing");
    assert_eq!(slugify("Unicode café"), "unicode-caf"); // non-ASCII dropped
    assert_eq!(slugify("snake_case_stays"), "snake_case_stays");
    assert_eq!(slugify("!!!"), "");
}

//*************************************************************************
// test_parse_toc_options_defaults
//*************************************************************************
#[test]
fn test_parse_toc_options_defaults() {
    let o = parse_toc_options("<!-- TOC -->");
    assert_eq!(o.min_level, DEFAULT_MIN_LEVEL);
    assert_eq!(o.max_level, DEFAULT_MAX_LEVEL);
}

//*************************************************************************
// test_parse_toc_options_values
//*************************************************************************
#[test]
fn test_parse_toc_options_values() {
    let o = parse_toc_options("<!-- TOC minLevel=3 maxLevel=5 -->");
    assert_eq!(o.min_level, 3);
    assert_eq!(o.max_level, 5);
}

//*************************************************************************
// test_parse_toc_options_swap_when_inverted
//*************************************************************************
#[test]
fn test_parse_toc_options_swap_when_inverted() {
    let o = parse_toc_options("<!-- TOC minLevel=5 maxLevel=2 -->");
    // min/max silently swapped rather than falling back — users get what
    // they meant rather than an invisible-defaulted TOC.
    assert_eq!(o.min_level, 2);
    assert_eq!(o.max_level, 5);
}

//*************************************************************************
// test_parse_toc_options_ignores_garbage
//*************************************************************************
#[test]
fn test_parse_toc_options_ignores_garbage() {
    let o = parse_toc_options("<!-- TOC minLevel=xyz foo=bar maxLevel=99 -->");
    // Unparseable / out-of-range values leave the defaults in place.
    assert_eq!(o.min_level, DEFAULT_MIN_LEVEL);
    assert_eq!(o.max_level, DEFAULT_MAX_LEVEL);
}

//*************************************************************************
// test_atx_requires_space_after_hashes
//*************************************************************************
#[test]
fn test_atx_requires_space_after_hashes() {
    // `##foo` (no space) is not a heading per CommonMark.
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
##NoSpace
## WithSpace
";
    let out = update_toc_in_document(doc);
    assert!(!out.contains("(#nospace)"));
    assert!(out.contains("- [WithSpace](#withspace)"));
}

//*************************************************************************
// test_strips_trailing_hashes
//*************************************************************************
#[test]
fn test_strips_trailing_hashes() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## Heading ##
";
    let out = update_toc_in_document(doc);
    assert!(out.contains("- [Heading](#heading)"));
}

//*************************************************************************
// test_marker_requires_own_line
//*************************************************************************
#[test]
fn test_marker_requires_own_line() {
    // The string "<!-- TOC -->" buried in prose must NOT trigger anything.
    let doc = "Inline mention of <!-- TOC --> should be ignored.\n## A\n";
    assert_eq!(update_toc_in_document(doc), doc);
}

//*************************************************************************
// test_parse_toc_options_non_toc_leading_token
//*************************************************************************
/// parse_toc_options is called only on lines already validated by
/// is_toc_open_marker, but the function has a defensive branch for the
/// case where the inner content starts with something other than "TOC".
/// Calling it directly with a non-TOC leading token must return defaults.
#[test]
fn test_parse_toc_options_non_toc_leading_token() {
    // Inner splits on whitespace → first token is "NOTOC" ≠ "TOC".
    // The Some(_) arm sets rest = inner (the whole inner string).
    // "something" has no '=' so it is silently ignored, and both levels
    // stay at their defaults.  (Using key=value pairs here would still be
    // parsed from `inner`, so we deliberately omit them.)
    let o = parse_toc_options("<!-- NOTOC something -->");
    assert_eq!(o.min_level, DEFAULT_MIN_LEVEL);
    assert_eq!(o.max_level, DEFAULT_MAX_LEVEL);
}

//*************************************************************************
// test_seven_or_more_hashes_not_a_heading
//*************************************************************************
/// ATX headings are limited to six `#` characters; a seventh makes the
/// line a non-heading, so it must be excluded from the TOC.
#[test]
fn test_seven_or_more_hashes_not_a_heading() {
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
####### Too Deep (7 hashes)
## Visible
";
    let out = update_toc_in_document(doc);
    assert!(out.contains("- [Visible](#visible)"));
    // The 7-hash line is NOT a heading so it must not appear as a TOC
    // list entry.  The raw line still exists in the document body, so we
    // check for the link form rather than the text alone.
    assert!(!out.contains("- [Too Deep]"), "7-hash line must not produce a TOC entry");
}

//*************************************************************************
// test_empty_heading_text_after_hash_strip
//*************************************************************************
/// A heading whose display text is entirely consumed by trailing-hash
/// stripping (e.g. `## ##`) produces an empty string and must be ignored —
/// an id-less entry in the TOC would produce a broken link.
#[test]
fn test_empty_heading_text_after_hash_strip() {
    // "## ##" → raw_text is "##", trim is "##", strip_trailing_hashes("##")
    // returns "" after stripping the hash run preceded by "" (whitespace).
    // parse_atx_heading returns None for empty text.
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## ##
## Real
";
    let out = update_toc_in_document(doc);
    // Only the real heading appears in the TOC.
    assert!(out.contains("- [Real](#real)"));
    // The "## ##" line must not produce a link.
    assert!(!out.contains("(#)"));
}

//*************************************************************************
// test_strip_trailing_hashes_no_space_before
//*************************************************************************
/// If the hash run at the end of the heading text is NOT preceded by
/// whitespace, the run is part of the text (e.g. "C#") and must be left
/// intact. strip_trailing_hashes should return the original `s` unchanged.
#[test]
fn test_strip_trailing_hashes_no_space_before() {
    // "## C#" → raw_text "C#", trailing '#' has no preceding whitespace
    // so strip_trailing_hashes returns "C#" (the `s` branch).
    let doc = "\
<!-- TOC -->
<!-- /TOC -->
## C#
";
    let out = update_toc_in_document(doc);
    // Heading text "C#" must appear in the TOC.
    assert!(out.contains("- [C#](#c)"), "expected C# slug, got:\n{}", out);
}

//*************************************************************************
// test_nested_toc_opener_aborts_block
//*************************************************************************
/// When a second `<!-- TOC -->` opener is encountered while scanning for
/// a closer, the current pair is abandoned (we do not support nesting).
/// The document must come back unchanged.
#[test]
fn test_nested_toc_opener_aborts_block() {
    // The outer opener aborts when the scanner sees a second opener.
    // The second opener then scans forward but finds no closing marker,
    // so no TocBlock is ever pushed.  Result: blocks is empty → the
    // document is returned verbatim.
    //
    // Note: adding a <!-- /TOC --> would let the *second* opener pair
    // with it, forming a valid block.  To exercise the break-with-no-
    // closer path we deliberately omit the close marker.
    let doc = "<!-- TOC -->\n<!-- TOC -->\n## Heading\n";
    assert_eq!(update_toc_in_document(doc), doc);
}

//*************************************************************************
// test_is_toc_open_marker_empty_inner_comment
//*************************************************************************
/// A comment with no inner content (`<!-- -->`) must not be treated as a
/// TOC opener. The `split_whitespace().next()` call returns None for an
/// empty string, hitting the `None => false` arm.
#[test]
fn test_is_toc_open_marker_empty_inner_comment() {
    // "<!-- -->" → inner is "" → split_whitespace().next() is None → false.
    assert!(!is_toc_open_marker("<!-- -->"));
    // A single space comment.
    assert!(!is_toc_open_marker("<!---->"));
}

//*************************************************************************
// test_update_toc_command_wrapper
//*************************************************************************
/// The public Tauri command `update_toc` is a thin String-owning wrapper
/// around `update_toc_in_document`. Calling it directly verifies the
/// wrapper compiles correctly and delegates properly.
#[test]
fn test_update_toc_command_wrapper() {
    let input = "<!-- TOC -->\n<!-- /TOC -->\n## X\n".to_string();
    let out = update_toc(input);
    assert!(out.contains("- [X](#x)"));
}
