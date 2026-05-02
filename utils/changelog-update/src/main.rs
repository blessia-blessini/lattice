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

//! changelog-update
//! ----------------
//! Inserts a commit-title bullet immediately after the first line that
//! contains the marker `INSERT BULLETS UNDER THIS LINE` in CHANGELOG.md.
//!
//! Usage:
//!   changelog-update "<commit title>" "<path-to-CHANGELOG.md>"
//!
//! Always exits 0 — it must never block a git commit.

use std::{env, fs, process};

const MARKER: &str = "INSERT BULLETS UNDER THIS LINE";

////////////////////////////////////////////////////////////////
/// main
////////////////////////////////////////////////////////////////
fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 3 {
        eprintln!("[changelog-update] usage: changelog-update <title> <changelog-path>");
        process::exit(0);
    }

    let title = args[1].trim();
    let path = &args[2];

    if title.is_empty() {
        process::exit(0);
    }

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[changelog-update] warning: cannot read {path}: {e}");
            process::exit(0);
        }
    };

    if let Err(e) = update(&content, title, path) {
        eprintln!("[changelog-update] warning: {e}");
    }

    process::exit(0);
} // main END ////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
/// update
////////////////////////////////////////////////////////////////
fn update(content: &str, title: &str, path: &str) -> Result<(), String> {
    // Detect and preserve the original line-ending style
    let eol: &str = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let trailing_newline = content.ends_with('\n');

    // Split into lines, stripping \r for uniform in-memory handling
    let mut lines: Vec<String> = content
        .split('\n')
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();

    // Drop the phantom empty element left by a trailing newline
    if trailing_newline {
        if lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            lines.pop();
        }
    }

    // ── Locate the marker line ────────────────────────────────────────────
    let marker_idx = match lines.iter().position(|l| l.contains(MARKER)) {
        Some(i) => i,
        None    => return Ok(()), // marker not present — nothing to do
    };

    let bullet = format!("- {title}");

    // ── Amend-safe: skip if the exact bullet already follows the marker ───
    let mut j = marker_idx + 1;
    while j < lines.len() {
        if lines[j] == bullet {
            return Ok(());
        }
        // Stop scanning at the next section heading or another marker
        if lines[j].starts_with('#') || lines[j].contains(MARKER) {
            break;
        }
        j += 1;
    }

    // ── Insert immediately after the marker line ──────────────────────────
    lines.insert(marker_idx + 1, bullet.clone());

    // Reconstruct with the original EOL, restoring the trailing newline
    let mut new_content = lines.join(eol);
    if trailing_newline {
        new_content.push_str(eol);
    }

    fs::write(path, new_content).map_err(|e| format!("cannot write {path}: {e}"))?;

    println!("[changelog] added: {bullet}");
    Ok(())
} // update END ////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
/// tests
////////////////////////////////////////////////////////////////
#[cfg(test)]
mod tests {
    use super::*;

    fn make_changelog(bullets: &str) -> String {
        format!(
            "# Changelog\n\n## vCurrent\n\n<!-- INSERT BULLETS UNDER THIS LINE -->\n{bullets}\n## v0.1.0\n\n<!-- INSERT BULLETS UNDER THIS LINE -->\n- old thing\n"
        )
    }

    #[test]
    fn inserts_bullet_after_marker() {
        let content = make_changelog("");
        let tmp = std::env::temp_dir().join("cl_test1.md");
        fs::write(&tmp, &content).unwrap();
        update(&content, "add new feature", tmp.to_str().unwrap()).unwrap();
        let result = fs::read_to_string(&tmp).unwrap();
        assert!(result.contains("- add new feature"));
    }

    #[test]
    fn bullet_is_placed_immediately_after_marker() {
        let content = make_changelog("");
        let tmp = std::env::temp_dir().join("cl_test4.md");
        fs::write(&tmp, &content).unwrap();
        update(&content, "first entry", tmp.to_str().unwrap()).unwrap();
        let result = fs::read_to_string(&tmp).unwrap();
        let marker_pos  = result.find(MARKER).unwrap();
        let bullet_pos  = result.find("- first entry").unwrap();
        assert!(bullet_pos > marker_pos, "bullet must come after marker");
        // Nothing between marker line and bullet line
        let between = &result[marker_pos..bullet_pos];
        assert_eq!(between.lines().count(), 1, "bullet must be on the very next line");
    }

    #[test]
    fn does_not_duplicate_on_amend() {
        let content = make_changelog("- add new feature\n");
        let tmp = std::env::temp_dir().join("cl_test2.md");
        fs::write(&tmp, &content).unwrap();
        update(&content, "add new feature", tmp.to_str().unwrap()).unwrap();
        let result = fs::read_to_string(&tmp).unwrap();
        assert_eq!(result.matches("- add new feature").count(), 1);
    }

    #[test]
    fn does_not_touch_older_version_section() {
        let content = make_changelog("");
        let tmp = std::env::temp_dir().join("cl_test3.md");
        fs::write(&tmp, &content).unwrap();
        update(&content, "something new", tmp.to_str().unwrap()).unwrap();
        let result = fs::read_to_string(&tmp).unwrap();
        // Old bullet must still be there
        assert!(result.contains("- old thing"));
        // New bullet must appear before the v0.1.0 section
        let new_pos = result.find("- something new").unwrap();
        let old_pos = result.find("## v0.1.0").unwrap();
        assert!(new_pos < old_pos, "new bullet must be before the old version section");
    }

    #[test]
    fn no_marker_means_no_change() {
        let content = "# Changelog\n\n- existing\n".to_string();
        let tmp = std::env::temp_dir().join("cl_test5.md");
        fs::write(&tmp, &content).unwrap();
        update(&content, "new thing", tmp.to_str().unwrap()).unwrap();
        let result = fs::read_to_string(&tmp).unwrap();
        assert!(!result.contains("- new thing"), "must not modify file without marker");
        assert!(result.contains("- existing"));
    }
} // tests END ////////////////////////////////////////////////////
