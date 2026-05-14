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

//! Integration tests — Tauri command shim wiring
//!
//! These tests sit in `tests/` so they compile as a **separate Cargo test
//! binary** (a proper `[[test]]` target).  That matters on Windows: the
//! `cargo:rustc-link-arg-tests` directive in `build.rs` embeds the Common
//! Controls v6 activation manifest into this binary, which is required for
//! `tauri::test::MockRuntime` to load without crashing on
//! `STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139 / `TaskDialogIndirect`).
//!
//! Inline `#[cfg(test)]` modules inside `[lib]` cannot receive that manifest
//! via `cargo:rustc-link-arg-tests` (the directive applies only to explicit
//! test targets), which is why the MockRuntime tests live here rather than
//! in `settings_tests.rs`.
//!
//! # What is verified
//!
//! The unit tests in `settings_tests.rs` cover every branch of the `_internal`
//! functions.  These tests add a higher layer: they prove that the thin Tauri
//! command shims (`load_settings`, `save_settings`) correctly wire up an
//! `AppHandle` to those internal functions end-to-end.  Specifically:
//!
//! 1. A `tauri::App<MockRuntime>` can be constructed and its `AppHandle` passed
//!    to the shims without panicking.
//! 2. `calc_base_path_internal` is called through a live `AppHandle` and
//!    produces a usable home path.
//! 3. Settings are loaded / saved and the results flow back through the command
//!    boundary unmodified.

use lattice_lib::settings::{load_settings, save_settings, Settings};
use std::fs;
use tauri::test::{mock_builder, mock_context, noop_assets};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Spin up a minimal in-process Tauri application backed by `MockRuntime`.
/// No real window, no display server, no IPC — pure in-process.
fn make_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .build(mock_context(noop_assets()))
        .expect("MockRuntime app construction failed")
}

// ─────────────────────────────────────────────────────────────────────────────
// test_load_settings_shim_missing_file_returns_defaults
// ─────────────────────────────────────────────────────────────────────────────
/// Wiring: shim must succeed even for a non-existent settings path.
///
/// The internal function falls back to `Settings::default()` when the file is
/// absent; this test verifies that the default values flow back through the
/// command boundary unchanged and that no panic occurs.
#[test]
fn test_load_settings_shim_missing_file_returns_defaults() {
    let app = make_app();
    let handle = app.handle().clone();

    // Path has no `.lattice` component → get_vault_root returns Err,
    // so load_settings_internal takes the Err branch and returns raw defaults.
    let result = load_settings(handle, "/nonexistent_lattice_path/settings.json".to_string());
    assert!(
        result.is_ok(),
        "Shim must not error on a missing file: {:?}",
        result
    );
    let s = result.unwrap();
    assert_eq!(s.default_open_theme, "dark");
    assert!(!s.word_wrap);
    assert!(s.save_on_blur);
    assert!(s.highlight_mark);
}

// ─────────────────────────────────────────────────────────────────────────────
// test_load_settings_shim_reads_valid_file
// ─────────────────────────────────────────────────────────────────────────────
/// Wiring: shim with a real `.lattice/settings.json` must parse the file and
/// return expanded settings, proving that `calc_base_path_internal` and
/// `load_settings_internal` are correctly plumbed through the shim.
#[test]
fn test_load_settings_shim_reads_valid_file() {
    let app = make_app();
    let handle = app.handle().clone();

    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, r#"{"wordWrap": true, "saveOnBlur": false}"#).unwrap();

    let result = load_settings(handle, settings_path.to_string_lossy().to_string());
    assert!(result.is_ok(), "Expected Ok from shim: {:?}", result);

    let s = result.unwrap();
    assert!(s.word_wrap, "wordWrap must be true");
    assert!(!s.save_on_blur, "saveOnBlur must be false");
}

// ─────────────────────────────────────────────────────────────────────────────
// test_save_settings_shim_persists_to_disk
// ─────────────────────────────────────────────────────────────────────────────
/// Wiring: shim must write settings to disk with the daily-notes path
/// condensed, proving `calc_base_path_internal` and `save_settings_internal`
/// are correctly connected through the command boundary.
///
/// Also verifies merge semantics: a key present in the existing file but
/// absent from `Settings` must be preserved after the save.
#[test]
fn test_save_settings_shim_persists_to_disk() {
    let app = make_app();
    let handle = app.handle().clone();

    let temp = tempfile::tempdir().unwrap();
    let vault_root = temp.path().join("vault");
    let lattice_dir = vault_root.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    // Pre-seed an unknown key to verify merge semantics
    fs::write(&settings_path, r#"{"unknownKey": "preserved"}"#).unwrap();

    let sep = std::path::MAIN_SEPARATOR_STR;
    let mut s = Settings::default();
    s.word_wrap = true;
    // Supply an expanded daily path so the condense step can be verified
    s.daily_notes_path = format!("{}{sep}daily", vault_root.display());

    let result = save_settings(handle, settings_path.to_string_lossy().to_string(), s);
    assert!(result.is_ok(), "save_settings shim must succeed: {:?}", result);

    let raw = fs::read_to_string(&settings_path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();

    assert_eq!(v["wordWrap"], true, "wordWrap must be persisted");

    let stored = v["dailyNotesPath"].as_str().unwrap_or("");
    assert!(
        stored.contains("{notesRoot}"),
        "daily path must be condensed to {{notesRoot}} token, got: {}",
        stored
    );

    assert_eq!(
        v["unknownKey"], "preserved",
        "unknown keys in the existing file must survive a save"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// test_load_then_save_round_trip
// ─────────────────────────────────────────────────────────────────────────────
/// Wiring round-trip: load → mutate in memory → save → load again.
/// Verifies that two separate shim invocations on the same file produce
/// consistent results and that no state leaks between them.
#[test]
fn test_load_then_save_round_trip() {
    let temp = tempfile::tempdir().unwrap();
    let vault_root = temp.path().join("vault");
    let lattice_dir = vault_root.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let path_str = settings_path.to_string_lossy().to_string();

    // ── Load 1 — should return defaults ──────────────────────────────────────
    {
        let app = make_app();
        let handle = app.handle().clone();
        let s = load_settings(handle, path_str.clone()).unwrap();
        assert!(!s.word_wrap, "Initial wordWrap must be false (default)");
    }

    // ── Save — flip wordWrap ──────────────────────────────────────────────────
    {
        let app = make_app();
        let handle = app.handle().clone();
        let mut s = Settings::default();
        s.word_wrap = true;
        save_settings(handle, path_str.clone(), s).unwrap();
    }

    // ── Load 2 — must reflect the saved value ─────────────────────────────────
    {
        let app = make_app();
        let handle = app.handle().clone();
        let s = load_settings(handle, path_str.clone()).unwrap();
        assert!(s.word_wrap, "wordWrap must be true after save");
    }
}
