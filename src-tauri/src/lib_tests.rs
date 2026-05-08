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
// test_is_dir
//*************************************************************************
#[test]
fn test_is_dir() {
    let temp_dir = tempfile::tempdir().unwrap();
    let dir_path = temp_dir.path().to_string_lossy().to_string();

    // Test existing directory
    assert!(is_dir(dir_path.clone()));

    // Test file (should not be dir)
    let file_path = temp_dir.path().join("test_file.txt");
    fs::write(&file_path, "content").unwrap();
    assert!(!is_dir(file_path.to_string_lossy().to_string()));

    // Test non-existent path
    let non_existent = temp_dir.path().join("fake_dir");
    assert!(!is_dir(non_existent.to_string_lossy().to_string()));
}
// test_is_dir END ********************************************************

//*************************************************************************
// test_vault_initialization
//*************************************************************************
#[test]
fn test_vault_initialization() {
    let temp_dir = tempfile::tempdir().unwrap();
    // Use temp_dir as home for this test
    let home_dir = temp_dir.path();

    let doc_path = temp_dir.path().join("docs").join("note.md");
    fs::create_dir_all(doc_path.parent().unwrap()).unwrap();
    fs::write(&doc_path, "note").unwrap();
    let doc_path_str = doc_path.to_string_lossy().to_string();

    // 1. Initialize Vault
    let settings_path = initialize_vault_settings(doc_path_str.clone()).unwrap();

    // Verify .lattice/settings.json created
    assert!(Path::new(&settings_path).exists());
    assert!(settings_path.contains(".lattice"));
    assert!(settings_path.contains("settings.json"));

    // 2. Find Vault Settings (should find the one we just made)
    // Use internal function so we can pass mocked home
    let found_path = find_vault_settings_file_internal(doc_path_str.clone(), home_dir).unwrap();
    assert_eq!(found_path, Some(settings_path));

    // 3. Find from distinct file in same dir
    let doc2 = temp_dir.path().join("docs").join("note2.md");
    fs::write(&doc2, "note2").unwrap();
    let found_path_2 =
        find_vault_settings_file_internal(doc2.to_string_lossy().to_string(), home_dir)
            .unwrap();
    assert!(found_path_2.is_some());

    // 4. Test Fallback when no vault found (Force Fallback)
    // Use a path that is unlikely to have a .lattice parent (e.g. C:\ or /)
    // This forces traversal to fail and triggers the fallback logic using the provided home_dir (temp)
    #[cfg(desktop)]
    let root_path = dirs::home_dir().unwrap().to_string_lossy().to_string();
    #[cfg(not(desktop))]
    let root_path = "/".to_string();

    // Note: We use the 'home_dir' variable from line 745 (temp_dir), NOT real home
    let res = find_vault_settings_file_internal(root_path.to_string(), home_dir).unwrap();

    let expected_fallback_path = home_dir.join(".lattice").join("settings.json");

    // Ensure result matches the fallback path in our temp home
    let real_vault_path = std::path::Path::new(&root_path)
        .join(".lattice")
        .join("settings.json");
    let fallback_str = expected_fallback_path.to_string_lossy().to_string();
    let real_str = real_vault_path.to_string_lossy().to_string();

    let found = res.expect("Should find a vault path");

    // Either fallback (temp dir) OR real existing vault (user home) is acceptable
    if found == real_str {
        // Found existing vault, fallback logic was skipped correctly due to existing vault
    } else if found == fallback_str {
        // Fallback used, verify file created
        assert!(expected_fallback_path.exists());
    } else {
        panic!(
            "Expected vault at {:?} or existing {:?}, but got {:?}",
            fallback_str, real_str, found
        );
    }
}
// test_vault_initialization END *******************************************

//*************************************************************************
// test_save_image_and_base64
//*************************************************************************
#[test]
fn test_save_image_and_base64() {
    let temp_dir = tempfile::tempdir().unwrap();
    let doc_path = temp_dir.path().join("image_doc.md");
    fs::write(&doc_path, "# Doc").unwrap();
    let doc_path_str = doc_path.to_string_lossy().to_string();

    // Tiny 1x1 GIF Base64
    let b64_gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    // 1. Save Image
    let rel_path = save_image(doc_path_str.clone(), b64_gif.to_string()).unwrap();

    // Verify structure: [filename]_assets/img_[timestamp].png
    assert!(rel_path.contains("image_doc_assets"));
    assert!(rel_path.ends_with(".png"));

    // Construct absolute path to verify existence
    let parent = doc_path.parent().unwrap();
    let abs_asset_path = parent.join(&rel_path);
    assert!(abs_asset_path.exists());

    // 2. Read back as Base64
    let read_b64_res = read_file_base64(abs_asset_path.to_string_lossy().to_string()).unwrap();

    // Should start with data:image/png;base64,... (save_image forces png extension logic in our code currently?
    // Actually save_image saves as .png, so read should detect png)
    assert!(read_b64_res.starts_with("data:image/png;base64,"));

    // Verify content (loose check since we might re-encode or it might not be bit-exact if image lib touches it)
    // But here we just wrote bytes. Wait, save_image decodes b64 to bytes, then writes.
    // read_file_base64 reads bytes, encodes to b64. Should be identical.
    let payload = read_b64_res.split(',').nth(1).unwrap();
    assert_eq!(payload, b64_gif);
}
// test_save_image_and_base64 END ******************************************

//**************************************************************************
// test_generate_new_window_label
//**************************************************************************
#[test]
fn test_generate_new_window_label() {
    let label1 = generate_new_window_label();
    std::thread::sleep(std::time::Duration::from_millis(1)); // Ensure time passes
    let label2 = generate_new_window_label();

    assert!(!label1.is_empty());
    assert!(!label2.is_empty());
    assert_ne!(label1, label2); // should differ
} // test_generate_new_window_label END ************************************

//**************************************************************************
// test_parse_launch_args
//**************************************************************************
#[test]
fn test_parse_launch_args() {
    let no_args = vec!["app_binary".to_string()];
    assert_eq!(parse_launch_args(no_args), None);

    let file_arg = vec!["app_binary".to_string(), "doc.md".to_string()];
    assert_eq!(parse_launch_args(file_arg), Some("doc.md".to_string()));

    let flag_arg = vec!["app_binary".to_string(), "--flag".to_string()];
    assert_eq!(parse_launch_args(flag_arg), None);

    // Multi arg, takes first if not flag
    let multi = vec![
        "app_binary".to_string(),
        "doc.md".to_string(),
        "--other".to_string(),
    ];
    assert_eq!(parse_launch_args(multi), Some("doc.md".to_string()));
}
// test_parse_launch_args END **********************************************

//**************************************************************************
// test_debug_file_probe_logic
//**************************************************************************
#[test]
fn test_debug_file_probe_logic() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("probe.txt");
    fs::write(&file_path, "probe me").unwrap();

    let path_str = file_path.to_string_lossy().to_string();
    let log = debug_file_probe(path_str);

    assert!(log.contains("Probe for:"));
    assert!(log.contains("Is File: true"));
    assert!(log.contains("Len: 8")); // "probe me" length

    let missing = temp_dir.path().join("missing.txt");
    let log_missing = debug_file_probe(missing.to_string_lossy().to_string());
    assert!(log_missing.contains("Exists: false"));
}
// test_debug_file_probe_logic END *************************************

//**************************************************************************
// test_debug_file_probe_valid_image
//**************************************************************************
/// Exercises the "Integrity: OK" success path inside debug_file_probe.
/// Uses a minimal but valid 1×1 transparent GIF (same bytes as the known
/// base64 constant used elsewhere in the test suite).
#[test]
fn test_debug_file_probe_valid_image() {
    let gif_bytes = general_purpose::STANDARD
        .decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
        .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("tiny.gif");
    fs::write(&file_path, &gif_bytes).unwrap();

    let log = debug_file_probe(file_path.to_string_lossy().to_string());
    assert!(
        log.contains("Integrity: OK"),
        "Expected successful image decode, got:\n{}",
        log
    );
    assert!(log.contains("Dimensions: 1x1"));
}
// test_debug_file_probe_valid_image END ***********************************

//**************************************************************************
// test_debug_file_probe_non_image_fails_decode
//**************************************************************************
/// Exercises the "Integrity: FAILED" decode-error branch.
#[test]
fn test_debug_file_probe_non_image_fails_decode() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("not_an_image.dat");
    fs::write(&file_path, b"this is plain text, not a valid image format").unwrap();

    let log = debug_file_probe(file_path.to_string_lossy().to_string());
    assert!(
        log.contains("Integrity: FAILED"),
        "Expected failed decode, got:\n{}",
        log
    );
}
// test_debug_file_probe_non_image_fails_decode END ************************

//**************************************************************************
// test_debug_file_probe_missing_path_shows_parent
//**************************************************************************
/// When the path does not exist the probe should log its parent directory.
#[test]
fn test_debug_file_probe_missing_path_shows_parent() {
    let temp_dir = tempfile::tempdir().unwrap();
    let missing = temp_dir.path().join("does_not_exist.bin");

    let log = debug_file_probe(missing.to_string_lossy().to_string());
    assert!(log.contains("Exists: false"));
    assert!(log.contains("Parent"), "Expected parent info in log:\n{}", log);
}
// test_debug_file_probe_missing_path_shows_parent END ********************

//**************************************************************************
// test_trace_log_does_not_panic
//**************************************************************************
#[test]
fn test_trace_log_does_not_panic() {
    // trace_log is a thin println! wrapper; the only contract is no panic
    trace_log("test message from unit test".to_string());
}
// test_trace_log_does_not_panic END ***************************************

//**************************************************************************
// test_read_file_base64_mime_types
//**************************************************************************
/// Verifies every mime-type branch in read_file_base64.
#[test]
fn test_read_file_base64_mime_types() {
    let temp_dir = tempfile::tempdir().unwrap();
    let cases: &[(&str, &str)] = &[
        ("test.jpg",  "image/jpeg"),
        ("test.jpeg", "image/jpeg"),
        ("test.gif",  "image/gif"),
        ("test.svg",  "image/svg+xml"),
        ("test.webp", "image/webp"),
        ("test.png",  "image/png"),
        ("test.bin",  "image/png"), // unknown extension falls back to png
    ];
    for (filename, expected_mime) in cases {
        let path = temp_dir.path().join(filename);
        fs::write(&path, b"fake bytes").unwrap();
        let result = read_file_base64(path.to_string_lossy().to_string())
            .expect("read_file_base64 should succeed");
        assert!(
            result.starts_with(&format!("data:{};base64,", expected_mime)),
            "Wrong mime for '{}': got prefix '{}'",
            filename,
            &result[..result.len().min(50)]
        );
    }
}
// test_read_file_base64_mime_types END ************************************

//**************************************************************************
// test_read_file_base64_missing_file_returns_err
//**************************************************************************
#[test]
fn test_read_file_base64_missing_file_returns_err() {
    let result = read_file_base64("/nonexistent_xyz_lattice/file.png".to_string());
    assert!(result.is_err());
}
// test_read_file_base64_missing_file_returns_err END *********************

//**************************************************************************
// test_initialize_vault_settings_with_directory_path
//**************************************************************************
/// When the supplied path is a directory (not a file) the function must
/// create `.lattice/settings.json` inside that directory.
#[test]
fn test_initialize_vault_settings_with_directory_path() {
    let temp_dir = tempfile::tempdir().unwrap();
    let dir_path = temp_dir.path().to_string_lossy().to_string();

    let result = initialize_vault_settings(dir_path);
    assert!(result.is_ok(), "Expected Ok, got {:?}", result);
    let settings_path = result.unwrap();
    assert!(settings_path.contains(".lattice"));
    assert!(settings_path.ends_with("settings.json"));
    assert!(Path::new(&settings_path).exists());
}
// test_initialize_vault_settings_with_directory_path END *****************

//**************************************************************************
// test_initialize_vault_settings_idempotent
//**************************************************************************
/// Calling twice on the same path must not error and must return the same
/// settings path both times (existing settings.json is not overwritten).
#[test]
fn test_initialize_vault_settings_idempotent() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("doc.md");
    fs::write(&file_path, "").unwrap();
    let path_str = file_path.to_string_lossy().to_string();

    let r1 = initialize_vault_settings(path_str.clone()).unwrap();
    let r2 = initialize_vault_settings(path_str).unwrap();
    assert_eq!(r1, r2, "Second call must return the same settings path");
}
// test_initialize_vault_settings_idempotent END ***************************

//**************************************************************************
// test_find_vault_internal_directory_input
//**************************************************************************
/// When file_path is itself a directory that contains a .lattice folder,
/// the function must find the existing vault without climbing to the parent.
#[test]
fn test_find_vault_internal_directory_input() {
    let temp_dir = tempfile::tempdir().unwrap();
    let home = temp_dir.path();

    // Pre-create the vault settings directory
    let lattice_dir = temp_dir.path().join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();

    // Pass the temp dir itself (a directory, not a file) as the search start
    let result = find_vault_settings_file_internal(
        temp_dir.path().to_string_lossy().to_string(),
        home,
    );
    assert!(result.is_ok());
    let found = result.unwrap().expect("Should find a settings path");
    assert!(found.ends_with("settings.json"), "Expected settings.json, got: {}", found);
}
// test_find_vault_internal_directory_input END ****************************

//**************************************************************************
// test_find_vault_settings_file_fallback_to_home
//**************************************************************************
/// Exercises find_vault_settings_file_internal when the file has no .lattice
/// in its own directory.  The function either finds an ancestor .lattice (valid)
/// or exhausts the walk and falls back to home_dir (also valid).  We verify
/// the behavioural contract — Ok(Some(path)) where path is an existing
/// settings.json — without assuming which branch fired, because the loop
/// walks the real filesystem and a system-level .lattice may exist above the
/// temp dir on the developer's machine.
#[test]
fn test_find_vault_settings_file_fallback_to_home() {
    let isolated_root = tempfile::tempdir().unwrap();
    let sub = isolated_root.path().join("deep").join("subdir");
    fs::create_dir_all(&sub).unwrap();
    let file_path = sub.join("note.md");
    fs::write(&file_path, "hello").unwrap();

    let home_temp = tempfile::tempdir().unwrap();

    let result = find_vault_settings_file_internal(
        file_path.to_string_lossy().to_string(),
        home_temp.path(),
    );

    assert!(result.is_ok(), "Function must not return an error");
    let found = result.unwrap().expect("Must return Some settings path");
    assert!(
        found.ends_with("settings.json"),
        "Returned path must end with settings.json, got: {}",
        found
    );
    assert!(
        Path::new(&found).exists(),
        "settings.json must exist on disk at: {}",
        found
    );
}
// test_find_vault_settings_file_fallback_to_home END **********************

//**************************************************************************
// test_save_image_assets_dir_already_exists
//**************************************************************************
/// Covers the branch inside save_image where assets_dir already exists
/// (the `if !assets_dir.exists()` branch evaluates to false).
#[test]
fn test_save_image_assets_dir_already_exists() {
    let temp_dir = tempfile::tempdir().unwrap();
    let doc_path = temp_dir.path().join("existing_doc.md");
    fs::write(&doc_path, "# doc").unwrap();
    let doc_str = doc_path.to_string_lossy().to_string();
    let b64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    // First call — creates the assets directory
    let r1 = save_image(doc_str.clone(), b64.to_string()).unwrap();

    // Second call — assets directory now already exists; exercises the else branch
    let r2 = save_image(doc_str.clone(), b64.to_string()).unwrap();

    // Both paths must sit inside the assets directory
    assert!(r1.contains("existing_doc_assets"));
    assert!(r2.contains("existing_doc_assets"));

    let p1 = temp_dir.path().join(&r1);
    let p2 = temp_dir.path().join(&r2);
    assert!(p1.exists());
    assert!(p2.exists());
}
// test_save_image_assets_dir_already_exists END ***************************

//**************************************************************************
// test_debug_file_probe_short_file_no_header_hex
//**************************************************************************
/// Covers the `else` branch of `if bytes.len() >= 4` in debug_file_probe.
/// A file shorter than 4 bytes will fail image decode AND skip the hex header.
#[test]
fn test_debug_file_probe_short_file_no_header_hex() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("two_bytes.dat");
    fs::write(&file_path, b"AB").unwrap(); // 2 bytes — fails decode, < 4 bytes

    let log = debug_file_probe(file_path.to_string_lossy().to_string());

    assert!(log.contains("Integrity: FAILED"));
    // Header hex line must NOT appear because len < 4
    assert!(
        !log.contains("Header (Hex)"),
        "Should not log header hex for files < 4 bytes, got:\n{}",
        log
    );
}
// test_debug_file_probe_short_file_no_header_hex END **********************

//**************************************************************************
// test_get_version_string_not_empty
//**************************************************************************
/// get_version_string reads a compile-time constant via include_str!.
/// The build script always generates the file, so this is safe to call in tests.
#[test]
fn test_get_version_string_not_empty() {
    let v = get_version_string();
    assert!(!v.trim().is_empty(), "Version string should not be blank");
}
// test_get_version_string_not_empty END ***********************************

//**************************************************************************
// test_maybe_sabotage_file_noop
//**************************************************************************
/// In production builds (cfg not integration_test) maybe_sabotage_file is a
/// no-op. Just calling it proves the function body is reachable.
#[test]
fn test_maybe_sabotage_file_noop() {
    // Should return immediately without side-effects
    super::test_utils::maybe_sabotage_file("irrelevant_path.md");
}
// test_maybe_sabotage_file_noop END ***************************************

//**************************************************************************
// test_save_image_invalid_base64_returns_err
//**************************************************************************
/// save_image must return Err when the image_data string is not valid base64.
#[test]
fn test_save_image_invalid_base64_returns_err() {
    let temp_dir = tempfile::tempdir().unwrap();
    let doc_path = temp_dir.path().join("doc.md");
    fs::write(&doc_path, "# doc").unwrap();

    let result = save_image(doc_path.to_string_lossy().to_string(), "!!!not base64!!!".to_string());
    assert!(result.is_err(), "Expected Err for invalid base64, got Ok");
}
// test_save_image_invalid_base64_returns_err END **************************

//**************************************************************************
// test_get_launch_file_smoke
//**************************************************************************
/// get_launch_file must not panic and must return Option<String>.
/// During `cargo test` the first non-flag argv is the test binary itself,
/// which starts with nothing unusual — this exercises the function path.
#[test]
fn test_get_launch_file_smoke() {
    // Simply calling it exercises the function body (parse_launch_args is
    // tested separately for all branches; here we just prove no panic).
    let _ = get_launch_file();
}
// test_get_launch_file_smoke END ******************************************

//**************************************************************************
// test_find_vault_preexisting_settings_not_overwritten
//**************************************************************************
/// When a .lattice/settings.json already exists the function must return
/// its path without overwriting the content (the `if !settings_path.exists()`
/// false branch inside the traversal loop).
#[test]
fn test_find_vault_preexisting_settings_not_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    let vault_root = temp.path().join("project");
    let lattice_dir = vault_root.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();

    let settings_path = lattice_dir.join("settings.json");
    let custom_content = r#"{"wordWrap": true}"#;
    fs::write(&settings_path, custom_content).unwrap();

    let doc_path = vault_root.join("doc.md");
    fs::write(&doc_path, "hello").unwrap();

    let found = find_vault_settings_file_internal(
        doc_path.to_string_lossy().to_string(),
        home,
    )
    .unwrap()
    .expect("Must find the vault settings");

    assert_eq!(found, settings_path.to_string_lossy().as_ref());
    // Original content must be intact — not reset to "{}"
    let on_disk = fs::read_to_string(&settings_path).unwrap();
    assert_eq!(on_disk.trim(), custom_content);
}
// test_find_vault_preexisting_settings_not_overwritten END ****************

//**************************************************************************
// test_find_vault_fallback_lattice_exists_settings_missing
//**************************************************************************
/// Covers the branch where .lattice exists but settings.json does not:
/// the function must create settings.json and return its path.
///
/// The file lives inside the same temp root that owns the .lattice dir.
/// The traversal climbs to that root and finds the .lattice there — fully
/// under test control.  Using a separate tempdir would land the file under
/// the real %TEMP% hierarchy, which may be inside the developer's home dir
/// where a real .lattice already exists, causing a false positive mismatch.
#[test]
fn test_find_vault_fallback_lattice_exists_settings_missing() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();

    // Pre-create the .lattice dir but NOT settings.json
    let lattice_dir = home.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();

    // File sits inside home/subdir so the traversal climbs to home and
    // finds home/.lattice — the dir-exists-but-settings-missing branch.
    let sub = home.join("deep").join("sub");
    fs::create_dir_all(&sub).unwrap();
    let file = sub.join("note.md");
    fs::write(&file, "hi").unwrap();

    let found = find_vault_settings_file_internal(
        file.to_string_lossy().to_string(),
        home,
    )
    .unwrap()
    .expect("Must return settings path");

    let expected = lattice_dir.join("settings.json");
    assert_eq!(found, expected.to_string_lossy().as_ref());
    assert!(expected.exists(), "settings.json must have been created");
}
// test_find_vault_fallback_lattice_exists_settings_missing END ************

//**************************************************************************
// test_find_vault_fallback_both_exist_returns_existing
//**************************************************************************
/// Covers the branch where .lattice/settings.json already exists:
/// the function must return the existing path without touching the file.
///
/// The file lives inside the same temp root that owns the .lattice dir so
/// the traversal finds it under our controlled temp tree rather than the
/// developer's real home directory (which also has .lattice on this machine).
#[test]
fn test_find_vault_fallback_both_exist_returns_existing() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();

    let lattice_dir = home.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();
    let settings_path = lattice_dir.join("settings.json");
    let sentinel = r#"{"wordWrap": true}"#;
    fs::write(&settings_path, sentinel).unwrap();

    // File sits inside home/subdir so the traversal climbs to home and
    // finds the existing home/.lattice/settings.json — the both-exist branch.
    let sub = home.join("subdir");
    fs::create_dir_all(&sub).unwrap();
    let file = sub.join("note.md");
    fs::write(&file, "hi").unwrap();

    let found = find_vault_settings_file_internal(
        file.to_string_lossy().to_string(),
        home,
    )
    .unwrap()
    .expect("Must return existing settings");

    assert_eq!(found, settings_path.to_string_lossy().as_ref());
    // Content must be untouched
    let on_disk = fs::read_to_string(&settings_path).unwrap();
    assert_eq!(on_disk.trim(), sentinel);
}
// test_find_vault_fallback_both_exist_returns_existing END ****************

//**************************************************************************
// test_find_vault_internal_from_file_inside_vault
//**************************************************************************
/// When the search starts from a file that is a direct child of the vault
/// root containing .lattice, the function must find the vault in one hop
/// (exercises the `current.is_file()` → parent branch at the top).
#[test]
fn test_find_vault_internal_from_file_inside_vault() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let vault_root = temp.path().join("vault");
    let lattice_dir = vault_root.join(".lattice");
    fs::create_dir_all(&lattice_dir).unwrap();

    let file = vault_root.join("note.md");
    fs::write(&file, "test").unwrap();

    let found = find_vault_settings_file_internal(
        file.to_string_lossy().to_string(),
        &home,
    )
    .unwrap()
    .expect("Should find vault settings");

    assert!(found.ends_with("settings.json"));
    assert!(std::path::Path::new(&found).exists());
}
// test_find_vault_internal_from_file_inside_vault END *********************

//**************************************************************************
// test_parse_launch_args_empty_args
//**************************************************************************
/// Edge case: args vector is completely empty (no binary name either).
#[test]
fn test_parse_launch_args_empty_args() {
    assert_eq!(parse_launch_args(vec![]), None);
}
// test_parse_launch_args_empty_args END ***********************************

//**************************************************************************
// test_save_image_no_parent_directory
//**************************************************************************
/// Covers the `Cannot_get_parent_directory` branch in save_image.
/// An empty string path has no parent component — `path.parent()` returns None.
#[test]
fn test_save_image_no_parent_directory() {
    let result = save_image("".to_string(), "base64data".to_string());
    assert_eq!(
        result.unwrap_err(),
        "Cannot_get_parent_directory",
        "Empty path should yield Cannot_get_parent_directory"
    );
}
// test_save_image_no_parent_directory END **********************************

//**************************************************************************
// test_save_image_no_file_stem
//**************************************************************************
/// Covers the `Cannot_get_file_stem` branch in save_image.
///
/// A path whose last component is `..` has `Some(parent)` (the traversal
/// gives the directory before `..`) but `file_name()` — and therefore
/// `file_stem()` — returns `None` because `..` is a special path component
/// that has no file-name meaning.  This is the only portable way on stable
/// Rust to reach `Cannot_get_file_stem` without a real file being absent.
#[test]
fn test_save_image_no_file_stem() {
    let temp = tempfile::tempdir().unwrap();
    // temp/.. → parent = Some(temp_path), file_name = None → file_stem = None
    let dotdot_path = temp.path().join("..").to_string_lossy().to_string();
    let result = save_image(dotdot_path, "base64data".to_string());
    assert_eq!(
        result.unwrap_err(),
        "Cannot_get_file_stem",
        "Path ending in '..' should yield Cannot_get_file_stem"
    );
}
// test_save_image_no_file_stem END *****************************************

//**************************************************************************
// test_read_file_base64_no_extension_defaults_to_png
//**************************************************************************
/// Covers the `unwrap_or("png")` branch in `read_file_base64`.
///
/// When a file has no extension at all, `path.extension()` returns `None`
/// and `and_then(|e| e.to_str())` propagates `None`, so `unwrap_or("png")`
/// fires.  The existing mime-type matrix only tests files *with* extensions;
/// this test covers the extension-absent code path.
#[test]
fn test_read_file_base64_no_extension_defaults_to_png() {
    let temp = tempfile::tempdir().unwrap();
    // A filename with no dot has no extension → extension() = None → unwrap_or("png")
    let path = temp.path().join("noextension");
    fs::write(&path, b"fake bytes").unwrap();
    let result = read_file_base64(path.to_string_lossy().to_string())
        .expect("read_file_base64 should succeed for a file with no extension");
    assert!(
        result.starts_with("data:image/png;base64,"),
        "File with no extension must default to image/png, got prefix: {}",
        &result[..result.len().min(50)]
    );
}
// test_read_file_base64_no_extension_defaults_to_png END ******************
