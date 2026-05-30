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

// macOS platform tests — file-association via RunEvent::Opened (Apple Events).
//
// On macOS, the OS delivers file paths as `file://` URLs inside
// `RunEvent::Opened`.  These tests verify the `url.to_file_path()` conversion
// used in the event handler.  They are included by file_open_tests.rs via
// build.rs — no #[cfg(target_os)] anywhere.

// ─────────────────────────────────────────────────────────────────────────────
// test_macos_file_url_to_path_simple
// ─────────────────────────────────────────────────────────────────────────────
/// macOS sends file paths as `file://` URLs inside `RunEvent::Opened`.
/// Verifies that `url.to_file_path()` (used in the event handler) converts
/// them to proper absolute paths.
#[test]
fn test_macos_file_url_to_path_simple() {
    let url = url::Url::parse("file:///Users/alice/notes/hello.md").unwrap();
    let path = url.to_file_path().expect("to_file_path failed");
    assert_eq!(path.to_string_lossy(), "/Users/alice/notes/hello.md");
}

// ─────────────────────────────────────────────────────────────────────────────
// test_macos_file_url_with_spaces_decoded
// ─────────────────────────────────────────────────────────────────────────────
/// Paths with spaces are percent-encoded in the URL; they must be decoded.
#[test]
fn test_macos_file_url_with_spaces_decoded() {
    let url =
        url::Url::parse("file:///Users/alice/my%20notes/hello%20world.md").unwrap();
    let path = url.to_file_path().expect("to_file_path failed");
    assert_eq!(
        path.to_string_lossy(),
        "/Users/alice/my notes/hello world.md"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// test_macos_non_file_url_rejected
// ─────────────────────────────────────────────────────────────────────────────
/// Non-file URLs (e.g. custom scheme URLs) must not produce a file path —
/// they should be silently skipped in the RunEvent::Opened handler.
#[test]
fn test_macos_non_file_url_rejected() {
    let url = url::Url::parse("https://example.com/file.md").unwrap();
    assert!(
        url.to_file_path().is_err(),
        "non-file URL should not convert to a path"
    );
}
