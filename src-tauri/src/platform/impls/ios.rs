// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// iOS platform implementation stub — NOT YET IMPLEMENTED.
//
// iOS, like macOS, delivers file-open events via Apple Events
// (`RunEvent::Opened { urls }`). When iOS support is developed, this file
// should mirror `impls/macos.rs`.
//
// For now, startup creates a single empty window (Tauri mobile's default
// single-window model) and the event loop is a no-op.

use log::info;

const PLATFORM_NAME: &str = "ios";

pub(super) struct PlatformImpl;


impl Platform for PlatformImpl {

    //**************************************************************************
    // open_windows_on_startup
    //**************************************************************************
    /// Called from `setup_handler` during Tauri startup.
    ///
    /// Creates a single empty editor window.
    /// TODO: defer to `handle_run_event` once iOS file-association is
    /// implemented, following the same pattern as `impls/macos.rs`.
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>> {
        info!(
            "platform/{}: creating empty editor window (file-association not yet implemented).",
            PLATFORM_NAME
        );
        let handle = app.handle().clone();
        super::build_window_with_file(&handle, None)
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })
    }
    // open_windows_on_startup END ***********************************************


    //**************************************************************************
    // handle_run_event
    //**************************************************************************
    /// TODO: handle `RunEvent::Opened { urls }` once iOS file-association
    /// is implemented (same mechanism as macOS Apple Events).
    fn handle_run_event(&self, _app: &tauri::AppHandle, _event: tauri::RunEvent) {
        // Not yet implemented.
    }
    // handle_run_event END ******************************************************
}
