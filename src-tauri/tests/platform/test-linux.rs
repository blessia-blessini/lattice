// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 OFFICE:
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

// Linux platform tests — file-association via .desktop MIME type / CLI args.
//
// On Linux, the desktop environment passes the file path as a plain CLI
// argument via the .desktop MIME association.  These tests cover
// Linux-specific scenarios: symlink paths and UTF-8 non-ASCII filenames.
// Included by file_open_tests.rs via build.rs — no #[cfg(target_os)] anywhere.

// ─────────────────────────────────────────────────────────────────────────────
// test_linux_symlink_to_md_file
// ─────────────────────────────────────────────────────────────────────────────
/// On Linux, the desktop environment (via a `.desktop` MIME association) may
/// resolve a symlink and pass the symlink path to Lattice.  `read_text_file`
/// must follow the symlink transparently.
#[test]
fn test_linux_symlink_to_md_file() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let real_file = dir.path().join("real.md");
    let expected = "# Symlink Target\n\nContent behind a symlink.";
    std::fs::write(&real_file, expected).unwrap();

    let link_path = dir.path().join("link.md");
    symlink(&real_file, &link_path).unwrap();

    assert_eq!(read_file_content(&link_path.to_string_lossy(), "test-linux-symlink"), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// test_linux_unicode_path
// ─────────────────────────────────────────────────────────────────────────────
/// Linux file paths are UTF-8 and may include non-ASCII characters in
/// directory or file names.  A path with accented characters must not prevent
/// `read_text_file` from opening the file.
#[test]
fn test_linux_unicode_path() {
    let dir = tempfile::tempdir().unwrap();
    let unicode_dir = dir.path().join("données_café");
    std::fs::create_dir_all(&unicode_dir).unwrap();
    let md_path = unicode_dir.join("notes.md");
    let expected = "# Unicode Path\n\nNon-ASCII directory name.";
    std::fs::write(&md_path, expected).unwrap();
    assert_eq!(read_file_content(&md_path.to_string_lossy(), "test-linux-unicode"), expected);
}
