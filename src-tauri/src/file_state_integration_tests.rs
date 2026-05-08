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

use crate::file_state::determine_wished_format;

use super::{
    DetectedLineEndings, FileTrackerState, create_daily_note_file, read_text_file_internal,
    scan_content, write_text_file_internal,
};

#[test]
fn test_create_daily_note_file() {
    let temp_dir = tempfile::tempdir().unwrap();
    let notes_path = temp_dir.path().to_string_lossy().to_string();

    let result1 = create_daily_note_file(notes_path.clone());
    assert!(result1.is_ok());
    let final_path1 = result1.unwrap();

    // Simulating file creation format e.g. YYYYMMDD-DDD.md
    assert!(std::path::Path::new(&final_path1).exists());

    // If exact name exists and is readable, should return the exact same path
    let result2 = create_daily_note_file(notes_path.clone());
    assert_eq!(result2.unwrap(), final_path1);
}
use std::fs;
use std::path::Path;

// Helper to write bytes directly to disk (bypassing any text processing)
fn write_bin_file(filename: &str, bytes: &[u8]) {
    let path = Path::new("..")
        .join("_test_samples")
        .join("temp")
        .join(filename);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("Failed to create temp dir FOR TESTING");
    }
    fs::write(&path, bytes).expect("Failed to write test file FOR TESTING");
}

fn read_and_scan(filename: &str) -> DetectedLineEndings {
    let path = Path::new("..")
        .join("_test_samples")
        .join("temp")
        .join(filename);
    let content = fs::read_to_string(&path).expect("Failed to read test file FOR TESTING");
    scan_content(&content)
}

#[test]
fn test_integration_lf_files() {
    // Prepare files
    write_bin_file("lf_1line.md.bin", b"foo\nbar");
    write_bin_file("lf_multi.md.bin", b"Line1\nLine2\nLine3\n");

    // Verify
    assert_eq!(
        read_and_scan("lf_1line.md.bin"),
        DetectedLineEndings::OnlyLF
    );
    assert_eq!(
        read_and_scan("lf_multi.md.bin"),
        DetectedLineEndings::OnlyLF
    );
}

#[test]
fn test_integration_crlf_files() {
    // Prepare files
    write_bin_file("crlf_1line.md.bin", b"foo\r\nbar");
    write_bin_file("crlf_multi.md.bin", b"Line1\r\nLine2\r\nLine3\r\n");

    // Verify
    assert_eq!(
        read_and_scan("crlf_1line.md.bin"),
        DetectedLineEndings::OnlyCRLF
    );
    assert_eq!(
        read_and_scan("crlf_multi.md.bin"),
        DetectedLineEndings::OnlyCRLF
    );
}

#[test]
fn test_integration_mixed_files() {
    // Prepare files
    write_bin_file("mixed.md.bin", b"Line1\nLine2\r\nLine3");

    // Verify
    assert_eq!(read_and_scan("mixed.md.bin"), DetectedLineEndings::Mixed);
}

#[test]
fn test_write_text_file_logic_with_state() {
    use super::{FileTrackerState, write_text_file_internal};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // Mock state
    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("test_write.md");
    let path_str = file_path.to_string_lossy().to_string();

    // 1. Write fresh
    let content1 = "Hello\nWorld";
    let res1 =
        write_text_file_internal(path_str.clone(), content1.to_string(), &state).unwrap();
    assert_eq!(res1.path, path_str);

    // 2. Simulate external change (Conflict Setup)
    // Manually update file on disk to simulate external editor
    std::fs::write(&file_path, "External Change").unwrap();

    // 3. Try to save "Version 2"
    // The internal state expects hash of "Hello\nWorld"
    // But disk has "External Change".
    // This should trigger conflict.
    let content2 = "Version 2";
    let res2 =
        write_text_file_internal(path_str.clone(), content2.to_string(), &state).unwrap();

    assert_ne!(res2.path, path_str);
    assert!(res2.path.contains("test_write")); // Should preserve part of name

    // 4. Verify original file preserved
    let disk_content = std::fs::read_to_string(&file_path).unwrap();
    assert_eq!(disk_content, "External Change");

    // 5. Verify new file created with Version 2
    let new_content = std::fs::read_to_string(&res2.path).unwrap();
    assert!(new_content.contains("Version 2"));
}

#[test]
fn test_lock_timeout_error_propagation() {
    use super::{FileTrackerState, read_text_file_internal};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // Mock state
    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };

    // 1. Acquire lock and hold it (simulating another thread/process holding it)
    // Note: In a single-threaded test runner, this works because acquire_lock uses try_lock loop
    let _guard = state.files.lock().unwrap();

    // 2. Prepare a real file so read_to_string succeeds
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("timeout_test.md");
    std::fs::write(&file_path, "content").unwrap();

    // 3. Try to read (should fail due to timeout)
    let res = read_text_file_internal(file_path.to_string_lossy().to_string(), None, &state);

    // 4. Verify the ? operator propogated the error
    assert!(res.is_err());
    let err = res.unwrap_err();
    assert!(
        err.contains(ERR_FILE_LOCK_TIMEOUT!()),
        "Error message was ****: {}",
        err
    );
}

//*************************************************************************
// test_read_write_text_file_basic
//*************************************************************************
#[test]
fn test_read_write_text_file_basic() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // Mock state
    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("test_basic.md");
    let path_str = file_path.to_string_lossy().to_string();

    let internal_content = "Hello\nWorld";

    let external_con_win = super::to_physical(
        internal_content,
        determine_wished_format(DetectedLineEndings::None, true),
    );
    let external_con_mac = super::to_physical(
        internal_content,
        determine_wished_format(DetectedLineEndings::None, false),
    );

    // Write
    let write_res =
        write_text_file_internal(path_str.clone(), internal_content.to_string(), &state)
            .unwrap();
    assert_eq!(write_res.path, path_str);

    // Read
    let read_res = read_text_file_internal(path_str.clone(), None, &state).unwrap();
    assert_eq!(read_res.content, internal_content);
    // Hash check

    let tracker = state.files.lock().unwrap();
    let _expected_hash = tracker.get(&path_str).unwrap().last_hash.clone();

    let hash_win = crate::textcontent_hashing::compute_hash(&external_con_win);
    let hash_mac = crate::textcontent_hashing::compute_hash(&external_con_mac);

    let matches_win = read_res.hash == hash_win;
    let matches_mac = read_res.hash == hash_mac;

    //  XOR check: "exactly one of:  the obove MUST match
    assert!(
        matches_win ^ matches_mac,
        "Hash matches exactly one: win: {}, mac: {}, actual: {}",
        matches_win,
        matches_mac,
        read_res.hash
    );
}
// test_read_write_text_file_basic END **********************************

//*************************************************************************
// test_write_text_file_conflict
//*************************************************************************
#[test]
fn test_write_text_file_conflict() {
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    // Mock state
    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("conflict.md");
    let path_str = file_path.to_string_lossy().to_string();

    // 1. Create Initial File
    let initial_content = "Version 1";
    let _ = write_text_file_internal(path_str.clone(), initial_content.to_string(), &state)
        .unwrap();
    let hash_v1 = crate::textcontent_hashing::compute_hash(initial_content);
    let expected_hash2 = "4461645df7107aea4f366672d1f8744c63937802e951c380e9b27aedb610317c7f4082988105f1e638e16fca7fcdf48fd90aa2ef7da6761d59376cc7b1718ce8";
    assert_eq!(hash_v1, expected_hash2);

    // 2. Simulator: Another process changes the file on disk
    // Note: write_text_file expects internal format on input but writes physical.
    // We simulate disk write directly.
    #[cfg(target_os = "windows")]
    let disk_content = "Version 1 Modified on Disk\n".replace("\n", "\r\n");
    #[cfg(not(target_os = "windows"))]
    let disk_content = "Version 1 Modified on Disk\n";

    fs::write(&file_path, disk_content).unwrap();

    // 3. App tries to save "Version 2"
    // The *State* still remembers hash_v1.
    // Optimistic locking compares State.last_hash (hash_v1) vs Disk Hash (hash of "Version 1 Modified...").
    // Since they differ, it triggers conflict.
    let new_content = "Version 2";
    let write_res =
        write_text_file_internal(path_str.clone(), new_content.to_string(), &state).unwrap();

    // 4. Assert Conflict Resolution
    // The path returned should NOT be the original path, but a new backup path
    assert_ne!(write_res.path, path_str);
    assert!(write_res.path.contains("conflict"));

    // Verify both files exist
    assert!(Path::new(&path_str).exists()); // Original (Modified on Disk)
    assert!(Path::new(&write_res.path).exists()); // New Backup (Version 2)

    // Verify content of backup
    let backup_content = read_text_file_internal(write_res.path, None, &state)
        .unwrap()
        .content;
    assert_eq!(backup_content, new_content);
}

#[test]
fn test_reproduction_crlf_mismatch() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // Mock state
    let state = super::FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("test_crlf.md");
    let path_str = file_path.to_string_lossy().to_string();

    // 1. Manually write a file with CRLF (Simulate Windows Disk)
    let crlf_content = "Line1\r\nLine2";
    std::fs::write(&file_path, crlf_content).unwrap();

    // 2. Read the file (Logic stores Hash of Internal/LF content)
    // internal should be "Line1\nLine2"
    let _read_res = read_text_file_internal(path_str.clone(), None, &state).unwrap();

    // ASSERT: Tracker has Hash("Line1\nLine2")

    // 3. Write back the SAME content (Internal format)
    // Ideally, this should NOT conflict.
    let internal_content = "Line1\nLine2";
    let write_res =
        write_text_file_internal(path_str.clone(), internal_content.to_string(), &state)
            .unwrap();

    // 4. Assert Path Identical (No Conflict)
    // If Logic is buggy (comparing Hash(LF) stored vs Hash(CRLF) on disk), this fails.
    assert_eq!(
        write_res.path, path_str,
        "Should not conflict when saving same content despite CRLF on disk"
    );
}
#[test]
fn test_close_file_and_cleanup_state() {
    use super::{
        FileState, FileTrackerState, FileWishedFormat, cleanup_window_state,
        close_file_internal,
    };
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };

    // 1. Inject test state: One file shared by two windows, one file held by one
    {
        let mut tracker = state.files.lock().unwrap();
        tracker.insert(
            "shared.md".to_string(),
            FileState {
                last_hash: "hash1".to_string(),
                last_accessed: 0,
                window_ids: vec!["win1".to_string(), "win2".to_string()],
                wished_format: FileWishedFormat::NewLineLFLikeUnix,
            },
        );
        tracker.insert(
            "private.md".to_string(),
            FileState {
                last_hash: "hash2".to_string(),
                last_accessed: 0,
                window_ids: vec!["win1".to_string()],
                wished_format: FileWishedFormat::NewLineLFLikeUnix,
            },
        );
    }

    // 2. Test closing a shared file for one window
    let res = close_file_internal("shared.md".to_string(), "win1".to_string(), &state);
    assert!(res.is_ok());

    {
        let tracker = state.files.lock().unwrap();
        assert!(tracker.contains_key("shared.md"));
        // File still exists but win1 is gone
        assert_eq!(
            tracker.get("shared.md").unwrap().window_ids,
            vec!["win2".to_string()]
        );
    }

    // 3. Test closing the last window for a file
    let res2 = close_file_internal("shared.md".to_string(), "win2".to_string(), &state);
    assert!(res2.is_ok());

    {
        let tracker = state.files.lock().unwrap();
        // File should be completely removed from tracker
        assert!(!tracker.contains_key("shared.md"));
    }

    // 4. Test sweeping a closed window (win1 closes entirely, has private.md open)
    cleanup_window_state("win1", &state);

    {
        let tracker = state.files.lock().unwrap();
        // private.md should be gone because win1 was sweeped
        assert!(!tracker.contains_key("private.md"));
        assert!(tracker.is_empty());
    }
}
// -----------------------------------------------------------------------
// test_write_to_root_path_errors
// -----------------------------------------------------------------------
/// Passing "/" (no parent) as a write target must return an error from
/// do_writefile rather than panicking.
#[test]
#[cfg(unix)]
fn test_write_to_root_path_errors() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };
    // "/" has no parent — the do_writefile guard should return Err
    let result = write_text_file_internal("/".to_string(), "data".to_string(), &state);
    assert!(result.is_err(), "Expected Err for root path, got Ok");
}

// -----------------------------------------------------------------------
// test_close_file_unknown_path_is_noop
// -----------------------------------------------------------------------
/// Closing a path that is not in the tracker should silently succeed.
#[test]
fn test_close_file_unknown_path_is_noop() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };
    let res = super::close_file_internal(
        "never_opened.md".to_string(),
        "win1".to_string(),
        &state,
    );
    assert!(res.is_ok());
    assert!(state.files.lock().unwrap().is_empty());
}

// -----------------------------------------------------------------------
// test_cleanup_window_state_window_not_in_any_file
// -----------------------------------------------------------------------
/// cleanup_window_state for a window that owns no files should be a no-op.
#[test]
fn test_cleanup_window_state_window_not_in_any_file() {
    use super::{FileState, FileTrackerState, FileWishedFormat, cleanup_window_state};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };
    {
        let mut t = state.files.lock().unwrap();
        t.insert(
            "file.md".to_string(),
            FileState {
                last_hash: "h".to_string(),
                last_accessed: 0,
                window_ids: vec!["win2".to_string()],
                wished_format: FileWishedFormat::NewLineLFLikeUnix,
            },
        );
    }
    // "win1" owns nothing — sweep must leave "file.md" intact
    cleanup_window_state("win1", &state);
    let t = state.files.lock().unwrap();
    assert!(t.contains_key("file.md"), "file.md should still be tracked");
    assert_eq!(t["file.md"].window_ids, vec!["win2".to_string()]);
}

// -----------------------------------------------------------------------
// test_read_file_adds_window_without_duplication
// -----------------------------------------------------------------------
/// Re-reading a file for the same window should NOT duplicate the window ID.
/// Reading with a second window should add it once.
#[test]
fn test_read_file_adds_window_without_duplication() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("multi_win.md");
    std::fs::write(&file_path, "hello").unwrap();
    let path_str = file_path.to_string_lossy().to_string();

    // First read — registers win1
    read_text_file_internal(path_str.clone(), Some("win1".to_string()), &state).unwrap();
    // Same window reads again — win1 must NOT be pushed twice
    read_text_file_internal(path_str.clone(), Some("win1".to_string()), &state).unwrap();
    // Different window — win2 added
    read_text_file_internal(path_str.clone(), Some("win2".to_string()), &state).unwrap();

    let tracker = state.files.lock().unwrap();
    let entry = tracker.get(&path_str).unwrap();
    assert_eq!(entry.window_ids.len(), 2, "Expected exactly 2 distinct windows");
    assert!(entry.window_ids.contains(&"win1".to_string()));
    assert!(entry.window_ids.contains(&"win2".to_string()));
}

// -----------------------------------------------------------------------
// test_write_twice_no_conflict
// -----------------------------------------------------------------------
/// Writing to a known file without any external modification must overwrite
/// cleanly (same path returned, no conflict copy).
#[test]
fn test_write_twice_no_conflict() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("no_conflict.md");
    let path_str = file_path.to_string_lossy().to_string();

    // First write — creates the file
    let res1 = write_text_file_internal(path_str.clone(), "initial".to_string(), &state)
        .unwrap();
    assert_eq!(res1.path, path_str);

    // Sync state: read so the tracker holds the exact on-disk hash
    read_text_file_internal(path_str.clone(), None, &state).unwrap();

    // Second write — no external change, must NOT produce a conflict copy
    let res2 = write_text_file_internal(path_str.clone(), "updated".to_string(), &state)
        .unwrap();
    assert_eq!(res2.path, path_str, "Path must be unchanged (no conflict)");

    let disk = std::fs::read_to_string(&file_path).unwrap();
    assert!(disk.contains("updated"));
}

// -----------------------------------------------------------------------
// test_create_daily_note_creates_nonexistent_directory
// -----------------------------------------------------------------------
/// create_daily_note_file must call create_dir_all when the target
/// directory does not yet exist. Passing a nested path that has never
/// been created verifies this branch.
#[test]
fn test_create_daily_note_creates_nonexistent_directory() {
    let temp_dir = tempfile::tempdir().unwrap();
    // Build a nested path that does NOT exist yet.
    let notes_path = temp_dir
        .path()
        .join("deep")
        .join("nested")
        .join("notes");
    assert!(!notes_path.exists(), "Pre-condition: directory must not exist");

    let path_str = notes_path.to_string_lossy().to_string();
    let result = create_daily_note_file(path_str);

    assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
    let file_path = result.unwrap();
    assert!(
        std::path::Path::new(&file_path).exists(),
        "Created daily-note file must exist on disk"
    );
    assert!(
        notes_path.exists(),
        "Directory must have been created by create_dir_all"
    );
}

// -----------------------------------------------------------------------
// test_create_daily_note_file_collision_counter_loop
// -----------------------------------------------------------------------
/// When the base daily-note file exists but cannot be read (permission
/// denied), create_daily_note_file must walk the counter loop and return
/// the first suffixed path it can create (e.g. `YYYYMMDD-DDD-1.md`).
/// The first suffix is always writable (fresh path), so exactly one
/// iteration is needed.
#[test]
#[cfg(unix)]
fn test_create_daily_note_file_collision_counter_loop() {
    use std::os::unix::fs::PermissionsExt;

    let temp_dir = tempfile::tempdir().unwrap();
    let notes_path = temp_dir.path().to_string_lossy().to_string();

    // Create the base daily-note so we know its name.
    let base_path_str = create_daily_note_file(notes_path.clone()).unwrap();
    let base_path = std::path::Path::new(&base_path_str);

    // Make the base file unreadable so `fs::read` will fail.
    let mut perms = std::fs::metadata(base_path).unwrap().permissions();
    perms.set_mode(0o000);
    std::fs::set_permissions(base_path, perms).unwrap();

    // Now call again: base exists but is unreadable → loop → creates -1 variant.
    let result = create_daily_note_file(notes_path.clone());

    // Restore permissions so the temp_dir cleanup doesn't fail.
    let mut perms2 = std::fs::metadata(base_path).unwrap().permissions();
    perms2.set_mode(0o644);
    std::fs::set_permissions(base_path, perms2).unwrap();

    assert!(result.is_ok(), "Expected collision counter to find a slot: {:?}", result.err());
    let new_path = result.unwrap();
    // Must differ from the base (a suffix was appended).
    assert_ne!(new_path, base_path_str, "Collision must produce a different path");
    assert!(
        std::path::Path::new(&new_path).exists(),
        "Collision-resolved file must exist"
    );
}

// -----------------------------------------------------------------------
// test_write_conflict_when_file_exists_but_is_unreadable
// -----------------------------------------------------------------------
/// When the tracker holds an expected hash for a file that exists on disk
/// but cannot be read (permission denied), write_text_file_internal must
/// detect the read failure and resolve by creating a new copy.
#[test]
#[cfg(unix)]
fn test_write_conflict_when_file_exists_but_is_unreadable() {
    use std::collections::HashMap;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{Arc, Mutex};

    let state = FileTrackerState {
        files: Arc::new(Mutex::new(HashMap::new())),
    };
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("unreadable.md");
    let path_str = file_path.to_string_lossy().to_string();

    // 1. Create and register the file normally.
    write_text_file_internal(path_str.clone(), "original".to_string(), &state).unwrap();
    read_text_file_internal(path_str.clone(), None, &state).unwrap();

    // 2. Remove read permission so the conflict-check read will fail.
    let mut perms = std::fs::metadata(&file_path).unwrap().permissions();
    perms.set_mode(0o000);
    std::fs::set_permissions(&file_path, perms.clone()).unwrap();

    // 3. Attempt a write — file exists but is unreadable → conflict path.
    let result = write_text_file_internal(path_str.clone(), "new content".to_string(), &state);

    // Restore permissions before any assertions so temp cleanup works.
    perms.set_mode(0o644);
    std::fs::set_permissions(&file_path, perms).unwrap();

    assert!(result.is_ok(), "Expected Ok (conflict copy), got: {:?}", result.err());
    let response = result.unwrap();
    // The response path must differ — a new conflict copy was made.
    assert_ne!(
        response.path, path_str,
        "An unreadable file must trigger a conflict copy"
    );
    assert!(
        std::path::Path::new(&response.path).exists(),
        "Conflict copy must exist on disk"
    );
}
