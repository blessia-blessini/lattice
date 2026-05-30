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

// Windows platform tests — file-association via CLI arguments.
//
// On Windows, double-clicking a `.md` file passes the path as a plain CLI
// argument.  These tests cover Windows-specific scenarios: paths with spaces
// and CRLF write-back tracking for files with no line endings.
// Included by file_open_tests.rs via build.rs — no #[cfg(target_os)] anywhere.

// ─────────────────────────────────────────────────────────────────────────────
// test_windows_path_with_spaces
// ─────────────────────────────────────────────────────────────────────────────
/// On Windows the OS delivers file-association paths as plain CLI arguments.
/// When the path contains spaces (e.g. `C:\Users\My Name\notes\hello.md`)
/// they arrive as a single string — no quoting needed by the caller.
/// Verify that `read_text_file` handles a path that contains spaces.
#[test]
fn test_windows_path_with_spaces() {
    let dir = tempfile::Builder::new()
        .prefix("lattice path with spaces")
        .tempdir()
        .unwrap();
    let md_path = dir.path().join("my file.md");
    let expected = "# Spaces\n\nPaths with spaces must work on Windows.";
    std::fs::write(&md_path, expected).unwrap();
    assert_eq!(read_file_content(&md_path.to_string_lossy(), "test-win-spaces"), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// test_windows_single_line_file_tracked_for_crlf
// ─────────────────────────────────────────────────────────────────────────────
/// On Windows, a file with no line endings (single-line content) has
/// `DetectedLineEndings::None`.  The Windows-specific `prefer_windows = true`
/// branch inside `read_text_file_internal` must set `wished_format` to
/// `NewLineCRLFLikeWindows` for mixed/none-line-ending content.
#[test]
fn test_windows_single_line_file_tracked_for_crlf() {
    let app = make_app();
    let handle = app.handle().clone();

    let mut tmp = NamedTempFile::new().unwrap();
    let single_line = "No line endings here at all";
    tmp.write_all(single_line.as_bytes()).unwrap();
    let path = tmp.path().to_string_lossy().to_string();

    file_state::read_text_file(
        path.clone(),
        handle.state::<file_state::FileTrackerState>(),
        Some("test-win-crlf-track".to_string()),
    )
    .expect("read must succeed");

    let state = handle.state::<file_state::FileTrackerState>();
    let tracker = state.files.lock().unwrap();
    let entry = tracker.get(&path).expect("file must be tracked after read");
    assert_eq!(
        entry.wished_format,
        file_state::FileWishedFormat::NewLineCRLFLikeWindows,
        "Windows must prefer CRLF for ambiguous (no line endings) content"
    );
}
