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

//! Third-party licence notices in the app (Chapter FOS, IMPL-LTTCE-FOS-00003).
//!
//! Every installer carries `THIRD-PARTY-NOTICES.md` and `LICENSE` as bundled
//! resources (`tauri.conf.json` → `bundle.resources`, IMPL-LTTCE-FOS-00001).
//! This module opens the notices in an editor window, read-only, and keeps
//! the installed copies from being overwritten: an NSIS per-user install puts
//! the resource folder somewhere the user can write.
//!
//! The path rules are pure functions over `Path`s, unit-tested on the host in
//! a `TempDir`; only `open_licences_window` touches Tauri.

use log::{info, warn};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// File name of the generated notices, at the root of the resource folder.
pub const NOTICES_FILE: &str = "THIRD-PARTY-NOTICES.md";


//******************************************************************************
// canonical_or_lexical
//******************************************************************************
/// The canonical form of the nearest existing ancestor of `path`, with the
/// components that do not exist yet (a save may create them) appended and
/// their `.` / `..` resolved lexically. Canonical forms make `C:\A\..\B`,
/// `c:\b` and `\\?\C:\B` compare equal on Windows; comparing a canonical
/// folder against a plain spelling of a new file would never match.
fn canonical_or_lexical(path: &Path) -> PathBuf {
    let mut missing: Vec<std::path::Component> = Vec::new();
    let mut current = path;
    loop {
        if let Ok(mut resolved) = current.canonicalize() {
            for component in missing.iter().rev() {
                match component {
                    std::path::Component::ParentDir => {
                        resolved.pop();
                    }
                    std::path::Component::CurDir => {}
                    other => resolved.push(other.as_os_str()),
                }
            }
            return resolved;
        }
        match (current.parent(), current.components().next_back()) {
            (Some(parent), Some(last)) => {
                missing.push(last);
                current = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
} // canonical_or_lexical END **************************************************


//******************************************************************************
// is_inside
//******************************************************************************
/// `true` when `path` is `dir` itself or lies anywhere below it.
pub(crate) fn is_inside(path: &Path, dir: &Path) -> bool {
    canonical_or_lexical(path).starts_with(canonical_or_lexical(dir))
} // is_inside END *************************************************************


//******************************************************************************
// refuse_write_into_resources
//******************************************************************************
/// IMPL-LTTCE-FOS-00003 — the save guard. Errs for a target inside the
/// app's resource folder; passes everything else, and passes when the
/// resource folder is unknown (`None`: nothing installed to protect).
pub(crate) fn refuse_write_into_resources(target: &str, resource_dir: Option<&Path>) -> Result<(), String> {
    match resource_dir {
        Some(dir) if is_inside(Path::new(target), dir) => {
            warn!("Refused to write into the installed resources: {}", target);
            Err(format!(
                "{} belongs to the installed application and cannot be changed. Use Save As to keep your own copy.",
                target
            ))
        }
        _ => Ok(()),
    }
} // refuse_write_into_resources END *******************************************


//******************************************************************************
// notices_path
//******************************************************************************
/// The bundled notices inside `resource_dir`, or an error saying the build
/// was packaged without them (never silently an empty window).
pub(crate) fn notices_path(resource_dir: &Path) -> Result<PathBuf, String> {
    let path = resource_dir.join(NOTICES_FILE);
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "The third-party notices were not found at {}. This build was packaged without them.",
            path.display()
        ))
    }
} // notices_path END **********************************************************


//******************************************************************************
// open_licences_window
//******************************************************************************
/// IMPL-LTTCE-FOS-00003 — REQ-LTTCE-FOS-00003: opens the bundled
/// `THIRD-PARTY-NOTICES.md` in a new editor window, marked read-only.
#[tauri::command]
pub async fn open_licences_window(app: tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let path = notices_path(&resource_dir)?;
    info!("Opening third-party notices: {}", path.display());
    crate::open_document_window(app, Some(path.to_string_lossy().into_owned()), true).await
} // open_licences_window END **************************************************


#[cfg(test)]
#[path = "licences_tests.rs"]
mod tests;
