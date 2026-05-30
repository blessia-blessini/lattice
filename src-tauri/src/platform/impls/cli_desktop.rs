// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// Shared CLI-arg helpers — included by windows.rs, linux.rs, and macos.rs.
//
// Defines two free functions that encapsulate CLI-arg-based file-association.
// Each platform file includes this file and calls these functions directly
// from its own `impl Platform for PlatformImpl` block.

// Shared per-path helper — opens one window per path.
// Used by cli_desktop_open_windows_on_startup (Windows/Linux) and directly
// by macos.rs's open_windows_on_startup (which has no empty-window fallback).
fn cli_desktop_open_file_paths(
    handle: &tauri::AppHandle,
    paths: Vec<String>,
    platform_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    for path in paths {
        log::info!("platform/{}: opening '{}'", platform_name, path);

        #[cfg(any(test, integration_test))]
        super::test_utils::maybe_sabotage_file(&path);

        super::build_window_with_file(handle, Some(path))
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    }
    Ok(())
}

// on macOS, open_windows_on_startup is implemented directly in macos.rs
// and does not delegate to this shared helper (to avoid the double-window bug).
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn cli_desktop_open_windows_on_startup(
    app: &mut tauri::App,
    platform_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    for (i, arg) in std::env::args().enumerate() {
        log::info!("ARG[{}]: {}", i, arg);
    }

    let paths = cli_args::collect_file_paths();
    let handle = app.handle().clone();

    if paths.is_empty() {
        log::info!(
            "platform/{}: no CLI file paths — opening empty editor window.",
            platform_name
        );
        super::build_window_with_file(&handle, None)
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    } else {
        cli_desktop_open_file_paths(&handle, paths, platform_name)?;
    }
    Ok(())
}

// on MAC this function is not used
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn cli_desktop_handle_run_event(_app: &tauri::AppHandle, _event: tauri::RunEvent) {
    // Intentionally empty — CLI-arg-based file-association needs no event handling.
}
