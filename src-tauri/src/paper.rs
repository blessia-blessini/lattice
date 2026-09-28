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
//! GTK, COM or AppKit types. The one host-specific fact the margins depend on —
//! whether the host draws the running header and footer — comes from
//! `Platform::draws_page_header_footer`; the rule itself is [`PageMargins`].

//**************************************************************
// Page geometry constants
//**************************************************************
/// The CLI option that selects the paper: `--paper <name>` or `--paper=<name>`.
pub const PAPER_FLAG: &str = "--paper";

/// Margin on every side of a page that carries the running header and
/// "Page X of Y" footer, in millimetres — room for them to sit in.
///
/// Mirrors `@page { margin: 2cm }` in `src/App.css`, which Chromium (WebView2)
/// honours and draws those page-margin boxes inside. Change both together.
pub const HEADER_FOOTER_MARGIN_MM: f64 = 20.0;

/// Top, right and bottom margin of a page with no header or footer, in
/// millimetres. With nothing to hold, 2 cm there was only lost paper.
pub const COMPACT_MARGIN_MM: f64 = 10.0;

/// Left margin of a page with no header or footer, in millimetres. Kept at
/// 2 cm by choice: room for binding or punching on the side pages are held by.
pub const BINDING_MARGIN_MM: f64 = 20.0;

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
// PageMargins
//**************************************************************
/// The four page margins of a PDF export, in millimetres.
///
/// REQ-LTTCE-XPT-00012 — decided here, per kind of host, and handed both to
/// the host's page-setup API and to the export window's CSS `@page` rule
/// (WKWebView obeys the CSS one); the same for every paper. A host that draws the
/// running header and page-number footer (the CSS page-margin boxes) needs
/// [`HEADER_FOOTER_MARGIN_MM`] all round for them. A host that cannot draw them
/// (WebKit) gets [`COMPACT_MARGIN_MM`] at the top, right and bottom and
/// [`BINDING_MARGIN_MM`] on the left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageMargins {
    pub top_mm: f64,
    pub right_mm: f64,
    pub bottom_mm: f64,
    pub left_mm: f64,
}

impl PageMargins {
    /// A page with the running header and page-number footer.
    pub const WITH_HEADER_FOOTER: PageMargins = PageMargins {
        top_mm: HEADER_FOOTER_MARGIN_MM,
        right_mm: HEADER_FOOTER_MARGIN_MM,
        bottom_mm: HEADER_FOOTER_MARGIN_MM,
        left_mm: HEADER_FOOTER_MARGIN_MM,
    };

    /// A page without them.
    pub const WITHOUT_HEADER_FOOTER: PageMargins = PageMargins {
        top_mm: COMPACT_MARGIN_MM,
        right_mm: COMPACT_MARGIN_MM,
        bottom_mm: COMPACT_MARGIN_MM,
        left_mm: BINDING_MARGIN_MM,
    };

    /// The margins for a host that does (`true`) or does not (`false`) draw
    /// the running header and page-number footer.
    pub const fn for_host(draws_header_footer: bool) -> PageMargins {
        if draws_header_footer {
            PageMargins::WITH_HEADER_FOOTER
        } else {
            PageMargins::WITHOUT_HEADER_FOOTER
        }
    }

    /// The margins in PostScript points, rounded, for the export log:
    /// `"top 28, right 28, bottom 28, left 57 pt"` — the unit of the PDF, like
    /// the page size logged beside it.
    pub fn describe_points(&self) -> String {
        format!(
            "top {:.0}, right {:.0}, bottom {:.0}, left {:.0} pt",
            mm_to_points(self.top_mm),
            mm_to_points(self.right_mm),
            mm_to_points(self.bottom_mm),
            mm_to_points(self.left_mm)
        )
    }
}
// PageMargins END ***********************************************


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


//**************************************************************
// tests
//**************************************************************
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
    fn margin_constants_in_every_unit() {
        assert!(close(HEADER_FOOTER_MARGIN_MM, 20.0));
        assert!(close(mm_to_points(HEADER_FOOTER_MARGIN_MM), 56.69));
        assert!(close(mm_to_inches(HEADER_FOOTER_MARGIN_MM), 0.787));
        assert!(close(COMPACT_MARGIN_MM, 10.0));
        assert!(close(mm_to_points(COMPACT_MARGIN_MM), 28.35));
        assert!(close(BINDING_MARGIN_MM, 20.0));
    }

    #[test]
    fn a_header_footer_host_keeps_two_centimetres_all_round() {
        // Windows (WebView2): the page is exactly what it was before compact
        // margins existed — header and "Page X of Y" need the room.
        let m = PageMargins::for_host(true);
        assert_eq!(m, PageMargins::WITH_HEADER_FOOTER);
        for side in [m.top_mm, m.right_mm, m.bottom_mm, m.left_mm] {
            assert!(close(side, 20.0));
        }
    }

    #[test]
    fn a_host_without_header_footer_gets_one_centimetre_except_left() {
        // REQ-LTTCE-XPT-00012: Linux and macOS (WebKit) — nothing to hold in
        // the margins, so 1 cm top, right and bottom; the left keeps 2 cm.
        let m = PageMargins::for_host(false);
        assert_eq!(m, PageMargins::WITHOUT_HEADER_FOOTER);
        assert!(close(m.top_mm, 10.0));
        assert!(close(m.right_mm, 10.0));
        assert!(close(m.bottom_mm, 10.0));
        assert!(close(m.left_mm, 20.0));
    }

    #[test]
    fn margins_are_logged_in_points_per_side() {
        assert_eq!(
            PageMargins::WITHOUT_HEADER_FOOTER.describe_points(),
            "top 28, right 28, bottom 28, left 57 pt"
        );
        assert_eq!(
            PageMargins::WITH_HEADER_FOOTER.describe_points(),
            "top 57, right 57, bottom 57, left 57 pt"
        );
    }
}
// tests END *************************************************
