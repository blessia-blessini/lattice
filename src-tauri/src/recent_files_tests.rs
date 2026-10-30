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
    // A folder is no document any more.
    assert_eq!(recent_file_state_of(tmp.path()), RecentFileState::NotFound);
    // A deleted file, and a deleted folder tree (the case of removed test
    // fixtures, src-tauri/target/e2e-*/…).
    assert_eq!(recent_file_state_of(&tmp.path().join("deleted.md")), RecentFileState::NotFound);
    assert_eq!(
        recent_file_state_of(&tmp.path().join("gone-folder").join("daily").join("x.md")),
        RecentFileState::NotFound
    );
    // A relative path that does not resolve: also only "not found".
    assert_eq!(
        recent_file_state_of(Path::new("relative-folder-that-is-not-there/x.md")),
        RecentFileState::NotFound
    );
}
// state_of_files_folders_and_missing_paths END ****************


//**************************************************************
// other_errors_keep_the_entry
//**************************************************************
/// Any error other than "not found" -- here an invalid path (a NUL byte,
/// refused by every OS) -- means "cannot tell": open as before, keep it.
#[test]
fn other_errors_keep_the_entry() {
    assert_eq!(recent_file_state_of(Path::new("bad\0name.md")), RecentFileState::Unavailable);
}
// other_errors_keep_the_entry END *****************************


//**************************************************************
// serialises_as_the_frontend_expects
//**************************************************************
#[test]
fn serialises_as_the_frontend_expects() {
    assert_eq!(serde_json::to_string(&RecentFileState::File).unwrap(), "\"file\"");
    assert_eq!(serde_json::to_string(&RecentFileState::NotFound).unwrap(), "\"notFound\"");
    assert_eq!(serde_json::to_string(&RecentFileState::Unavailable).unwrap(), "\"unavailable\"");
}
// serialises_as_the_frontend_expects END **********************
