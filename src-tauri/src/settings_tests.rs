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
use serde_json::json;
use std::fs;
use std::path::PathBuf;

// We use generic variables instead of specific human names to comply with robust codebase practices.

#[test]
fn test_get_vault_root() {
    // Use the actual OS home directory to test natively against realistic OS paths
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));

    let global_settings = home.join(".lattice").join("settings.json");
    let global_root = get_vault_root(&global_settings.to_string_lossy(), Some(&home)).unwrap();
    assert_eq!(global_root, home.join("lattice-notes"));

    let local_project = home.join("opt").join("projects").join("my-vault");
    let local_settings = local_project.join(".lattice").join("settings.json");

    let local_root = get_vault_root(&local_settings.to_string_lossy(), Some(&home)).unwrap();
    assert_eq!(local_root, local_project);

    // Defensive programming rejection tests
    let missing_lattice = local_project.join("settings.json");
    assert!(
        get_vault_root(&missing_lattice.to_string_lossy(), Some(&home)).is_err(),
        "Must reject paths missing .lattice"
    );

    let wrong_filename = local_project.join(".lattice").join("other.json");
    assert!(
        get_vault_root(&wrong_filename.to_string_lossy(), Some(&home)).is_err(),
        "Must reject files not named settings.json"
    );
}

#[test]
fn test_expand_daily_notes_path() {
    let vault_root = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~")).join("lattice-notes");
    let vault_str = vault_root.to_string_lossy().to_string();
    let sep = std::path::MAIN_SEPARATOR.to_string();

    let mut s = Settings::default();
    s.daily_notes_path = "{notesRoot}/my-daily-notes".to_string();

    let expanded = expand_daily_notes_path(s, &vault_root);
    assert_eq!(expanded.daily_notes_path, format!("{}/my-daily-notes", vault_str));

    let s2 = Settings::default(); // empty daily_notes_path
    let expanded2 = expand_daily_notes_path(s2, &vault_root);
    assert_eq!(
        expanded2.daily_notes_path,
        format!("{}{}daily", vault_str, sep)
    );
}

#[test]
fn test_condense_daily_notes_path() {
    let vault_root = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~")).join("lattice-notes");
    let vault_str = vault_root.to_string_lossy().to_string();

    let mut s = Settings::default();
    s.daily_notes_path = format!("{}/my-daily-notes", vault_str);

    let condensed = condense_daily_notes_path(s, &vault_root);
    assert_eq!(condensed.daily_notes_path, "{notesRoot}/my-daily-notes");

    // Path outside vault root should remain untouched
    let mut s2 = Settings::default();
    let outside_path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~")).join("some").join("other");
    let outside_str = outside_path.to_string_lossy().to_string();
    s2.daily_notes_path = outside_str.clone();
    
    let condensed2 = condense_daily_notes_path(s2, &vault_root);
    assert_eq!(condensed2.daily_notes_path, outside_str);
}

// -----------------------------------------------------------------------
// test_default_factory_fns
// -----------------------------------------------------------------------
/// Verify each `#[serde(default = "...")]` factory function directly.
/// These are often missed because coverage only sees them via serde reflection.
#[test]
fn test_default_factory_fns() {
    assert_eq!(default_theme(), "dark");
    assert_eq!(default_word_wrap(), false);
    assert_eq!(default_save_on_blur(), true);
    assert_eq!(default_highlight_mark(), true);
    // UTST for REQ-LTTCE-WSP-00002 — whitespace visualization is OFF by default
    assert_eq!(default_show_whitespace(), false);
    // UTST for REQ-LTTCE-WSP-00005 — tab size defaults to 2, range 2..=8
    assert_eq!(default_tab_size(), 2);
    assert_eq!(TAB_SIZE_MIN, 2);
    assert_eq!(TAB_SIZE_MAX, 8);
    assert!(default_mermaid_init().contains("'theme': 'base'"));
}

// -----------------------------------------------------------------------
// test_settings_default_trait
// -----------------------------------------------------------------------
#[test]
fn test_settings_default_trait() {
    let s = Settings::default();
    assert_eq!(s.default_open_theme, "dark");
    assert_eq!(s.word_wrap, false);
    assert_eq!(s.save_on_blur, true);
    assert_eq!(s.daily_notes_path, "");
    assert_eq!(s.highlight_mark, true);
    assert_eq!(s.show_whitespace, false);
    assert_eq!(s.tab_size, 2);
    assert!(s.default_mermaid_init.contains("'theme': 'base'"));
}

// -----------------------------------------------------------------------
// test_settings_serde_defaults_on_empty_json
// -----------------------------------------------------------------------
/// Deserialising `{}` must apply serde defaults via the factory functions.
#[test]
fn test_settings_serde_defaults_on_empty_json() {
    let s: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(s.default_open_theme, "dark");
    assert!(!s.word_wrap);
    assert!(s.save_on_blur);
    assert_eq!(s.daily_notes_path, "");
    assert!(s.highlight_mark);
    // UTST for REQ-LTTCE-WSP-00002 — missing key must default to OFF
    assert!(!s.show_whitespace);
    assert!(s.default_mermaid_init.contains("'theme': 'base'"), "defaultMermaidInit must default to the base-theme init string");
}

// -----------------------------------------------------------------------
// test_show_whitespace_default_and_roundtrip
// -----------------------------------------------------------------------
/// UTST for REQ-LTTCE-WSP-00002 / IMPL-LTTCE-WSP-00004.
/// Verify showWhitespace defaults to false when absent from JSON and that
/// it survives a serialize → deserialize round-trip with both values.
#[test]
fn test_show_whitespace_default_and_roundtrip() {
    // Missing key → defaults to false (feature is opt-in)
    let s: Settings = serde_json::from_str("{}").unwrap();
    assert!(!s.show_whitespace);

    // Explicit true survives roundtrip (camelCase key on the wire)
    let json_on = r#"{"showWhitespace": true}"#;
    let s_on: Settings = serde_json::from_str(json_on).unwrap();
    assert!(s_on.show_whitespace);
    let serialized = serde_json::to_string(&s_on).unwrap();
    assert!(serialized.contains("\"showWhitespace\":true"));
    let s_on2: Settings = serde_json::from_str(&serialized).unwrap();
    assert!(s_on2.show_whitespace);

    // Explicit false stays false
    let json_off = r#"{"showWhitespace": false}"#;
    let s_off: Settings = serde_json::from_str(json_off).unwrap();
    assert!(!s_off.show_whitespace);
}

// -----------------------------------------------------------------------
// test_parse_settings_lenient
// -----------------------------------------------------------------------
/// UTST for REQ-LTTCE-SET-00001 / IMPL-LTTCE-SET-00001.
/// One corrupt field must cost exactly that field — never the whole file.
#[test]
fn test_parse_settings_lenient_drops_only_corrupt_fields() {
    // tabSize = 2^64-1 does not fit u32 → previously the WHOLE file reset.
    // Now: wordWrap survives, tabSize falls back to its default.
    let json = r#"{"wordWrap": true, "tabSize": 18446744073709551615}"#;
    let s = parse_settings_lenient(json);
    assert!(s.word_wrap, "valid field must survive a corrupt sibling");
    assert_eq!(s.tab_size, 2, "corrupt field must fall back to its default");

    // Wrong type on a bool: same rule.
    let json2 = r#"{"wordWrap": "yes", "showWhitespace": true, "dailyNotesPath": "/d"}"#;
    let s2 = parse_settings_lenient(json2);
    assert!(!s2.word_wrap, "corrupt bool falls back to default (false)");
    assert!(s2.show_whitespace);
    assert_eq!(s2.daily_notes_path, "/d");
}

#[test]
fn test_parse_settings_lenient_valid_file_unchanged() {
    // Fast path: a fully valid file parses exactly as before.
    let json = r#"{"wordWrap": true, "tabSize": 4, "defaultOpenTheme": "light"}"#;
    let s = parse_settings_lenient(json);
    assert!(s.word_wrap);
    assert_eq!(s.tab_size, 4);
    assert_eq!(s.default_open_theme, "light");
}

#[test]
fn test_parse_settings_lenient_unsalvageable_input() {
    // Not JSON / not an object → all defaults (previous behaviour kept).
    assert_eq!(parse_settings_lenient("not json at all"), Settings::default());
    assert_eq!(parse_settings_lenient("[1, 2, 3]"), Settings::default());
    assert_eq!(parse_settings_lenient(""), Settings::default());
}

#[test]
fn test_parse_settings_lenient_preserves_unknown_keys_tolerance() {
    // Unknown keys were always tolerated (forward compatibility) and must
    // still be: they parse fine in isolation and are simply ignored.
    let json = r#"{"futureSetting": {"nested": 1}, "wordWrap": true}"#;
    let s = parse_settings_lenient(json);
    assert!(s.word_wrap);
}

#[test]
fn test_load_settings_internal_survives_corrupt_field() {
    // End-to-end through the loader: corrupt tabSize on disk → other
    // settings intact, tabSize clamped default.
    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    let home = temp.path().join("home");

    fs::write(
        &settings_path,
        r#"{"wordWrap": true, "tabSize": 18446744073709551615}"#,
    )
    .unwrap();
    let s = load_settings_internal(&settings_path.to_string_lossy(), &home).unwrap();
    assert!(s.word_wrap);
    assert_eq!(s.tab_size, 2);
}

// -----------------------------------------------------------------------
// test_tab_size_default_roundtrip_and_clamp
// -----------------------------------------------------------------------
/// UTST for REQ-LTTCE-WSP-00005 / IMPL-LTTCE-WSP-00008.
/// tabSize: default 2 when absent, camelCase on the wire, survives a
/// roundtrip, and load clamps hand-edited out-of-range values into 2..=8.
#[test]
fn test_tab_size_default_roundtrip_and_clamp() {
    // Missing key → default 2
    let s: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(s.tab_size, 2);

    // Explicit value survives roundtrip with camelCase key
    let s4: Settings = serde_json::from_str(r#"{"tabSize": 4}"#).unwrap();
    assert_eq!(s4.tab_size, 4);
    let serialized = serde_json::to_string(&s4).unwrap();
    assert!(serialized.contains("\"tabSize\":4"));

    // load_settings_internal clamps out-of-range values (settings.json is
    // hand-editable). Uses a real temp settings file like the other
    // load tests.
    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    let home = temp.path().join("home");

    fs::write(&settings_path, r#"{"tabSize": 1}"#).unwrap();
    let low = load_settings_internal(&settings_path.to_string_lossy(), &home).unwrap();
    assert_eq!(low.tab_size, TAB_SIZE_MIN);

    fs::write(&settings_path, r#"{"tabSize": 99}"#).unwrap();
    let high = load_settings_internal(&settings_path.to_string_lossy(), &home).unwrap();
    assert_eq!(high.tab_size, TAB_SIZE_MAX);

    fs::write(&settings_path, r#"{"tabSize": 6}"#).unwrap();
    let ok = load_settings_internal(&settings_path.to_string_lossy(), &home).unwrap();
    assert_eq!(ok.tab_size, 6);
}

// -----------------------------------------------------------------------
// test_highlight_mark_default_and_roundtrip
// -----------------------------------------------------------------------
/// Verify highlightMark defaults to true when absent from JSON and that
/// it survives a serialize → deserialize round-trip with both values.
#[test]
fn test_highlight_mark_default_and_roundtrip() {
    // Missing key → defaults to true
    let s: Settings = serde_json::from_str("{}").unwrap();
    assert!(s.highlight_mark);

    // Explicit false survives roundtrip
    let json_off = r#"{"highlightMark": false}"#;
    let s_off: Settings = serde_json::from_str(json_off).unwrap();
    assert!(!s_off.highlight_mark);
    let serialized = serde_json::to_string(&s_off).unwrap();
    let s_off2: Settings = serde_json::from_str(&serialized).unwrap();
    assert!(!s_off2.highlight_mark);

    // Explicit true survives roundtrip
    let json_on = r#"{"highlightMark": true}"#;
    let s_on: Settings = serde_json::from_str(json_on).unwrap();
    assert!(s_on.highlight_mark);
}

// -----------------------------------------------------------------------
// test_settings_clone_and_partial_eq
// -----------------------------------------------------------------------
#[test]
fn test_settings_clone_and_partial_eq() {
    let s1 = Settings::default();
    let s2 = s1.clone();
    assert_eq!(s1, s2);

    let mut s3 = s1.clone();
    s3.word_wrap = true;
    assert_ne!(s1, s3);
}

// -----------------------------------------------------------------------
// test_get_vault_root_no_home_dir_req
// -----------------------------------------------------------------------
/// When `home_dir_req` is `None` the function should still resolve the vault
/// root from the `.lattice` hierarchy without the home-directory check.
#[test]
fn test_get_vault_root_no_home_dir_req() {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    let vault = home.join("my").join("vault");
    let settings_path = vault.join(".lattice").join("settings.json");

    let result = get_vault_root(&settings_path.to_string_lossy(), None);
    assert!(result.is_ok(), "Expected Ok, got {:?}", result);
    assert_eq!(result.unwrap(), vault);
}

// -----------------------------------------------------------------------
// test_merge_settings_non_object_current_json
// -----------------------------------------------------------------------
/// When `current_json` is not a JSON object (e.g. an array or null), the
/// merge must not panic and must still produce valid JSON.
#[test]
fn test_merge_settings_non_object_current_json() {
    // Array input
    let current_arr = serde_json::json!([1, 2, 3]);
    let result = merge_settings(&current_arr, &Settings::default());
    assert!(result.is_ok(), "merge_settings must not fail on array input");

    // Null input
    let current_null = serde_json::json!(null);
    let result2 = merge_settings(&current_null, &Settings::default());
    assert!(result2.is_ok(), "merge_settings must not fail on null input");
}

#[test]
fn test_merge_settings() {
    let current_json = json!({
        "unknownProperty": 42,
        "wordWrap": false
    });

    let mut settings = Settings::default();
    settings.word_wrap = true;
    settings.daily_notes_path = "custom_path".to_string();

    let merged_str = merge_settings(&current_json, &settings).unwrap();
    let merged: serde_json::Value = serde_json::from_str(&merged_str).unwrap();

    // unknown property should be preserved
    assert_eq!(merged["unknownProperty"], 42);
    // updated properties should be overwritten
    assert_eq!(merged["wordWrap"], true);
    assert_eq!(merged["dailyNotesPath"], "custom_path");
}

// ───────────────────────────────────────────────────────────────────────────
// load_settings_internal
// ───────────────────────────────────────────────────────────────────────────

// -----------------------------------------------------------------------
// test_load_settings_internal_missing_file_returns_defaults
// -----------------------------------------------------------------------
/// A non-existent settings file must silently fall back to defaults.
#[test]
fn test_load_settings_internal_missing_file_returns_defaults() {
    let temp = tempfile::tempdir().unwrap();
    // settings path doesn't exist — load must not error
    let missing = temp.path().join("no_vault").join("settings.json");
    // We pick a path that also fails get_vault_root (no .lattice component),
    // so the Err(_) branch is exercised and raw defaults are returned.
    let home = temp.path();
    let result = load_settings_internal(&missing.to_string_lossy(), home);
    assert!(result.is_ok(), "Expected Ok(defaults), got {:?}", result);
    let s = result.unwrap();
    assert_eq!(s.default_open_theme, "dark");
    assert!(!s.word_wrap);
    assert!(s.save_on_blur);
    assert!(s.highlight_mark);
}

// -----------------------------------------------------------------------
// test_load_settings_internal_valid_vault_file
// -----------------------------------------------------------------------
/// Reading a valid settings.json inside a .lattice hierarchy must return
/// the parsed settings with the daily-notes path expanded.
#[test]
fn test_load_settings_internal_valid_vault_file() {
    let temp = tempfile::tempdir().unwrap();
    let vault_root = temp.path().join("my-vault");
    let lattice_dir = vault_root.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");

    let json_content = r#"{"wordWrap": true, "dailyNotesPath": "{notesRoot}/notes"}"#;
    fs::write(&settings_path, json_content).unwrap();

    let home = temp.path().join("home");
    let result =
        load_settings_internal(&settings_path.to_string_lossy(), &home);
    assert!(result.is_ok(), "Expected Ok, got {:?}", result);
    let s = result.unwrap();
    assert!(s.word_wrap);
    // {notesRoot} must be expanded to vault_root
    let vault_str = vault_root.to_string_lossy().to_string();
    assert!(
        s.daily_notes_path.contains(&vault_str),
        "Expected expanded notesRoot in '{}', vault='{}'",
        s.daily_notes_path, vault_str
    );
}

// -----------------------------------------------------------------------
// test_load_settings_internal_invalid_json_returns_defaults
// -----------------------------------------------------------------------
/// Corrupt JSON in the settings file must fall back to defaults (not error).
#[test]
fn test_load_settings_internal_invalid_json_returns_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, b"{ not valid json !!!").unwrap();

    let home = temp.path().join("otherhome");
    let s = load_settings_internal(&settings_path.to_string_lossy(), &home).unwrap();
    assert_eq!(s.default_open_theme, "dark"); // default
}

// -----------------------------------------------------------------------
// test_load_settings_internal_invalid_vault_path_returns_raw_settings
// -----------------------------------------------------------------------
/// When the settings path does not conform to the `.lattice/settings.json`
/// convention, get_vault_root returns Err and the Err(_) branch is taken —
/// the parsed settings are returned without path expansion.
#[test]
fn test_load_settings_internal_invalid_vault_path_returns_raw_settings() {
    let temp = tempfile::tempdir().unwrap();
    // File sits in a plain directory, NOT inside .lattice
    let plain_dir = temp.path().join("plain");
    fs::create_dir_all(&plain_dir).unwrap();
    let settings_path = plain_dir.join("settings.json");
    fs::write(&settings_path, r#"{"wordWrap": true}"#).unwrap();

    let home = temp.path();
    let s = load_settings_internal(&settings_path.to_string_lossy(), home).unwrap();
    assert!(s.word_wrap);
    // daily_notes_path must be untouched (empty default), since expansion was skipped
    assert_eq!(s.daily_notes_path, "");
}

// ───────────────────────────────────────────────────────────────────────────
// save_settings_internal
// ───────────────────────────────────────────────────────────────────────────

// -----------------------------------------------------------------------
// test_save_settings_internal_creates_and_reads_back
// -----------------------------------------------------------------------
/// Round-trip: save then load must recover identical logical settings.
#[test]
fn test_save_settings_internal_creates_and_reads_back() {
    let temp = tempfile::tempdir().unwrap();
    let vault_root = temp.path().join("vault");
    let lattice_dir = vault_root.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let home = temp.path().join("home");
    let sep = std::path::MAIN_SEPARATOR_STR;
    let daily = format!("{}{sep}daily", vault_root.display());

    let mut s = Settings::default();
    s.word_wrap = true;
    s.daily_notes_path = daily.clone();

    save_settings_internal(&settings_path.to_string_lossy(), s, &home).unwrap();

    // Read back the raw file to verify condensation happened
    let raw = fs::read_to_string(&settings_path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["wordWrap"], true);
    // path was condensed to {notesRoot} token
    let stored_path = v["dailyNotesPath"].as_str().unwrap_or("");
    assert!(
        stored_path.contains("{notesRoot}"),
        "Expected condensed path, got: {}",
        stored_path
    );
}

// -----------------------------------------------------------------------
// test_save_settings_internal_merges_unknown_keys
// -----------------------------------------------------------------------
/// Keys present in the existing file but absent from Settings must be
/// preserved after a save (merge semantics, not overwrite).
#[test]
fn test_save_settings_internal_merges_unknown_keys() {
    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, r#"{"unknownKey": "preserved", "wordWrap": false}"#).unwrap();

    let home = temp.path().join("home");
    let mut s = Settings::default();
    s.word_wrap = true;
    save_settings_internal(&settings_path.to_string_lossy(), s, &home).unwrap();

    let raw = fs::read_to_string(&settings_path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["unknownKey"], "preserved", "Unknown key must survive merge");
    assert_eq!(v["wordWrap"], true, "Updated key must be overwritten");
}

// -----------------------------------------------------------------------
// test_save_settings_internal_refuses_non_vault_path
// -----------------------------------------------------------------------
/// UTST for REQ-LTTCE-SET-00002 / IMPL-LTTCE-SET-00002 (path gate).
/// A settings path outside the `.lattice/settings.json` convention must be
/// REFUSED (Err) and the target file must be left untouched — save_settings
/// must never be usable as an arbitrary-path file write.
/// (Replaces the pre-hardening test that allowed such writes and merely
/// skipped path condensing.)
#[test]
fn test_save_settings_internal_refuses_non_vault_path() {
    let temp = tempfile::tempdir().unwrap();
    let plain_dir = temp.path().join("plain");
    fs::create_dir_all(&plain_dir).unwrap();
    let home = temp.path();

    // Wrong parent directory (not `.lattice`)
    let settings_path = plain_dir.join("settings.json");
    fs::write(&settings_path, "original-content").unwrap();
    let result = save_settings_internal(
        &settings_path.to_string_lossy(),
        Settings::default(),
        home,
    );
    assert!(result.is_err(), "Expected Err for non-.lattice path");
    assert_eq!(
        fs::read_to_string(&settings_path).unwrap(),
        "original-content",
        "Refused save must not touch the target file"
    );

    // Wrong filename (not `settings.json`), even inside `.lattice`
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let wrong_name = lattice_dir.join("evil.json");
    let result2 = save_settings_internal(
        &wrong_name.to_string_lossy(),
        Settings::default(),
        home,
    );
    assert!(result2.is_err(), "Expected Err for wrong filename");
    assert!(!wrong_name.exists(), "Refused save must not create the file");
}

// -----------------------------------------------------------------------
// test_save_settings_internal_clamps_tab_size_on_disk
// -----------------------------------------------------------------------
/// UTST for REQ-LTTCE-SET-00002 / IMPL-LTTCE-SET-00002 (value gate).
/// A typed-but-absurd tabSize must be clamped BEFORE persisting, so the
/// file on disk never holds an out-of-range value.
#[test]
fn test_save_settings_internal_clamps_tab_size_on_disk() {
    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, "{}").unwrap();
    let home = temp.path().join("home");

    let mut s = Settings::default();
    s.tab_size = 1_000_000; // fits u32, semantically absurd
    save_settings_internal(&settings_path.to_string_lossy(), s, &home).unwrap();

    let raw = fs::read_to_string(&settings_path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["tabSize"], TAB_SIZE_MAX, "On-disk tabSize must be clamped");

    let mut s2 = Settings::default();
    s2.tab_size = 0;
    save_settings_internal(&settings_path.to_string_lossy(), s2, &home).unwrap();
    let v2: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(v2["tabSize"], TAB_SIZE_MIN);
}

// -----------------------------------------------------------------------
// test_save_settings_internal_write_fails_returns_err
// -----------------------------------------------------------------------
/// Writing to a read-only location must return Err (not panic).
#[test]
fn test_save_settings_internal_write_fails_returns_err() {
    use crate::test_fs_helpers::{can_test_unreadable, make_unreadable};

    let temp = tempfile::tempdir().unwrap();
    let lattice_dir = temp.path().join("vault").join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    fs::write(&settings_path, "{}").unwrap();

    let home = temp.path().join("home");
    let _guard = make_unreadable(&settings_path);
    let result = save_settings_internal(
        &settings_path.to_string_lossy(),
        Settings::default(),
        &home,
    );
    drop(_guard);

    if can_test_unreadable() {
        assert!(result.is_err(), "Expected Err when writing to unreadable file");
    }
}

// -----------------------------------------------------------------------
// test_get_vault_root_no_parent_for_lattice
// -----------------------------------------------------------------------
/// When .lattice itself has no parent (e.g. path is `/.lattice/settings.json`
/// on a real filesystem root) the function must return Err rather than panic.
#[test]
fn test_get_vault_root_no_parent_for_lattice() {
    // On Unix: "/.lattice/settings.json" → .lattice parent = "/" → parent of "/" = None
    // We simulate this by constructing the path purely from strings (no disk access needed).
    let path = std::path::Path::new("/.lattice/settings.json");
    // Only run assertion where parent() actually returns None for root
    if path.parent().and_then(|p| p.parent()).is_none() {
        let result = get_vault_root("/.lattice/settings.json", None);
        assert!(result.is_err(), "Expected Err for root-level .lattice, got {:?}", result);
    }
    // On Windows "/.lattice/settings.json" may behave differently; the test
    // is silently skipped so the build stays green everywhere.
}

// ═══════════════════════════════════════════════════════════════════════════
// Shim-path smoke tests  (unit level)
// ─────────────────────────────────────────────────────────────────────────
// These tests verify the logical data path of the command shims by calling
// load_settings_internal / save_settings_internal directly with the same
// home path that calc_base_path_internal would supply on desktop.
//
// The true end-to-end wiring tests — which construct a live MockRuntime
// AppHandle and call load_settings / save_settings through it — live in
// tests/wiring.rs (a proper Cargo [[test]] target).  They sit there because:
//   • cargo:rustc-link-arg-tests (needed to embed the Windows comctl32 v6
//     manifest for MockRuntime) only applies to [[test]] targets, not to
//     inline #[cfg(test)] modules inside [lib].
//   • tests/wiring.rs compiles as a separate binary that receives the
//     manifest, so MockRuntime works there without any new crate dependency.
// ═══════════════════════════════════════════════════════════════════════════
mod wiring {
    use super::*;

    /// Returns the home path exactly as `calc_base_path_internal` does on
    /// desktop — without needing an `AppHandle` or a live Tauri runtime.
    fn desktop_home() -> PathBuf {
        dirs::home_dir().expect("could not resolve home directory")
    }

    // -----------------------------------------------------------------------
    // test_load_settings_shim_missing_file_returns_defaults
    // -----------------------------------------------------------------------
    /// Wiring: a non-existent settings path must silently fall back to
    /// defaults and flow back through the logical command boundary unchanged.
    #[test]
    fn test_load_settings_shim_missing_file_returns_defaults() {
        let home = desktop_home();
        // Path has no .lattice component so get_vault_root returns Err,
        // exercising the Err(_) branch inside load_settings_internal.
        let result = load_settings_internal("/nonexistent_lattice_path/settings.json", &home);
        assert!(result.is_ok(), "Shim must not error on missing file: {:?}", result);
        let s = result.unwrap();
        assert_eq!(s.default_open_theme, "dark");
        assert!(!s.word_wrap);
    }

    // -----------------------------------------------------------------------
    // test_load_settings_shim_reads_valid_file
    // -----------------------------------------------------------------------
    /// Wiring: a real .lattice/settings.json must be parsed and expanded,
    /// proving the home-path derivation and load_settings_internal are
    /// correctly connected through the logical command boundary.
    #[test]
    fn test_load_settings_shim_reads_valid_file() {
        let home = desktop_home();

        let temp = tempfile::tempdir().unwrap();
        let lattice_dir = temp.path().join("vault").join(".lattice");
        fs::create_dir_all(&lattice_dir).unwrap();
        let settings_path = lattice_dir.join("settings.json");
        fs::write(&settings_path, r#"{"wordWrap": true}"#).unwrap();

        let result = load_settings_internal(&settings_path.to_string_lossy(), &home);
        assert!(result.is_ok(), "Expected Ok from shim: {:?}", result);
        assert!(result.unwrap().word_wrap, "wordWrap must be true after load");
    }

    // -----------------------------------------------------------------------
    // test_save_settings_shim_persists_to_disk
    // -----------------------------------------------------------------------
    /// Wiring: settings must be written to disk with the daily-notes path
    /// condensed, proving the home-path derivation and save_settings_internal
    /// are correctly connected through the logical command boundary.
    #[test]
    fn test_save_settings_shim_persists_to_disk() {
        let home = desktop_home();

        let temp = tempfile::tempdir().unwrap();
        let vault_root = temp.path().join("vault");
        let lattice_dir = vault_root.join(".lattice");
        fs::create_dir_all(&lattice_dir).unwrap();
        let settings_path = lattice_dir.join("settings.json");
        fs::write(&settings_path, "{}").unwrap();

        let sep = std::path::MAIN_SEPARATOR_STR;
        let mut s = Settings::default();
        s.word_wrap = true;
        // Provide an expanded daily path so the condense step can be verified.
        s.daily_notes_path = format!("{}{sep}daily", vault_root.display());

        let result = save_settings_internal(&settings_path.to_string_lossy(), s, &home);
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
    }
}
