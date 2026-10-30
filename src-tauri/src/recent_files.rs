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
//! answers, for one entry, whether it can be dropped:
//!
//! ```text
//!   exists, is a file                              → File         open it
//!   gone: not found while its drive / root exists  → Gone         drop it
//!         or now a folder
//!   anything else: drive or stick not connected,   → Unavailable  keep it
//!         no permission, a path without a root
//! ```
//!
//! Only "not found" counts as gone, and only when the drive or root the path
//! lives on exists: an unplugged stick or a disconnected network share also
//! reports "not found", and its entries must survive until it is back. The
//! OS error *text* is never looked at -- it is localised.

use serde::Serialize;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

//**************************************************************
// RecentFileState
//**************************************************************
/// What became of a recent-files entry (REQ-LTTCE-RCT-00002).
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecentFileState {
    /// An existing file: open it.
    File,
    /// Certainly gone: not found on a drive that exists, or now a folder.
    Gone,
    /// Cannot tell now (drive missing, no permission, no root): keep it.
    Unavailable,
}
// RecentFileState END *****************************************


//**************************************************************
// path_root
//**************************************************************
/// The drive or root a path lives on -- `C:\`, `\\server\share\`, `/` -- or
/// `None` for a path without one (relative, or a bare `C:file`).
fn path_root(path: &Path) -> Option<PathBuf> {
    let root: PathBuf = path
        .components()
        .take_while(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
        .collect();
    let has_root_dir = root.components().any(|c| matches!(c, Component::RootDir));
    has_root_dir.then_some(root)
}
// path_root END ***********************************************


//**************************************************************
// recent_file_state_of
//**************************************************************
/// IMPL-LTTCE-RCT-00001 — classifies one entry (see the module table).
pub fn recent_file_state_of(path: &Path) -> RecentFileState {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => RecentFileState::File,
        Ok(_) => RecentFileState::Gone,
        Err(e) if e.kind() == ErrorKind::NotFound => match path_root(path) {
            Some(root) if root.is_dir() => RecentFileState::Gone,
            _ => RecentFileState::Unavailable,
        },
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
