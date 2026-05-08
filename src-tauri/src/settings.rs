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

impl Default for Settings {
    fn default() -> Self {
        Settings {
            default_open_theme: default_theme(),
            word_wrap: default_word_wrap(),
            save_on_blur: default_save_on_blur(),
            daily_notes_path: "".to_string(),
            highlight_mark: default_highlight_mark(),
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
// load_settings
//**************************************************************
#[tauri::command]
pub fn load_settings(app: tauri::AppHandle, settings_path: String) -> Result<Settings, String> {
    let content = fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
    let settings: Settings = serde_json::from_str(&content).unwrap_or_default();

    let home_path_str = crate::calc_base_path(app)?;
    let home_path = Path::new(&home_path_str);

    match get_vault_root(&settings_path, Some(home_path)) {
        Ok(vault_root) => Ok(expand_daily_notes_path(settings, &vault_root)),
        Err(_) => Ok(settings),
    }
}
// load_settings END *******************************************

//**************************************************************
// save_settings
//**************************************************************
#[tauri::command]
pub fn save_settings(
    app: tauri::AppHandle,
    settings_path: String,
    settings: Settings,
) -> Result<(), String> {
    let home_path_str = crate::calc_base_path(app)?;
    let home_path = Path::new(&home_path_str);

    let mut final_settings = settings;
    if let Ok(vault_root) = get_vault_root(&settings_path, Some(home_path)) {
        final_settings = condense_daily_notes_path(final_settings, &vault_root);
    }

    let current_content = fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
    let current_json: serde_json::Value =
        serde_json::from_str(&current_content).unwrap_or(serde_json::json!({}));

    let formatted_json = merge_settings(&current_json, &final_settings)?;
    fs::write(&settings_path, formatted_json).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
