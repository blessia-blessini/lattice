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

//******************************************************************************
/// file_state module
/// Implements data structures and logic for tracking file state
/// and detecting line endings.
//******************************************************************************
use log::info;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::textcontent_hashing;

//******************************************************************************
/// Represents the desired line ending format for a file.
/// used when writing the file back to "disk"/SSD/HDD.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FileWishedFormat {
    /// Unix-style line endings (\n)
    NewLineLFLikeUnix,
    /// Windows-style line endings (\r\n)
    NewLineCRLFLikeWindows,
}

/// This is a private enum that is used to track the detected line endings in a file.
/// It INTENTIONALLY is **not** exposed to the outside world.
#[derive(Debug, Clone, Copy, PartialEq)]
enum DetectedLineEndings {
    /// ONLY LF detected and at least one LF line ending
    OnlyLF,
    /// ONLY CRLF detected and at least one CRLF line ending
    OnlyCRLF,
    /// MIXED detected and at least one of each detected
    Mixed,
    /// NO line endings detected at all - it was a "single line file"
    None,
}

pub struct FileTrackerState {
    pub files: Arc<Mutex<HashMap<String, FileState>>>,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct FileResponse {
    pub content: String,
    pub hash: String,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct WriteResponse {
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Clone)]
pub struct FileState {
    // pub path: String, This is the key in the map anyways
    pub last_hash: String,
    pub last_accessed: u128,     // Timestamp (millis)
    pub window_ids: Vec<String>, // MULTIPLE EDITORS MAY BE EDITING THE SAME FILE IN MEMORY
    pub wished_format: FileWishedFormat,
}

//******************************************************************************
/// Error message for file lock timeout. Defined here so it can be used in a gray test
#[rustfmt::skip]
macro_rules! ERR_FILE_LOCK_TIMEOUT { () => { "Could not acquire file-lock for " }; }

//******************************************************************************
/// Attempts to acquire a lock on the provided mutex with a timeout strategy.
///
/// It retries locking at fixed intervals until the timeout is reached.
/// This prevents the application from hanging indefinitely if a deadlock or
/// long-running operation holds the lock.
///
/// ## Arguments
/// * `mutex` - The `Arc<Mutex<...>>` to acquire.
///
/// ## Returns
/// * `Result<MutexGuard, String>` - The guard if successful, or an error message on timeout.
fn acquire_lock_with_timeout(
    mutex: &Arc<Mutex<HashMap<String, FileState>>>,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, FileState>>, String> {
    const FILE_LOCK_TIMEOUT_MS: u32 = 5000;
    const FILE_LOCK_SLEEP_MS: u32 = 25;

    let mut count_down: u32 = FILE_LOCK_TIMEOUT_MS / FILE_LOCK_SLEEP_MS;

    loop {
        if let Ok(guard) = mutex.try_lock() {
            return Ok(guard);
        }

        if count_down == 0 {
            const S_W: u32 = FILE_LOCK_TIMEOUT_MS / 1000;
            #[rustfmt::skip]
            return Err(format!( concat!(ERR_FILE_LOCK_TIMEOUT!(), "{} seconds"), S_W) );
        }
        count_down -= 1;
        std::thread::sleep(std::time::Duration::from_millis(FILE_LOCK_SLEEP_MS.into()));
    }
} // acquire_lock_with_timeout END *********************************************

//******************************************************************************
// to_internal
//******************************************************************************
/// **Background**:
///   internal "content" is always \n line endings
///   physical "content" is OS specific line endings
///   Reason: We want native tools to work with the files directly as they are
///      plain text files after all
/// This function:
///   - normalizes line endings to Internal format (\n unix line endings)
///   - ensures that the application always works with Unix-style line endings
///     internally,
///   - regardless of the underlying OS or file content.
///
fn to_internal(content: &str) -> String {
    content.replace("\r\n", "\n")
}
// to_internal END *************************************************************

//******************************************************************************
/// to_physical:
/// Converts Internal line endings (\n) to Physical format based on WishedFormat
///
fn to_physical(content: &str, format: FileWishedFormat) -> String {
    match format {
        FileWishedFormat::NewLineCRLFLikeWindows => content.replace("\n", "\r\n"),
        FileWishedFormat::NewLineLFLikeUnix => content.to_string(),
    }
}
// to_physical END *************************************************************

//******************************************************************************
/// read_text_file (Command)
///   
/// Reads a text file and returns its content and hash.
///
/// Use this command to load file content into the frontend. It automatically tracks the file
/// in the backend state, enabling optimistic concurrency control for future writes.
///
/// # Arguments
/// * `path` - The absolute path to the file.
/// * `state` - The application's `FileTrackerState`.
/// * `window_label` - Optional label of the window requesting the file (for tracking open files per window).
#[tauri::command]
pub fn read_text_file(
    path: String,
    state: tauri::State<FileTrackerState>,
    window_label: Option<String>,
) -> Result<FileResponse, String> {
    read_text_file_internal(path, window_label, &state)
}
// read_text_file END **********************************************************

//******************************************************************************
// read_text_file_internal (Helper)
//******************************************************************************
fn read_text_file_internal(
    path: String,
    window_label: Option<String>,
    state: &FileTrackerState,
) -> Result<FileResponse, String> {
    // Read "Physical" content from disk (OS specific line endings)
    let physical_content = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // Detect line endings
    let detected_lines = scan_content(&physical_content);

    // Determine wished format
    // Defaulting to OS preference for mixed/none.
    #[cfg(target_os = "windows")]
    let prefer_windows = true;
    #[cfg(not(target_os = "windows"))]
    let prefer_windows = false;

    let wished_format = determine_wished_format(detected_lines, prefer_windows);

    // Convert to "Internal" content (\n only) for the app
    let internal_content = to_internal(&physical_content);

    // Compute hash on the Physical content (External Hash)
    // This ensures that we track the file exactly as it is on disk (CRLF/LF)
    //    as oposed to internal content - because we are checking if another program
    //    has modified the file on disk.
    // aligning with write_text_file logic.
    let hash = textcontent_hashing::compute_hash(&physical_content);

    // Update File State
    let mut tracker = acquire_lock_with_timeout(&state.files)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();

    let labels = if let Some(lbl) = window_label.clone() {
        vec![lbl]
    } else {
        Vec::new()
    };

    // If it exists, we update it. If not, we create it.

    tracker
        .entry(path.clone())
        .and_modify(|s| {
            s.last_hash = hash.clone();
            s.last_accessed = timestamp;
            s.wished_format = wished_format;
            // Assuming fresh read overrides
            if let Some(lbl) = window_label.clone()
                && !s.window_ids.contains(&lbl)
            {
                s.window_ids.push(lbl);
            }
        })
        .or_insert(FileState {
            last_hash: hash.clone(),
            last_accessed: timestamp,
            window_ids: labels,
            wished_format,
        });

    Ok(FileResponse {
        content: internal_content,
        hash,
    })
} // read_text_file_internal END *******************************************

//******************************************************************************
// write_text_file
//******************************************************************************
/// Write text file to disk.
/// Looks if file is already internally registered in FileTrackerState.
/// If so, checks last known hash (of external content) and determines if file was updated since
/// last access (optimistic locking). If there is a conflict saves the file with a new name
///  (theats the file as a different from now on), otherwise (if file was not changed),
///  saves it (and updates the external hash)
///
/// ## Arguments
/// * `path` - The absolute path to the file.
/// * `content` - The new content to write (internal format: `\n` line endings).
/// * `state` - The application's `FileTrackerState`.
///
/// ## Returns
/// * `WriteResponse`: response containing status of write operation and new path of file and
///    'path of file' : caller can check if file name changed, which means file there was
///        optimistic locking conflict)
///    status: status of write operation
#[tauri::command]
pub fn write_text_file(
    path: String,
    content: String, // Received as Internal content (\n) from frontend
    state: tauri::State<FileTrackerState>,
) -> Result<WriteResponse, String> {
    write_text_file_internal(path, content, &state)
}
///
/// The worker function for write_text_file.
///
fn write_text_file_internal(
    path: String,
    content: String, // Received as Internal content (\n) from frontend
    state: &FileTrackerState,
) -> Result<WriteResponse, String> {
    let file_path = Path::new(&path);
    let mut tracker = acquire_lock_with_timeout(&state.files)?;

    #[cfg(target_os = "windows")]
    let mut wished_format = FileWishedFormat::NewLineCRLFLikeWindows;
    #[cfg(not(target_os = "windows"))]
    let mut wished_format = FileWishedFormat::NewLineLFLikeUnix;

    // Check if we have state for this file
    // We clone necessary data to avoid holding an immutable borrow on tracker
    // which would prevent us from passing &mut tracker to do_writefile later.
    let state_info = tracker
        .get(&path)
        .map(|fs_found| (fs_found.last_hash.clone(), fs_found.wished_format));

    if let Some((expected, format)) = state_info {
        wished_format = format;
        if file_path.exists() {
            if let Ok(physical_current) = fs::read_to_string(file_path) {
                // this layer compares external hashes
                let current_hash = textcontent_hashing::compute_hash(&physical_current);
                if current_hash != expected {
                    // Conflict! Resolve by creating a new file.
                    info!("[INFO] Resolving conflict for {:?}", file_path);
                    return do_writefile(file_path, &content, wished_format, &mut tracker, true);
                } else {
                    // file exists and no conflict
                    // will be handled without creating new name and path
                }
            } else {
                //file exists but cannot be read
                info!("[WARN] Hash conflict detected 2. Will save to new {}", path);
                return do_writefile(file_path, &content, wished_format, &mut tracker, true);
            }
        } else {
            //file does not exist
            if file_path.parent().is_none() {
                info!(
                    "[INFO] new file without explicit parent directory {}. Will not save",
                    path
                );
                return Err("Invalid file path or URL".to_string());
            } else {
                // file does not exist but has parent directory and seems "legit"
                // should be a new file
                // will be handled without creating new name and path
                info!("[INFO] new file {}", path);
            }
        }
    }

    do_writefile(file_path, &content, wished_format, &mut tracker, false)
} // write_text_file_internal END *******************************************

//******************************************************************************
// create_daily_note_file
//******************************************************************************
/// Creates an empty markdown file named YYYYMMDD-DDD.md based on current local time.
/// Returns the full physical path to the file.
#[tauri::command]
pub fn create_daily_note_file(daily_notes_path: String) -> Result<String, String> {
    use chrono::Local;

    let now = Local::now();
    let base_name = now.format("%Y%m%d-%a").to_string();

    let path = std::path::Path::new(&daily_notes_path);
    if !path.exists() {
        std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }

    let mut target_path = path.join(format!("{}.md", base_name));

    if target_path.exists() {
        if std::fs::read(&target_path).is_ok() {
            return Ok(target_path.to_string_lossy().to_string());
        }
    } else if std::fs::write(&target_path, "").is_ok() {
        return Ok(target_path.to_string_lossy().to_string());
    } else {
        // intentionally do nothing
    }

    let mut counter = 1;
    while counter < 100 {
        let suffix_name = format!("{}-{}.md", base_name, counter);
        target_path = path.join(&suffix_name);

        if target_path.exists() {
            if std::fs::read(&target_path).is_ok() {
                return Ok(target_path.to_string_lossy().to_string());
            }
        } else if std::fs::write(&target_path, "").is_ok() {
            return Ok(target_path.to_string_lossy().to_string());
        } else {
            // intentionally do nothing
        }

        counter += 1;
    }

    Err("Failed to create daily note file after 100 attempts.".to_string())
}
// create_daily_note_file END **************************************************

//******************************************************************************
// handle_conflict
//******************************************************************************
fn do_writefile(
    file_path: &Path,
    content: &str,
    p_wished_format: FileWishedFormat,
    tracker: &mut HashMap<String, FileState>,
    generate_new_name: bool,
) -> Result<WriteResponse, String> {
    // set initially equal to file_path
    let mut new_path = file_path.to_path_buf();
    if generate_new_name {
        // returning dot "." if no parent directory
        let parent = file_path.parent().unwrap_or(Path::new("."));
        let stem = file_path.file_stem().unwrap_or_default().to_string_lossy();
        let extension = file_path.extension().unwrap_or_default().to_string_lossy();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let new_filename = format!("{}-{}.{}", stem, timestamp, extension);
        new_path = parent.join(new_filename);
    }

    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    } else {
        return Err("[ERROR] Invalid file path or URL 2".to_string());
    }

    // Convert Internal -> Physical before writing the conflict copy
    let physical_content = to_physical(content, p_wished_format);
    fs::write(&new_path, &physical_content).map_err(|e| e.to_string())?;
    let new_hash = textcontent_hashing::compute_hash(&physical_content);

    // Update State
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();

    tracker
        .entry(file_path.to_string_lossy().to_string())
        .and_modify(|s| {
            s.last_hash = new_hash.clone();
            s.last_accessed = timestamp;
        })
        .or_insert(FileState {
            last_hash: new_hash.clone(),
            last_accessed: timestamp,
            window_ids: Vec::new(), // If saving a new file, we might not know the window yet unless passed... assuming logic elsewhere handles "open" or "save as" implies open.
            wished_format: p_wished_format,
        });

    Ok(WriteResponse {
        path: new_path.to_string_lossy().to_string(),
        hash: new_hash,
    })
}
// handle_conflict END *********************************************************

//******************************************************************************
// close_file
//******************************************************************************
/// Closes a file for a specific window, removing it from the tracking state if no other windows are using it.
///
/// This should be called when a tab or editor for a file is closed in the frontend.
///
/// # Arguments
/// * `path` - The absolute path of the file to close.
/// * `window_label` - The label of the window closing the file.
/// * `state` - The application's `FileTrackerState`.
#[tauri::command]
pub fn close_file(
    path: String,
    window_label: String,
    state: tauri::State<FileTrackerState>,
) -> Result<(), String> {
    close_file_internal(path, window_label, &state)
} // close_file END **********************************************************

/// Closes a file internal worker function
///    for a specific window, removing it from the tracking
///    state if no other windows are using it.
///
/// This should be called when a tab or editor for a file is closed in the frontend.
///
/// # Arguments
/// * `path` - The absolute path of the file to close.
/// * `window_label` - The label of the window closing the file.
/// * `state` - The application's `FileTrackerState`.
fn close_file_internal(
    path: String,
    window_label: String,
    state: &FileTrackerState,
) -> Result<(), String> {
    let mut tracker = acquire_lock_with_timeout(&state.files)?;

    let mut remove = false;
    if let Some(fs_state) = tracker.get_mut(&path) {
        fs_state.window_ids.retain(|w| w != &window_label);
        if fs_state.window_ids.is_empty() {
            remove = true;
        }
    }

    if remove {
        tracker.remove(&path);
        info!("Closed file, state removed: {}", path);
    }

    Ok(())
} // close_file_internal END ***************************************************

//******************************************************************************
// cleanup_window_state
//******************************************************************************
/// Cleans up file tracking state for a closed window.
///
/// Iterates through all tracked files and removes the given `window_label` from their tracking list.
/// If a file is no longer open in any window, it is removed from the tracker entirely.
///
/// # Arguments
/// * `window_label` - The label of the window that was closed.
/// * `state` - The application's `FileTrackerState`.
pub fn cleanup_window_state(window_label: &str, state: &FileTrackerState) {
    if let Ok(mut tracker) = acquire_lock_with_timeout(&state.files) {
        // create a list of paths to remove
        // initially empty
        let mut paths_to_remove = Vec::new();

        for (path, file_state) in tracker.iter_mut() {
            if let Some(pos) = file_state.window_ids.iter().position(|x| x == window_label) {
                file_state.window_ids.remove(pos);
                if file_state.window_ids.is_empty() {
                    paths_to_remove.push(path.clone());
                }
            }
        }

        for path in paths_to_remove {
            tracker.remove(&path);
            info!(
                "Window {} closed, file state removed: {}",
                window_label, path
            );
        }
    }
}
// cleanup_window_state END ****************************************************

//******************************************************************************
//******************************************************************************
/// scan_content
/// Optimized for single-pass O(N) detection
/// # Arguments
/// * `content` - The content to scan for line endings
/// # Returns
/// * `DetectedLineEndings` - The detected line endings
fn scan_content(content: &str) -> DetectedLineEndings {
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    let mut has_lf = false;
    let mut has_crlf = false;

    while i < len {
        if bytes[i] == b'\n' {
            if i > 0 && bytes[i - 1] == b'\r' {
                has_crlf = true;
            } else {
                has_lf = true;
            }

            // Early exit optimization: if we found both, it's Mixed.
            if has_lf && has_crlf {
                return DetectedLineEndings::Mixed;
            }
        }
        i += 1;
    }

    match (has_lf, has_crlf) {
        (true, true) => DetectedLineEndings::Mixed,
        (true, false) => DetectedLineEndings::OnlyLF,
        (false, true) => DetectedLineEndings::OnlyCRLF,
        (false, false) => DetectedLineEndings::None,
    }
}

//**************************************************************************
//**************************************************************************
/// determine_wished_format
///    calculate what will be the file format at the time of "writing the file"
/// This is currently done when we run on Windows, although it **may** change in the future, e.g. in case
/// we decide to make the _preferred CRLF format_ independent from the OS (a specific case is if
/// decide to add a user setting like "alwaysUseUnix format" or "alwaysUseWindows format".
///
///
/// # Arguments
/// * `detected` - the detected line endings
/// * `is_os_windows_format_preferred` - true if the _preferred CRLF format_ **is** `NewLineCRLFLikeWindows`.
///
/// # Returns
/// * `FileWishedFormat` - the wished format at the time of "writing the file"
fn determine_wished_format(
    detected: DetectedLineEndings,
    is_os_windows_format_preferred: bool,
) -> FileWishedFormat {
    match detected {
        DetectedLineEndings::OnlyLF => FileWishedFormat::NewLineLFLikeUnix,
        DetectedLineEndings::OnlyCRLF => FileWishedFormat::NewLineCRLFLikeWindows,
        DetectedLineEndings::Mixed | DetectedLineEndings::None => {
            if is_os_windows_format_preferred {
                FileWishedFormat::NewLineCRLFLikeWindows
            } else {
                FileWishedFormat::NewLineLFLikeUnix
            }
        }
    }
} // determine_wished_format END **********************************************

// Do not write product but only test code after this line ///////////////

// ****************************************************************************
/// Auto Tests Module: Consider moving to a separate file   
///
///         
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_content_pure_lf() {
        assert_eq!(scan_content("foo\nbar"), DetectedLineEndings::OnlyLF);
        assert_eq!(scan_content("foo\nbar\nbaz"), DetectedLineEndings::OnlyLF);
        assert_eq!(scan_content("\n"), DetectedLineEndings::OnlyLF);
    }

    #[test]
    fn test_scan_content_pure_crlf() {
        assert_eq!(scan_content("foo\r\nbar"), DetectedLineEndings::OnlyCRLF);
        assert_eq!(
            scan_content("foo\r\nbar\r\nbaz"),
            DetectedLineEndings::OnlyCRLF
        );
        assert_eq!(scan_content("\r\n"), DetectedLineEndings::OnlyCRLF);
    }

    #[test]
    fn test_scan_content_mixed() {
        assert_eq!(scan_content("a\nb\r\nc"), DetectedLineEndings::Mixed);
        assert_eq!(
            scan_content("Line1\r\nLine2\nLine3"),
            DetectedLineEndings::Mixed
        );
        // Edge case: LF followed immediately by CRLF
        assert_eq!(scan_content("\n\r\n"), DetectedLineEndings::Mixed);
    }

    #[test]
    fn test_scan_content_none() {
        assert_eq!(scan_content(""), DetectedLineEndings::None);
        assert_eq!(
            scan_content("No line endings here"),
            DetectedLineEndings::None
        );
    }

    #[test]
    fn test_decision_logic() {
        // None -> Default to OS
        assert_eq!(
            determine_wished_format(DetectedLineEndings::None, true),
            FileWishedFormat::NewLineCRLFLikeWindows
        );
        assert_eq!(
            determine_wished_format(DetectedLineEndings::None, false),
            FileWishedFormat::NewLineLFLikeUnix
        );

        // Mixed -> Default to OS
        assert_eq!(
            determine_wished_format(DetectedLineEndings::Mixed, true),
            FileWishedFormat::NewLineCRLFLikeWindows
        );
        assert_eq!(
            determine_wished_format(DetectedLineEndings::Mixed, false),
            FileWishedFormat::NewLineLFLikeUnix
        );

        // Pure Preserved
        assert_eq!(
            determine_wished_format(DetectedLineEndings::OnlyLF, true),
            FileWishedFormat::NewLineLFLikeUnix
        );
        assert_eq!(
            determine_wished_format(DetectedLineEndings::OnlyCRLF, false),
            FileWishedFormat::NewLineCRLFLikeWindows
        );
    }
}

//**************************************************************************
//**************************************************************************
/// Integration Tests Module with OS File System Primitives:
///    Creates and tests with the OS primitives for reading and wring ...
///    not on mobile OSes yet ....
#[cfg(test)]
mod integration_tests {
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
}
// test_write_text_file_conflict END **************************************

//**************************************************************************
//**************************************************************************
/// Wrapper API Boundary Tests Module
/// Tests the Tauri API boundary functions (which wrap the internal logic).
/// Uses a safe memory layout transmutation to bypass GUI limits in unit tests.
#[cfg(test)]
mod wrapper_tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // Helper macro to forge a tauri::State without spinning up a heavy GUI event loop.
    // Since `tauri::State<'_, T>` is a single-field transparent tuple struct wrapping a `&T`,
    // it shares the exact memory layout as the reference.
    fn forge_state<T: Send + Sync + 'static>(state: &T) -> tauri::State<'_, T> {
        let tauri_state: tauri::State<'_, T> = unsafe { std::mem::transmute(state) };
        tauri_state
    }

    #[test]
    fn test_wrapper_read_text_file() {
        let state = FileTrackerState {
            files: Arc::new(Mutex::new(HashMap::new())),
        };
        let tauri_state = forge_state(&state);

        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("wrapper_read.md");
        std::fs::write(&file_path, "wrapper_test").unwrap();

        let res = read_text_file(
            file_path.to_string_lossy().to_string(),
            tauri_state,
            Some("w1".to_string()),
        );
        assert!(res.is_ok());
    }

    #[test]
    fn test_wrapper_write_text_file() {
        let state = FileTrackerState {
            files: Arc::new(Mutex::new(HashMap::new())),
        };
        let tauri_state = forge_state(&state);

        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("wrapper_write.md");

        let res = write_text_file(
            file_path.to_string_lossy().to_string(),
            "wrapper_content".to_string(),
            tauri_state,
        );
        assert!(res.is_ok());
    }

    #[test]
    fn test_wrapper_close_file() {
        let state = FileTrackerState {
            files: Arc::new(Mutex::new(HashMap::new())),
        };
        {
            let mut tracker = state.files.lock().unwrap();
            tracker.insert(
                "wrapper_close.md".to_string(),
                FileState {
                    last_hash: "".to_string(),
                    last_accessed: 0,
                    window_ids: vec!["w1".to_string()],
                    wished_format: FileWishedFormat::NewLineLFLikeUnix,
                },
            );
        }

        let tauri_state = forge_state(&state);

        let res = close_file(
            "wrapper_close.md".to_string(),
            "w1".to_string(),
            tauri_state,
        );
        assert!(res.is_ok());

        assert!(state.files.lock().unwrap().is_empty());
    }
}
