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

//! Daily note — file name, title line, and create-or-open (Chapter DLN).
//!
//! One command, two entry points in the UI (the menu entry and the 🗒 toolbar
//! button): open today's note in the "Daily Notes Path" folder, creating it
//! first if it does not exist yet.
//!
//! ```text
//!   prefix "DLN", 2026-08-04       → DLN-2026-08-04-Tue.md
//!   prefix "",    2026-08-04       → 2026-08-04-Tue.md
//!   title, calendar-week mode OFF  → # Daily Note: DLN-2026-08-04-Tue
//!   title, calendar-week mode ON   → # Daily Note: 2026 CW32 Tue
//! ```
//!
//! Everything that decides *what* the note is called and *what* it starts
//! with is pure (takes a `NaiveDate`, returns a `String`) so it is unit-tested
//! against fixed dates, year boundaries included. Only [`open_daily_note`]
//! reads the clock.
//!
//! ## Why the prefix is a type, not a `String`
//!
//! The prefix becomes part of a file name. [`DailyNotePrefix`] can only be
//! constructed from 0–3 ASCII letters or digits, and it deserializes through
//! the same check (`#[serde(try_from = "String")]`). So an invalid value is
//! stopped wherever it enters: a hand-edited `settings.json` (the lenient
//! settings loader then drops just that field back to its default,
//! REQ-LTTCE-SET-00001) or an IPC call from the WebView (the command is never
//! entered). A path separator or `..` can therefore never reach `Path::join`.
//!
//! ## Why the title is written without a line ending
//!
//! Lattice writes a file with the line endings it already has, and gives a
//! file that has none the platform's native ones on its first save
//! (`file_state::determine_wished_format`). Writing the single title line with
//! no terminator leaves that decision to the one place that already makes it,
//! instead of hard-coding `\n` (or branching on the OS) here.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

/// Prefix used when the setting is absent from `settings.json`
/// (REQ-LTTCE-DLN-00005). Keep in sync with `DAILY_NOTE_PREFIX_DEFAULT` in
/// `src/lib/daily-note.ts` (documented pairing — the two codebases
/// cannot share one constant without codegen).
pub const DAILY_NOTE_PREFIX_DEFAULT: &str = "DLN";

/// Longest allowed prefix, in characters (REQ-LTTCE-DLN-00005). Keep in sync
/// with `DAILY_NOTE_PREFIX_MAX_LEN` in `src/lib/daily-note.ts`.
pub const DAILY_NOTE_PREFIX_MAX_LEN: usize = 3;

/// Text in front of the name or calendar week in a new note's title line.
const TITLE_LEAD: &str = "# Daily Note: ";

/// File extension of a daily note.
const DAILY_NOTE_EXTENSION: &str = "md";

//******************************************************************************
// DailyNotePrefix
//******************************************************************************
/// IMPL-LTTCE-DLN-00001 — a validated daily-note file-name prefix
/// (REQ-LTTCE-DLN-00005).
///
/// Invariant: 0 to [`DAILY_NOTE_PREFIX_MAX_LEN`] characters, each one of
/// `A–Z`, `a–z`, `0–9`. The empty prefix is valid and means "no prefix".
/// The only constructors are [`DailyNotePrefix::new`], `Default` and serde
/// (which goes through `new`), so a value of this type always holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct DailyNotePrefix(String);

impl DailyNotePrefix {
    //**************************************************************************
    // DailyNotePrefix::new
    //**************************************************************************
    /// Validate `value` and wrap it. Returns a human-readable error naming the
    /// rule that was broken; the value itself is quoted so the user can find
    /// it in a hand-edited settings file.
    pub fn new(value: &str) -> Result<Self, String> {
        let length = value.chars().count();
        if length > DAILY_NOTE_PREFIX_MAX_LEN {
            return Err(format!(
                "Daily note prefix {value:?} is longer than {DAILY_NOTE_PREFIX_MAX_LEN} characters"
            ));
        }
        if !value.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(format!(
                "Daily note prefix {value:?} may only contain the letters A-Z, a-z and the digits 0-9"
            ));
        }
        Ok(Self(value.to_string()))
    }
    // DailyNotePrefix::new END ************************************************

    /// The prefix text; empty when the user chose "no prefix".
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for DailyNotePrefix {
    fn default() -> Self {
        Self(DAILY_NOTE_PREFIX_DEFAULT.to_string())
    }
}

impl TryFrom<String> for DailyNotePrefix {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(&value)
    }
}

impl From<DailyNotePrefix> for String {
    fn from(prefix: DailyNotePrefix) -> Self {
        prefix.0
    }
}
// DailyNotePrefix END *********************************************************

//******************************************************************************
// daily_note_base_name
//******************************************************************************
/// IMPL-LTTCE-DLN-00002 — the note's name without extension
/// (REQ-LTTCE-DLN-00002): `<prefix>-YYYY-MM-DD-ddd`, or `YYYY-MM-DD-ddd` when
/// the prefix is empty. `ddd` is the English weekday abbreviation (`Mon` …
/// `Sun`) whatever the system locale — chrono's `%a` is not localised.
pub fn daily_note_base_name(prefix: &DailyNotePrefix, date: NaiveDate) -> String {
    let stamp = date.format("%Y-%m-%d-%a").to_string();
    if prefix.as_str().is_empty() {
        stamp
    } else {
        format!("{}-{}", prefix.as_str(), stamp)
    }
}
// daily_note_base_name END ****************************************************

//******************************************************************************
// daily_note_title
//******************************************************************************
/// IMPL-LTTCE-DLN-00002 — the title line a new note starts with
/// (REQ-LTTCE-DLN-00004).
///
/// * `use_calendar_week_title == false` → `# Daily Note: <base_name>`
/// * `use_calendar_week_title == true`  → `# Daily Note: YYYY CWWW ddd`
///
/// The calendar week is ISO 8601: weeks start on Monday and week 1 is the
/// week that contains the year's first Thursday. `YYYY` is the year that
/// *week* belongs to, which differs from the calendar year for a few days
/// around New Year (Mon 2025-12-29 is `2026 CW01`, Fri 2027-01-01 is
/// `2026 CW53`) — otherwise those days would be titled with a week that does
/// not exist in the year shown.
pub fn daily_note_title(base_name: &str, date: NaiveDate, use_calendar_week_title: bool) -> String {
    if use_calendar_week_title {
        let week = date.iso_week();
        format!(
            "{TITLE_LEAD}{} CW{:02} {}",
            week.year(),
            week.week(),
            date.format("%a")
        )
    } else {
        format!("{TITLE_LEAD}{base_name}")
    }
}
// daily_note_title END ********************************************************

//******************************************************************************
// DailyNote
//******************************************************************************
/// Result of [`create_or_open_daily_note`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyNote {
    /// Full path of the note.
    pub path: PathBuf,
    /// `true` when this call created the file and wrote the title; `false`
    /// when the file was already there and was left untouched.
    pub created: bool,
}
// DailyNote END ***************************************************************

//******************************************************************************
// create_or_open_daily_note
//******************************************************************************
/// IMPL-LTTCE-DLN-00003 — make sure the note for `date` exists in `dir` and
/// return its path (REQ-LTTCE-DLN-00002 … REQ-LTTCE-DLN-00004).
///
/// * `dir` is created (with parents) when missing.
/// * The file is created with `create_new`, i.e. `O_EXCL` / `CREATE_NEW`: the
///   existence check and the creation are one atomic operation. An existing
///   note — including one created a moment ago by a second Lattice window —
///   is therefore never truncated or rewritten, only reported back.
/// * Only a file that this call created gets the title line.
/// * A *directory* with the note's name is an error, not "already exists".
pub fn create_or_open_daily_note(
    dir: &Path,
    prefix: &DailyNotePrefix,
    use_calendar_week_title: bool,
    date: NaiveDate,
) -> Result<DailyNote, String> {
    if dir.as_os_str().is_empty() {
        return Err("Daily notes path is not set.".to_string());
    }
    std::fs::create_dir_all(dir).map_err(|e| {
        format!(
            "Cannot create the daily notes folder {}: {e}",
            dir.display()
        )
    })?;

    let base_name = daily_note_base_name(prefix, date);
    let path = dir.join(format!("{base_name}.{DAILY_NOTE_EXTENSION}"));

    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let title = daily_note_title(&base_name, date, use_calendar_week_title);
            file.write_all(title.as_bytes()).map_err(|e| {
                format!(
                    "Created {} but could not write its title: {e}",
                    path.display()
                )
            })?;
            Ok(DailyNote {
                path,
                created: true,
            })
        }
        // Windows answers `CREATE_NEW` on an existing *directory* with
        // ERROR_ACCESS_DENIED, not ERROR_FILE_EXISTS, so the error kind alone
        // does not reveal that the name is taken — look at the path as well.
        Err(e) if e.kind() == ErrorKind::AlreadyExists || path.is_dir() => {
            if path.is_file() {
                Ok(DailyNote {
                    path,
                    created: false,
                })
            } else {
                Err(format!(
                    "{} exists but is not a file; cannot open it as the daily note",
                    path.display()
                ))
            }
        }
        Err(e) => Err(format!(
            "Cannot create the daily note {}: {e}",
            path.display()
        )),
    }
}
// create_or_open_daily_note END ***********************************************

//******************************************************************************
// open_daily_note (Tauri command)
//******************************************************************************
/// IMPL-LTTCE-DLN-00003 — Tauri command behind the menu entry and the 🗒
/// toolbar button. Uses the *local* date, creates the note if needed, and
/// returns its full path for the frontend to load like any other file.
///
/// `prefix` is a [`DailyNotePrefix`], so an invalid prefix sent over IPC is
/// rejected while the arguments are deserialized — this body never sees it.
#[tauri::command]
pub fn open_daily_note(
    daily_notes_path: String,
    prefix: DailyNotePrefix,
    use_calendar_week_title: bool,
) -> Result<String, String> {
    let today = chrono::Local::now().date_naive();
    create_or_open_daily_note(
        Path::new(&daily_notes_path),
        &prefix,
        use_calendar_week_title,
        today,
    )
    .map(|note| note.path.to_string_lossy().into_owned())
}
// open_daily_note END *********************************************************

#[cfg(test)]
#[path = "daily_note_tests.rs"]
mod tests;
