// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

use crate::export::ExportFormat;
use crate::paper::{PaperSize, PAPER_FLAG};

/// Options whose *next* argument is their value, never a file path:
/// `--color` (injected by `cargo tauri dev`) and `--paper`. One list, so a new
/// valued option cannot be added to one scan and forgotten in the other.
const VALUED_OPTIONS: [&str; 2] = ["--color", PAPER_FLAG];

//**************************************************************
// file_paths_in
//**************************************************************
/// The file paths in `args` (`args[0]` being the program).
///
/// Skips every argument that starts with `-`, and the value that follows a
/// [`VALUED_OPTIONS`] entry — so `--paper a4 notes.md` yields only
/// `notes.md`. Pure over its input so the rule is host-testable;
/// `collect_file_paths` is the `std::env::args()` wrapper.
pub fn file_paths_in<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut paths = Vec::new();
    let mut skip_next = false;
    for arg in args.into_iter().skip(1) {
        let arg = arg.as_ref();
        if skip_next {
            skip_next = false;
            continue;
        }
        if VALUED_OPTIONS.contains(&arg) {
            skip_next = true;
        } else if !arg.starts_with('-') {
            paths.push(arg.to_string());
        }
    }
    paths
}
// file_paths_in END *********************************************

//**************************************************************
// collect_file_paths
//**************************************************************
/// The file paths on the real command line; empty when there are none.
/// See [`file_paths_in`].
pub fn collect_file_paths() -> Vec<String> {
    file_paths_in(std::env::args())
}
// collect_file_paths END ****************************************

//**************************************************************
// paper_size_in
//**************************************************************
/// The paper requested in `args` by `--paper <name>` or `--paper=<name>`,
/// or [`PaperSize::default`] when the option is absent.
///
/// REQ-LTTCE-XPT-00011. A missing or unknown value is an `Err` naming the
/// accepted values, never a silent fallback: a script that asked for A3 and
/// quietly got A4 would only find out on paper. The first `--paper` wins, the
/// same rule as the export flags themselves. Pure over its input.
pub fn paper_size_in<I, S>(args: I) -> Result<PaperSize, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let arg = arg.as_ref();
        let value = if arg == PAPER_FLAG {
            match args.next() {
                Some(v) if !v.as_ref().starts_with('-') => v.as_ref().to_string(),
                _ => {
                    return Err(format!(
                        "{} needs a value: one of {}",
                        PAPER_FLAG,
                        PaperSize::accepted_names()
                    ));
                }
            }
        } else if let Some(v) = arg.strip_prefix(PAPER_FLAG).and_then(|r| r.strip_prefix('=')) {
            v.to_string()
        } else {
            continue;
        };
        return PaperSize::parse(&value).ok_or_else(|| {
            format!(
                "unknown paper size '{}' for {}; use one of: {}",
                value,
                PAPER_FLAG,
                PaperSize::accepted_names()
            )
        });
    }
    Ok(PaperSize::default())
}
// paper_size_in END *********************************************

//**************************************************************
// requested_paper_size
//**************************************************************
/// The paper requested on the real command line. See [`paper_size_in`].
pub fn requested_paper_size() -> Result<PaperSize, String> {
    paper_size_in(std::env::args())
}
// requested_paper_size END **************************************

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


//**************************************************************
// tests
//**************************************************************
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

    // ── file_paths_in ───────────────────────────────────────────────────────

    #[test]
    fn file_paths_skip_the_program_and_every_flag() {
        assert_eq!(
            file_paths_in(["lattice", "--export-pdf", "a.md", "b.md"]),
            vec!["a.md", "b.md"]
        );
        assert!(file_paths_in(["lattice"]).is_empty());
        assert!(file_paths_in(Vec::<&str>::new()).is_empty());
    }

    #[test]
    fn a_paper_value_is_never_taken_for_a_file() {
        // Without VALUED_OPTIONS "a3" would be exported as a Markdown file.
        assert_eq!(
            file_paths_in(["lattice", "--export-pdf", "--paper", "a3", "notes.md"]),
            vec!["notes.md"]
        );
        assert_eq!(
            file_paths_in(["lattice", "--export-pdf", "--paper=a3", "notes.md"]),
            vec!["notes.md"]
        );
    }

    #[test]
    fn the_dev_color_value_is_still_skipped() {
        assert_eq!(
            file_paths_in(["lattice", "--color", "always", "notes.md"]),
            vec!["notes.md"]
        );
    }

    #[test]
    fn a_trailing_valued_option_does_not_panic() {
        assert!(file_paths_in(["lattice", "--export-pdf", "--paper"]).is_empty());
    }

    // ── paper_size_in ───────────────────────────────────────────────────────

    #[test]
    fn paper_defaults_to_a4_when_not_given() {
        assert_eq!(paper_size_in(["lattice", "--export-pdf", "a.md"]), Ok(PaperSize::A4));
        assert_eq!(paper_size_in(Vec::<&str>::new()), Ok(PaperSize::A4));
    }

    #[test]
    fn paper_is_read_in_both_spellings_and_any_case() {
        for p in PaperSize::ALL {
            let spaced = ["lattice", "--export-pdf", "--paper", p.name(), "a.md"];
            assert_eq!(paper_size_in(spaced), Ok(p));
            let joined = format!("--paper={}", p.name().to_uppercase());
            assert_eq!(paper_size_in(["lattice", joined.as_str(), "a.md"]), Ok(p));
        }
    }

    #[test]
    fn paper_may_come_before_or_after_the_export_flag() {
        assert_eq!(
            paper_size_in(["lattice", "--paper", "letter", "--export-pdf", "a.md"]),
            Ok(PaperSize::Letter)
        );
    }

    #[test]
    fn an_unknown_paper_is_an_error_naming_the_accepted_values() {
        let err = paper_size_in(["lattice", "--export-pdf", "--paper", "a5", "a.md"]).unwrap_err();
        assert!(err.contains("'a5'") && err.contains("a4, a3, letter"), "{err}");
        let err = paper_size_in(["lattice", "--paper="]).unwrap_err();
        assert!(err.contains("''"), "{err}");
    }

    #[test]
    fn a_missing_paper_value_is_an_error() {
        // At the end of the line, and when the next argument is another flag —
        // "--paper --export-pdf" must not swallow the export flag as a value.
        for argv in [
            vec!["lattice", "--export-pdf", "a.md", "--paper"],
            vec!["lattice", "--paper", "--export-pdf", "a.md"],
        ] {
            let err = paper_size_in(argv).unwrap_err();
            assert!(err.contains("needs a value"), "{err}");
        }
    }

    #[test]
    fn the_first_paper_option_wins() {
        assert_eq!(
            paper_size_in(["lattice", "--paper", "a3", "--paper", "letter"]),
            Ok(PaperSize::A3)
        );
    }

    #[test]
    fn near_miss_paper_options_are_ignored() {
        // Only the exact option (or `--paper=`) selects a paper; a file that
        // merely starts with "--paper" in its name is not one.
        assert_eq!(paper_size_in(["lattice", "--papers", "a3"]), Ok(PaperSize::A4));
        assert_eq!(paper_size_in(["lattice", "-paper", "a3"]), Ok(PaperSize::A4));
    }

    #[test]
    fn paper_absent_in_test_binary() {
        assert_eq!(requested_paper_size(), Ok(PaperSize::A4));
    }
}
// tests END *************************************************
