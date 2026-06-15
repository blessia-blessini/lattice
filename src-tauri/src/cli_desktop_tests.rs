// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Unit tests for the CLI startup dispatch logic (`cli_desktop.rs`).
//!
//! Included inline via `#[path]` in `lib.rs`:
//! ```
//! #[cfg(test)] #[path = "cli_desktop_tests.rs"] mod cli_desktop_tests;
//! ```
//!
//! Runs under `cargo test --lib` — same compilation unit as the library,
//! so it sees private items through `crate::test_hooks`.
//! No Tauri runtime or OS resources required.

use crate::test_hooks::{RecordingOpener, WindowOpener, dispatch_startup};

// ─────────────────────────────────────────────────────────────────────────────
// Zero paths → one empty-window call
// ─────────────────────────────────────────────────────────────────────────────
/// cli_desktop_open_windows_on_startup with no CLI args must open exactly one
/// empty editor window (path = None).
#[test]
fn test_startup_no_paths_opens_one_empty_window() {
    let opener = RecordingOpener::new();
    dispatch_startup(vec![], &opener).unwrap();
    assert_eq!(opener.call_count(), 1);
    assert_eq!(opener.call_at(0), None, "empty startup must pass None");
}

// ─────────────────────────────────────────────────────────────────────────────
// One path → one window with that path
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_startup_one_path_opens_one_window() {
    let opener = RecordingOpener::new();
    dispatch_startup(vec!["/tmp/notes.md".into()], &opener).unwrap();
    assert_eq!(opener.call_count(), 1);
    assert_eq!(opener.call_at(0), Some("/tmp/notes.md".into()));
}

// ─────────────────────────────────────────────────────────────────────────────
// N paths → N windows, correct order
// ─────────────────────────────────────────────────────────────────────────────
/// cli_desktop_open_file_paths loops paths in order; each must open independently.
#[test]
fn test_startup_multiple_paths_open_in_order() {
    let paths = vec!["/a.md".into(), "/b.md".into(), "/c.md".into()];
    let opener = RecordingOpener::new();
    dispatch_startup(paths, &opener).unwrap();
    assert_eq!(opener.call_count(), 3);
    assert_eq!(opener.call_at(0), Some("/a.md".into()));
    assert_eq!(opener.call_at(1), Some("/b.md".into()));
    assert_eq!(opener.call_at(2), Some("/c.md".into()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Error on first bad path aborts the loop
// ─────────────────────────────────────────────────────────────────────────────
/// cli_desktop_open_file_paths uses `?` — first Err aborts; remaining paths
/// are not opened.
#[test]
fn test_startup_error_aborts_remaining_paths() {
    struct FailOnSecond { count: RefCell<usize> }
    use std::cell::RefCell;
    impl WindowOpener for FailOnSecond {
        fn open(&self, _: Option<String>) -> Result<(), String> {
            let n = *self.count.borrow();
            *self.count.borrow_mut() = n + 1;
            if n >= 1 { Err("window build failed".into()) } else { Ok(()) }
        }
    }
    let opener = FailOnSecond { count: RefCell::new(0) };
    let result = dispatch_startup(
        vec!["/a.md".into(), "/b.md".into(), "/c.md".into()],
        &opener,
    );
    assert!(result.is_err());
    assert_eq!(*opener.count.borrow(), 2, "must stop after the second call");
}
