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

//! Recent files — is an "Open Recent" entry still there? (Chapter RCT)
//!
//! The list itself lives in the frontend (`localStorage`); this module only
//! answers, for one entry, what became of it:
//!
//! ```text
//!   exists, is a file                    → File         open it
//!   not found, or now a folder           → NotFound     ask the user whether to remove it
//!   any other error (no permission, an   → Unavailable  open as before, keep it
//!   invalid path)
//! ```
//!
//! "Not found" is never taken as proof that the file is gone: an unplugged
//! stick, an unmounted volume (`/Volumes/X`, `/media/<user>/X`) or a Windows
//! path over 260 characters report it too. So the user decides; nothing is
//! removed automatically. The OS error *text* is never looked at -- it is
//! localised.

use serde::Serialize;
use std::io::ErrorKind;
use std::path::Path;

//**************************************************************
// RecentFileState
//**************************************************************
/// What became of a recent-files entry (REQ-LTTCE-RCT-00002).
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecentFileState {
    /// An existing file: open it.
    File,
    /// Not found, or a folder now: ask whether to remove the entry.
    NotFound,
    /// Any other error: open as before, keep the entry.
    Unavailable,
}
// RecentFileState END *****************************************


//**************************************************************
// recent_file_state_of
//**************************************************************
/// IMPL-LTTCE-RCT-00001 — classifies one entry (see the module table). One
/// `metadata` call: an offline network share costs one timeout, not two.
pub fn recent_file_state_of(path: &Path) -> RecentFileState {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => RecentFileState::File,
        Ok(_) => RecentFileState::NotFound,
        Err(e) if e.kind() == ErrorKind::NotFound => RecentFileState::NotFound,
        Err(_) => RecentFileState::Unavailable,
    }
}
// recent_file_state_of END ************************************


//**************************************************************
// recent_file_state
//**************************************************************
/// Tauri command behind "Open Recent": the state of one entry.
#[tauri::command]
pub fn recent_file_state(path: String) -> RecentFileState {
    recent_file_state_of(Path::new(&path))
}
// recent_file_state END ***************************************


#[cfg(test)]
#[path = "recent_files_tests.rs"]
mod tests;
