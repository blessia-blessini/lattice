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

use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Weekday};

////////////////////////////////////////////////////////////////
/// generate_version_string
////////////////////////////////////////////////////////////////
fn generate_version_string<Tz: TimeZone>(ptimestamp: DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    // 1. Year and Week
    // using iso_week() to align with ISO8601 as requested
    let iso_week = ptimestamp.iso_week();
    let year = iso_week.year();
    let week = iso_week.week();

    // 2. Calculate Hex Time (BBBB)
    // "number of 20sec periods passed since Monday Morning 0.0h"
    // We need the Date of the Monday of this ISO week.

    // NaiveDate::from_isoywd_opt creates a date from ISO year, week, and weekday.
    let monday_date = NaiveDate::from_isoywd_opt(year, week, Weekday::Mon)
        .expect("Failed to calculate Monday date");

    // Convert to local datetime at 00:00:00
    // We use the timezone of the passed 'now'
    let monday_start = ptimestamp
        .timezone()
        .from_local_datetime(&monday_date.and_hms_opt(0, 0, 0).unwrap())
        .single()
        .expect("Ambiguous or invalid local time for Monday 00:00");

    let duration = ptimestamp.signed_duration_since(monday_start);
    let seconds_since_monday = duration.num_seconds();

    // Ensure non-negative (might happen if system clock changed or very close to boundary)
    let safe_seconds = if seconds_since_monday < 0 {
        0
    } else {
        seconds_since_monday as u64
    };

    let periods = safe_seconds / 20;

    // Format: YYYY.WW.BBBB (Leading Zeros)
    format!("{:04}W{:02}.{:04X}", year, week, periods)
} // generate_version_string END /////////////////////////////////

////////////////////////////////////////////////////////////////
/// main
////////////////////////////////////////////////////////////////
fn main() {
    let now = Local::now();
    println!("{}", generate_version_string(now));
} // main END ////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
/// tests
////////////////////////////////////////////////////////////////
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    #[test]
    fn test_first_second_of_week() {
        // Monday 00:00:00
        // Using FixedOffset to avoid local timezone complexity in tests
        // Example: 2024-01-08 is a Monday (Week 02)
        let tz = FixedOffset::east_opt(0).unwrap();
        let monday = tz.with_ymd_and_hms(2024, 1, 8, 0, 0, 0).unwrap();

        assert_eq!(generate_version_string(monday), "2024.CW02.0000");
    }

    #[test]
    fn test_last_second_of_week() {
        // Sunday 23:59:59
        // Example: 2024-01-14 is a Sunday (Week 02)
        let tz = FixedOffset::east_opt(0).unwrap();
        let sunday = tz.with_ymd_and_hms(2024, 1, 14, 23, 59, 59).unwrap();

        // Seconds in a week = 7 * 24 * 3600 = 604800
        // Last second index (0-based) = 604799
        // Periods = 604799 / 20 = 30239.95 -> 30239
        // 30239 in Hex is 0x761F
        assert_eq!(generate_version_string(sunday), "2024.CW02.761F");
    }
} // tests END ///////////////////////////////////////////////////
