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

//! Vault settings path resolution — pure logic, no Tauri runtime.
//!
//! # Why this is its own module
//!
//! Locating a vault is path arithmetic plus filesystem probes.  Keeping it out
//! of `lib.rs` lets it be unit-tested directly, and puts the one thing that
//! genuinely differs per platform — *what a "path" even means* — in one place.
//!
//! # What "the path of the open file" means per target
//!
//! | Route                                         | What we get            | Walk-up        |
//! |-----------------------------------------------|------------------------|----------------|
//! | Desktop (Win/macOS/Linux), any route          | real path              | yes, unbounded |
//! | iOS — `Documents/Inbox` copy on an opened file| real path, in sandbox  | yes, bounded   |
//! | iOS — `UIDocumentPicker` security-scoped URL  | real path, outside     | stops at boundary |
//! | Android — app-private storage                 | real path, in sandbox  | yes, bounded   |
//! | Android — SAF / `ACTION_VIEW`                 | `content://…` URI      | **impossible** |
//!
//! So the input is only genuinely undefined in the last row.  A `content://`
//! document URI has no parent directory to inspect — a walk-up is not merely
//! unhelpful there, it is meaningless — so such a document gets the fallback
//! vault.  Note this is downstream of a larger gap: `std::fs` cannot open a
//! `content://` URI either (see `file_state::read_text_file_internal`), so
//! *reading* such a document must be solved via Android's `ContentResolver`
//! before vault resolution for it means anything at all.
//!
//! # The boundary
//!
//! On mobile the upward walk is bounded by the app sandbox root.  Without a
//! boundary the walk climbs to `/`, where every ancestor `stat` is denied and
//! any hit would be outside the sandbox anyway.  Desktop passes `None` and so
//! behaves exactly as before.

use log::{info, warn};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Content written into a freshly created `settings.json`.
pub(crate) const DEFAULT_SETTINGS: &str = r#"{}"#;

/// Prefix for every user-facing vault initialisation failure.
pub(crate) const ERR_PREFIX: &str = "Cannot Initialize Vault: ";


//******************************************************************************
// PathKind
//******************************************************************************
/// What a "path" handed to us by the frontend actually denotes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathKind {
    /// A real filesystem path: it has ancestry that can be walked and probed.
    FileSystem,
    /// An opaque document URI (Android SAF `content://…`).  No parent
    /// directory exists, so no walk-up is possible.
    OpaqueUri,
}
// PathKind END ****************************************************************


//******************************************************************************
// classify_path
//******************************************************************************
/// Decides whether `raw` is a filesystem path or an opaque document URI.
///
/// A filesystem path never contains `"://"`:
/// * POSIX `/home/leo/a.md` — no scheme separator at all;
/// * Windows `C:\Users\leo\a.md` — has `':'`, but never `"://"`;
/// * UNC `\\server\share` — no `':'` at all.
///
/// So the separator is a reliable discriminator, provided what precedes it
/// looks like an RFC 3986 scheme (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`).
pub(crate) fn classify_path(raw: &str) -> PathKind {
    match raw.find("://") {
        None => PathKind::FileSystem,
        Some(idx) => {
            let scheme = &raw[..idx];
            let mut chars = scheme.chars();
            let looks_like_scheme = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
            if looks_like_scheme {
                PathKind::OpaqueUri
            } else {
                PathKind::FileSystem
            }
        }
    }
}
// classify_path END ***********************************************************


//******************************************************************************
// Probe
//******************************************************************************
/// Outcome of looking for a `.lattice` directory at one level of the walk.
#[derive(Debug, PartialEq, Eq)]
enum Probe {
    /// A `.lattice` directory is present here.
    Found(PathBuf),
    /// Definitively not here.
    Absent,
    /// We were not permitted to look.  Crucially NOT the same as `Absent`:
    /// `Path::exists()` collapses the two, which is how a real vault becomes
    /// silently invisible under Android scoped storage or the iOS sandbox.
    Unreadable,
}
// Probe END *******************************************************************


//******************************************************************************
// probe_vault_dir
//******************************************************************************
/// Looks for `<dir>/.lattice`, distinguishing "absent" from "not allowed".
fn probe_vault_dir(dir: &Path) -> Probe {
    let vault_dir = dir.join(".lattice");
    match fs::metadata(&vault_dir) {
        Ok(md) if md.is_dir() => Probe::Found(vault_dir),
        // A regular FILE named `.lattice` is not a vault; keep walking.
        Ok(_) => Probe::Absent,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Probe::Absent,
        Err(e) => {
            warn!(
                "vault: cannot inspect {:?} ({}). Treating as no-vault, but a \
                 vault may exist here and be invisible to us.",
                vault_dir, e
            );
            Probe::Unreadable
        }
    }
}
// probe_vault_dir END *********************************************************


//******************************************************************************
// describe_vault_io_error
//******************************************************************************
/// Turns an `io::Error` into something a user can act on.
///
/// `ErrorKind` is matched first because it is portable; the historical
/// `raw_os_error() == 30` check is kept as a fallback (30 is `EROFS` on
/// Linux/Android/macOS) so behaviour on existing platforms is unchanged.
pub(crate) fn describe_vault_io_error(prefix: &str, e: &io::Error) -> String {
    if e.kind() == io::ErrorKind::ReadOnlyFilesystem || e.raw_os_error() == Some(30) {
        return format!(
            "{}The file system is read-only. This happens with external cloud \
             files (e.g. Google Drive). To use Vault features, please move the \
             file to local device storage.",
            prefix
        );
    }
    if e.kind() == io::ErrorKind::PermissionDenied {
        return format!(
            "{}Not allowed to write next to this file. On mobile this happens \
             for files outside the app's own storage. Please move the file to \
             storage the app may write to.",
            prefix
        );
    }
    format!("{}{}", prefix, e)
}
// describe_vault_io_error END *************************************************


//******************************************************************************
// fallback_vault
//******************************************************************************
/// Ensures `<base>/.lattice/settings.json` exists and returns its path.
/// `create_dir_all` also creates `base` itself, which matters on iOS where
/// Application Support does not exist until the app makes it.
fn fallback_vault(base: &Path) -> Result<String, String> {
    let lattice_dir = base.join(".lattice");
    let settings_path = lattice_dir.join("settings.json");

    if !settings_path.exists() {
        if !lattice_dir.exists() {
            fs::create_dir_all(&lattice_dir)
                .map_err(|e| describe_vault_io_error("Cannot create fallback vault: ", &e))?;
        }
        fs::write(&settings_path, DEFAULT_SETTINGS)
            .map_err(|e| describe_vault_io_error("Cannot create fallback vault: ", &e))?;
    }

    Ok(settings_path.to_string_lossy().to_string())
}
// fallback_vault END **********************************************************


//******************************************************************************
// find_vault_settings_file_internal
//******************************************************************************
/// Unbounded search — the historical two-argument entry point, kept so the
/// existing tests read unchanged.  Production code always goes through
/// [`find_vault_settings_file_bounded`], which is why this is test-only.
#[cfg(test)]
pub(crate) fn find_vault_settings_file_internal(
    file_path: String,
    home_dir: &Path,
) -> Result<Option<String>, String> {
    find_vault_settings_file_bounded(file_path, home_dir, None)
}
// find_vault_settings_file_internal END ***************************************


//******************************************************************************
// find_vault_settings_file_bounded
//******************************************************************************
/// Walks up from `file_path` looking for a `.lattice` directory, then falls
/// back to `home_dir/.lattice`.
///
/// # Arguments
///
/// * `file_path` - Starting path for the upward search (file or directory).
/// * `home_dir`  - Fallback root used when no vault is found in the ancestry.
/// * `boundary`  - Optional root the walk may not climb out of (the mobile
///   sandbox).  `None` walks to the filesystem root, as on desktop.
///
/// # Returns
///
/// `Ok(Some(path))` with the absolute path to `settings.json`, or an error
/// message if a required directory or file cannot be created.
pub(crate) fn find_vault_settings_file_bounded(
    file_path: String,
    home_dir: &Path,
    boundary: Option<&Path>,
) -> Result<Option<String>, String> {
    // An opaque document URI has no ancestry: skip the pointless walk.
    if classify_path(&file_path) == PathKind::OpaqueUri {
        info!(
            "vault: {:?} is an opaque document URI with no traversable parent; \
             using the fallback vault under {:?}.",
            file_path, home_dir
        );
        return fallback_vault(home_dir).map(Some);
    }

    let mut current = Path::new(&file_path);
    // Step to the parent only for a FILE; a directory is itself a candidate.
    if current.is_file()
        && let Some(parent) = current.parent()
    {
        current = parent;
    }

    let mut unreadable_ancestors = 0usize;

    loop {
        // Stop as soon as the walk would leave the sandbox.
        if let Some(root) = boundary
            && !current.starts_with(root)
        {
            info!("vault: walk stopped at sandbox boundary {:?}.", root);
            break;
        }

        match probe_vault_dir(current) {
            Probe::Found(vault_dir) => {
                let settings_path = vault_dir.join("settings.json");
                if !settings_path.exists() {
                    fs::write(&settings_path, DEFAULT_SETTINGS).map_err(|e| e.to_string())?;
                }
                return Ok(Some(settings_path.to_string_lossy().to_string()));
            }
            Probe::Absent => {}
            Probe::Unreadable => unreadable_ancestors += 1,
        }

        match current.parent() {
            Some(parent) => current = parent, // crawl up the hierarchy
            None => break,
        }
    }

    if unreadable_ancestors > 0 {
        warn!(
            "vault: {} ancestor(s) could not be inspected, so a local vault may \
             exist but be unreachable. Falling back to {:?}.",
            unreadable_ancestors, home_dir
        );
    }

    fallback_vault(home_dir).map(Some)
}
// find_vault_settings_file_bounded END ****************************************


//******************************************************************************
// initialize_vault_settings_internal
//******************************************************************************
/// Creates a `.lattice` directory plus `settings.json`.  Idempotent.
///
/// If `file_path` is a regular file, `.lattice` is created alongside it in the
/// parent directory; if it is a directory, `.lattice` is created inside it.
/// An existing `settings.json` is never overwritten.
pub(crate) fn initialize_vault_settings_internal(file_path: String) -> Result<String, String> {
    // Refuse early rather than fabricating a nonsense path: for a
    // `content://…/document/msf%3A1000` URI, `is_file()` is false, so the URI
    // would otherwise be treated as a DIRECTORY and we would try to create
    // `content:/…/document/msf%3A1000/.lattice`.
    if classify_path(&file_path) == PathKind::OpaqueUri {
        return Err(format!(
            "{}this document was opened through the system document picker, \
             which gives the app no folder to create a vault in. Please save or \
             move the file into device storage first.",
            ERR_PREFIX
        ));
    }

    let path = Path::new(&file_path);
    let parent = if path.is_file() {
        path.parent()
            .ok_or_else(|| format!("{}Cannot get parent directory", ERR_PREFIX))?
    } else {
        path
    };

    let vault_dir = parent.join(".lattice");
    fs::create_dir_all(&vault_dir).map_err(|e| describe_vault_io_error(ERR_PREFIX, &e))?;

    let settings_path = vault_dir.join("settings.json");
    if !settings_path.exists() {
        fs::write(&settings_path, DEFAULT_SETTINGS)
            .map_err(|e| describe_vault_io_error(ERR_PREFIX, &e))?;
    }

    Ok(settings_path.to_string_lossy().to_string())
}
// initialize_vault_settings_internal END **************************************

#[cfg(test)]
#[path = "vault_path_tests.rs"]
mod tests;
