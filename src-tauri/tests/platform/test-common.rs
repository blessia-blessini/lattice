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

// Shared test helpers — included once in file_open_tests.rs before the
// platform include!().  Platform files (test-windows.rs, test-linux.rs, …)
// do NOT re-include this file; the helpers are already in scope when the
// platform file is pasted in by include!().
//
// Same pattern as cli_desktop.rs in production: a shared helper file that is
// pulled in at one call site, not included by each consumer individually.

// ─────────────────────────────────────────────────────────────────────────────
// make_app
// ─────────────────────────────────────────────────────────────────────────────
/// Build a minimal mock Tauri app with `FileTrackerState` managed.
/// No real window, no display server — pure in-process.
fn make_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .manage(file_state::FileTrackerState {
            files: Arc::new(Mutex::new(HashMap::new())),
        })
        .build(mock_context(noop_assets()))
        .expect("MockRuntime app construction failed")
}

// ─────────────────────────────────────────────────────────────────────────────
// read_file_content
// ─────────────────────────────────────────────────────────────────────────────
/// Reads the file at `path` through the Direct Push mechanism (`read_text_file`),
/// asserts that the read succeeds, and returns the normalised content string.
///
/// Use this instead of the six-line boilerplate whenever a test only needs to
/// verify the returned content.  Tests that need to inspect `FileTrackerState`
/// after the read (e.g. `wished_format` checks) must call `make_app()` and
/// `read_text_file` directly so they can hold onto the app handle.
fn read_file_content(path: &str, window_label: &str) -> String {
    let app = make_app();
    let handle = app.handle().clone();
    let state = handle.state::<file_state::FileTrackerState>();
    file_state::read_text_file(
        path.to_string(),
        state,
        Some(window_label.to_string()),
    )
    .unwrap_or_else(|e| panic!("read_text_file failed for '{}': {}", path, e))
    .content
}
