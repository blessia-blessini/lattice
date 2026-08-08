use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

//**************************************************************
// Settings
//**************************************************************
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub default_open_theme: String,

    #[serde(default = "default_word_wrap")]
    pub word_wrap: bool,

    #[serde(default = "default_save_on_blur")]
    pub save_on_blur: bool,

    #[serde(default)]
    pub daily_notes_path: String,

    #[serde(default = "default_highlight_mark")]
    pub highlight_mark: bool,

    // IMPL-LTTCE-WSP-00004 — persisted "Show Whitespace" flag (default OFF)
    #[serde(default = "default_show_whitespace")]
    pub show_whitespace: bool,

    // IMPL-LTTCE-WSP-00008 — persisted tab display width in columns. Valid
    // range TAB_SIZE_MIN..=TAB_SIZE_MAX; clamped on load (defensive: the
    // settings file is user-editable JSON). The editor's indent unit is one
    // real tab character, so indent width always equals this value.
    #[serde(default = "default_tab_size")]
    pub tab_size: u32,

    #[serde(default = "default_block_external_images")]
    pub block_external_images: bool,

    #[serde(default = "default_mermaid_init")]
    pub default_mermaid_init: String,

    // IMPL-LTTCE-MRC-00003 — persisted "Copy Diagrams On Light Background"
    // flag (REQ-LTTCE-MRC-00005, default ON). When set, a diagram copied to
    // the clipboard is rendered light-on-white whatever theme the app is in,
    // because the documents people paste into are overwhelmingly white.
    #[serde(default = "default_copy_diagrams_light")]
    pub copy_diagrams_light: bool,
}

fn default_theme() -> String {
    "dark".to_string()
}
fn default_word_wrap() -> bool {
    false
}
fn default_save_on_blur() -> bool {
    true
}
fn default_highlight_mark() -> bool {
    true
}
fn default_show_whitespace() -> bool {
    false
}
/// Valid range for `tab_size` (shared by clamp-on-load and the Settings UI contract).
pub const TAB_SIZE_MIN: u32 = 2;
pub const TAB_SIZE_MAX: u32 = 8;
fn default_tab_size() -> u32 {
    2
}
fn default_block_external_images() -> bool {
    true
}
fn default_copy_diagrams_light() -> bool {
    true
}
fn default_mermaid_init() -> String {
    " {'theme': 'base', 'themeVariables': {\n  'signalColor':     '#1a1a1a',\n  'signalTextColor': '#1a1a1a',\n  'lineColor':       '#1a1a1a',\n  'actorLineColor':  '#1a1a1a',\n  'fontSize':        '16px'\n}}".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            default_open_theme: default_theme(),
            word_wrap: default_word_wrap(),
            save_on_blur: default_save_on_blur(),
            daily_notes_path: "".to_string(),
            highlight_mark: default_highlight_mark(),
            show_whitespace: default_show_whitespace(),
            tab_size: default_tab_size(),
            block_external_images: default_block_external_images(),
            default_mermaid_init: default_mermaid_init(),
            copy_diagrams_light: default_copy_diagrams_light(),
        }
    }
}
// Settings END ************************************************

//**************************************************************
// get_vault_root
//**************************************************************
pub fn get_vault_root(settings_path: &str, home_dir_req: Option<&Path>) -> Result<PathBuf, String> {
    let s_path = Path::new(settings_path);

    // Defensive safeguard to prevent unvalidated strings from being parsed
    if s_path.file_name().and_then(|n| n.to_str()) != Some("settings.json") {
        return Err("Invalid path: Must explicitly target 'settings.json'".into());
    }

    let lattice_dir = s_path.parent().ok_or("No parent dir for settings")?;

    if lattice_dir.file_name().and_then(|n| n.to_str()) != Some(".lattice") {
        return Err("Invalid path: Must be inside a '.lattice' hierarchy".into());
    }

    let vault_root = lattice_dir.parent().ok_or("No parent dir for .lattice")?;

    if let Some(home) = home_dir_req
        && vault_root == home
    {
        return Ok(home.join("lattice-notes"));
    }

    Ok(vault_root.to_path_buf())
}
// get_vault_root END ******************************************

//**************************************************************
// expand_daily_notes_path
//**************************************************************
pub fn expand_daily_notes_path(mut settings: Settings, vault_root: &Path) -> Settings {
    let vault_root_str = vault_root.to_string_lossy().to_string();

    if !settings.daily_notes_path.is_empty() {
        settings.daily_notes_path = settings
            .daily_notes_path
            .replace("{notesRoot}", &vault_root_str);
    } else {
        let sep = std::path::MAIN_SEPARATOR.to_string();
        settings.daily_notes_path = format!("{}{}daily", vault_root_str, sep);
    }
    settings
}
// expand_daily_notes_path END *********************************

//**************************************************************
// condense_daily_notes_path
//**************************************************************
pub fn condense_daily_notes_path(mut settings: Settings, vault_root: &Path) -> Settings {
    let vault_root_str = vault_root.to_string_lossy().to_string();
    if settings.daily_notes_path.starts_with(&vault_root_str) {
        settings.daily_notes_path = settings
            .daily_notes_path
            .replace(&vault_root_str, "{notesRoot}");
    }
    settings
}
// condense_daily_notes_path END *******************************

//**************************************************************
// merge_settings
//**************************************************************
pub fn merge_settings(
    current_json: &serde_json::Value,
    settings: &Settings,
) -> Result<String, String> {
    let mut current = current_json.clone();
    if let serde_json::Value::Object(ref mut map) = current {
        let new_json = serde_json::to_value(settings).map_err(|e| e.to_string())?;
        if let serde_json::Value::Object(new_map) = new_json {
            for (k, v) in new_map {
                map.insert(k, v);
            }
        }
    }
    serde_json::to_string_pretty(&current).map_err(|e| e.to_string())
}
// merge_settings END ******************************************

//**************************************************************
// parse_settings_lenient
//**************************************************************
/// Parse settings JSON with per-field graceful degradation
/// (IMPL-LTTCE-SET-00001).
///
/// Fast path: a whole-struct parse, byte-for-byte the previous behaviour.
/// On failure (settings.json is hand-editable — one field with the wrong
/// type, e.g. `"tabSize": 2e64` or `"wordWrap": "yes"`, used to reset
/// EVERY setting to its default), each top-level key is probed in
/// isolation: `{key: value}` must deserialize into `Settings` (whose
/// remaining fields fall back to their serde defaults). Offending keys are
/// dropped, the surviving keys are parsed once — so a single corrupt field
/// costs exactly that field, nothing else.
///
/// DRY note: this stays generic over the one derived schema — no field
/// name, type, or default is repeated here; new settings fields get this
/// protection automatically.
pub fn parse_settings_lenient(content: &str) -> Settings {
    if let Ok(settings) = serde_json::from_str::<Settings>(content) {
        return settings; // fast path — valid file, zero extra work
    }
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(content)
    else {
        // Not JSON at all, or not an object — nothing salvageable.
        return Settings::default();
    };
    let mut clean = serde_json::Map::new();
    for (key, value) in map {
        let probe = serde_json::Value::Object(std::iter::once((key.clone(), value.clone())).collect());
        if serde_json::from_value::<Settings>(probe).is_ok() {
            clean.insert(key, value);
        }
    }
    serde_json::from_value(serde_json::Value::Object(clean)).unwrap_or_default()
}
// parse_settings_lenient END **********************************

//**************************************************************
// load_settings_internal  (pure — no AppHandle)
//**************************************************************
pub fn load_settings_internal(settings_path: &str, home_path: &Path) -> Result<Settings, String> {
    let content = fs::read_to_string(settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut settings = parse_settings_lenient(&content);

    // Defensive clamp (IMPL-LTTCE-WSP-00008): settings.json is hand-editable,
    // so an out-of-range tabSize must not reach the editor. Keep in sync with
    // the frontend counterpart in src/lib/tab-size.ts (documented pairing —
    // the two codebases cannot share one constant without codegen).
    settings.tab_size = settings.tab_size.clamp(TAB_SIZE_MIN, TAB_SIZE_MAX);

    match get_vault_root(settings_path, Some(home_path)) {
        Ok(vault_root) => Ok(expand_daily_notes_path(settings, &vault_root)),
        Err(_) => Ok(settings),
    }
}
// load_settings_internal END **********************************

//**************************************************************
// load_settings
//**************************************************************
#[tauri::command]
pub fn load_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings_path: String,
) -> Result<Settings, String> {
    let home_path_str = crate::calc_base_path_internal(app)?;
    let home_path_owned = PathBuf::from(&home_path_str);
    load_settings_internal(&settings_path, &home_path_owned)
}
// load_settings END *******************************************

//**************************************************************
// save_settings_internal  (pure — no AppHandle)
//**************************************************************
pub fn save_settings_internal(
    settings_path: &str,
    settings: Settings,
    home_path: &Path,
) -> Result<(), String> {
    // IMPL-LTTCE-SET-00002 — write-side gate (REQ-LTTCE-SET-00002).
    // (1) Path gate: refuse to write anywhere except a `.lattice/settings.json`
    //     (the same shape check the vault-root derivation uses). Tauri
    //     commands are reachable from the WebView, so without this gate a
    //     compromised frontend could turn save_settings into an
    //     arbitrary-path file write.
    let vault_root = get_vault_root(settings_path, Some(home_path))
        .map_err(|e| format!("Refusing to save settings: {}", e))?;

    // (2) Value gate: clamp numeric fields before persisting, so the file on
    //     disk never holds out-of-range values (the loader clamps too —
    //     belt and braces, both sides use the same constants).
    let mut final_settings = settings;
    final_settings.tab_size = final_settings.tab_size.clamp(TAB_SIZE_MIN, TAB_SIZE_MAX);

    final_settings = condense_daily_notes_path(final_settings, &vault_root);

    let current_content = fs::read_to_string(settings_path).unwrap_or_else(|_| "{}".to_string());
    let current_json: serde_json::Value =
        serde_json::from_str(&current_content).unwrap_or(serde_json::json!({}));

    let formatted_json = merge_settings(&current_json, &final_settings)?;
    fs::write(settings_path, formatted_json).map_err(|e| e.to_string())?;

    Ok(())
}
// save_settings_internal END **********************************

//**************************************************************
// save_settings
//**************************************************************
#[tauri::command]
pub fn save_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings_path: String,
    settings: Settings,
) -> Result<(), String> {
    let home_path_str = crate::calc_base_path_internal(app)?;
    let home_path_owned = PathBuf::from(&home_path_str);
    save_settings_internal(&settings_path, settings, &home_path_owned)
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
