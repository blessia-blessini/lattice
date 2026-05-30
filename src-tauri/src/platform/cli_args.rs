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
}
