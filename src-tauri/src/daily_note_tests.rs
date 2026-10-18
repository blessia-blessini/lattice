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

//! UTST for the daily note (REQ-LTTCE-DLN-00002 … REQ-LTTCE-DLN-00005,
//! IMPL-LTTCE-DLN-00001 … IMPL-LTTCE-DLN-00003).
//!
//! Every file-system case works inside its own `TempDir` and never looks
//! outside it, so the result cannot depend on the developer's machine.

use super::*;

//******************************************************************************
// helpers
//******************************************************************************
/// Shorthand for a calendar date that is known to be valid.
fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).expect("valid test date")
}

/// Shorthand for a prefix that is known to be valid.
fn prefix(value: &str) -> DailyNotePrefix {
    DailyNotePrefix::new(value).expect("valid test prefix")
}

/// The whole file, as text.
fn read(path: &Path) -> String {
    std::fs::read_to_string(path).expect("daily note readable")
}
// helpers END *****************************************************************

//******************************************************************************
// prefix — REQ-LTTCE-DLN-00005
//******************************************************************************
mod prefix_rules {
    use super::*;

    #[test]
    fn default_is_dln() {
        assert_eq!(DailyNotePrefix::default().as_str(), "DLN");
        assert_eq!(
            DailyNotePrefix::default().as_str(),
            DAILY_NOTE_PREFIX_DEFAULT
        );
    }

    #[test]
    fn accepts_zero_to_three_ascii_letters_and_digits() {
        for ok in ["", "D", "DL", "DLN", "dln", "a1Z", "007", "9"] {
            assert!(DailyNotePrefix::new(ok).is_ok(), "{ok:?} must be accepted");
        }
    }

    #[test]
    fn rejects_more_than_three_characters() {
        let err = DailyNotePrefix::new("DLNX").unwrap_err();
        assert!(err.contains("longer than 3"), "unexpected message: {err}");
    }

    #[test]
    fn rejects_anything_that_is_not_a_latin_letter_or_digit() {
        // Path separators and dots matter most: the prefix becomes part of a
        // file name, so none of these may ever reach Path::join.
        for bad in [
            "a/b", "..", ".", "a\\", "/", "a b", " ", "-", "_", "a.b", "é", "ÄÖ", "1\n",
        ] {
            assert!(
                DailyNotePrefix::new(bad).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn length_is_counted_in_characters_not_bytes() {
        // Three non-ASCII letters are three characters (six bytes) — rejected
        // for being non-ASCII, never for being "too long".
        let err = DailyNotePrefix::new("äöü").unwrap_err();
        assert!(
            err.contains("may only contain"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn deserializes_only_valid_values() {
        let ok: DailyNotePrefix = serde_json::from_str(r#""AB1""#).unwrap();
        assert_eq!(ok.as_str(), "AB1");
        let empty: DailyNotePrefix = serde_json::from_str(r#""""#).unwrap();
        assert_eq!(empty.as_str(), "");

        assert!(serde_json::from_str::<DailyNotePrefix>(r#""../x""#).is_err());
        assert!(serde_json::from_str::<DailyNotePrefix>(r#""TOOLONG""#).is_err());
        assert!(
            serde_json::from_str::<DailyNotePrefix>("42").is_err(),
            "a number is not a prefix"
        );
    }

    #[test]
    fn serializes_as_a_plain_string() {
        assert_eq!(serde_json::to_string(&prefix("Ab9")).unwrap(), r#""Ab9""#);
        assert_eq!(String::from(prefix("")), "");
    }
}
// prefix END ******************************************************************

//******************************************************************************
// file name — REQ-LTTCE-DLN-00002
//******************************************************************************
mod file_name {
    use super::*;

    #[test]
    fn matches_the_specified_example() {
        // The example from the feature request: 2026-Aug-04, a Tuesday.
        assert_eq!(
            daily_note_base_name(&prefix("DLN"), ymd(2026, 8, 4)),
            "DLN-2026-08-04-Tue"
        );
    }

    #[test]
    fn empty_prefix_leaves_no_leading_dash() {
        assert_eq!(
            daily_note_base_name(&prefix(""), ymd(2026, 8, 4)),
            "2026-08-04-Tue"
        );
    }

    #[test]
    fn keeps_the_prefix_case_as_typed() {
        assert_eq!(
            daily_note_base_name(&prefix("dn1"), ymd(2026, 8, 4)),
            "dn1-2026-08-04-Tue"
        );
    }

    #[test]
    fn pads_month_and_day_to_two_digits() {
        assert_eq!(
            daily_note_base_name(&prefix("DLN"), ymd(2026, 1, 5)),
            "DLN-2026-01-05-Mon"
        );
    }

    #[test]
    fn uses_english_three_letter_weekdays_mon_to_sun() {
        // 2026-08-03 is a Monday; walk one full week.
        let expected = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for (offset, day) in expected.iter().enumerate() {
            let date = ymd(2026, 8, 3 + offset as u32);
            assert!(
                daily_note_base_name(&prefix(""), date).ends_with(day),
                "{date} must end with {day}"
            );
        }
    }
}
// file name END ***************************************************************

//******************************************************************************
// title — REQ-LTTCE-DLN-00004
//******************************************************************************
mod title {
    use super::*;

    /// Title in calendar-week mode for `date` (the base name is irrelevant).
    fn cw(date: NaiveDate) -> String {
        daily_note_title("ignored", date, true)
    }

    #[test]
    fn file_name_mode_repeats_the_name_without_extension() {
        assert_eq!(
            daily_note_title("DLN-2026-08-04-Tue", ymd(2026, 8, 4), false),
            "# Daily Note: DLN-2026-08-04-Tue"
        );
    }

    #[test]
    fn calendar_week_mode_mid_year() {
        assert_eq!(cw(ymd(2026, 8, 4)), "# Daily Note: 2026 CW32 Tue");
        assert_eq!(cw(ymd(2026, 10, 18)), "# Daily Note: 2026 CW42 Sun");
    }

    #[test]
    fn calendar_week_is_two_digits() {
        assert_eq!(cw(ymd(2026, 1, 5)), "# Daily Note: 2026 CW02 Mon");
    }

    #[test]
    fn week_one_is_the_week_holding_the_first_thursday() {
        // 2026-01-01 is a Thursday, so it lies in week 1 of 2026 …
        assert_eq!(cw(ymd(2026, 1, 1)), "# Daily Note: 2026 CW01 Thu");
        // … and so does the Monday before it, still in calendar year 2025.
        assert_eq!(cw(ymd(2025, 12, 29)), "# Daily Note: 2026 CW01 Mon");
        // 2024-12-30 (Mon) opens the week holding Thursday 2025-01-02.
        assert_eq!(cw(ymd(2024, 12, 30)), "# Daily Note: 2025 CW01 Mon");
    }

    #[test]
    fn early_january_can_belong_to_week_53_of_the_previous_year() {
        // 2026 starts on a Thursday, so it has 53 ISO weeks; 2027-01-01 (Fri)
        // is in the last of them.
        assert_eq!(cw(ymd(2027, 1, 1)), "# Daily Note: 2026 CW53 Fri");
        // 2020 (leap year starting on a Wednesday) also has 53 weeks.
        assert_eq!(cw(ymd(2021, 1, 3)), "# Daily Note: 2020 CW53 Sun");
    }

    #[test]
    fn week_one_never_shows_the_previous_years_number() {
        // The case the user would notice: the filename year is 2025, but the
        // week is 2026's week 1 — the title must say 2026.
        let date = ymd(2025, 12, 31);
        assert_eq!(
            daily_note_base_name(&prefix("DLN"), date),
            "DLN-2025-12-31-Wed"
        );
        assert_eq!(cw(date), "# Daily Note: 2026 CW01 Wed");
    }
}
// title END *******************************************************************

//******************************************************************************
// create_or_open — REQ-LTTCE-DLN-00002 / -00003 / -00004
//******************************************************************************
mod create_or_open {
    use super::*;

    #[test]
    fn creates_the_note_with_its_title_and_no_line_ending() {
        let tmp = tempfile::tempdir().unwrap();
        let note =
            create_or_open_daily_note(tmp.path(), &prefix("DLN"), false, ymd(2026, 8, 4)).unwrap();

        assert!(note.created);
        assert_eq!(note.path, tmp.path().join("DLN-2026-08-04-Tue.md"));
        assert_eq!(read(&note.path), "# Daily Note: DLN-2026-08-04-Tue");
    }

    #[test]
    fn creates_the_calendar_week_title_when_asked() {
        let tmp = tempfile::tempdir().unwrap();
        let note =
            create_or_open_daily_note(tmp.path(), &prefix("DLN"), true, ymd(2026, 10, 18)).unwrap();

        assert_eq!(note.path, tmp.path().join("DLN-2026-10-18-Sun.md"));
        assert_eq!(read(&note.path), "# Daily Note: 2026 CW42 Sun");
    }

    #[test]
    fn empty_prefix_names_the_file_by_date_only() {
        let tmp = tempfile::tempdir().unwrap();
        let note =
            create_or_open_daily_note(tmp.path(), &prefix(""), false, ymd(2026, 8, 4)).unwrap();

        assert_eq!(note.path, tmp.path().join("2026-08-04-Tue.md"));
        assert_eq!(read(&note.path), "# Daily Note: 2026-08-04-Tue");
    }

    #[test]
    fn creates_a_missing_folder_with_its_parents() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("deep").join("nested").join("daily");
        assert!(!dir.exists(), "pre-condition");

        let note = create_or_open_daily_note(&dir, &prefix("DLN"), false, ymd(2026, 8, 4)).unwrap();
        assert!(note.created);
        assert!(note.path.is_file());
    }

    #[test]
    fn second_call_opens_the_same_note_without_touching_it() {
        let tmp = tempfile::tempdir().unwrap();
        let date = ymd(2026, 8, 4);
        let first = create_or_open_daily_note(tmp.path(), &prefix("DLN"), false, date).unwrap();

        // Different title mode on the second call: an existing note must still
        // not be re-titled.
        let second = create_or_open_daily_note(tmp.path(), &prefix("DLN"), true, date).unwrap();

        assert!(!second.created);
        assert_eq!(second.path, first.path);
        assert_eq!(read(&second.path), "# Daily Note: DLN-2026-08-04-Tue");
    }

    #[test]
    fn concurrent_calls_create_the_note_exactly_once() {
        // Two Lattice windows pressing the button at the same moment: the
        // existence check and the creation are one atomic step, so exactly
        // one caller creates (and titles) the note and nobody truncates it.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let dir = dir.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    create_or_open_daily_note(&dir, &prefix("DLN"), false, ymd(2026, 8, 4)).unwrap()
                })
            })
            .collect();
        let notes: Vec<DailyNote> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        assert_eq!(
            notes.iter().filter(|n| n.created).count(),
            1,
            "exactly one creator"
        );
        assert!(
            notes.iter().all(|n| n.path == notes[0].path),
            "all callers get the same note"
        );
        assert_eq!(read(&notes[0].path), "# Daily Note: DLN-2026-08-04-Tue");
    }

    #[test]
    fn existing_note_keeps_the_users_content_byte_for_byte() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("DLN-2026-08-04-Tue.md");
        let original = "my own notes\r\n- [ ] keep me\r\n";
        std::fs::write(&path, original).unwrap();

        let note =
            create_or_open_daily_note(tmp.path(), &prefix("DLN"), true, ymd(2026, 8, 4)).unwrap();

        assert!(!note.created);
        assert_eq!(note.path, path);
        assert_eq!(
            read(&path),
            original,
            "an existing note must never be rewritten"
        );
    }

    #[test]
    fn existing_empty_note_is_not_given_a_title() {
        // Only a note this call created gets a title (REQ-LTTCE-DLN-00004).
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("DLN-2026-08-04-Tue.md");
        std::fs::write(&path, "").unwrap();

        let note =
            create_or_open_daily_note(tmp.path(), &prefix("DLN"), false, ymd(2026, 8, 4)).unwrap();

        assert!(!note.created);
        assert_eq!(read(&path), "");
    }

    #[test]
    fn notes_of_other_days_are_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let yesterday = tmp.path().join("DLN-2026-08-03-Mon.md");
        std::fs::write(&yesterday, "yesterday").unwrap();

        let note =
            create_or_open_daily_note(tmp.path(), &prefix("DLN"), false, ymd(2026, 8, 4)).unwrap();

        assert!(note.created);
        assert_eq!(read(&yesterday), "yesterday");
    }

    #[test]
    fn a_folder_with_the_notes_name_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("DLN-2026-08-04-Tue.md")).unwrap();

        let err = create_or_open_daily_note(tmp.path(), &prefix("DLN"), false, ymd(2026, 8, 4))
            .unwrap_err();
        assert!(err.contains("not a file"), "unexpected message: {err}");
    }

    #[test]
    fn a_file_where_the_folder_should_be_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let blocker = tmp.path().join("daily");
        std::fs::write(&blocker, "I am a file").unwrap();

        let err = create_or_open_daily_note(&blocker, &prefix("DLN"), false, ymd(2026, 8, 4))
            .unwrap_err();
        assert!(
            err.contains("daily notes folder"),
            "unexpected message: {err}"
        );
        assert_eq!(
            read(&blocker),
            "I am a file",
            "the blocking file must be left as it was"
        );
    }

    #[test]
    fn an_empty_folder_path_is_an_error() {
        let err = create_or_open_daily_note(Path::new(""), &prefix("DLN"), false, ymd(2026, 8, 4))
            .unwrap_err();
        assert!(err.contains("not set"), "unexpected message: {err}");
    }
}
// create_or_open END **********************************************************

//******************************************************************************
// open_daily_note — the command reads the local clock
//******************************************************************************
mod command {
    use super::*;

    #[test]
    fn opens_todays_note_in_the_given_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().into_owned();

        // Bracket the call with two clock reads so a run across midnight
        // cannot fail the test.
        let before = chrono::Local::now().date_naive();
        let path = open_daily_note(dir, prefix("DLN"), false).unwrap();
        let after = chrono::Local::now().date_naive();

        let name = Path::new(&path)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let expected: Vec<String> = [before, after]
            .iter()
            .map(|d| format!("{}.md", daily_note_base_name(&prefix("DLN"), *d)))
            .collect();
        assert!(
            expected.contains(&name),
            "{name} must be one of {expected:?}"
        );
        assert!(Path::new(&path).starts_with(tmp.path()));
        assert!(read(Path::new(&path)).starts_with("# Daily Note: DLN-"));
    }

    #[test]
    fn reports_errors_as_text() {
        let err = open_daily_note(String::new(), prefix("DLN"), false).unwrap_err();
        assert!(err.contains("not set"));
    }
}
// command END *****************************************************************
