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

//! The last vault the user worked in (Chapter VLT, IMPL-LTTCE-VLT-00002).
//!
//! A window opened without a document has nothing to walk up from, so it
//! would always land in the home vault. This module remembers the last *real*
//! vault — any vault other than the home vault — in one small JSON file, and
//! hands it back for such a window as long as it still exists.
//!
//! Pure logic over paths: the caller passes the state file's location
//! (`app_local_data_dir()/last-vault.json` in the app), so every rule here is
//! unit-tested on the host inside a `TempDir`.

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// File name of the state file inside the app's local data folder.
pub const LAST_VAULT_FILE: &str = "last-vault.json";

/// Makes every temporary file name unique within the process: all windows
/// share one process, so the process id alone is not enough.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);


//******************************************************************************
// LastVault
//******************************************************************************
/// On-disk shape of the state file.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LastVault {
    /// Absolute path of the vault's `.lattice/settings.json`.
    vault_settings_path: PathBuf,
}
// LastVault END ***************************************************************


//******************************************************************************
// is_vault_settings_file
//******************************************************************************
/// `true` for an absolute path to an existing `<dir>/.lattice/settings.json`.
///
/// The remembered path is later *written* to by Save in Settings, so a state
/// file edited by hand (or damaged) must never point anywhere else.
fn is_vault_settings_file(path: &Path) -> bool {
    path.is_absolute()
        && path.file_name().is_some_and(|n| n == "settings.json")
        && path
            .parent()
            .and_then(|p| p.file_name())
            .is_some_and(|n| n == ".lattice")
        && path.is_file()
}
// is_vault_settings_file END **************************************************


//******************************************************************************
// recall
//******************************************************************************
/// The remembered vault's `settings.json`, if one is remembered and it is
/// still a vault. Every reason for `None` other than "nothing remembered yet"
/// is logged, so a vanished vault leaves a trace (REQ-LTTCE-VLT-00003).
pub fn recall(state_file: &Path) -> Option<PathBuf> {
    let text = match fs::read_to_string(state_file) {
        Ok(t) => t,
        Err(_) => return None, // first run, or never left the home vault
    };
    let remembered: LastVault = match serde_json::from_str(&text) {
        Ok(r) => r,
        Err(e) => {
            warn!("vault: ignoring unreadable {}: {e}", state_file.display());
            return None;
        }
    };
    if is_vault_settings_file(&remembered.vault_settings_path) {
        Some(remembered.vault_settings_path)
    } else {
        warn!(
            "vault: remembered vault {} is gone or not a vault; using the home vault.",
            remembered.vault_settings_path.display()
        );
        None
    }
}
// recall END ******************************************************************


//******************************************************************************
// remember
//******************************************************************************
/// Store `settings_path` as the last vault, unless it is already stored.
///
/// Written to a temporary file first and renamed into place, so a crash or a
/// second window writing at the same moment can never leave half a file.
pub fn remember(state_file: &Path, settings_path: &Path) -> Result<(), String> {
    let entry = LastVault { vault_settings_path: settings_path.to_path_buf() };
    if let Ok(text) = fs::read_to_string(state_file)
        && serde_json::from_str::<LastVault>(&text).is_ok_and(|current| current == entry)
    {
        return Ok(()); // unchanged: no write
    }
    if let Some(dir) = state_file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?;
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = state_file.with_extension(format!("json.{}.{n}.tmp", std::process::id()));
    fs::write(&temp, json).map_err(|e| format!("cannot write {}: {e}", temp.display()))?;
    fs::rename(&temp, state_file).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("cannot replace {}: {e}", state_file.display())
    })
}
// remember END ****************************************************************


//******************************************************************************
// same_file
//******************************************************************************
/// `true` when both paths name the same file, however they are spelled —
/// drive-letter case, `..` detours, `\\?\` prefixes. Byte equality alone let a
/// differently spelled home vault count as "another vault".
fn same_file(a: &Path, b: &Path) -> bool {
    a == b
        || matches!(
            (fs::canonicalize(a), fs::canonicalize(b)),
            (Ok(x), Ok(y)) if x == y
        )
}
// same_file END ***************************************************************


//******************************************************************************
// choose_vault
//******************************************************************************
/// IMPL-LTTCE-VLT-00002 — the vault a lookup ends in, and the memory update.
///
/// * `document`      — what the lookup started from; empty = "no document".
/// * `found`         — the vault the walk-up found (`vault_path`): the nearest
///   vault above the document, or for "no document" the working directory's,
///   else `home_settings`.
/// * `home_settings` — the home vault's `settings.json`.
///
/// A lookup for "no document" that found only the home vault gets the
/// remembered vault instead, if it still exists (REQ-LTTCE-VLT-00002/-00003).
/// Whatever is chosen, a vault other than the home vault becomes the new
/// memory. Failing to remember is logged, never fatal: the lookup's answer
/// does not depend on it.
///
/// `found` is made absolute first: for "no document" the walk reports the
/// working directory's vault as the relative `.lattice/settings.json`, which
/// would be meaningless once remembered (and `recall` refuses it).
pub fn choose_vault(document: &str, found: &Path, home_settings: &Path, state_file: &Path) -> PathBuf {
    let found = std::path::absolute(found).unwrap_or_else(|_| found.to_path_buf());
    let found_is_home = same_file(&found, home_settings);
    let chosen = if document.is_empty() && found_is_home {
        match recall(state_file) {
            Some(remembered) => {
                info!("vault: no document; using the last vault {}", remembered.display());
                remembered
            }
            None => found,
        }
    } else {
        found
    };
    if !same_file(&chosen, home_settings)
        && let Err(e) = remember(state_file, &chosen)
    {
        warn!("vault: could not remember {}: {e}", chosen.display());
    }
    chosen
}
// choose_vault END ************************************************************


#[cfg(test)]
#[path = "last_vault_tests.rs"]
mod tests;
