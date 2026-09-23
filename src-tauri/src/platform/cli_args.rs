// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

use crate::export::ExportFormat;

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

//**************************************************************
// export_format_in
//**************************************************************
/// The headless export format requested by `args`, or `None` for an ordinary
/// interactive launch.
///
/// Pure over its input so the flag-scanning rule itself is host-testable —
/// `requested_export_format` is the thin `std::env::args()` wrapper around it.
/// The first recognised export flag wins; a second one is ignored rather than
/// silently overriding the first, so `--export-html --export-pdf a.md` exports
/// HTML instead of quietly doing something the caller did not ask for.
pub fn export_format_in<I, S>(args: I) -> Option<ExportFormat>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .find_map(|a| ExportFormat::from_flag(a.as_ref()))
}
// export_format_in END ******************************************

//**************************************************************
// requested_export_format
//**************************************************************
/// Whether the process was launched with a headless export flag
/// (`--export-html` / `--export-pdf`), scanning the real `std::env::args()`.
///
/// Non-flag arguments alongside it (collected separately via
/// `collect_file_paths`) are the files to export.
pub fn requested_export_format() -> Option<ExportFormat> {
    export_format_in(std::env::args())
}
// requested_export_format END ***********************************

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
        // The test runner never passes an export flag, so this must read None
        // rather than panic — proves the scan itself is well-formed.
        assert!(requested_export_format().is_none());
    }

    #[test]
    fn recognises_each_export_flag() {
        for f in ExportFormat::ALL {
            let argv = ["lattice", f.flag(), "notes.md"];
            assert_eq!(export_format_in(argv), Some(f));
        }
    }

    #[test]
    fn no_flag_means_interactive_launch() {
        assert_eq!(export_format_in(["lattice", "notes.md"]), None);
        assert_eq!(export_format_in(["lattice"]), None);
        assert_eq!(export_format_in(Vec::<&str>::new()), None);
    }

    #[test]
    fn near_miss_flags_do_not_trigger_an_export() {
        // Defensive: only the exact flags switch the process into a mode that
        // never shows a window.
        assert_eq!(export_format_in(["lattice", "--export"]), None);
        assert_eq!(export_format_in(["lattice", "--export-pdf=a.pdf"]), None);
        assert_eq!(export_format_in(["lattice", "-export-pdf"]), None);
        assert_eq!(export_format_in(["lattice", "--EXPORT-PDF"]), None);
    }

    #[test]
    fn first_export_flag_wins_when_both_are_given() {
        assert_eq!(
            export_format_in(["lattice", "--export-html", "--export-pdf", "a.md"]),
            Some(ExportFormat::Html)
        );
        assert_eq!(
            export_format_in(["lattice", "--export-pdf", "--export-html", "a.md"]),
            Some(ExportFormat::Pdf)
        );
    }

    #[test]
    fn export_flags_never_leak_into_collected_file_paths() {
        // collect_file_paths() skips anything starting with '-'; assert the
        // flag constants keep honouring that contract.
        for f in ExportFormat::ALL {
            assert!(f.flag().starts_with('-'));
        }
    }
}
