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

mod file_state;
mod textcontent_hashing;
mod settings;
mod toc;
mod table_format;

// APP-wide state to hold watchers per window
struct WatcherState {
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
}

//******************************************************************************
// calc_base_path
//******************************************************************************
pub(crate) fn calc_base_path_internal(_app: tauri::AppHandle) -> Result<String, String> {
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

#[tauri::command]
fn calc_base_path(_app: tauri::AppHandle) -> Result<String, String> {
    calc_base_path_internal(_app)
}
// calc_base_path END *****************************************************

//******************************************************************************
// get_base_path
//******************************************************************************
// /// a simple getter from the private variable M_PATH
// /// Returns None if the path has not been initialized yet.
// fn get_base_path() -> Option<String> {
//    let m_path = M_PATH.lock().unwrap();
//    if m_path.is_empty() {
//        None
//    } else {
//        Some(m_path.clone())
//    }
// }
// get_base_path END ***********************************************************

//******************************************************************************
// open_new_window
//******************************************************************************
#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    info!("open_new_window called. Path: {:?}", path);
    let label = generate_new_window_label();

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()));

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
}
// open_new_window END *****************************************************

//******************************************************************************
// generate_new_window_label
//******************************************************************************
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
/// open_settings_window
//******************************************************************************
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
/// is_dir
//******************************************************************************
#[tauri::command]
fn is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
} // is_dir END **********************************************************

///  Find the path to the vault settings file or the vault directory .lattice
///  if not found returns OK(None)
///  otherwise returns Ok(jsonfilepath) if it exists
///  otherwise if it does not exists returns .lattice directory path
///
//******************************************************************************
/// find_vault_settings_file
//******************************************************************************
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

/////////////////////////////////////////////////////////////////
/// initialize_vault_settings:
///   Initialize a vault by placing a .lattice directory
///      in the parent directory of the file path
///      and a settings.json file in the .lattice directory
///   ON success returns the path to the settings.json file path
///   ON failure returns an error message
///
//******************************************************************************
// initialize_vault_settings
//******************************************************************************
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
/// watch_file
//******************************************************************************
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
/// save_image
//******************************************************************************
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
/// debug_file_probe
//******************************************************************************
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
/// read_file_base64
//******************************************************************************
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
/// get_launch_file
//******************************************************************************
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
#[tauri::command]
fn trace_log(msg: String) {
    println!("DEBUG_TRACE: {}", msg);
} // trace_log END *************************************************************

//******************************************************************************
// exit_app
//******************************************************************************
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
} // exit_app END *************************************************************

//******************************************************************************
// get_version_string
//******************************************************************************
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
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
} // run END *******************************************************************

//******************************************************************************
// setup_handler
//******************************************************************************
fn setup_handler(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Logic for File Association (Desktop)
    // Collect all non-flag arguments as file paths
    #[cfg(desktop)]
    let mut file_paths: Vec<String> = Vec::new();
    #[cfg(not(desktop))]
    let file_paths: Vec<String> = Vec::new();

    #[cfg(desktop)]
    {
        use std::env;
        let args: Vec<String> = env::args().collect();
        let mut i = 1;
        while i < args.len() {
            let arg = &args[i];
            if arg == "--color" {
                i += 2; // Skip flag and value (e.g. "always")
                continue;
            }
            if !arg.starts_with('-') {
                file_paths.push(arg.clone());
            }
            i += 1;
        }
    }

    // Determine what to open: list of Some(path) or just [None] if empty
    let windows_to_open: Vec<String> = if file_paths.is_empty() {
        vec!["".to_string()]
    } else {
        file_paths
    };

    for fpath in windows_to_open {
        // 2. Prepare Window Config
        let label = generate_new_window_label();
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App("index.html".into()),
        );

        #[cfg(desktop)]
        {
            builder = builder.title(format!("lattice ({})", get_version_string()));
            builder = builder.inner_size(800.0, 600.0);
        }

        // 3. Direct Push Injection
        let filepath_found_oncli = !fpath.is_empty();
        info!(
            "setup: Found CLI file path: {}",
            if filepath_found_oncli {
                fpath.as_str()
            } else {
                "NONE"
            }
        );

        // DEBUG: Print all args to debug CLI passing
        #[cfg(debug_assertions)]
        for (i, arg) in std::env::args().enumerate() {
            info!("ARG[{}]: {}", i, arg);
        }

        // Error injection for testing
        //   it is empty in production
        test_utils::maybe_sabotage_file(&fpath);

        let mut content = "".to_string();
        // This will work even for an empty file
        let mut hash = textcontent_hashing::compute_hash(&content);

        if !filepath_found_oncli {
            info!("setup: No CLI file path found, content will be empty as expected");
        } else {
            let fp = fpath.clone();
            let state: tauri::State<file_state::FileTrackerState> = app.state();

            match file_state::read_text_file(fp, state, Some(label.clone())) {
                Ok(response) => {
                    content = response.content;
                    hash = response.hash;

                    info!("setup: Injected Direct Push content for window {}", label);
                }
                Err(e) => {
                    error!("setup: Failed to read file at {}: {}", fpath, e);
                }
            }
        }

        let payload: serde_json::Value = json!({
           "content": content,
           "hash": hash,
           "path": fpath
        });

        let script = format!("window.__LATTICE_INIT_DATA__ = {};", payload);
        builder = builder.initialization_script(&script);
        // 4. Create the Window
        let window = builder.build().map_err(|e| e.to_string())?;
        info!("setup: Window '{}' created .", label);

        // 5. Attach Close Listener for File State Cleanup
        let app_handle = app.handle().clone();
        let label_clone = label.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: tauri::State<file_state::FileTrackerState> = app_handle.state();
                // Call cleanup
                file_state::cleanup_window_state(&label_clone, &state);
            }
        });
    } //for fpath END

    Ok(())
} // setup_handler END *****************************************************


#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;

//******************************************************************************
// test_utils module (Hidden in Production)
//******************************************************************************
mod test_utils {
    #[allow(unused_imports)]
    use super::*;

    #[cfg(integration_test)]
    pub fn maybe_sabotage_file(fpath: &str) {
        let target_file = fpath.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            info!("[TEST] Sabotage Initiated");
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
