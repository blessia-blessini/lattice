// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Platform module — single entry point, zero `#[cfg(target_os)]` in source.
//!
//! # How platform selection works
//!
//! `build.rs` inspects `CARGO_CFG_TARGET_OS` at compile time and copies one
//! of the files from `src/platform/impls/` into `$OUT_DIR/platform_impl.rs`.
//! The `include!` below pastes that file into this module scope.
//!
//! ```text
//! lib.rs
//!   └── mod platform;          ← this file; zero OS knowledge in lib.rs
//!         └── include!(…/platform_impl.rs)   ← build.rs picks the right impl
//!
//! src/platform/impls/
//!   macos.rs     ← Apple Events (Opened / Ready)
//!   windows.rs   ← CLI arg association
//!   linux.rs     ← CLI arg association
//!   android.rs   ← stub (TODO: Intents)
//!   ios.rs       ← stub (TODO: Apple Events)
//! ```
//!
//! # Adding a new platform
//! 1. Create `src/platform/impls/<os>.rs` implementing `open_windows_on_startup`
//!    and `handle_run_event`.
//! 2. Add a match arm in `build.rs` (the one place that knows about OS names).
//! 3. No other file needs to change.
//!
//! # Shared helpers available to all implementations
//! All implementation files call `super::build_window_with_file(...)` and,
//! in test builds, `super::test_utils::maybe_sabotage_file(...)`.

// ── Sub-modules ──────────────────────────────────────────────────────────────
// cli_args is used by cli_desktop.rs (included by windows.rs and linux.rs).
pub(super) mod cli_args;

// ── Shared helpers available to all implementations ──────────────────────────
// Implementation files call `super::build_window_with_file(...)` which
// resolves directly to lib.rs (the parent of this module).
// In test builds, they also access `super::test_utils::...`.
// #[cfg(any(test, integration_test))]
// pub(crate) use super::test_utils;

// ── Contract: every platform must implement this trait ───────────────────────
// Defined here once. The include! below supplies the concrete type and impl.
pub(crate) trait Platform {
    /// Called once from `setup_handler` during Tauri startup.
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>>;

    /// Called for every `RunEvent` from the Tauri event loop.
    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent);

    //**************************************************************
    // Platform::print_to_pdf
    //**************************************************************
    /// Prints `window`'s *current* document to a PDF file at `out_path`,
    /// reporting the outcome through `done`.
    ///
    /// IMPL-LTTCE-XPT-00005 — the paginating is done by the host WebView that
    /// already rendered the preview (WebView2 on Windows, WebKitGTK on Linux,
    /// WKWebView on macOS), so `--export-pdf` cannot drift from what
    /// `--export-html` and an interactive Ctrl-P produce.
    ///
    /// Every implementation lays the document out on `paper`, portrait, with
    /// the margins [`page_margins`] gives for this host (REQ-LTTCE-XPT-00011 /
    /// REQ-LTTCE-XPT-00012), set explicitly through its host's page-setup API.
    /// Host defaults differ (Letter vs A4, GTK's near-zero margins) and WebKit
    /// ignores the CSS `@page` margin, so nothing may be left to them.
    ///
    /// Asynchronous by construction: every host API here completes through a
    /// callback, so implementations return immediately and send on `done`
    /// later, exactly once. Use [`PdfDone`] to get that "exactly once" for
    /// free on both the success and the setup-failure path.
    ///
    /// The default implementation refuses. It is what the mobile stubs get:
    /// Android and iOS have no verified print-to-PDF path here, and a loud,
    /// bounded refusal is the honest answer (see `.claude/rules/mobile.md`).
    fn print_to_pdf(
        &self,
        window: &tauri::WebviewWindow,
        out_path: std::path::PathBuf,
        paper: crate::paper::PaperSize,
        done: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) {
        let _ = (window, paper);
        let _ = done.send(Err(format!(
            "PDF export is not supported on this platform (wanted '{}')",
            out_path.display()
        )));
    }
    // Platform::print_to_pdf END ********************************


    //**************************************************************
    // Platform::draws_page_header_footer
    //**************************************************************
    /// Whether this host's print engine draws the CSS page-margin boxes — the
    /// running file-name header and the "Page X of Y" footer.
    ///
    /// A fact about the engine, not a choice: Chromium (WebView2) draws them,
    /// WebKit (WebKitGTK, WKWebView) does not. [`page_margins`] turns it into
    /// the page's margins. The default, `false`, is right for every WebKit host
    /// and harmless for the mobile stubs, which cannot print at all.
    fn draws_page_header_footer(&self) -> bool {
        false
    }
    // Platform::draws_page_header_footer END ********************
}

// ── Platform implementation — injected by build.rs ──────────────────────────
// build.rs writes the selected impl file to $OUT_DIR/platform_impl.rs.
// That file must define:
//   struct PlatformImpl;
//   impl Platform for PlatformImpl { … }
// Windows and Linux share impls/cli_desktop.rs; their platform files just
// set PLATFORM_NAME and include! that shared body.
// The compiler verifies the impl is complete against the trait above.
// include! pastes it here; only one OS's code is ever compiled.
include!(concat!(env!("OUT_DIR"), "/platform_impl.rs"));

// ── Public API — free functions that forward to the platform impl ─────────────
// lib.rs calls these directly.  The trait is enforced at compile time;
// callers never need to name PlatformImpl or import the Platform trait.

pub(crate) fn open_windows_on_startup(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    PlatformImpl.open_windows_on_startup(app)
}

pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    PlatformImpl.handle_run_event(app, event);
}

//******************************************************************************
// print_to_pdf
//******************************************************************************
/// Forwards to the selected platform implementation. See
/// [`Platform::print_to_pdf`].
pub(crate) fn print_to_pdf(
    window: &tauri::WebviewWindow,
    out_path: std::path::PathBuf,
    paper: crate::paper::PaperSize,
    done: tokio::sync::oneshot::Sender<Result<(), String>>,
) {
    PlatformImpl.print_to_pdf(window, out_path, paper, done);
}
// print_to_pdf END ************************************************************


//******************************************************************************
// page_margins
//******************************************************************************
/// The margins every PDF of this build is printed with (REQ-LTTCE-XPT-00012):
/// the rule in [`crate::paper::PageMargins`] applied to this host's
/// [`Platform::draws_page_header_footer`].
///
/// The one source for the backends, which hand it to their page-setup API,
/// and for `export.rs`, which logs it and hands it to the export window's
/// `@page` rule (`ExportLaunch::page_margins`) — so CSS, host API and log
/// always state the same margins.
pub(crate) fn page_margins() -> crate::paper::PageMargins {
    crate::paper::PageMargins::for_host(PlatformImpl.draws_page_header_footer())
}
// page_margins END ************************************************************


//******************************************************************************
// PdfDone
//******************************************************************************
/// A one-shot completion sink shared by every platform's `print_to_pdf`.
///
/// The host print APIs all report through callbacks, and each of them has more
/// than one way to finish: a setup error before the callback is ever
/// registered, a success callback, a failure callback. `PdfDone` makes
/// "whichever happens first wins, the rest are ignored" the single, shared
/// rule instead of three near-identical hand-rolled guards (DRY), and keeps a
/// `oneshot::Sender` — which consumes itself on `send` — usable from the `Fn`
/// (not `FnOnce`) closures those APIs require.
pub(crate) struct PdfDone(
    std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>,
);

#[allow(dead_code)] // Only the desktop impls use it; mobile takes the default.
impl PdfDone {
    /// Wraps `tx` so it can be cloned into several callbacks.
    pub(crate) fn new(
        tx: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) -> std::sync::Arc<Self> {
        std::sync::Arc::new(PdfDone(std::sync::Mutex::new(Some(tx))))
    }

    /// Reports `result` if nothing has been reported yet; otherwise a no-op.
    ///
    /// A poisoned lock is treated as "already reported" rather than
    /// propagated: a panicking print callback must not also panic the caller
    /// awaiting the result — the bounded timeout in `export.rs` covers it.
    pub(crate) fn finish(&self, result: Result<(), String>) {
        if let Ok(mut slot) = self.0.lock()
            && let Some(tx) = slot.take()
        {
            let _ = tx.send(result);
        }
    }
}
// PdfDone END *****************************************************************


//******************************************************************************
// written_pdf_result
//******************************************************************************
/// The result to report once a host print API says it has finished: its own
/// verdict (`host_ok`) *and* a non-empty file at `path`.
///
/// Shared by every desktop backend (DRY). A host's "finished" is not evidence
/// that a file exists: a print operation can complete without writing, and an
/// export that reports success with nothing on disk is the failure mode
/// REQ-LTTCE-XPT-00006 forbids. Pure apart from the one `metadata` read, so it
/// is tested on every host even though each backend runs on only one.
pub(crate) fn written_pdf_result(host_ok: bool, path: &std::path::Path) -> Result<(), String> {
    if !host_ok {
        return Err("the host print operation reported a failure".to_string());
    }
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > 0 => Ok(()),
        Ok(_) => Err(format!("the PDF '{}' was written empty", path.display())),
        Err(e) => Err(format!("no PDF was written to '{}': {}", path.display(), e)),
    }
}
// written_pdf_result END ******************************************************


//**************************************************************
// tests
//**************************************************************
#[cfg(test)]
mod tests {
    use super::*;

    //**************************************************************
    // written_pdf_result
    //**************************************************************

    #[test]
    fn a_reported_success_with_a_non_empty_file_is_success() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("out.pdf");
        std::fs::write(&pdf, b"%PDF-1.4").unwrap();
        assert_eq!(written_pdf_result(true, &pdf), Ok(()));
    }

    #[test]
    fn a_reported_success_without_a_file_is_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let err = written_pdf_result(true, &dir.path().join("never-written.pdf")).unwrap_err();
        assert!(err.contains("no PDF was written"), "{err}");
    }

    #[test]
    fn a_reported_success_with_an_empty_file_is_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("empty.pdf");
        std::fs::write(&pdf, b"").unwrap();
        assert!(written_pdf_result(true, &pdf).unwrap_err().contains("empty"));
    }

    #[test]
    fn a_reported_failure_wins_even_over_an_existing_file() {
        // A stale file from an earlier run must not turn a failed print into a
        // success.
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("stale.pdf");
        std::fs::write(&pdf, b"%PDF-1.4").unwrap();
        assert!(written_pdf_result(false, &pdf).unwrap_err().contains("reported a failure"));
    }

    //**************************************************************
    // PdfDone
    //**************************************************************
    // `try_recv` is used rather than `.await` so these stay plain `#[test]`s:
    // the value is already in the channel by the time it is read, and no
    // async runtime (nor a tokio "macros"/"rt" dev-dependency) is needed.

    #[test]
    fn pdf_done_forwards_the_first_result() {
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        let done = PdfDone::new(tx);
        done.finish(Ok(()));
        assert_eq!(rx.try_recv(), Ok(Ok(())));
    }

    #[test]
    fn pdf_done_ignores_every_result_after_the_first() {
        // A host API that reports both "finished" and "failed" must not be
        // able to turn a completed export into an error, or panic on a
        // sender that has already been consumed.
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        let done = PdfDone::new(tx);
        done.finish(Ok(()));
        done.finish(Err("late failure".to_string()));
        done.finish(Err("later still".to_string()));
        assert_eq!(rx.try_recv(), Ok(Ok(())));
    }

    #[test]
    fn pdf_done_forwards_a_failure_verbatim() {
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        let done = PdfDone::new(tx);
        done.finish(Err("boom".to_string()));
        assert_eq!(rx.try_recv(), Ok(Err("boom".to_string())));
    }

    #[test]
    fn pdf_done_never_panics_when_the_receiver_is_gone() {
        // export.rs drops the receiver on timeout; a late callback must not
        // take the process down with it.
        let (tx, rx) = tokio::sync::oneshot::channel();
        let done = PdfDone::new(tx);
        drop(rx);
        done.finish(Ok(()));
    }

    #[test]
    fn pdf_done_is_shareable_across_callbacks() {
        // The host APIs need the sink in more than one closure at once; that
        // is the whole reason it is an Arc rather than a moved sender.
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        let done = PdfDone::new(tx);
        let a = done.clone();
        let b = done.clone();
        drop(done);
        b.finish(Err("setup failed".to_string()));
        a.finish(Ok(()));
        assert_eq!(rx.try_recv(), Ok(Err("setup failed".to_string())));
    }
}
// tests END *************************************************
