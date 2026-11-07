// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

use crate::export::ExportFormat;
use crate::paper::{PaperSize, PAPER_FLAG};

/// Options whose *next* argument is their value, never a file path:
/// `--color` (injected by `cargo tauri dev`) and `--paper`. Each may also be
/// written `--option=value`.
const VALUED_OPTIONS: [&str; 2] = ["--color", PAPER_FLAG];

/// Options that ask for the usage text (REQ-LTTCE-CLU-00002). `/?` is the
/// Windows idiom; it is accepted on every platform because no real Markdown
/// file is called `?` in the root directory. Every other `/...` argument
/// stays a path — on Linux and macOS `/home/...` *is* one.
pub const HELP_OPTIONS: [&str; 3] = ["--help", "-h", "/?"];

/// Exit status for an unknown option (REQ-LTTCE-CLU-00001). 2 is the usual
/// "usage error" status, kept apart from the 1 an export failure returns, so a
/// script can tell "you called me wrong" from "the export went wrong".
pub const EXIT_USAGE: i32 = 2;

/// Prefix of the process-serial-number argument older macOS versions add
/// when an app is started from the Finder. The user never typed it, so it is
/// tolerated rather than reported. It takes no value.
const MACOS_PSN_PREFIX: &str = "-psn_";

/// Prefixes of the user-defaults overrides Cocoa reads from the command line
/// as `-Key Value` pairs — `-NSDocumentRevisionsDebugMode YES` from Xcode,
/// `-AppleLanguages (de)` from `open --args`. Host arguments, not Lattice
/// options: tolerated, and their value is never taken for a file.
const MACOS_DEFAULTS_PREFIXES: [&str; 2] = ["-NS", "-Apple"];


//**************************************************************
// ArgKind
//**************************************************************
/// What one command-line argument is, as decided by [`classify`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArgKind {
    /// Starts with `-`, or is one of [`HELP_OPTIONS`].
    Option,
    /// The value of the option right before it (`a3` in `--paper a3`).
    Value,
    /// Anything else: a file to open or export.
    Path,
}
// ArgKind END ***************************************************


//**************************************************************
// takes_value
//**************************************************************
/// Whether option `arg` takes the next argument as its value.
fn takes_value(arg: &str) -> bool {
    VALUED_OPTIONS.contains(&arg) || MACOS_DEFAULTS_PREFIXES.iter().any(|p| arg.starts_with(p))
}
// takes_value END ***********************************************


//**************************************************************
// classify
//**************************************************************
/// Sorts every argument after `args[0]` (the program) into [`ArgKind`]s.
///
/// The one rule every scan in this file reads — the option check, the file
/// paths, the paper and the export format — so they cannot disagree about
/// which argument is what. An option that [`takes_value`] claims the next
/// argument as its value only when that argument does not start with `-`:
/// `--paper --export-pdf` must not hide the export flag, and `--color --paper
/// a3` must not turn `--paper` into a value and `a3` into a file.
fn classify<I, S>(args: I) -> Vec<(ArgKind, String)>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out: Vec<(ArgKind, String)> = Vec::new();
    let mut value_allowed = false;
    for arg in args.into_iter().skip(1) {
        let arg = arg.as_ref();
        let kind = if HELP_OPTIONS.contains(&arg) || arg.starts_with('-') {
            ArgKind::Option
        } else if value_allowed {
            ArgKind::Value
        } else {
            ArgKind::Path
        };
        value_allowed = kind == ArgKind::Option && takes_value(arg);
        out.push((kind, arg.to_string()));
    }
    out
}
// classify END **************************************************


//**************************************************************
// OptionCheck
//**************************************************************
/// What the options on a command line ask for, decided before Tauri starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionCheck {
    /// Every option is known: start normally (editor or headless export).
    Run,
    /// A help option was given: print the usage text and exit 0.
    Help,
    /// The first unknown option, verbatim: print it with the usage text and
    /// exit [`EXIT_USAGE`].
    Unknown(String),
}
// OptionCheck END ***********************************************


//**************************************************************
// is_known_option
//**************************************************************
/// Whether option `arg` is one Lattice understands or a host injects (help
/// options excluded — [`check_options_in`] handles those first).
///
/// The export flags come from [`ExportFormat::ALL`] and the valued options
/// from [`VALUED_OPTIONS`], so a new option is known here as soon as it is
/// added there. `--paper=<value>` is known whatever the value: whether the
/// value is a real paper is [`paper_size_in`]'s question, with its own error.
fn is_known_option(arg: &str) -> bool {
    ExportFormat::from_flag(arg).is_some()
        || VALUED_OPTIONS.contains(&arg)
        || VALUED_OPTIONS
            .iter()
            .any(|o| arg.strip_prefix(o).is_some_and(|rest| rest.starts_with('=')))
        || arg.starts_with(MACOS_PSN_PREFIX)
        || MACOS_DEFAULTS_PREFIXES.iter().any(|p| arg.starts_with(p))
}
// is_known_option END *******************************************


//**************************************************************
// check_options_in
//**************************************************************
/// Classifies the options in `args` (`args[0]` being the program).
///
/// REQ-LTTCE-CLU-00001 / REQ-LTTCE-CLU-00002. Options are those [`classify`]
/// finds. A help option anywhere wins over an unknown one anywhere, so
/// `lattice --bogus --help` prints the help and exits 0. A bare `-` and `--`
/// are unknown: Lattice reads no standard input and has no end-of-options
/// marker.
///
/// Pure over its input; `lib.rs` calls it with the real command line.
pub fn check_options_in<I, S>(args: I) -> OptionCheck
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut first_unknown: Option<String> = None;
    for (kind, arg) in classify(args) {
        if kind != ArgKind::Option {
            continue;
        }
        if HELP_OPTIONS.contains(&arg.as_str()) {
            return OptionCheck::Help;
        }
        if first_unknown.is_none() && !is_known_option(&arg) {
            first_unknown = Some(arg);
        }
    }
    first_unknown.map_or(OptionCheck::Run, OptionCheck::Unknown)
}
// check_options_in END ******************************************


//**************************************************************
// usage_text
//**************************************************************
/// The short usage text printed for [`OptionCheck::Help`] and
/// [`OptionCheck::Unknown`]. Built from the constants the parser uses — every
/// [`ExportFormat`], the paper names and default, the help options — so a new
/// export format or paper appears here without an edit. It lists the options
/// a user types; host-injected ones (`--color`, `-psn_…`, `-NS…`) are not
/// for users and are left out.
pub fn usage_text() -> String {
    const COL: usize = 16;
    let paper_arg = format!("{PAPER_FLAG} <size>");
    let mut text = format!(
        "Usage: lattice [<file.md> ...]\n\
         \x20      lattice <export option> [{paper_arg}] <file.md> [<file.md> ...]\n\
         \n\
         Without options, opens each file in its own editor window.\n\
         \n\
         Options:\n",
    );
    for f in ExportFormat::ALL {
        let flag = f.flag();
        let ext = f.as_str();
        text.push_str(&format!("  {flag:<COL$} write each file's preview to <file>.{ext}, then exit\n"));
    }
    text.push_str(&format!(
        "  {paper_arg:<COL$} paper for {}: {} (default: {})\n",
        ExportFormat::Pdf.flag(),
        PaperSize::accepted_names(),
        PaperSize::default().name(),
    ));
    text.push_str(&format!("  {:<COL$} show this help and exit\n", HELP_OPTIONS.join(", ")));
    text
}
// usage_text END ************************************************


//**************************************************************
// respond_to_options
//**************************************************************
/// Acts on `check`: writes the help to `out` or the error and the usage to
/// `err`, and returns the exit status the process must end with — or `None`
/// for [`OptionCheck::Run`], where nothing is written and startup continues.
///
/// IMPL-LTTCE-CLU-00001. The writers are parameters so the exact bytes and
/// the exit status are unit-testable; `lib.rs` passes stdout and stderr.
/// Each message is built first and written with one `write_all`, so on an
/// unbuffered stderr it is one write, not one per formatted piece — less
/// room for a shell prompt to land in the middle of it. A failed write is
/// ignored: the exit status still tells a script what happened, and there is
/// nowhere left to report the write failure to.
pub fn respond_to_options(
    check: &OptionCheck,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
) -> Option<i32> {
    match check {
        OptionCheck::Run => None,
        OptionCheck::Help => {
            let _ = out.write_all(usage_text().as_bytes());
            let _ = out.flush();
            Some(0)
        }
        OptionCheck::Unknown(option) => {
            let message = format!("lattice: unknown option '{option}'\n\n{}", usage_text());
            let _ = err.write_all(message.as_bytes());
            let _ = err.flush();
            Some(EXIT_USAGE)
        }
    }
}
// respond_to_options END ****************************************

//**************************************************************
// file_paths_in
//**************************************************************
/// The file paths in `args` (`args[0]` being the program): every
/// [`ArgKind::Path`] of [`classify`] — so `--paper a4 notes.md` yields only
/// `notes.md`. Pure over its input so the rule is host-testable;
/// `collect_file_paths` is the `std::env::args()` wrapper.
pub fn file_paths_in<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    classify(args)
        .into_iter()
        .filter(|(kind, _)| *kind == ArgKind::Path)
        .map(|(_, arg)| arg)
        .collect()
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
/// same rule as the export flags themselves. Pure over its input; the value
/// is whatever [`classify`] marked as the option's value.
pub fn paper_size_in<I, S>(args: I) -> Result<PaperSize, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args = classify(args);
    for (i, (kind, arg)) in args.iter().enumerate() {
        if *kind != ArgKind::Option {
            continue;
        }
        let value = if arg == PAPER_FLAG {
            match args.get(i + 1) {
                Some((ArgKind::Value, v)) => v.clone(),
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
/// The headless export format requested by `args` (`args[0]` being the
/// program), or `None` for an ordinary interactive launch.
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
    classify(args)
        .into_iter()
        .filter(|(kind, _)| *kind == ArgKind::Option)
        .find_map(|(_, arg)| ExportFormat::from_flag(&arg))
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

    // ── check_options_in (UTST-LTTCE-CLU-00001) ─────────────────────────────

    fn unknown(o: &str) -> OptionCheck {
        OptionCheck::Unknown(o.to_string())
    }

    #[test]
    fn every_valid_command_line_runs() {
        for argv in [
            vec!["lattice"],
            vec!["lattice", "notes.md", "/abs/dir/other.md"],
            vec!["lattice", "--export-html", "a.md"],
            vec!["lattice", "--export-pdf", "--paper", "a3", "a.md"],
            vec!["lattice", "--export-pdf", "--paper=letter", "a.md"],
            // the value is paper_size_in's business, not an unknown option
            vec!["lattice", "--export-pdf", "--paper=a5", "a.md"],
            vec!["lattice", "--color", "always", "a.md"],
            vec!["lattice", "-psn_0_12345"],
        ] {
            assert_eq!(check_options_in(&argv), OptionCheck::Run, "{argv:?}");
        }
        assert_eq!(check_options_in(Vec::<&str>::new()), OptionCheck::Run);
    }

    #[test]
    fn every_help_option_asks_for_help() {
        for h in HELP_OPTIONS {
            assert_eq!(check_options_in(["lattice", h]), OptionCheck::Help, "{h}");
        }
    }

    #[test]
    fn help_wins_over_an_unknown_option_in_either_order() {
        assert_eq!(check_options_in(["lattice", "--bogus", "--help"]), OptionCheck::Help);
        assert_eq!(check_options_in(["lattice", "-h", "--bogus"]), OptionCheck::Help);
    }

    #[test]
    fn unknown_long_short_and_bare_dash_options_are_reported() {
        assert_eq!(check_options_in(["lattice", "--bogus", "a.md"]), unknown("--bogus"));
        assert_eq!(check_options_in(["lattice", "-x"]), unknown("-x"));
        assert_eq!(check_options_in(["lattice", "-"]), unknown("-"));
        assert_eq!(check_options_in(["lattice", "--"]), unknown("--"));
    }

    #[test]
    fn near_miss_options_are_unknown_not_silently_ignored() {
        // The same near misses that must not start an export
        // (near_miss_flags_do_not_trigger_an_export) must now be reported.
        for o in ["--export", "--export-pdf=a.pdf", "-export-pdf", "--EXPORT-PDF", "--papers", "-paper"] {
            assert_eq!(check_options_in(["lattice", o, "a.md"]), unknown(o), "{o}");
        }
    }

    #[test]
    fn the_first_unknown_option_is_the_one_reported() {
        assert_eq!(check_options_in(["lattice", "--one", "--two"]), unknown("--one"));
    }

    #[test]
    fn a_paper_value_is_not_checked_as_an_option_unless_it_looks_like_one() {
        // "a3" after --paper is a value; "--bogus" after --paper is still an
        // option, and so is the export flag in "--paper --export-pdf".
        assert_eq!(check_options_in(["lattice", "--paper", "a3"]), OptionCheck::Run);
        assert_eq!(check_options_in(["lattice", "--paper", "--bogus"]), unknown("--bogus"));
        assert_eq!(
            check_options_in(["lattice", "--paper", "--export-pdf", "a.md"]),
            OptionCheck::Run
        );
        assert_eq!(check_options_in(["lattice", "--paper", "-h"]), OptionCheck::Help);
        assert_eq!(check_options_in(["lattice", "--paper"]), OptionCheck::Run);
    }

    #[test]
    fn other_slash_arguments_stay_paths() {
        assert_eq!(check_options_in(["lattice", "/h"]), OptionCheck::Run);
        assert_eq!(check_options_in(["lattice", "/help.md"]), OptionCheck::Run);
    }

    // ── usage_text / respond_to_options (UTST-LTTCE-CLU-00002) ──────────────

    #[test]
    fn usage_text_names_every_option_and_paper() {
        let text = usage_text();
        assert!(text.starts_with("Usage: lattice"), "{text}");
        for f in ExportFormat::ALL {
            assert!(text.contains(f.flag()), "{} missing:\n{text}", f.flag());
        }
        for h in HELP_OPTIONS {
            assert!(text.contains(h), "{h} missing:\n{text}");
        }
        assert!(text.contains(PAPER_FLAG), "{text}");
        assert!(text.contains(&PaperSize::accepted_names()), "{text}");
        assert!(text.ends_with('\n'), "{text}");
    }

    /// Width the usage text must fit in: a standard terminal (REQ-LTTCE-CLU-00002).
    const USAGE_MAX_COLUMNS: usize = 80;

    #[test]
    fn usage_text_stays_short() {
        // REQ-LTTCE-CLU-00002: one screen, and no line that wraps in a
        // standard 80-column terminal.
        let text = usage_text();
        assert!(text.lines().count() <= 15, "{text}");
        for line in text.lines() {
            assert!(line.chars().count() <= USAGE_MAX_COLUMNS, "{} columns: {line}", line.len());
        }
    }

    #[test]
    fn usage_text_lists_user_options_only() {
        // Host-injected arguments are tolerated, not advertised.
        let text = usage_text();
        assert!(!text.contains("--color") && !text.contains("-psn") && !text.contains("-NS"), "{text}");
    }

    // ── classify: one rule for every scan (review cycle 1, finding 2) ───────

    #[test]
    fn a_valued_option_never_swallows_the_next_option() {
        // `--color --paper a3`: --paper is an option, a3 its value, no file.
        let argv = ["lattice", "--export-pdf", "--color", "--paper", "a3", "notes.md"];
        assert_eq!(file_paths_in(argv), vec!["notes.md"]);
        assert_eq!(check_options_in(argv), OptionCheck::Run);
        assert_eq!(paper_size_in(argv), Ok(PaperSize::A3));
        assert_eq!(export_format_in(argv), Some(ExportFormat::Pdf));
        // `--paper --paper a3`: the first --paper has no value.
        let argv = ["lattice", "--export-pdf", "--paper", "--paper", "a3", "notes.md"];
        assert_eq!(file_paths_in(argv), vec!["notes.md"]);
        assert!(paper_size_in(argv).unwrap_err().contains("needs a value"));
    }

    #[test]
    fn every_scan_agrees_on_what_each_argument_is() {
        let argv = ["lattice", "--color", "always", "a.md", "--paper", "letter", "b.md", "--export-pdf"];
        let kinds: Vec<ArgKind> = classify(argv).into_iter().map(|(k, _)| k).collect();
        use ArgKind::{Option as O, Path as P, Value as V};
        assert_eq!(kinds, vec![O, V, P, O, V, P, O]);
        assert_eq!(file_paths_in(argv), vec!["a.md", "b.md"]);
    }

    #[test]
    fn the_program_name_is_never_an_argument() {
        // argv[0] may be anything, even something that looks like a flag.
        assert_eq!(export_format_in(["--export-pdf", "a.md"]), None);
        assert_eq!(paper_size_in(["--paper=a5"]), Ok(PaperSize::A4));
        assert_eq!(check_options_in(["--bogus"]), OptionCheck::Run);
    }

    // ── host-injected arguments (review cycle 1, finding 1) ─────────────────

    #[test]
    fn macos_defaults_overrides_are_tolerated_and_their_value_is_no_file() {
        for argv in [
            vec!["lattice", "-NSDocumentRevisionsDebugMode", "YES", "notes.md"],
            vec!["lattice", "-AppleLanguages", "(de)", "notes.md"],
            vec!["lattice", "-ApplePersistenceIgnoreState", "YES", "notes.md"],
        ] {
            assert_eq!(check_options_in(&argv), OptionCheck::Run, "{argv:?}");
            assert_eq!(file_paths_in(&argv), vec!["notes.md"], "{argv:?}");
        }
    }

    #[test]
    fn run_writes_nothing_and_continues() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        assert_eq!(respond_to_options(&OptionCheck::Run, &mut out, &mut err), None);
        assert!(out.is_empty() && err.is_empty());
    }

    #[test]
    fn help_goes_to_stdout_with_status_0() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        assert_eq!(respond_to_options(&OptionCheck::Help, &mut out, &mut err), Some(0));
        assert_eq!(String::from_utf8(out).unwrap(), usage_text());
        assert!(err.is_empty());
    }

    #[test]
    fn an_unknown_option_goes_to_stderr_with_the_usage_and_status_2() {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = respond_to_options(&unknown("--bogus"), &mut out, &mut err);
        assert_eq!(code, Some(EXIT_USAGE));
        assert_eq!(EXIT_USAGE, 2);
        assert!(out.is_empty());
        let err = String::from_utf8(err).unwrap();
        assert!(err.starts_with("lattice: unknown option '--bogus'\n\n"), "{err}");
        assert!(err.ends_with(&usage_text()), "{err}");
    }

    #[test]
    fn a_failing_writer_still_yields_the_exit_status() {
        struct Broken;
        impl std::io::Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("closed"))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Err(std::io::Error::other("closed"))
            }
        }
        assert_eq!(respond_to_options(&OptionCheck::Help, &mut Broken, &mut Broken), Some(0));
        assert_eq!(
            respond_to_options(&unknown("-x"), &mut Broken, &mut Broken),
            Some(EXIT_USAGE)
        );
    }
}
// tests END *************************************************
