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

//! UTST for recent-files entries (REQ-LTTCE-RCT-00002, IMPL-LTTCE-RCT-00001).
//! Every case works inside its own `TempDir`.

use super::*;

//**************************************************************
// state_of_files_folders_and_missing_paths
//**************************************************************
#[test]
fn state_of_files_folders_and_missing_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("note.md");
    std::fs::write(&file, "# note").unwrap();

    assert_eq!(recent_file_state_of(&file), RecentFileState::File);
    // A folder is no document any more: gone.
    assert_eq!(recent_file_state_of(tmp.path()), RecentFileState::Gone);
    // Not found on a drive that exists: gone -- also when whole folders went
    // (the case of deleted test fixtures, src-tauri/target/e2e-*/…).
    assert_eq!(recent_file_state_of(&tmp.path().join("deleted.md")), RecentFileState::Gone);
    assert_eq!(
        recent_file_state_of(&tmp.path().join("gone-folder").join("daily").join("x.md")),
        RecentFileState::Gone
    );
}
// state_of_files_folders_and_missing_paths END ****************


//**************************************************************
// a_path_without_a_root_is_never_dropped
//**************************************************************
/// No drive or root to check: cannot tell, keep the entry.
#[test]
fn a_path_without_a_root_is_never_dropped() {
    assert_eq!(
        recent_file_state_of(Path::new("relative-folder-that-is-not-there/x.md")),
        RecentFileState::Unavailable
    );
    assert_eq!(path_root(Path::new("x.md")), None);
}
// a_path_without_a_root_is_never_dropped END ******************


//**************************************************************
// root_of_an_absolute_path
//**************************************************************
#[test]
fn root_of_an_absolute_path() {
    let tmp = tempfile::tempdir().unwrap();
    let root = path_root(&tmp.path().join("a").join("b.md")).expect("an absolute path has a root");
    assert!(root.is_dir(), "the temp dir's drive or root exists: {}", root.display());
    assert!(tmp.path().starts_with(&root));
}
// root_of_an_absolute_path END ********************************


//**************************************************************
// a_missing_drive_keeps_the_entry
//**************************************************************
/// A drive that is not there (an unplugged stick) reports "not found" too;
/// its entries must stay. Uses a Windows drive letter that does not exist on
/// this machine; on other systems such a path has no root and is kept anyway.
#[test]
fn a_missing_drive_keeps_the_entry() {
    let unused = ('D'..='Z')
        .map(|c| format!("{c}:\\"))
        .find(|d| !Path::new(d).exists())
        .expect("some drive letter is unused");
    let entry = PathBuf::from(format!("{unused}notes\\x.md"));
    assert_eq!(recent_file_state_of(&entry), RecentFileState::Unavailable);
}
// a_missing_drive_keeps_the_entry END *************************


//**************************************************************
// serialises_as_the_frontend_expects
//**************************************************************
#[test]
fn serialises_as_the_frontend_expects() {
    assert_eq!(serde_json::to_string(&RecentFileState::File).unwrap(), "\"file\"");
    assert_eq!(serde_json::to_string(&RecentFileState::Gone).unwrap(), "\"gone\"");
    assert_eq!(serde_json::to_string(&RecentFileState::Unavailable).unwrap(), "\"unavailable\"");
}
// serialises_as_the_frontend_expects END **********************
