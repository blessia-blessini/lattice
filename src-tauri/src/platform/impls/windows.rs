// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// Windows platform implementation — file-association via CLI arguments.
//
// On Windows, double-clicking a `.md` file associated with Lattice causes the
// OS to launch the process with the file path as a plain CLI argument.
//
// Both trait methods delegate to the shared CLI helpers in cli_desktop.rs.

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/platform/impls/cli_desktop.rs"));

pub(super) struct PlatformImpl;

impl Platform for PlatformImpl {
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>> {
        cli_desktop_open_windows_on_startup(app, "windows")
    }

    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent) {
        cli_desktop_handle_run_event(app, event)
    }
}
