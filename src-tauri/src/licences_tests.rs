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

//! UTST for IMPL-LTTCE-FOS-00003 — the bundled notices are found, and nothing
//! inside the resource folder can be saved over.

use super::*;
use std::fs;
use tempfile::TempDir;


//******************************************************************************
// fixture
//******************************************************************************
/// A resource folder holding the notices, next to a user folder.
fn fixture() -> (TempDir, PathBuf, PathBuf) {
    let tmp = TempDir::new().expect("temp dir");
    let resources = tmp.path().join("app").join("resources");
    let user = tmp.path().join("notes");
    fs::create_dir_all(&resources).unwrap();
    fs::create_dir_all(&user).unwrap();
    fs::write(resources.join(NOTICES_FILE), "# Third-Party Notices\n").unwrap();
    (tmp, resources, user)
} // fixture END ***************************************************************


#[test]
fn notices_path_finds_the_bundled_file() {
    let (_tmp, resources, _) = fixture();
    assert_eq!(notices_path(&resources).unwrap(), resources.join(NOTICES_FILE));
}

#[test]
fn notices_path_reports_a_build_without_notices() {
    let (_tmp, _, user) = fixture();
    let err = notices_path(&user).unwrap_err();
    assert!(err.contains("packaged without them"), "{err}");
}

#[test]
fn save_into_the_notices_is_refused() {
    let (_tmp, resources, _) = fixture();
    let target = resources.join(NOTICES_FILE);
    let err = refuse_write_into_resources(target.to_str().unwrap(), Some(&resources)).unwrap_err();
    assert!(err.contains("Save As"), "{err}");
}

#[test]
fn a_new_file_inside_the_resources_is_refused() {
    let (_tmp, resources, _) = fixture();
    let target = resources.join("sub").join("new.md");
    assert!(refuse_write_into_resources(target.to_str().unwrap(), Some(&resources)).is_err());
}

#[test]
fn a_dotted_path_into_the_resources_is_refused() {
    // `..` must not walk around the guard.
    let (_tmp, resources, user) = fixture();
    let target = user.join("..").join("app").join("resources").join(NOTICES_FILE);
    assert!(refuse_write_into_resources(target.to_str().unwrap(), Some(&resources)).is_err());
}

#[test]
fn a_new_folder_climbing_into_the_resources_is_refused() {
    // Non-existing components with `..` resolve lexically onto the resources.
    let (_tmp, resources, user) = fixture();
    let target = user.join("new").join("..").join("..").join("app").join("resources").join("x.md");
    assert!(refuse_write_into_resources(target.to_str().unwrap(), Some(&resources)).is_err());
}

#[test]
fn saving_elsewhere_is_allowed() {
    let (_tmp, resources, user) = fixture();
    let target = user.join("note.md");
    assert!(refuse_write_into_resources(target.to_str().unwrap(), Some(&resources)).is_ok());
}

#[test]
fn a_sibling_with_a_common_prefix_is_not_inside() {
    // `resources-old` starts with the same characters but is another folder.
    let (_tmp, resources, _) = fixture();
    let sibling = resources.with_file_name("resources-old");
    fs::create_dir_all(&sibling).unwrap();
    assert!(!is_inside(&sibling.join("x.md"), &resources));
}

#[test]
fn an_unknown_resource_folder_guards_nothing() {
    let (_tmp, resources, _) = fixture();
    let target = resources.join(NOTICES_FILE);
    assert!(refuse_write_into_resources(target.to_str().unwrap(), None).is_ok());
}
