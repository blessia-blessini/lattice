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

use super::*;

#[test]
fn test_scan_content_pure_lf() {
    assert_eq!(scan_content("foo\nbar"), DetectedLineEndings::OnlyLF);
    assert_eq!(scan_content("foo\nbar\nbaz"), DetectedLineEndings::OnlyLF);
    assert_eq!(scan_content("\n"), DetectedLineEndings::OnlyLF);
}

#[test]
fn test_scan_content_pure_crlf() {
    assert_eq!(scan_content("foo\r\nbar"), DetectedLineEndings::OnlyCRLF);
    assert_eq!(
        scan_content("foo\r\nbar\r\nbaz"),
        DetectedLineEndings::OnlyCRLF
    );
    assert_eq!(scan_content("\r\n"), DetectedLineEndings::OnlyCRLF);
}

#[test]
fn test_scan_content_mixed() {
    assert_eq!(scan_content("a\nb\r\nc"), DetectedLineEndings::Mixed);
    assert_eq!(
        scan_content("Line1\r\nLine2\nLine3"),
        DetectedLineEndings::Mixed
    );
    // Edge case: LF followed immediately by CRLF
    assert_eq!(scan_content("\n\r\n"), DetectedLineEndings::Mixed);
}

#[test]
fn test_scan_content_none() {
    assert_eq!(scan_content(""), DetectedLineEndings::None);
    assert_eq!(
        scan_content("No line endings here"),
        DetectedLineEndings::None
    );
}

#[test]
fn test_decision_logic() {
    // None -> Default to OS
    assert_eq!(
        determine_wished_format(DetectedLineEndings::None, true),
        FileWishedFormat::NewLineCRLFLikeWindows
    );
    assert_eq!(
        determine_wished_format(DetectedLineEndings::None, false),
        FileWishedFormat::NewLineLFLikeUnix
    );

    // Mixed -> Default to OS
    assert_eq!(
        determine_wished_format(DetectedLineEndings::Mixed, true),
        FileWishedFormat::NewLineCRLFLikeWindows
    );
    assert_eq!(
        determine_wished_format(DetectedLineEndings::Mixed, false),
        FileWishedFormat::NewLineLFLikeUnix
    );

    // Pure Preserved
    assert_eq!(
        determine_wished_format(DetectedLineEndings::OnlyLF, true),
        FileWishedFormat::NewLineLFLikeUnix
    );
    assert_eq!(
        determine_wished_format(DetectedLineEndings::OnlyCRLF, false),
        FileWishedFormat::NewLineCRLFLikeWindows
    );
}
