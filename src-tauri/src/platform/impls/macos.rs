// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// macOS platform implementation — file-association via CLI args + Apple Events.
//
// open_windows_on_startup only opens windows for explicit CLI-arg paths.
// It deliberately does NOT open an empty fallback window: on macOS, files
// opened via double-click arrive as RunEvent::Opened (Apple Events), and
// plain launches (dock/Spotlight) are handled by RunEvent::Ready below.
//
// handle_run_event is macOS-specific: it handles NSOpenDocument Apple Events
// that Tauri surfaces as RunEvent::Opened { urls }, and creates an empty window
// on RunEvent::Ready when no windows exist yet.

// Shared CLI desktop helpers — macOS-specific open_windows_on_startup delegates
// to these, while other platforms use the shared CLI arg collection logic.
// This is one of the ways to mimic ("override only changed " static) inheritance 
// in Rust
include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/platform/impls/cli_desktop.rs"
));

use log::{error, info};
use tauri::Manager;

pub(super) struct PlatformImpl;

impl Platform for PlatformImpl {
    //**************************************************************************
    // open_windows_on_startup
    //**************************************************************************
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // On macOS, files opened via double-click / "Open With" are delivered as
        // RunEvent::Opened Apple Events — NOT as CLI arguments.  So we must NOT
        // open an empty fallback window here when there are no CLI args: the
        // file window will arrive via Opened, and the empty-window fallback is
        // handled by RunEvent::Ready (which checks webview_windows().is_empty()).
        //
        // Without this guard the sequence was:
        //   1. setup: no CLI args → empty window created  ← bug
        //   2. RunEvent::Opened fires → file window created on top
        // resulting in two windows every time a file was double-clicked.
        //
        // With this guard:
        //   • Double-click: setup does nothing; Opened fires → one file window.
        //   • CLI open (`lattice foo.md`): paths found → one file window.
        //   • Plain launch (dock/Spotlight): setup does nothing; Ready fires
        //     (no windows yet) → one empty window.
        let paths = cli_args::collect_file_paths();
        let handle = app.handle().clone();
        cli_desktop_open_file_paths(&handle, paths, "macos")?;
        // No fallback empty window here — see RunEvent::Ready below.
        Ok(())
    }
    // open_windows_on_startup END ***********************************************

    //**************************************************************************
    // handle_run_event
    //**************************************************************************
    /// Called for every `RunEvent` from the Tauri event loop.
    ///
    /// Handles `Opened` (file association) and `Ready` (empty-window fallback).
    /// All other events are explicitly ignored — not swallowed by a wildcard.
    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent) {
        match event {
            tauri::RunEvent::Opened { urls } => {
                for url in &urls {
                    match url.to_file_path() {
                        Ok(path) => {
                            let path_str = path.to_string_lossy().to_string();
                            info!("macOS Opened: opening '{}'", path_str);
                            if let Err(e) = super::build_window_with_file(app, Some(path_str)) {
                                error!("macOS Opened: window creation failed: {}", e);
                            }
                        }
                        Err(_) => {
                            // Silently skip non-file URLs (custom scheme, http, etc.)
                            info!("macOS Opened: non-file URL '{}', skipping", url);
                        }
                    }
                }
            }
            tauri::RunEvent::Ready => {
                // Launched via dock icon / Spotlight — no Opened event fires.
                // Also fires after double-click, but by then Opened has already
                // created the file window, so the is_empty() guard prevents a
                // second empty window.
                if app.webview_windows().is_empty() {
                    info!("macOS Ready: no windows; creating empty editor window.");
                    if let Err(e) = super::build_window_with_file(app, None) {
                        error!("macOS Ready: empty window creation failed: {}", e);
                    }
                }
            }
            // Every other RunEvent (ExitRequested, Exit, WindowEvent, …) is
            // intentionally not handled here — no wildcard swallow.
            _ => {}
        }
    }
    // handle_run_event END ******************************************************
}
