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

//! UTST for the last vault (REQ-LTTCE-VLT-00002, REQ-LTTCE-VLT-00003,
//! IMPL-LTTCE-VLT-00002). Every case lives in its own `TempDir`: the state
//! file, the home vault and every other vault are fixtures, never the
//! machine's own.

use super::*;
use tempfile::TempDir;

/// Create `<root>/<name>/.lattice/settings.json` and return its path.
fn make_vault(root: &Path, name: &str) -> PathBuf {
    let dir = root.join(name).join(".lattice");
    fs::create_dir_all(&dir).unwrap();
    let settings = dir.join("settings.json");
    fs::write(&settings, "{}").unwrap();
    settings
}

/// A fixture world: a home vault, a state file location, a temp root.
struct World {
    tmp: TempDir,
    home: PathBuf,
    state: PathBuf,
}

fn world() -> World {
    let tmp = tempfile::tempdir().unwrap();
    let home = make_vault(tmp.path(), "home");
    let state = tmp.path().join("app-local-data").join(LAST_VAULT_FILE);
    World { tmp, home, state }
}

mod recall_and_remember {
    use super::*;

    #[test]
    fn nothing_remembered_yet() {
        let w = world();
        assert_eq!(recall(&w.state), None);
    }

    #[test]
    fn remembers_and_recalls_a_vault() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        remember(&w.state, &notes).unwrap();
        assert_eq!(recall(&w.state), Some(notes));
    }

    #[test]
    fn creates_the_state_folder() {
        let w = world();
        assert!(!w.state.parent().unwrap().exists());
        remember(&w.state, &make_vault(w.tmp.path(), "notes")).unwrap();
        assert!(w.state.is_file());
    }

    #[test]
    fn a_vanished_vault_is_not_recalled() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        remember(&w.state, &notes).unwrap();
        fs::remove_dir_all(w.tmp.path().join("notes")).unwrap();
        assert_eq!(recall(&w.state), None);
    }

    #[test]
    fn a_damaged_state_file_is_ignored() {
        let w = world();
        fs::create_dir_all(w.state.parent().unwrap()).unwrap();
        fs::write(&w.state, "{ not json").unwrap();
        assert_eq!(recall(&w.state), None);
    }

    #[test]
    fn a_path_that_is_not_a_vault_settings_file_is_ignored() {
        // Save in Settings writes to the recalled path: it must never be an
        // arbitrary file, however the state file came to name one.
        let w = world();
        let other = w.tmp.path().join("important.txt");
        fs::write(&other, "keep me").unwrap();
        let relative = PathBuf::from("notes/.lattice/settings.json");
        for bad in [other, relative] {
            fs::create_dir_all(w.state.parent().unwrap()).unwrap();
            let json = serde_json::json!({ "vaultSettingsPath": bad }).to_string();
            fs::write(&w.state, json).unwrap();
            assert_eq!(recall(&w.state), None, "{bad:?} must not be recalled");
        }
    }

    #[test]
    fn an_unchanged_vault_is_not_rewritten() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        // Same content as remember() would write, but compact: a rewrite
        // would pretty-print it, so the text shows whether one happened.
        fs::create_dir_all(w.state.parent().unwrap()).unwrap();
        let compact = serde_json::json!({ "vaultSettingsPath": notes }).to_string();
        fs::write(&w.state, &compact).unwrap();
        remember(&w.state, &notes).unwrap();
        assert_eq!(fs::read_to_string(&w.state).unwrap(), compact);
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let w = world();
        remember(&w.state, &make_vault(w.tmp.path(), "a")).unwrap();
        remember(&w.state, &make_vault(w.tmp.path(), "b")).unwrap();
        let names: Vec<_> = fs::read_dir(w.state.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(LAST_VAULT_FILE)]);
    }
}

mod choose {
    use super::*;

    #[test]
    fn no_document_gets_the_remembered_vault() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        remember(&w.state, &notes).unwrap();
        assert_eq!(choose_vault("", &w.home, &w.home, &w.state), notes);
    }

    #[test]
    fn no_document_and_nothing_remembered_gets_home_and_stores_nothing() {
        let w = world();
        assert_eq!(choose_vault("", &w.home, &w.home, &w.state), w.home);
        assert!(!w.state.exists(), "the home vault is never remembered");
    }

    #[test]
    fn no_document_with_a_vanished_vault_falls_back_to_home() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        remember(&w.state, &notes).unwrap();
        fs::remove_dir_all(w.tmp.path().join("notes")).unwrap();
        assert_eq!(choose_vault("", &w.home, &w.home, &w.state), w.home);
    }

    #[test]
    fn a_document_in_a_vault_is_remembered() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        let chosen = choose_vault("/any/doc.md", &notes, &w.home, &w.state);
        assert_eq!(chosen, notes);
        assert_eq!(recall(&w.state), Some(notes));
    }

    #[test]
    fn a_document_outside_any_vault_does_not_overwrite_the_memory() {
        let w = world();
        let notes = make_vault(w.tmp.path(), "notes");
        remember(&w.state, &notes).unwrap();
        assert_eq!(choose_vault("/stray/doc.md", &w.home, &w.home, &w.state), w.home);
        assert_eq!(recall(&w.state), Some(notes));
    }

    #[test]
    fn the_latest_vault_wins() {
        let w = world();
        let a = make_vault(w.tmp.path(), "a");
        let b = make_vault(w.tmp.path(), "b");
        choose_vault("/a/doc.md", &a, &w.home, &w.state);
        choose_vault("/b/doc.md", &b, &w.home, &w.state);
        assert_eq!(choose_vault("", &w.home, &w.home, &w.state), b);
    }

    #[test]
    fn a_vault_in_the_working_directory_beats_the_memory() {
        // "No document" whose walk found a real vault (the working
        // directory's) keeps it — and it becomes the new memory.
        let w = world();
        let remembered = make_vault(w.tmp.path(), "remembered");
        let cwd_vault = make_vault(w.tmp.path(), "cwd");
        remember(&w.state, &remembered).unwrap();
        assert_eq!(choose_vault("", &cwd_vault, &w.home, &w.state), cwd_vault);
        assert_eq!(recall(&w.state), Some(cwd_vault));
    }
}
