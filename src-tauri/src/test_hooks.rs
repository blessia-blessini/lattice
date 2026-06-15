// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Test-only hooks — compiled exclusively when `cfg(test)` is active.
//!
//! Included in `lib.rs` via:
//! ```
//! #[cfg(test)] mod test_hooks;
//! ```
//!
//! Nothing here is reachable by production callers or external consumers.
//! The compiler enforces this: the module does not exist outside test builds.
//!
//! # Pattern
//!
//! [`WindowOpener`] is the trait (the "declaration / interface").
//! [`RecordingOpener`] is a test double that records calls without touching the OS.
//! [`dispatch_startup`] is the pure logic extracted from `cli_desktop_open_windows_on_startup`,
//! injectable with any opener — real or mock.
//!
//! Production code is **not changed**; we test the logic in isolation.

use std::cell::RefCell;

// ─────────────────────────────────────────────────────────────────────────────
// WindowOpener — the interface (declaration)
// ─────────────────────────────────────────────────────────────────────────────
/// Open one editor window, optionally pre-loaded with a file.
///
/// Production never depends on this trait — it exists solely so tests can
/// inject a recorder instead of a real Tauri window.
pub(crate) trait WindowOpener {
    fn open(&self, path: Option<String>) -> Result<(), String>;
}

// ─────────────────────────────────────────────────────────────────────────────
// RecordingOpener — test double, no OS interaction
// ─────────────────────────────────────────────────────────────────────────────
/// Records every call to `open` without creating any real window.
/// No Tauri runtime or OS resources required.
pub(crate) struct RecordingOpener {
    pub calls: RefCell<Vec<Option<String>>>,
}

impl RecordingOpener {
    pub(crate) fn new() -> Self {
        Self { calls: RefCell::new(Vec::new()) }
    }
    pub(crate) fn call_count(&self) -> usize {
        self.calls.borrow().len()
    }
    pub(crate) fn call_at(&self, i: usize) -> Option<String> {
        self.calls.borrow()[i].clone()
    }
}

impl WindowOpener for RecordingOpener {
    fn open(&self, path: Option<String>) -> Result<(), String> {
        self.calls.borrow_mut().push(path);
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatch_startup — pure logic of cli_desktop_open_windows_on_startup
// ─────────────────────────────────────────────────────────────────────────────
/// Mirrors the dispatch logic of `cli_desktop_open_windows_on_startup`:
/// - zero paths  → open one empty window
/// - N paths     → open one window per path, abort on first error
///
/// Takes an opener so tests inject [`RecordingOpener`] instead of a real window.
/// Production code is unchanged — this function is test-only.
pub(crate) fn dispatch_startup(
    paths: Vec<String>,
    opener: &dyn WindowOpener,
) -> Result<(), String> {
    if paths.is_empty() {
        opener.open(None)?;
    } else {
        for path in paths {
            opener.open(Some(path))?;
        }
    }
    Ok(())
}
