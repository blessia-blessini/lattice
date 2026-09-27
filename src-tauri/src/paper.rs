// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Page geometry for `--export-pdf`: which paper, and how much margin.
//!
//! IMPL-LTTCE-XPT-00007 — REQ-LTTCE-XPT-00011 (paper chosen on the command
//! line) and REQ-LTTCE-XPT-00012 (the same page on every platform).
//!
//! The geometry is decided here, once, and handed to each host print API
//! explicitly. Leaving it to the hosts is what produced three different pages
//! from one document: WebView2 fell back to US Letter, WebKitGTK to A4 with
//! GTK's near-zero default margins (it ignores the CSS `@page` margin), and the
//! macOS path took a window-sized snapshot. Pure and host-testable — no Tauri,
//! GTK, COM or AppKit types.

//**************************************************************
// Page geometry constants
//**************************************************************
/// The CLI option that selects the paper: `--paper <name>` or `--paper=<name>`.
pub const PAPER_FLAG: &str = "--paper";

/// Margin on every side of every page, in millimetres.
///
/// Mirrors `@page { margin: 2cm }` in `src/App.css`, which only Chromium
/// (WebView2) honours. The WebKit hosts are given this value through their own
/// page-setup APIs instead, so all three produce the same page. Change both
/// together.
pub const PAGE_MARGIN_MM: f64 = 20.0;

const MM_PER_INCH: f64 = 25.4;
const POINTS_PER_INCH: f64 = 72.0;
// Page geometry constants END ***********************************


//**************************************************************
// PaperSize
//**************************************************************
/// The paper a PDF export is laid out on. Always portrait.
///
/// Single source of truth for the names the CLI accepts and for the physical
/// size each host API is given, converted to its own unit with the helpers
/// below (millimetres for GTK, inches for WebView2, points for AppKit).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PaperSize {
    /// ISO A4, 210 × 297 mm — the default.
    #[default]
    A4,
    /// ISO A3, 297 × 420 mm.
    A3,
    /// US Letter, 8.5 × 11 in.
    Letter,
}

impl PaperSize {
    /// Every paper size, in the order they are listed to the user.
    pub const ALL: [PaperSize; 3] = [PaperSize::A4, PaperSize::A3, PaperSize::Letter];

    /// The lowercase name accepted after `--paper`.
    pub const fn name(self) -> &'static str {
        match self {
            PaperSize::A4 => "a4",
            PaperSize::A3 => "a3",
            PaperSize::Letter => "letter",
        }
    }

    /// Portrait width and height in millimetres.
    pub const fn size_mm(self) -> (f64, f64) {
        match self {
            PaperSize::A4 => (210.0, 297.0),
            PaperSize::A3 => (297.0, 420.0),
            PaperSize::Letter => (215.9, 279.4),
        }
    }

    /// Portrait width and height in PostScript points (AppKit's unit, and the
    /// unit of a PDF `/MediaBox` — which is why the export log states the page
    /// in points: the log can be checked directly against the output file).
    pub fn size_points(self) -> (f64, f64) {
        let (w, h) = self.size_mm();
        (mm_to_points(w), mm_to_points(h))
    }

    /// The paper named by `value`, ignoring ASCII case; `None` if unknown.
    pub fn parse(value: &str) -> Option<PaperSize> {
        PaperSize::ALL
            .into_iter()
            .find(|p| p.name().eq_ignore_ascii_case(value))
    }

    /// The accepted names, for error messages: `"a4, a3, letter"`.
    pub fn accepted_names() -> String {
        PaperSize::ALL.map(PaperSize::name).join(", ")
    }
}
// PaperSize END *************************************************


//**************************************************************
// mm_to_inches
//**************************************************************
/// Millimetres to inches.
pub fn mm_to_inches(mm: f64) -> f64 {
    mm / MM_PER_INCH
}
// mm_to_inches END **********************************************


//**************************************************************
// mm_to_points
//**************************************************************
/// Millimetres to PostScript points (1/72 inch).
pub fn mm_to_points(mm: f64) -> f64 {
    mm_to_inches(mm) * POINTS_PER_INCH
}
// mm_to_points END **********************************************


#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.01
    }

    #[test]
    fn default_paper_is_a4() {
        assert_eq!(PaperSize::default(), PaperSize::A4);
    }

    #[test]
    fn every_name_parses_back_to_its_paper() {
        for p in PaperSize::ALL {
            assert_eq!(PaperSize::parse(p.name()), Some(p));
        }
    }

    #[test]
    fn parsing_ignores_ascii_case() {
        assert_eq!(PaperSize::parse("A4"), Some(PaperSize::A4));
        assert_eq!(PaperSize::parse("Letter"), Some(PaperSize::Letter));
        assert_eq!(PaperSize::parse("LETTER"), Some(PaperSize::Letter));
    }

    #[test]
    fn unknown_or_malformed_names_are_rejected() {
        for bad in ["", "a5", "legal", " a4", "a4 ", "a 4", "iso_a4", "--paper"] {
            assert_eq!(PaperSize::parse(bad), None, "{bad:?} must not parse");
        }
    }

    #[test]
    fn names_are_unique() {
        let mut names: Vec<_> = PaperSize::ALL.map(PaperSize::name).to_vec();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), PaperSize::ALL.len());
    }

    #[test]
    fn accepted_names_lists_every_paper() {
        assert_eq!(PaperSize::accepted_names(), "a4, a3, letter");
    }

    #[test]
    fn every_paper_is_portrait() {
        // REQ-LTTCE-XPT-00012: a window-shaped (landscape) page is the defect
        // this module exists to rule out.
        for p in PaperSize::ALL {
            let (w, h) = p.size_mm();
            assert!(h > w, "{} must be portrait", p.name());
        }
    }

    #[test]
    fn sizes_match_the_standards_in_every_unit() {
        let (w, h) = PaperSize::A4.size_points();
        assert!(close(w, 595.28) && close(h, 841.89), "A4 pt: {w} x {h}");
        let (w, h) = PaperSize::A3.size_points();
        assert!(close(w, 841.89) && close(h, 1190.55), "A3 pt: {w} x {h}");
        let (w, h) = PaperSize::Letter.size_points();
        assert!(close(w, 612.0) && close(h, 792.0), "Letter pt: {w} x {h}");
        let (w, h) = PaperSize::Letter.size_mm();
        assert!(close(mm_to_inches(w), 8.5) && close(mm_to_inches(h), 11.0));
    }

    #[test]
    fn margin_is_two_centimetres_in_every_unit() {
        assert!(close(PAGE_MARGIN_MM, 20.0));
        assert!(close(mm_to_points(PAGE_MARGIN_MM), 56.69));
        assert!(close(mm_to_inches(PAGE_MARGIN_MM), 0.787));
    }
}
