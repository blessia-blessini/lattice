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

use log::{debug, error, info};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, Window};

use base64::{Engine as _, engine::general_purpose};

const DEFAULT_SETTINGS: &str = r#"{}"#;
// Private Path variable of this module
// Private Path variable of this module
static M_PATH: Mutex<String> = Mutex::new(String::new());

pub mod e2e;
pub mod file_state;
pub mod settings;
mod table_format;
mod textcontent_hashing;
mod toc;

// Platform module — lib.rs has zero OS knowledge.
// Platform selection is handled by build.rs; see platform/mod.rs.
mod platform;

#[cfg(test)]
#[path = "test_fs_helpers.rs"]
pub mod test_fs_helpers;

// APP-wide state to hold watchers per window
struct WatcherState {
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
}

//******************************************************************************
// calc_base_path
//******************************************************************************
/// Returns the application's root storage path as a `String`.
/// Calculates the base path for the application.
///
/// On desktop platforms, this returns the user's home directory.
/// On mobile platforms, this returns the app's data directory.
/// The path is cached after the first successful calculation.
///
/// # Arguments
///
/// * `_app` - The Tauri `AppHandle`, used to resolve directories on mobile.
///
/// # Returns
///
/// A `Result` containing the path as a `String` if successful, or an error
/// message `String` if the path could not be resolved.
/// The first `String` is the path and the second `String` is the error message.
pub(crate) fn calc_base_path_internal<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<String, String> {
    // todo: mobile folder .. the root of the sandbox
    // the following is for desktop only
    #[cfg(desktop)]
    let home_dir = dirs::home_dir().ok_or("** Could not find user home directory".to_string())?;

    #[cfg(not(desktop))]
    let home_dir = _app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Lock the mutex to access the "private variable"
    let mut m_path = M_PATH.lock().map_err(|e| e.to_string())?;

    // If m_path is still "" set it to home_dir path
    if m_path.is_empty() {
        // this should set it once and for all
        *m_path = home_dir.to_string_lossy().to_string();
    }
    let l_path = m_path.clone();

    Ok(l_path)
}

/// Tauri command — exposes `calc_base_path_internal` to the frontend.
///
/// Thin shim that delegates to `calc_base_path_internal` with the real
/// Wry runtime.  The frontend calls this once on startup to learn the
/// root directory under which all user data is stored.
///
/// # Arguments
///
/// * `_app` - The Tauri `AppHandle`, forwarded to `calc_base_path_internal`.
///
/// # Returns
///
/// A `Result` containing the root path as a `String` on success, or an
/// error message `String` if the path could not be resolved.
#[tauri::command]
fn calc_base_path(_app: tauri::AppHandle) -> Result<String, String> {
    calc_base_path_internal(_app)
} // calc_base_path END *****************************************************

/// Opens a new Lattice editor window.
/// Optionally pre-loads a file using the Direct Push pattern.
///
/// If `path` is `Some`, the file is read immediately and its content is
/// injected into the new window via the `window.__LATTICE_INIT_DATA__`
/// JavaScript global so the renderer has the file content before the first
/// paint — no extra IPC round-trip after load.  If `path` is `None`, an
/// empty editor window is opened.  Each window receives a unique label from
/// `generate_new_window_label`.
///
/// # Arguments
///
/// * `app`  - The Tauri `AppHandle` used to build the new window.
/// * `path` - Optional file system path of the document to open.
///
/// # Returns
///
/// A `Result` containing `()` on success, or an error message `String` if
/// the file cannot be read or the window cannot be built.
#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    info!("open_new_window called. Path: {:?}", path);
    let label = generate_new_window_label();

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()));

    #[cfg(desktop)]
    {
        builder = configure_desktop_window(builder);
    }

    if let Some(p) = path {
        debug!("Processing Direct Push for: {}", p);

        let state: tauri::State<file_state::FileTrackerState> = app.state();

        // Use file_state internal logic to read and track the file
        // Pass the new window label so it is registered
        let response = file_state::read_text_file(p.clone(), state.clone(), Some(label.clone()))?;
        // file_state::read_text_file_internal(p.clone(), Some(label.clone()), tracker)?;

        let internal_content = response.content;
        let hash = response.hash;

        // Prepare the payload matching FileResponse struct
        let payload: serde_json::Value = json!({
            "content": internal_content,
            "hash": hash,
            "path": p // Frontend might want to know which file this is
        });

        // Inject as a global variable script
        // We use serde_json to safely escape the string for JS
        let script = format!("window.__LATTICE_INIT_DATA__ = {};", payload);

        builder = builder.initialization_script(&script);
        debug!("Direct Push script injected.");
    }

    builder.build().map_err(|e| {
        error!("Window build failed: {}", e);
        e.to_string()
    })?;

    info!("Window '{}' created successfully.", label);
    Ok(())
} // open_new_window END *****************************************************

//******************************************************************************
// generate_new_window_label
//******************************************************************************
/// Generates a process-unique label for a new Tauri editor window.
///
/// Labels follow the pattern `lattice-{N}-window` where `N` is a
/// monotonically increasing counter backed by a module-level `AtomicUsize`.
/// The counter is never reset within a process lifetime, so labels remain
/// unique even when windows are opened and closed repeatedly.  Tauri
/// requires all open window labels to be unique; this scheme satisfies that
/// without tracking freed labels.
///
/// # Returns
///
/// A `String` of the form `"lattice-{N}-window"`.
fn generate_new_window_label() -> String {
    use std::sync::atomic::{AtomicUsize, Ordering};
    // This static variable is initialized once and persists across function calls,
    // similar to a `static` variable in C/C++.
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("lattice-{}-window", count)
}
// generate_new_window_label END *******************************************

//******************************************************************************
// calculate_cascade_coordinates
//******************************************************************************
/// Pure calculation logic for window cascading tiling coordinates.
/// Given the count index, returns (x, y) coordinates representing logical pixels.
#[cfg(desktop)]
fn calculate_cascade_coordinates(count: usize) -> (f64, f64) {
    let index = count % 10;
    let x = 100.0 + 6.0 * (index as f64);
    let y = 100.0 + 3.0 * (index as f64);
    (x, y)
}

//******************************************************************************
// configure_desktop_window
//******************************************************************************
/// Configures title, size, and cascaded positioning for desktop windows.
/// Tiles each subsequent window 3 pixels lower and 6 pixels righter, wrapping
/// around back to the starting position after 10 windows have been created.
#[cfg(desktop)]
fn configure_desktop_window<R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'_, R, M>,
) -> tauri::WebviewWindowBuilder<'_, R, M> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static DESKTOP_WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(0);

    let count = DESKTOP_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let (x, y) = calculate_cascade_coordinates(count);

    builder
        .title(format!("lattice ({})", get_version_string()))
        .inner_size(800.0, 600.0)
        .position(x, y)
}

//******************************************************************************
// build_window_with_file
//******************************************************************************
/// Creates a new editor window and injects `path`'s content via Direct Push.
///
/// Shared by `setup_handler` (Windows/Linux startup via CLI args) and the
/// `RunEvent::Opened` callback (macOS file-association Apple Events). Also used
/// by `RunEvent::Ready` to create the initial empty window on macOS when no
/// file was opened. Attaches a `Destroyed` listener so `FileTrackerState` is
/// cleaned up when the window closes.
fn build_window_with_file(app: &tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let label = generate_new_window_label();

    let mut builder =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()));

    #[cfg(desktop)]
    {
        builder = configure_desktop_window(builder);
    }

    let path_str = path.clone().unwrap_or_default();
    let mut content = String::new();
    let mut hash = textcontent_hashing::compute_hash(&content);

    if !path_str.is_empty() {
        let state: tauri::State<file_state::FileTrackerState> = app.state();
        match file_state::read_text_file(path_str.clone(), state, Some(label.clone())) {
            Ok(response) => {
                content = response.content;
                hash = response.hash;
                info!(
                    "build_window_with_file: Direct Push injected for '{}'",
                    path_str
                );
            }
            Err(e) => {
                // Log but do not abort — a window with empty content is better
                // than no window at all when, e.g., a file was deleted after
                // the OS sent the open event.
                error!("build_window_with_file: cannot read '{}': {}", path_str, e);
            }
        }
    }

    let payload = json!({
        "content": content,
        "hash": hash,
        "path": path_str,
    });
    let script = format!("window.__LATTICE_INIT_DATA__ = {};", payload);
    builder = builder.initialization_script(&script);

    let window = builder.build().map_err(|e| {
        error!("build_window_with_file: window build failed: {}", e);
        e.to_string()
    })?;

    let app_clone = app.clone();
    let label_clone = label.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let state: tauri::State<file_state::FileTrackerState> = app_clone.state();
            file_state::cleanup_window_state(&label_clone, &state);
        }
    });

    info!("build_window_with_file: window '{}' created.", label);
    Ok(())
}
// build_window_with_file END **********************************************

// ─────────────────────────────────────────────────────────────────────────────
// Test-only modules (stripped from every production build)
// ─────────────────────────────────────────────────────────────────────────────
/// Trait + mock + pure dispatch logic.  Not visible to any external caller.
#[cfg(test)]
mod test_hooks;

/// Unit tests for the CLI startup dispatch path.
/// Inline via #[path] so they share this module's private scope.
#[cfg(test)]
#[path = "cli_desktop_tests.rs"]
mod cli_desktop_tests;

//******************************************************************************
// open_settings_window
//******************************************************************************
/// Opens the settings window, or focuses it if it is already open.
///
/// If a window with the label `"settings"` already exists, it is brought
/// to the foreground.  Otherwise a new 600 × 400 window is created on
/// desktop; on Windows it is parented to the calling window so it behaves
/// as a modal dialog.  The command emits `app:settings-opened` on creation
/// and registers a listener that emits `app:settings-closed` when the
/// window is destroyed, letting the frontend react to both lifecycle events.
///
/// # Arguments
///
/// * `app`     - The Tauri `AppHandle` used to create or locate the window.
/// * `_window` - The calling `WebviewWindow`, used as the parent on Windows.
///
/// # Returns
///
/// A `Result` containing `()` on success, or an error message `String` if
/// the window cannot be created or focused.
#[tauri::command]
async fn open_settings_window(
    app: tauri::AppHandle,
    _window: tauri::WebviewWindow,
) -> Result<(), String> {
    if let Some(_settings_window) = app.get_webview_window("settings") {
        #[cfg(desktop)]
        {
            _settings_window.set_focus().map_err(|e| e.to_string())?;
            _settings_window.show().map_err(|e| e.to_string())?;
        }
    } else {
        #[cfg(desktop)]
        let mut _builder = tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Settings")
        .inner_size(600.0, 400.0);

        #[cfg(not(desktop))]
        let mut _builder = tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        ); // no additional attributes for mobile

        #[cfg(target_family = "windows")]
        {
            // because on windows window can have a
            _builder = _builder.parent(&_window).map_err(|e| e.to_string())?;
        }

        let _settings_window = _builder.build().map_err(|e| e.to_string())?;

        let app_handle = app.clone();
        _settings_window.on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event {
                let _ = app_handle.emit("app:settings-closed", ());
            }
        });

        app.emit("app:settings-opened", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
} // open_settings_window END **********************************************

//******************************************************************************
// close_settings_window
//******************************************************************************
/// Closes and destroys the settings window if it is currently open.
///
/// On desktop, if no settings window is open the call is a no-op and
/// returns `Ok(())`.  On mobile the entire function body is compiled out
/// because settings are presented differently on those platforms.
///
/// # Arguments
///
/// * `_app` - The Tauri `AppHandle` used to locate the settings window.
///
/// # Returns
///
/// A `Result` containing `()` on success, or an error message `String` if
/// the window exists but cannot be destroyed.
#[tauri::command]
async fn close_settings_window(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(settings_window) = _app.get_webview_window("settings") {
        settings_window.destroy().map_err(|e| e.to_string())?;
    }

    Ok(())
} // close_settings_window END *********************************************

// read_text_file and write_text_file moved to file_state.rs

//******************************************************************************
// is_dir
//******************************************************************************
/// Returns whether `path` refers to an existing directory.
///
/// Non-existent paths and regular files both return `false`.  Exposed to
/// the frontend so the UI can distinguish files from folders without
/// issuing a separate metadata call.
///
/// # Arguments
///
/// * `path` - The file system path to test.
///
/// # Returns
///
/// `true` if `path` exists and is a directory, `false` otherwise.
#[tauri::command]
fn is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
} // is_dir END **********************************************************

//******************************************************************************
// find_vault_settings_file
//******************************************************************************
/// Tauri command — locates the vault `settings.json` for a given file path.
///
/// Resolves the home directory via `calc_base_path_internal`, then delegates
/// the full search to `find_vault_settings_file_internal`.  See that function
/// for the complete walk-up-and-fallback algorithm.
///
/// # Arguments
///
/// * `app`       - The Tauri `AppHandle` used to resolve the home directory.
/// * `file_path` - Path of any file or folder inside the vault to search from.
///
/// # Returns
///
/// A `Result` containing `Some(path)` with the absolute path to
/// `settings.json` on success, or an error message `String` if the home
/// directory cannot be determined or required files cannot be created.
#[tauri::command]
fn find_vault_settings_file(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<Option<String>, String> {
    // todo: mobile folder .. the root of the sandbox
    // the following is for desktop only

    let str_home_dir = calc_base_path(app)?;
    let home_dir = Path::new(&str_home_dir);

    // Log the path for debugging purposes on mobile
    info!("[INFO] User Root (~/AppDataDir): {:?}", home_dir);

    find_vault_settings_file_internal(file_path, home_dir)
}

/// Pure implementation of the vault-settings search.
/// Decoupled from the Tauri runtime so it can be unit-tested with any `home_dir`.
///
/// Starting from `file_path`, the function walks up the directory tree looking
/// for a `.lattice` directory.  When found, it ensures `settings.json` exists
/// inside it (writing `{}` if absent) and returns its path.  If no `.lattice`
/// ancestor is found, the function falls back to `home_dir/.lattice/settings.json`,
/// creating the directory and file as needed.
///
/// # Arguments
///
/// * `file_path` - Starting path for the upward search (file or directory).
/// * `home_dir`  - Fallback root used when no vault is found in the ancestry.
///
/// # Returns
///
/// A `Result` containing `Some(path)` with the absolute path to
/// `settings.json` on success, or an error message `String` if a required
/// directory or file cannot be created.
fn find_vault_settings_file_internal(
    file_path: String,
    home_dir: &Path,
) -> Result<Option<String>, String> {
    //find_vault_path
    let mut current = Path::new(&file_path);
    if current.is_file() {
        // do this only when param is a file, not a folder
        if let Some(parent) = current.parent() {
            current = parent;
        }
    }

    loop {
        let vault_dir = current.join(".lattice");
        if vault_dir.exists() && vault_dir.is_dir() {
            // found settings dir
            let settings_path = vault_dir.join("settings.json");
            if !settings_path.exists() {
                fs::write(&settings_path, DEFAULT_SETTINGS).map_err(|e| e.to_string())?;
            }
            return Ok(Some(settings_path.to_string_lossy().to_string()));
        }

        match current.parent() {
            Some(parent) => current = parent, //craw up the hierarchy
            None => break,
        }
    }

    // Fallback: Home directory
    let lattice_dir = home_dir.join(".lattice");
    let settings_path = lattice_dir.join("settings.json");

    if !settings_path.exists() {
        if !lattice_dir.exists() {
            fs::create_dir_all(&lattice_dir).map_err(|e| e.to_string())?;
        }
        fs::write(&settings_path, DEFAULT_SETTINGS).map_err(|e| e.to_string())?;
    }

    Ok(Some(settings_path.to_string_lossy().to_string()))
} // find_vault_settings_file END ******************************************

//******************************************************************************
// initialize_vault_settings
//******************************************************************************
/// Initialises a vault by creating a `.lattice` directory and `settings.json`.
/// Idempotent — safe to call on a vault that already exists.
///
/// If `file_path` is a regular file, `.lattice` is created alongside it in
/// the parent directory.  If it is a directory, `.lattice` is created inside
/// it.  An existing `settings.json` is never overwritten.  OS error 30
/// (read-only filesystem — common with some cloud-sync providers such as
/// Google Drive) is translated into a clear, user-facing error message.
///
/// # Arguments
///
/// * `file_path` - Path of the document or directory where the vault should
///   be initialised.
///
/// # Returns
///
/// A `Result` containing the absolute path to `settings.json` as a `String`
/// on success, or a human-readable error message `String` if the directory
/// cannot be created.
#[tauri::command]
fn initialize_vault_settings(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    const ERR_PREFIX: &str = "Cannot Initialize Vault: ";
    let parent = if path.is_file() {
        path.parent()
            .ok_or_else(|| format!("{}Cannot get parent directory", ERR_PREFIX))?
    } else {
        path
    };

    let vault_dir = parent.join(".lattice");
    fs::create_dir_all(&vault_dir).map_err(|e| {
        if let Some(30) = e.raw_os_error() {
            format!(
                "{}The file system is read-only. This happens with external cloud files (e.g. Google Drive).\
                 To use Vault features, please move the file to local device storage.",
                ERR_PREFIX
            )
        } else {
            format!("{}{}", ERR_PREFIX, e)
        }
    })?;

    let settings_path = vault_dir.join("settings.json");
    if !settings_path.exists() {
        fs::write(&settings_path, DEFAULT_SETTINGS).map_err(|e| format!("{}{}", ERR_PREFIX, e))?;
    }

    Ok(settings_path.to_string_lossy().to_string())
} // initialize_vault_settings END *****************************************

//******************************************************************************
// watch_file
//******************************************************************************
/// Registers a filesystem watcher on `path` for the given `window`.
/// Replaces any existing watcher registered for that window.
///
/// Uses the `notify` crate's recommended backend (inotify / FSEvents /
/// ReadDirectoryChangesW depending on the OS).  Each window may watch at
/// most one path at a time; re-calling this command for a window that
/// already has a watcher silently drops the previous one.  On `Modify`,
/// `Create`, or `Remove` events a `"file-changed"` event is broadcast on
/// the app handle, carrying the watched path as its payload.
///
/// # Arguments
///
/// * `app`    - The Tauri `AppHandle` used to emit events.
/// * `path`   - Absolute file system path to watch.
/// * `window` - The calling window; its label is used as the watcher key.
/// * `state`  - App-managed `WatcherState` holding the watcher registry.
///
/// # Returns
///
/// A `Result` containing `()` on success, or an error message `String` if
/// the watcher cannot be created or the path cannot be registered.
#[tauri::command]
fn watch_file(
    app: tauri::AppHandle,
    path: String,
    window: Window,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    println!(
        "DEBUG: watch_file called for path: {} on window: {}",
        path,
        window.label()
    );
    let path_clone = path.clone();
    let window_label = window.label().to_string();
    let app_handle = app.clone();

    let mut watchers = state.watchers.lock().unwrap();

    if watchers.contains_key(&window_label) {
        println!(
            "DEBUG: Removing existing watcher for window {}",
            window_label
        );
        watchers.remove(&window_label);
    }

    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            match res {
                Ok(event) => {
                    println!("DEBUG: Notify Event: {:?}", event);
                    match event.kind {
                        notify::EventKind::Modify(_)
                        | notify::EventKind::Create(_)
                        | notify::EventKind::Remove(_) => {
                            println!(
                                "DEBUG: Emitting file-changed to window '{}' for: {}",
                                window_label, path_clone
                            );
                            // Use emit_to for explicit targeting via main app handle
                            if let Err(e) = app_handle
                                .emit("file-changed", path_clone.clone())
                                .map_err(|e| e.to_string())
                            {
                                println!("DEBUG: Failed to emit event: {}", e);
                            } else {
                                println!("DEBUG: Emit success");
                            }
                        }
                        _ => {
                            println!("DEBUG: Ignored event kind: {:?}", event.kind);
                        }
                    }
                }
                Err(e) => println!("watch error: {:?}", e),
            }
        })
        .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    watchers.insert(window.label().to_string(), watcher);
    println!("DEBUG: Watcher inserted for window {}", window.label());
    Ok(())
}
// watch_file END **********************************************************

//******************************************************************************
// save_image
//******************************************************************************
/// Decodes a Base64 image and saves it beside the document at `file_path`.
/// Returns a Markdown-ready relative path to the saved image.
///
/// The image is written into a sibling directory named `{stem}_assets/`,
/// created on demand.  The filename is `img_{timestamp_ms}.png`, where the
/// timestamp ensures uniqueness without requiring a counter.  The returned
/// path uses forward slashes for Markdown compatibility regardless of the
/// host OS.
///
/// # Arguments
///
/// * `file_path`  - Absolute path to the document the image belongs to;
///   determines the parent directory and the assets-folder name.
/// * `image_data` - Raw Base64-encoded image bytes (no data-URL prefix).
///
/// # Returns
///
/// A `Result` containing the relative path to the saved image as a `String`
/// (e.g. `"doc_assets/img_1714000000000.png"`) on success, or an error
/// message `String` if the path is malformed, the Base64 is invalid, or
/// any I/O operation fails.
#[tauri::command]
fn save_image(file_path: String, image_data: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    let parent = path.parent().ok_or("Cannot_get_parent_directory")?;
    let stem = path
        .file_stem()
        .ok_or("Cannot_get_file_stem")?
        .to_string_lossy();

    // Create assets directory: [filename]_assets
    let assets_dir_name = format!("{}_assets", stem);
    let assets_dir = parent.join(&assets_dir_name);

    if !assets_dir.exists() {
        fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    }

    // Generate filename: img_[timestamp].png
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let image_filename = format!("img_{}.png", timestamp);
    let image_path = assets_dir.join(&image_filename);

    // Decode Base64
    let bytes = general_purpose::STANDARD
        .decode(image_data)
        .map_err(|e| e.to_string())?;

    // Write to file
    fs::write(&image_path, bytes).map_err(|e| e.to_string())?;

    // Return relative path: [filename]_assets/img_[timestamp].png
    // We use forward slashes for Markdown compatibility
    let relative_path = format!("{}/{}", assets_dir_name, image_filename);

    Ok(relative_path)
} // save_image END ********************************************************

//******************************************************************************
// debug_file_probe
//******************************************************************************
/// Probes a file path and returns a multi-line diagnostic report string.
/// Intended for developer diagnostics, not user-facing workflows.
///
/// The report records: whether the path is absolute, whether it exists, its
/// type (file/dir), byte length, permissions, and — for files up to 60 MB —
/// an attempt to decode the bytes as an image.  A successful decode logs the
/// colour format and dimensions; a failed decode logs the first four header
/// bytes in hexadecimal.  Files larger than 60 MB are skipped to prevent
/// memory and CPU exhaustion.
///
/// # Arguments
///
/// * `path` - The file system path to probe.
///
/// # Returns
///
/// A multi-line `String` containing the diagnostic report.  Never errors;
/// any I/O failures are recorded as lines inside the report itself.
#[tauri::command]
fn debug_file_probe(path: String) -> String {
    const MAX_MB: u64 = 60;

    let p = Path::new(&path);
    let mut log = format!("Probe for: '{}'\n", path);

    log.push_str(&format!("  - Is Absolute: {}\n", p.is_absolute()));
    log.push_str(&format!("  - Exists: {}\n", p.exists()));

    if p.exists() {
        log.push_str(&format!("  - Is File: {}\n", p.is_file()));
        match std::fs::metadata(p) {
            Ok(m) => {
                log.push_str(&format!("  - Len: {}\n", m.len()));
                log.push_str(&format!("  - Permissions: {:?}\n", m.permissions()));

                // SECURITY: Do not probe huge files to avoid DoS
                if m.len() > MAX_MB * 1024 * 1024 {
                    log.push_str(&format!(
                        "  - Security Block: File > {}MB. Skipping decode.\n",
                        MAX_MB
                    ));
                    return log;
                }
            }
            Err(e) => log.push_str(&format!("  - Metadata Error: {}\n", e)),
        }

        // Magic Byte Check -> Full Decode Check
        match std::fs::read(p) {
            Ok(bytes) => {
                match image::load_from_memory(&bytes) {
                    Ok(img) => {
                        log.push_str(&format!("  - Integrity: OK. Format: {:?}\n", img.color()));
                        log.push_str(&format!(
                            "  - Dimensions: {}x{}\n",
                            img.width(),
                            img.height()
                        ));
                    }
                    Err(e) => {
                        log.push_str(&format!("  - Integrity: FAILED. Decode Error: {}\n", e));
                        // Fallback to basic header check logging if decode fails
                        if bytes.len() >= 4 {
                            log.push_str(&format!("  - Header (Hex): {:02X?}\n", &bytes[0..4]));
                        }
                    }
                }
            }
            Err(e) => log.push_str(&format!("  - Read Error: {}\n", e)),
        }
    } else {
        // Try to identify parent existence
        if let Some(parent) = p.parent() {
            log.push_str(&format!(
                "  - Parent '{}' Exists: {}\n",
                parent.display(),
                parent.exists()
            ));
        }
    }
    log
} // debug_file_probe END **************************************************

//******************************************************************************
// read_file_base64
//******************************************************************************
/// Reads a file from disk and returns it as a Base64 data URL.
/// Bypasses the Tauri asset scope for arbitrary-path image loading.
///
/// The MIME type is derived from the file extension: `jpg`/`jpeg` →
/// `image/jpeg`, `gif` → `image/gif`, `svg` → `image/svg+xml`,
/// `webp` → `image/webp`, all other extensions → `image/png`.
/// The returned string is ready to use as an `<img src="...">` value
/// without any additional encoding.
///
/// # Arguments
///
/// * `path` - Absolute file system path of the image file to read.
///
/// # Returns
///
/// A `Result` containing the data URL as a `String` in the form
/// `"data:{mime};base64,{data}"` on success, or an error message `String`
/// if the file cannot be read.
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    // Read raw bytes using std::fs (Bypassing Tauri Scope)
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;

    // Encode to base64
    let b64 = general_purpose::STANDARD.encode(&bytes);

    // Determine mime type simply by extension (fallback to png)
    let path_obj = Path::new(&path);
    let ext = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let mime = match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "image/png",
    };

    Ok(format!("data:{};base64,{}", mime, b64))
} // read_file_base64 END **************************************************

//******************************************************************************
// get_launch_file
//******************************************************************************
/// Returns the file path supplied on the command line at launch, if any.
///
/// Reads `std::env::args()` and delegates to `parse_launch_args`.  The
/// frontend calls this once on startup to detect the file-association /
/// "open with" flow and pre-load the correct document.
///
/// # Returns
///
/// `Some(path)` with the first non-flag CLI argument, or `None` if the
/// application was launched without a file path.
#[tauri::command]
fn get_launch_file() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    parse_launch_args(args)
    /*
    // In production, args[0] is binary, args[1] is the file if associated or passed.
    // In dev, it might depend on how it's called, but typically same logic applies for `cargo tauri dev -- file`
    if args.len() > 1 {
        let potential_file = &args[1];
        // simple check to avoid flags
        if !potential_file.starts_with("-") {
            return Some(potential_file.clone());
        }
    }
    None
    */
} // get_launch_file END ***************************************************

//******************************************************************************
// parse_launch_args
//******************************************************************************
/// Extracts the first non-flag argument from an argument list.
/// Pure function — does not call `std::env::args()`, making it fully unit-testable.
///
/// `args[0]` is assumed to be the binary name and is always skipped.  The
/// first element at index ≥ 1 that does not start with `'-'` is returned as
/// the file path to open.
///
/// # Arguments
///
/// * `args` - Full argument vector, typically from `std::env::args().collect()`.
///
/// # Returns
///
/// `Some(path)` with the first non-flag argument, or `None` if every
/// argument is a flag or the vector contains only the binary name.
fn parse_launch_args(args: Vec<String>) -> Option<String> {
    if args.len() > 1 {
        let potential_file = &args[1];
        if !potential_file.starts_with("-") {
            return Some(potential_file.clone());
        }
    }
    None
}
// parse_launch_args END *******************************************************

//******************************************************************************
// trace_log
//******************************************************************************
/// Writes a trace message to stdout, prefixed with `DEBUG_TRACE:`.
///
/// Exposed as a Tauri command so the TypeScript frontend can emit messages
/// that appear in the same terminal stream as backend log output.  Useful
/// during development when the browser DevTools console and the native
/// process output need to be correlated.
///
/// # Arguments
///
/// * `msg` - The message string to print.
#[tauri::command]
fn trace_log(msg: String) {
    println!("DEBUG_TRACE: {}", msg);
} // trace_log END *************************************************************

//******************************************************************************
// exit_app
//******************************************************************************
/// Terminates the application with exit code 0.
///
/// Called by the frontend when the user selects "Quit" from the menu or
/// when the last window is closed on platforms where that action should
/// exit the process (Windows, Linux).
///
/// # Arguments
///
/// * `app` - The Tauri `AppHandle` used to call `exit(0)`.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
} // exit_app END *************************************************************

//******************************************************************************
// get_version_string
//******************************************************************************
/// Returns the application build version string.
///
/// The string is embedded at compile time via `include_str!` from
/// `$OUT_DIR/build_number.txt`, which is generated by `build.rs`.  No
/// runtime file access is required.  The frontend displays this value in
/// the window title bar and the "About" panel.
///
/// # Returns
///
/// A `String` containing the build version (e.g. `"0.2.31-abc1234"`).
#[tauri::command]
fn get_version_string() -> String {
    // This reads the file generated by build.rs at compile time
    // Equivalent to C's #include "file"
    const VERSION: &str = include_str!(concat!(env!("OUT_DIR"), "/build_number.txt"));
    VERSION.to_string()
} // get_version_string END ****************************************************

//******************************************************************************
// run
//******************************************************************************
/// Application entry point — configures and starts the Tauri runtime.
/// Does not return under normal operation.
///
/// Registers all plugins (log, opener, fs, dialog), app-managed state
/// (`WatcherState`, `FileTrackerState`), and the full set of Tauri command
/// handlers, then starts the event loop via `tauri::Builder::run`.  If the
/// runtime cannot start, the process panics with an error message.  On
/// mobile targets the function is annotated with
/// `#[tauri::mobile_entry_point]` so the platform's native launcher
/// (Android JNI / iOS UIApplicationMain) can call it directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // E2E binary registration mode.
    //
    // `cargo llvm-cov --no-report run --bin lattice --features e2e_test` is called once
    // from the build script solely to register this binary as a source-mapping object for
    // `cargo llvm-cov report` (without it, cli_desktop.rs / e2e.rs appear as 0% because
    // they are only compiled with --features e2e_test and not known to cargo-llvm-cov).
    //
    // The build script writes `e2e_register_only.txt` in src-tauri/ (the binary's cwd
    // during `cargo run`) before invoking cargo-llvm-cov.  Returning here exits the process
    // before Tauri ever starts, so the step takes <1 s instead of ~15 s.
    #[cfg(e2e_test)]
    if std::path::Path::new("e2e_register_only.txt").exists() {
        let _ = std::fs::remove_file("e2e_register_only.txt");
        return; // LLVM runtime writes profraw on process exit — binary IS registered
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| setup_handler(app))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        })
        .manage(file_state::FileTrackerState {
            files: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            calc_base_path,
            settings::load_settings,
            settings::save_settings,
            file_state::read_text_file,
            file_state::write_text_file,
            file_state::create_daily_note_file,
            file_state::close_file,
            open_new_window,
            open_settings_window,
            close_settings_window,
            find_vault_settings_file, //find_vault_path
            initialize_vault_settings,
            watch_file,
            is_dir,
            save_image,
            debug_file_probe,
            read_file_base64,
            get_launch_file,
            get_version_string,
            trace_log,
            exit_app,
            toc::update_toc,
            table_format::pad_tables
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            platform::handle_run_event(app_handle, event);
        });
} // run END *******************************************************************

//******************************************************************************
// setup_handler
//******************************************************************************
/// Tauri setup callback — runs once after the runtime initialises, before the event loop.
///
/// Collects non-flag CLI arguments (skipping `--color` injected by Cargo
/// during `cargo tauri dev`).  For each collected file path — or for a
/// single empty window when none are given — the function builds a
/// `WebviewWindow` and injects file content via the
/// `window.__LATTICE_INIT_DATA__` JavaScript global (Direct Push pattern),
/// so the renderer has the document before first paint.  A `Destroyed`
/// event listener is attached to each window so `file_state` can release
/// its per-window tracking state when the window closes.
///
/// # Arguments
///
/// * `app` - Mutable reference to the Tauri `App` provided by the Tauri
///   builder during setup.
///
/// # Returns
///
/// A `Result` containing `()` on success, or a boxed `Error` if a window
/// cannot be built, causing Tauri to abort startup.
fn setup_handler(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // E2E shutdown listener — compiled away in production builds.
    // Polls for `e2e_shutdown.txt` in the repo root every 500 ms.
    // When found: deletes the file, then calls app_handle.exit(0) —
    // the portable equivalent of WM_QUIT / NSApp terminate / GTK quit.
    if e2e::is_e2e_tst_build() {
        let handle = app.handle().clone();
        // Resolve repo root: when run from src-tauri/ step up one level.
        let cwd = std::env::current_dir().unwrap_or_default();
        let repo_root = if cwd.ends_with("src-tauri") {
            cwd.parent().unwrap_or(&cwd).to_path_buf()
        } else {
            cwd
        };
        std::thread::spawn(move || {
            let signal = repo_root.join("e2e_shutdown.txt");
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if signal.exists() {
                    let _ = std::fs::remove_file(&signal);
                    handle.exit(0);
                    break;
                }
            }
        });
    }

    platform::open_windows_on_startup(app)
} // setup_handler END *****************************************************

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;

//******************************************************************************
// test_utils module (Hidden in Production)
//******************************************************************************
#[cfg(any(test, integration_test))]
mod test_utils {
    #[allow(unused_imports)]
    use super::*;

    #[cfg(integration_test)]
    pub fn maybe_sabotage_file(fpath: &str) {
        let target_file = fpath.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            info!("[TEST] Sabotage Initiated ******************");
            // make this a cycle that repeats 30 times
            for _ in 0..30 {
                // trying each 2 seconds
                info!("[TEST] Internal Bad Actor error injection every 2 seconds for 1 minute...");
                std::thread::sleep(std::time::Duration::from_secs(2));

                if target_file == "NONE" {
                    info!("[TEST] No target file (NONE). Sabotage aborted.");
                    return;
                }

                info!("[TEST] Sabotaging file: {}", target_file);
                let current = std::fs::read_to_string(&target_file).unwrap_or_default();
                let new_content = format!("{}\n\n[TEST MODE CONFLICT TRIGGER]", current);
                if let Err(e) = std::fs::write(&target_file, new_content) {
                    error!("[TEST] Sabotage Failed: {}", e);
                } else {
                    info!("[TEST] Sabotage Complete!");
                }
            }
        });
    }

    #[cfg(not(integration_test))]
    pub fn maybe_sabotage_file(_fpath: &str) {
        // No-op in production
    }
}
// test_utils END **************************************************************
