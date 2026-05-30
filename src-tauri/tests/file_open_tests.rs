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

//! Integration tests — file-open / file-association wiring
//!
//! Verifies that the Direct Push file-content loading mechanism works correctly
//! on all desktop and mobile platforms.  These tests sit in `tests/` so they
//! compile as a proper `[[test]]` Cargo binary, which receives the Common
//! Controls v6 activation manifest on Windows (required by
//! `tauri::test::MockRuntime`).
//!
//! # Structure
//!
//! - Cross-platform tests are defined directly in this file.
//! - Platform-specific tests live in `tests/platform/<os>.rs`.
//!   `build.rs` copies the correct file to `$OUT_DIR/platform_tests.rs`,
//!   which is `include!`d at the bottom of this file.  No `#[cfg(target_os)]`
//!   appears anywhere in test code — the compiler only ever sees one platform
//!   file, mirroring the production `src/platform/` design.

use lattice_lib::file_state;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;
use tempfile::NamedTempFile;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (make_app + read_file_content — shared with platform test files)
// ─────────────────────────────────────────────────────────────────────────────
include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/platform/test-common.rs"
));

// ─────────────────────────────────────────────────────────────────────────────
// test_file_open_reads_content_correctly
// ─────────────────────────────────────────────────────────────────────────────
/// Core: read_text_file must return the exact bytes written to the file.
/// This is the mechanism used by build_window_with_file (the Direct Push
/// pattern) on all three desktop platforms.
#[test]
fn test_file_open_reads_content_correctly() {
    let mut tmp = NamedTempFile::new().unwrap();
    let expected = "# Hello World\n\nOpened via file association.";
    tmp.write_all(expected.as_bytes()).unwrap();
    assert_eq!(read_file_content(&tmp.path().to_string_lossy(), "test-core-0"), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// test_file_open_nonexistent_returns_error
// ─────────────────────────────────────────────────────────────────────────────
/// build_window_with_file intentionally does not abort when a file cannot be
/// read (e.g. deleted between the OS open event and the read). This test
/// verifies the underlying read returns Err rather than panicking.
#[test]
fn test_file_open_nonexistent_returns_error() {
    let app = make_app();
    let handle = app.handle().clone();
    let state = handle.state::<file_state::FileTrackerState>();

    let result = file_state::read_text_file(
        "/nonexistent/totally/missing.md".to_string(),
        state,
        Some("test-win-1".to_string()),
    );

    assert!(result.is_err(), "expected Err for nonexistent file, got Ok");
}

// ─────────────────────────────────────────────────────────────────────────────
// test_file_open_multiple_files
// ─────────────────────────────────────────────────────────────────────────────
/// On all platforms the OS may open several files at once (shift-click +
/// open-with, or dragging multiple files onto the dock icon on macOS).
/// Each file must be read independently and produce the correct content.
#[test]
fn test_file_open_multiple_files() {
    let app = make_app();
    let handle = app.handle().clone();

    // Create 3 temp files with distinct content
    let files: Vec<(NamedTempFile, String)> = (0..3)
        .map(|i| {
            let mut f = NamedTempFile::new().unwrap();
            let content = format!("# File {i}\n\nContent for file {i}.");
            f.write_all(content.as_bytes()).unwrap();
            (f, content)
        })
        .collect();

    for (i, (tmp, expected)) in files.iter().enumerate() {
        let path = tmp.path().to_string_lossy().to_string();
        let state = handle.state::<file_state::FileTrackerState>();
        let label = format!("test-win-multi-{}", i);

        let result = file_state::read_text_file(path, state, Some(label.clone()));
        assert!(result.is_ok(), "file {} read failed: {:?}", i, result);
        assert_eq!(
            result.unwrap().content,
            *expected,
            "content mismatch for file {}",
            i
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// test_file_open_empty_file
// ─────────────────────────────────────────────────────────────────────────────
/// An empty file should produce empty content (not an error). This mirrors the
/// "no file" startup path where build_window_with_file is called with None.
#[test]
fn test_file_open_empty_file() {
    let tmp = NamedTempFile::new().unwrap(); // 0 bytes
    assert_eq!(read_file_content(&tmp.path().to_string_lossy(), "test-empty"), "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-platform: CRLF normalization and .md extension
// ─────────────────────────────────────────────────────────────────────────────

/// A file authored on Windows (CRLF line endings) must be delivered with LF
/// content to the frontend on every platform — the Direct Push mechanism
/// normalises line endings before injection.
#[test]
fn test_file_open_crlf_content_normalized_to_lf() {
    let mut tmp = NamedTempFile::new().unwrap();
    tmp.write_all("# Heading\r\n\r\nParagraph one.\r\n".as_bytes()).unwrap();
    let content = read_file_content(&tmp.path().to_string_lossy(), "test-crlf-norm");
    assert!(
        !content.contains('\r'),
        "Internal content must not contain CR characters, got: {:?}",
        content
    );
    assert_eq!(content, "# Heading\n\nParagraph one.\n");
}

/// A file named with the `.md` extension — the exact extension registered in
/// `tauri.conf.json`'s `fileAssociations` — must open identically to any
/// other text file.
#[test]
fn test_file_open_md_named_file() {
    let dir = tempfile::tempdir().unwrap();
    let md_path = dir.path().join("notes.md");
    let expected = "# My Notes\n\nHello from file association.";
    std::fs::write(&md_path, expected).unwrap();
    assert_eq!(read_file_content(&md_path.to_string_lossy(), "test-md-ext"), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform-specific tests
// build.rs copies tests/platform/<os>.rs → $OUT_DIR/platform_tests.rs
// ─────────────────────────────────────────────────────────────────────────────
include!(concat!(env!("OUT_DIR"), "/platform_tests.rs"));
