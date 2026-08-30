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

// UTST for vault_path — path classification, bounded walk-up, vault init.

use super::*;
use std::fs;
use tempfile::TempDir;

//******************************************************************************
// helpers
//******************************************************************************
/// Creates `dir/.lattice/` (without a settings.json) and returns the dir.
fn make_vault_dir(dir: &Path) -> PathBuf {
    let v = dir.join(".lattice");
    fs::create_dir_all(&v).unwrap();
    v
}

/// Creates a file with the given content, making parents as needed.
fn make_file(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}
// helpers END *****************************************************************

// NOTE ON HERMETICITY — read before "simplifying" any test below.
//
// An UNBOUNDED search walks to the filesystem root, so it will happily find a
// real `.lattice` belonging to the developer.  On Windows the system temp dir
// lives under the user profile, so a plain TempDir walk climbs straight through
// `C:\Users\<user>\.lattice` — the global vault lattice itself creates — and
// the test picks that up instead of its own fixture.  (It bites on any box
// whose temp dir sits under $HOME; it just happens not to on Linux, where temp
// is /tmp and home is elsewhere.)
//
// So every test whose expected outcome is "nothing found -> fall back" passes
// `Some(tmp.path())` as the boundary, which confines the search to the fixture.
// Tests that plant their vault BELOW any possible real one (e.g. in the file's
// own directory) are deterministic already and stay unbounded.


// -----------------------------------------------------------------------
// classify_path
// -----------------------------------------------------------------------
#[test]
fn classify_treats_posix_paths_as_filesystem() {
    assert_eq!(classify_path("/home/leo/note.md"), PathKind::FileSystem);
    assert_eq!(classify_path("note.md"), PathKind::FileSystem);
    assert_eq!(classify_path(""), PathKind::FileSystem);
    assert_eq!(classify_path("/"), PathKind::FileSystem);
}

#[test]
fn classify_treats_windows_paths_as_filesystem() {
    // A drive letter has a ':' but never "://".
    assert_eq!(
        classify_path(r"C:\Users\leoni\note.md"),
        PathKind::FileSystem
    );
    // UNC share.
    assert_eq!(classify_path(r"\\server\share\note.md"), PathKind::FileSystem);
}

#[test]
fn classify_detects_android_content_uris() {
    assert_eq!(
        classify_path("content://com.android.providers.downloads.documents/document/msf%3A1000"),
        PathKind::OpaqueUri
    );
    assert_eq!(classify_path("file:///storage/note.md"), PathKind::OpaqueUri);
    assert_eq!(classify_path("http://example.com/a.md"), PathKind::OpaqueUri);
}

#[test]
fn classify_rejects_things_that_only_look_like_schemes() {
    // A scheme must start with a letter, so this is a (weird) path, not a URI.
    assert_eq!(classify_path("1234://x"), PathKind::FileSystem);
    assert_eq!(classify_path("://x"), PathKind::FileSystem);
}

// -----------------------------------------------------------------------
// find — basic walk-up (desktop behaviour, boundary = None)
// -----------------------------------------------------------------------
#[test]
fn find_locates_vault_in_the_files_own_directory() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    let doc = tmp.path().join("docs").join("note.md");
    make_file(&doc, "hi");
    let vault = make_vault_dir(&tmp.path().join("docs"));

    let found =
        find_vault_settings_file_internal(doc.to_string_lossy().to_string(), home.path()).unwrap();

    assert_eq!(found, Some(vault.join("settings.json").to_string_lossy().to_string()));
    // settings.json is created on demand when the vault dir exists without one
    assert!(vault.join("settings.json").exists());
}

#[test]
fn find_walks_up_to_an_ancestor_vault() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    let vault = make_vault_dir(tmp.path());
    let doc = tmp.path().join("a").join("b").join("c").join("note.md");
    make_file(&doc, "hi");

    let found =
        find_vault_settings_file_internal(doc.to_string_lossy().to_string(), home.path()).unwrap();

    assert_eq!(found, Some(vault.join("settings.json").to_string_lossy().to_string()));
}

#[test]
fn find_falls_back_to_home_when_no_vault_in_ancestry() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    let doc = tmp.path().join("note.md");
    make_file(&doc, "hi");

    // Bounded to the fixture — see NOTE ON HERMETICITY above.
    let found = find_vault_settings_file_bounded(
        doc.to_string_lossy().to_string(),
        home.path(),
        Some(tmp.path()),
    )
    .unwrap();

    let expected = home.path().join(".lattice").join("settings.json");
    assert_eq!(found, Some(expected.to_string_lossy().to_string()));
    assert!(expected.exists());
}

#[test]
fn find_ignores_a_regular_file_named_dot_lattice() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    // A FILE (not a directory) called .lattice must not be mistaken for a vault
    make_file(&tmp.path().join(".lattice"), "not a vault");
    let doc = tmp.path().join("note.md");
    make_file(&doc, "hi");

    // Bounded to the fixture — see NOTE ON HERMETICITY above.
    let found = find_vault_settings_file_bounded(
        doc.to_string_lossy().to_string(),
        home.path(),
        Some(tmp.path()),
    )
    .unwrap();

    let expected = home.path().join(".lattice").join("settings.json");
    assert_eq!(found, Some(expected.to_string_lossy().to_string()));
}

// -----------------------------------------------------------------------
// find — sandbox boundary (mobile behaviour)
// -----------------------------------------------------------------------
#[test]
fn bounded_walk_finds_a_vault_at_the_boundary_itself() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    let sandbox = tmp.path().join("sandbox");
    let vault = make_vault_dir(&sandbox);
    let doc = sandbox.join("docs").join("note.md");
    make_file(&doc, "hi");

    let found = find_vault_settings_file_bounded(
        doc.to_string_lossy().to_string(),
        home.path(),
        Some(&sandbox),
    )
    .unwrap();

    assert_eq!(found, Some(vault.join("settings.json").to_string_lossy().to_string()));
}

#[test]
fn bounded_walk_does_not_escape_the_sandbox() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    // A vault ABOVE the sandbox root must not be picked up.
    let outside_vault = make_vault_dir(tmp.path());
    let sandbox = tmp.path().join("sandbox");
    let doc = sandbox.join("docs").join("note.md");
    make_file(&doc, "hi");

    let found = find_vault_settings_file_bounded(
        doc.to_string_lossy().to_string(),
        home.path(),
        Some(&sandbox),
    )
    .unwrap();

    let fallback = home.path().join(".lattice").join("settings.json");
    assert_eq!(found, Some(fallback.to_string_lossy().to_string()));
    // and we must not have created a settings.json in the out-of-sandbox vault
    assert!(!outside_vault.join("settings.json").exists());
}

#[test]
fn bounded_walk_stops_immediately_for_a_path_outside_the_sandbox() {
    let tmp = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();

    // iOS document-picker shape: the file lives outside our container.
    let elsewhere = tmp.path().join("elsewhere");
    let elsewhere_vault = make_vault_dir(&elsewhere);
    let doc = elsewhere.join("note.md");
    make_file(&doc, "hi");

    let sandbox = tmp.path().join("sandbox");
    fs::create_dir_all(&sandbox).unwrap();

    let found = find_vault_settings_file_bounded(
        doc.to_string_lossy().to_string(),
        home.path(),
        Some(&sandbox),
    )
    .unwrap();

    let fallback = home.path().join(".lattice").join("settings.json");
    assert_eq!(found, Some(fallback.to_string_lossy().to_string()));
    assert!(!elsewhere_vault.join("settings.json").exists());
}

// -----------------------------------------------------------------------
// find — opaque URIs (Android SAF)
// -----------------------------------------------------------------------
#[test]
fn find_uses_fallback_for_a_content_uri_without_touching_the_filesystem() {
    let home = TempDir::new().unwrap();

    let uri = "content://com.android.providers.downloads.documents/document/msf%3A1000";
    let found = find_vault_settings_file_internal(uri.to_string(), home.path()).unwrap();

    let expected = home.path().join(".lattice").join("settings.json");
    assert_eq!(found, Some(expected.to_string_lossy().to_string()));
    assert!(expected.exists());
}

#[test]
fn find_creates_the_fallback_base_directory_if_missing() {
    // iOS: Application Support does not exist until the app creates it.
    let tmp = TempDir::new().unwrap();
    let base = tmp.path().join("Library").join("Application Support").join("lattice");
    assert!(!base.exists());

    // Bounded to a directory that does not exist yet, so nothing is searched
    // and the fallback is exercised on its own — see NOTE ON HERMETICITY.
    let doc = tmp.path().join("elsewhere").join("note.md");
    let found = find_vault_settings_file_bounded(
        doc.to_string_lossy().to_string(),
        &base,
        Some(&base),
    )
    .unwrap();
    let _ = &doc;

    let expected = base.join(".lattice").join("settings.json");
    assert_eq!(found, Some(expected.to_string_lossy().to_string()));
    assert!(expected.exists());
}

// -----------------------------------------------------------------------
// initialize_vault_settings_internal
// -----------------------------------------------------------------------
#[test]
fn init_creates_vault_beside_a_file() {
    let tmp = TempDir::new().unwrap();
    let doc = tmp.path().join("docs").join("note.md");
    make_file(&doc, "hi");

    let settings = initialize_vault_settings_internal(doc.to_string_lossy().to_string()).unwrap();

    assert_eq!(
        Path::new(&settings),
        tmp.path().join("docs").join(".lattice").join("settings.json")
    );
    assert!(Path::new(&settings).exists());
}

#[test]
fn init_creates_vault_inside_a_directory() {
    let tmp = TempDir::new().unwrap();

    let settings =
        initialize_vault_settings_internal(tmp.path().to_string_lossy().to_string()).unwrap();

    assert_eq!(
        Path::new(&settings),
        tmp.path().join(".lattice").join("settings.json")
    );
}

#[test]
fn init_is_idempotent_and_never_overwrites_settings() {
    let tmp = TempDir::new().unwrap();
    let doc = tmp.path().join("note.md");
    make_file(&doc, "hi");

    let first = initialize_vault_settings_internal(doc.to_string_lossy().to_string()).unwrap();
    fs::write(&first, r#"{"wordWrap":true}"#).unwrap();

    let second = initialize_vault_settings_internal(doc.to_string_lossy().to_string()).unwrap();

    assert_eq!(first, second);
    assert_eq!(fs::read_to_string(&second).unwrap(), r#"{"wordWrap":true}"#);
}

#[test]
fn init_refuses_an_opaque_content_uri_with_an_actionable_message() {
    let uri = "content://com.android.providers.downloads.documents/document/msf%3A1000";

    let err = initialize_vault_settings_internal(uri.to_string()).unwrap_err();

    assert!(err.starts_with(ERR_PREFIX), "got: {err}");
    assert!(err.contains("document picker"), "got: {err}");
}

// -----------------------------------------------------------------------
// describe_vault_io_error
// -----------------------------------------------------------------------
#[test]
fn describe_maps_read_only_filesystem_to_the_cloud_hint() {
    let e = io::Error::from_raw_os_error(30); // EROFS on Linux/Android/macOS
    let msg = describe_vault_io_error(ERR_PREFIX, &e);
    assert!(msg.contains("read-only"), "got: {msg}");
    assert!(msg.contains("Google Drive"), "got: {msg}");
}

#[test]
fn describe_maps_permission_denied_to_the_mobile_hint() {
    let e = io::Error::from(io::ErrorKind::PermissionDenied);
    let msg = describe_vault_io_error(ERR_PREFIX, &e);
    assert!(msg.starts_with(ERR_PREFIX), "got: {msg}");
    assert!(msg.contains("outside the app's own storage"), "got: {msg}");
}

#[test]
fn describe_falls_through_to_the_raw_error_otherwise() {
    let e = io::Error::new(io::ErrorKind::Other, "disk on fire");
    let msg = describe_vault_io_error(ERR_PREFIX, &e);
    assert_eq!(msg, format!("{}disk on fire", ERR_PREFIX));
}
