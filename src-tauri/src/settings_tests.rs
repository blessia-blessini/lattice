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
