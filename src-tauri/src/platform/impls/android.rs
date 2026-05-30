// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// Android platform implementation stub — NOT YET IMPLEMENTED.
//
// On Android, files are opened via Android Intents (`ACTION_VIEW`).
// For now, startup creates a single empty window (Tauri mobile's default
// single-window model) and the event loop is a no-op.

use log::info;

const PLATFORM_NAME: &str = "android";

pub(super) struct PlatformImpl;


impl Platform for PlatformImpl {

    //**************************************************************************
    // open_windows_on_startup
    //**************************************************************************
    /// Called from `setup_handler` during Tauri startup.
    ///
    /// Creates a single empty editor window.
    /// TODO: handle the incoming Intent URI once Android file-association
    /// is implemented via the Tauri Android plugin API.
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
    /// TODO: handle Android Intent file-open events once the Tauri Android
    /// plugin API for file associations is available.
    fn handle_run_event(&self, _app: &tauri::AppHandle, _event: tauri::RunEvent) {
        // Not yet implemented.
    }
    // handle_run_event END ******************************************************
}
