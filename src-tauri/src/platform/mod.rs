// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Platform module — single entry point, zero `#[cfg(target_os)]` in source.
//!
//! # How platform selection works
//!
//! `build.rs` inspects `CARGO_CFG_TARGET_OS` at compile time and copies one
//! of the files from `src/platform/impls/` into `$OUT_DIR/platform_impl.rs`.
//! The `include!` below pastes that file into this module scope.
//!
//! ```text
//! lib.rs
//!   └── mod platform;          ← this file; zero OS knowledge in lib.rs
//!         └── include!(…/platform_impl.rs)   ← build.rs picks the right impl
//!
//! src/platform/impls/
//!   macos.rs     ← Apple Events (Opened / Ready)
//!   windows.rs   ← CLI arg association
//!   linux.rs     ← CLI arg association
//!   android.rs   ← stub (TODO: Intents)
//!   ios.rs       ← stub (TODO: Apple Events)
//! ```
//!
//! # Adding a new platform
//! 1. Create `src/platform/impls/<os>.rs` implementing `open_windows_on_startup`
//!    and `handle_run_event`.
//! 2. Add a match arm in `build.rs` (the one place that knows about OS names).
//! 3. No other file needs to change.
//!
//! # Shared helpers available to all implementations
//! All implementation files call `super::build_window_with_file(...)` and,
//! in test builds, `super::test_utils::maybe_sabotage_file(...)`.

// ── Sub-modules ──────────────────────────────────────────────────────────────
// cli_args is used by cli_desktop.rs (included by windows.rs and linux.rs).
pub(super) mod cli_args;

// ── Shared helpers available to all implementations ──────────────────────────
// Implementation files call `super::build_window_with_file(...)` which
// resolves directly to lib.rs (the parent of this module).
// In test builds, they also access `super::test_utils::...`.
// #[cfg(any(test, integration_test))]
// pub(crate) use super::test_utils;

// ── Contract: every platform must implement this trait ───────────────────────
// Defined here once. The include! below supplies the concrete type and impl.
pub(crate) trait Platform {
    /// Called once from `setup_handler` during Tauri startup.
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>>;

    /// Called for every `RunEvent` from the Tauri event loop.
    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent);
}

// ── Platform implementation — injected by build.rs ──────────────────────────
// build.rs writes the selected impl file to $OUT_DIR/platform_impl.rs.
// That file must define:
//   struct PlatformImpl;
//   impl Platform for PlatformImpl { … }
// Windows and Linux share impls/cli_desktop.rs; their platform files just
// set PLATFORM_NAME and include! that shared body.
// The compiler verifies the impl is complete against the trait above.
// include! pastes it here; only one OS's code is ever compiled.
include!(concat!(env!("OUT_DIR"), "/platform_impl.rs"));

// ── Public API — free functions that forward to the platform impl ─────────────
// lib.rs calls these directly.  The trait is enforced at compile time;
// callers never need to name PlatformImpl or import the Platform trait.

pub(crate) fn open_windows_on_startup(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    PlatformImpl.open_windows_on_startup(app)
}

pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    PlatformImpl.handle_run_event(app, event);
}
