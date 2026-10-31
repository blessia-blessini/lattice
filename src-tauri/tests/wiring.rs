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

// ═════════════════════════════════════════════════════════════════════════════
// Daily note (Chapter DLN) — ITST through the real IPC boundary
// ─────────────────────────────────────────────────────────────────────────────
// The unit tests in daily_note_tests.rs pin the naming, title and
// create-or-open rules. These add what they cannot see: the frontend calls
// `invoke('open_daily_note', { dailyNotesPath, prefix, useCalendarWeekTitle })`,
// so the camelCase argument names, the prefix validation that happens while
// those arguments are deserialized, and the String path handed back are all
// exercised here exactly as the WebView exercises them.
// ═════════════════════════════════════════════════════════════════════════════

/// A MockRuntime app whose only command is `open_daily_note`, plus a webview
/// to send IPC requests from.
fn make_daily_note_app() -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![lattice_lib::daily_note::open_daily_note])
        .build(mock_context(noop_assets()))
        .expect("MockRuntime app construction failed");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");
    (app, webview)
}

/// Send `open_daily_note` with the given JSON arguments, as the frontend does.
fn invoke_open_daily_note(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    args: serde_json::Value,
) -> Result<String, serde_json::Value> {
    tauri::test::get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: "open_daily_note".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            // The webview's own URL is the app's local origin on every
            // platform (tauri://localhost, or http://tauri.localhost on
            // Windows/Android). Sending from anywhere else would be a
            // *remote* origin, which the ACL rightly refuses.
            url: webview.url().expect("mock webview has a URL"),
            body: tauri::ipc::InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<String>().expect("command returns a path string"))
}

// ─────────────────────────────────────────────────────────────────────────────
// test_open_daily_note_ipc_creates_then_reopens
// ─────────────────────────────────────────────────────────────────────────────
/// ITST for REQ-LTTCE-DLN-00002 … -00004: first call creates today's note in a
/// not-yet-existing folder with the calendar-week title; the second call
/// returns the same path and leaves the content — including the user's edit —
/// untouched.
#[test]
fn test_open_daily_note_ipc_creates_then_reopens() {
    let (_app, webview) = make_daily_note_app();
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("vault").join("daily");

    let args = serde_json::json!({
        "dailyNotesPath": dir.to_string_lossy(),
        "prefix": "DLN",
        "useCalendarWeekTitle": true,
    });

    let first = invoke_open_daily_note(&webview, args.clone()).expect("first call must succeed");
    let first_path = std::path::Path::new(&first);
    assert!(first_path.starts_with(&dir), "note must be in the daily folder: {first}");
    let name = first_path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.starts_with("DLN-") && name.ends_with(".md"), "unexpected name {name}");

    let title = fs::read_to_string(first_path).unwrap();
    assert!(title.starts_with("# Daily Note: ") && title.contains(" CW"), "unexpected title {title:?}");

    // The user writes into today's note, then presses the button again.
    let edited = format!("{title}\n\nmet the team\n");
    fs::write(first_path, &edited).unwrap();

    let second = invoke_open_daily_note(&webview, args).expect("second call must succeed");
    assert_eq!(second, first, "the same note must be opened again");
    assert_eq!(fs::read_to_string(first_path).unwrap(), edited, "existing note must not be rewritten");
}

// ─────────────────────────────────────────────────────────────────────────────
// test_open_daily_note_ipc_empty_prefix
// ─────────────────────────────────────────────────────────────────────────────
/// ITST for REQ-LTTCE-DLN-00002 / -00005: an empty prefix crosses the IPC
/// boundary as "no prefix" — the name starts with the year, not with a dash.
#[test]
fn test_open_daily_note_ipc_empty_prefix() {
    let (_app, webview) = make_daily_note_app();
    let temp = tempfile::tempdir().unwrap();

    let path = invoke_open_daily_note(
        &webview,
        serde_json::json!({
            "dailyNotesPath": temp.path().to_string_lossy(),
            "prefix": "",
            "useCalendarWeekTitle": false,
        }),
    )
    .expect("empty prefix is valid");

    let name = std::path::Path::new(&path).file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.chars().next().unwrap().is_ascii_digit(), "name must start with the year: {name}");
    let stem = name.trim_end_matches(".md");
    assert_eq!(fs::read_to_string(&path).unwrap(), format!("# Daily Note: {stem}"));
}

// ─────────────────────────────────────────────────────────────────────────────
// test_open_daily_note_ipc_rejects_invalid_prefix
// ─────────────────────────────────────────────────────────────────────────────
/// ITST for REQ-LTTCE-DLN-00005: a prefix that is not 0–3 Latin letters or
/// digits is refused at the IPC boundary — before any folder or file is made.
#[test]
fn test_open_daily_note_ipc_rejects_invalid_prefix() {
    let (_app, webview) = make_daily_note_app();
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("daily");

    for bad in ["../x", "TOOLONG", "a b"] {
        let result = invoke_open_daily_note(
            &webview,
            serde_json::json!({
                "dailyNotesPath": dir.to_string_lossy(),
                "prefix": bad,
                "useCalendarWeekTitle": false,
            }),
        );
        // Refused for the right reason: the prefix rule, named in the error —
        // not, say, an ACL or a missing-command error that would make this
        // test pass while proving nothing.
        let err = result.expect_err(&format!("prefix {bad:?} must be refused"));
        let message = err.as_str().unwrap_or_default().to_string();
        assert!(
            message.contains("Daily note prefix"),
            "prefix {bad:?} refused for the wrong reason: {err}"
        );
    }
    assert!(!dir.exists(), "a refused call must not create the folder");
}

// ─────────────────────────────────────────────────────────────────────────────
// test_daily_note_settings_round_trip_through_shims
// ─────────────────────────────────────────────────────────────────────────────
/// ITST for REQ-LTTCE-DLN-00005 / -00006: both settings survive
/// save_settings → load_settings through the real command shims, including
/// the empty prefix that must not come back as the default.
#[test]
fn test_daily_note_settings_round_trip_through_shims() {
    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, "{}").unwrap();
    let path_str = settings_path.to_string_lossy().to_string();

    {
        let app = make_app();
        let s = load_settings(app.handle().clone(), path_str.clone()).unwrap();
        assert_eq!(s.daily_note_prefix.as_str(), "DLN", "absent key → default prefix");
        assert!(!s.use_calendar_week_title, "absent key → file-name title");
    }
    {
        let app = make_app();
        let s = Settings {
            daily_note_prefix: lattice_lib::daily_note::DailyNotePrefix::new("").unwrap(),
            use_calendar_week_title: true,
            ..Default::default()
        };
        save_settings(app.handle().clone(), path_str.clone(), s).unwrap();
    }
    {
        let app = make_app();
        let s = load_settings(app.handle().clone(), path_str.clone()).unwrap();
        assert_eq!(s.daily_note_prefix.as_str(), "", "empty prefix must survive the round trip");
        assert!(s.use_calendar_week_title);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// test_recent_file_state_ipc
// ─────────────────────────────────────────────────────────────────────────────
/// ITST for REQ-LTTCE-RCT-00002: `recent_file_state` through the real IPC
/// boundary -- the camelCase `path` argument and the lower-case answers the
/// frontend switches on.
#[test]
fn test_recent_file_state_ipc() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("note.md");
    fs::write(&file, "# note").unwrap();

    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![lattice_lib::recent_files::recent_file_state])
        .build(mock_context(noop_assets()))
        .expect("MockRuntime app construction failed");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");
    let ask = |path: &std::path::Path| -> String {
        tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "recent_file_state".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: webview.url().expect("mock webview has a URL"),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({ "path": path.to_string_lossy() })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("recent_file_state never fails")
        .deserialize::<String>()
        .expect("a string state")
    };

    assert_eq!(ask(&file), "file");
    assert_eq!(ask(&temp.path().join("deleted.md")), "notFound");
    assert_eq!(ask(std::path::Path::new("bad\0name.md")), "unavailable");
}
// test_recent_file_state_ipc END ******************************
