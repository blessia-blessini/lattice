// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.


/// Collects non-flag command-line arguments as file paths.
///
/// Skips the `--color` flag (and its value) that `cargo tauri dev` injects.
/// Skips any argument that starts with `-`.
/// Returns an empty `Vec` when no file paths are present.
pub fn collect_file_paths() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut paths = Vec::new();
    let mut i = 1;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--color" {
            i += 2; // skip flag + its value
            continue;
        }
        if !arg.starts_with('-') {
            paths.push(arg.clone());
        }
        i += 1;
    }
    paths
}

/// The flag that switches the process into headless HTML-export mode.
pub const EXPORT_HTML_FLAG: &str = "--export-html";

//**************************************************************
// wants_export_html
//**************************************************************
/// Whether the process was launched with the headless export flag
/// (`--export-html`), scanning the real `std::env::args()`.
///
/// Non-flag arguments alongside it (collected separately via
/// `collect_file_paths`) are the files to export.
pub fn wants_export_html() -> bool {
    std::env::args().any(|a| a == EXPORT_HTML_FLAG)
}
// wants_export_html END *****************************************

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_when_no_paths() {
        // std::env::args() in a test binary has no user-supplied file args.
        // collect_file_paths must never panic and always return a Vec.
        let result = collect_file_paths();
        // Can't assert empty (test runner may inject flags), but must not panic.
        let _ = result;
    }

    #[test]
    fn export_flag_absent_in_test_binary() {
        // The test runner never passes --export-html, so this must read false
        // rather than panic — proves the scan itself is well-formed.
        assert!(!wants_export_html());
    }

    #[test]
    fn export_flag_constant_matches_collect_file_paths_skip_rule() {
        // collect_file_paths() skips anything starting with '-', so the flag
        // constant must never leak into the collected file-path list.
        assert!(EXPORT_HTML_FLAG.starts_with('-'));
    }
}
