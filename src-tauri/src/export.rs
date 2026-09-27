// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Headless CLI export (`--export-html` / `--export-pdf file1.md file2.md ...`).
//!
//! IMPL-LTTCE-XPT-00003 — REQ-LTTCE-XPT-00001..00006 in
//! `docs/10-System-Requirements.md`. Each path
//! is opened in an invisible window carrying the requested
//! `exportFormat` in its `__LATTICE_INIT_DATA__` (see
//! `build_window_with_file_ex` in `lib.rs`); the frontend renders the preview
//! and waits for it to settle (including Mermaid-diagram-to-PNG substitution —
//! the same substitution REQ-LTTCE-MRC-00002 requires for a clipboard copy,
//! generalised here to the whole document), then signals back through
//! `export_ready`.
//!
//! What happens at that point depends on the format:
//!
//! * [`ExportFormat::Html`] — the frontend serialises the settled preview and
//!   hands the HTML back; Rust writes it to disk.
//! * [`ExportFormat::Pdf`] — the frontend hands nothing back but the "settled"
//!   signal itself; Rust then asks the host WebView to print *that same
//!   settled document* to a PDF file (see `platform::print_to_pdf`). The
//!   layout engine doing the paginating is the one already rendering the
//!   preview, so the PDF and the HTML cannot come from two different
//!   renderers (IMPL-LTTCE-XPT-00005).
//!
//! Files are processed one at a time — `ExportState` holds at most one
//! in-flight sender — so no window is ever left open behind another.

use crate::paper::PaperSize;
use log::{error, info};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

//**************************************************************
// ExportFormat
//**************************************************************
/// The output format of one headless export run.
///
/// Single source of truth for everything that differs between the two CLI
/// export modes: the flag that selects it, the output file extension, and the
/// token handed to the frontend in `__LATTICE_INIT_DATA__.exportFormat`.
/// `platform/cli_args.rs` and `App.tsx` both derive their behaviour from this
/// one definition rather than repeating the strings (DRY).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    /// Rendered preview HTML, written by Rust from what the frontend returns.
    Html,
    /// PDF, produced by the host WebView printing the settled preview.
    Pdf,
}

impl ExportFormat {
    /// Every format, in the order flags are matched. Kept as one list so a
    /// third format cannot be added to `from_flag` and forgotten elsewhere.
    pub const ALL: [ExportFormat; 2] = [ExportFormat::Html, ExportFormat::Pdf];

    /// The CLI flag that selects this format.
    pub const fn flag(self) -> &'static str {
        match self {
            ExportFormat::Html => "--export-html",
            ExportFormat::Pdf => "--export-pdf",
        }
    }

    /// The lowercase name of the format. Used *both* as the output file
    /// extension (REQ-LTTCE-XPT-00002 / REQ-LTTCE-XPT-00005) and as the
    /// `exportFormat` token the frontend switches on — they are deliberately
    /// the same string so there is only one name per format to keep in sync.
    pub const fn as_str(self) -> &'static str {
        match self {
            ExportFormat::Html => "html",
            ExportFormat::Pdf => "pdf",
        }
    }

    /// The format selected by `arg`, or `None` if `arg` is not an export flag.
    pub fn from_flag(arg: &str) -> Option<ExportFormat> {
        ExportFormat::ALL.into_iter().find(|f| f.flag() == arg)
    }
}
// ExportFormat END **********************************************


//**************************************************************
// ExportLaunch
//**************************************************************
/// What an export window is told at launch, in `__LATTICE_INIT_DATA__`:
/// the format to produce and how long the frontend may wait for the
/// preview's diagrams to settle.
///
/// The settle budget travels with the format so the frontend has no clock of
/// its own to keep in step with Rust's. It once had one — a hard-coded 8 s —
/// and when Rust's render budget was raised to 90 s for a cold start, the
/// frontend still gave up at 8 s and exported an incomplete document
/// (REQ-LTTCE-XPT-00009).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportLaunch {
    pub format: ExportFormat,
    pub settle_budget: Duration,
}

impl ExportLaunch {
    /// The settle budget in whole milliseconds, as the frontend's
    /// `exportSettleMs` expects it.
    pub fn settle_ms(self) -> u64 {
        u64::try_from(self.settle_budget.as_millis()).unwrap_or(u64::MAX)
    }
}
// ExportLaunch END **********************************************


/// Per-app state carrying the channel for the single in-flight export.
///
/// The payload is what the *frontend* has to say once the preview has
/// settled: `Ok(Some(html))` for an HTML export, `Ok(None)` for a PDF export
/// (settled, nothing to hand over — Rust prints it), `Err(message)` when the
/// frontend itself failed to render.
type ReadySender = tokio::sync::oneshot::Sender<Result<Option<String>, String>>;

/// The single in-flight export: which window is allowed to complete it, and
/// the channel that completion travels down.
///
/// The label is not decoration. Closing a window does not silently discard a
/// signal its renderer has already started sending, so a file that timed out
/// can still emit `export_ready` *after* the next file has installed its own
/// sender — handing file N+1 the document of file N, under file N+1's name,
/// while file N+1's real completion is dropped as "nothing pending". Binding
/// the sender to one window label makes that signal identifiable and
/// discardable instead of silently authoritative.
struct Pending {
    /// Label of the one window whose `export_ready` may complete this export.
    window_label: String,
    tx: ReadySender,
}

#[derive(Default)]
pub struct ExportState {
    pending: Mutex<Option<Pending>>,
}

/// How long to wait for the **first** file of a run to render and settle.
///
/// REQ-LTTCE-XPT-00008 — the first export in a process pays costs no later one
/// does: the executable and the WebView's frameworks are paged in, the first
/// WKWebView / WebKitGTK / WebView2 instance of the process is constructed, and
/// the frontend bundle is parsed and executed for the first time. Measured on a
/// macOS arm64 CI runner on 2026-09-26: app launch alone took 4 s cold against
/// 1 s warm, and the cold render of `docs/demo/demo.md` (four Mermaid diagrams,
/// KaTeX) exceeded a 20 s budget while the warm render of the same document in
/// the same binary needed 17 s — inside the old limit by three seconds. A
/// budget that a correct render can miss because the machine was cold is not a
/// safety net, it is a source of false failures.
const FIRST_RENDER_TIMEOUT: Duration = Duration::from_secs(90);

/// How long to wait for each **subsequent** file's preview to render and settle
/// before giving up on it and moving to the next. Generous because Mermaid
/// rasterisation is deferred to an idle callback under `requestIdleCallback`,
/// which a busy renderer can delay.
///
/// Raising these costs nothing when rendering is quick: the wait ends on the
/// frontend's `export_ready` signal, not on the clock (see `export_one`). The
/// timeout exists only to bound a render that is never going to finish, so it
/// should be set by "how long before we call it wedged", not by "how long a
/// healthy render ought to take".
const RENDER_TIMEOUT: Duration = Duration::from_secs(45);

/// How long to wait for the host WebView's print-to-PDF to complete once the
/// document has already settled. Shorter than `RENDER_TIMEOUT`: nothing is
/// being rendered or rasterised any more, only paginated and serialised.
const PDF_PRINT_TIMEOUT: Duration = Duration::from_secs(30);

/// How much of a render budget is held back from the frontend's diagram wait
/// (REQ-LTTCE-XPT-00009). The frontend must give up *before* Rust does, so
/// that a stuck diagram is reported by the side that can say which diagrams
/// are missing — "3 of 5 diagram(s) had not finished rendering" — rather than
/// by Rust's bare "timed out". The margin covers what Rust's clock counts
/// but the frontend's does not: the frontend's own start-up and file load
/// before its wait begins (~3 s cold on a macOS CI runner, 2026-09-26), then
/// serialising the document and the IPC hop back.
const SETTLE_MARGIN: Duration = Duration::from_secs(10);

//**************************************************************
// is_expected_sender
//**************************************************************
/// Whether a signal from `caller_label` may complete the export currently
/// waiting on `expected_label`.
///
/// Pure and host-testable — the whole correlation rule in one place, so the
/// "wrong window" case can be asserted without a WebView.
fn is_expected_sender(expected_label: Option<&str>, caller_label: &str) -> bool {
    expected_label == Some(caller_label)
}
// is_expected_sender END ****************************************

//**************************************************************
// export_ready
//**************************************************************
/// Tauri command — the frontend's signal that the preview for the file
/// currently being exported has settled (see module docs).
///
/// `html` carries the serialised preview for an HTML export and is absent for
/// a PDF export; `error` is set instead when the frontend could not render.
///
/// Signals from any window other than the one this export is waiting on are
/// **discarded and logged** rather than accepted: see `Pending`. A signal
/// arriving with nothing pending is likewise a no-op, which happens when the
/// wait in `export_one` already timed out and moved on.
#[tauri::command]
pub fn export_ready(
    window: tauri::Window,
    state: tauri::State<ExportState>,
    html: Option<String>,
    error: Option<String>,
) {
    let caller = window.label();
    let mut slot = state.pending.lock().unwrap();

    if !is_expected_sender(slot.as_ref().map(|p| p.window_label.as_str()), caller) {
        match slot.as_ref() {
            Some(p) => error!(
                "export_ready from window '{}' ignored — this export belongs to '{}' \
                 (a timed-out window finishing late?)",
                caller, p.window_label
            ),
            None => info!(
                "export_ready from window '{}' ignored — no export is in flight",
                caller
            ),
        }
        return;
    }

    // Unwrap is sound: is_expected_sender only matches a `Some` slot.
    let pending = slot.take().expect("pending checked by is_expected_sender");
    let payload = match error {
        Some(msg) => Err(msg),
        None => Ok(html),
    };
    let _ = pending.tx.send(payload);
}
// export_ready END **********************************************

//**************************************************************
// export_output_path
//**************************************************************
/// The sibling of a source path carrying `format`'s extension: same directory
/// and stem, extension replaced (or added) unconditionally, matching
/// REQ-LTTCE-XPT-00002 (HTML) and REQ-LTTCE-XPT-00005 (PDF).
///
/// Pure and host-testable — no Tauri types.
pub fn export_output_path(source: &str, format: ExportFormat) -> PathBuf {
    let mut out = PathBuf::from(source);
    out.set_extension(format.as_str());
    out
}
// export_output_path END ****************************************

//**************************************************************
// render_timeout
//**************************************************************
/// The render budget for one export: longer for the first of a run.
///
/// IMPL for REQ-LTTCE-XPT-00008. Pure, so the policy is unit-testable without
/// a WebView, a window or a clock.
fn render_timeout(is_first_export: bool) -> Duration {
    if is_first_export {
        FIRST_RENDER_TIMEOUT
    } else {
        RENDER_TIMEOUT
    }
}
// render_timeout END *******************************************


//**************************************************************
// settle_budget
//**************************************************************
/// The frontend's diagram-settle budget for a given render budget:
/// `SETTLE_MARGIN` less, so the frontend reports first (see `SETTLE_MARGIN`).
///
/// IMPL for REQ-LTTCE-XPT-00009. Derived, never set separately, so raising
/// the render budget raises this with it. Pure and unit-tested.
fn settle_budget(render_budget: Duration) -> Duration {
    render_budget.saturating_sub(SETTLE_MARGIN)
}
// settle_budget END ********************************************


//**************************************************************
// run_export
//**************************************************************
/// Drives the whole headless export run: each path in turn, then exits the
/// process — this mode never opens a visible window or an editor session.
/// Exit code is `0` when every file exported, `1` if any failed, so the
/// invoking shell can detect a partial run.
///
/// `paper` is the page every PDF of the run is laid out on
/// (REQ-LTTCE-XPT-00011); an HTML export ignores it.
pub async fn run_export(
    app: tauri::AppHandle,
    paths: Vec<String>,
    format: ExportFormat,
    paper: PaperSize,
) {
    let mut had_error = false;
    if format == ExportFormat::Pdf {
        // In points, the unit of a PDF's /MediaBox, so the log line can be
        // checked against the output file directly.
        let (w, h) = paper.size_points();
        info!(
            "export-pdf: paper {} ({:.0} x {:.0} pt), margins {:.0} pt",
            paper.name(),
            w,
            h,
            crate::paper::mm_to_points(crate::paper::PAGE_MARGIN_MM)
        );
    }

    // `enumerate` rather than a flag: whether this is the process's first export
    // is a property of the loop, so it needs no mutable state and stays obvious
    // at the call site (REQ-LTTCE-XPT-00008).
    for (index, path) in paths.into_iter().enumerate() {
        match export_one(&app, &path, format, paper, index == 0).await {
            Ok(out) => info!("export-{}: wrote '{}'", format.as_str(), out.display()),
            Err(e) => {
                had_error = true;
                error!("export-{}: failed for '{}': {}", format.as_str(), path, e);
            }
        }
    }

    app.exit(if had_error { 1 } else { 0 });
}
// run_export END ************************************************

//**************************************************************
// export_one
//**************************************************************
/// Exports a single file: opens it in an invisible window, awaits the
/// frontend's "settled" signal (or times out), produces the output, and
/// closes the window either way — no window from this mode is ever left open.
async fn export_one(
    app: &tauri::AppHandle,
    path: &str,
    format: ExportFormat,
    paper: PaperSize,
    is_first_export: bool,
) -> Result<PathBuf, String> {
    ensure_readable(path)?;

    // The label is generated *before* the window exists so the sender can be
    // bound to it up front. Installing the sender first and learning the
    // label afterwards would leave a gap in which a signal could not be
    // attributed to anything.
    let label = crate::generate_new_window_label();

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let state: tauri::State<ExportState> = app.state();
        *state.pending.lock().unwrap() = Some(Pending {
            window_label: label.clone(),
            tx,
        });
    }

    let budget = render_timeout(is_first_export);
    let launch = ExportLaunch {
        format,
        settle_budget: settle_budget(budget),
    };

    let window =
        crate::build_window_with_file_ex(app, label, Some(path.to_string()), Some(launch))?;

    let settled = tokio::time::timeout(budget, rx).await;

    // Whatever happens next, stop tracking a sender for this window. This
    // alone does not make a late signal harmless — the next file installs its
    // own sender moments later, and a stray signal would find *that* one. It
    // is `Pending::window_label`, checked in `export_ready`, that rejects it.
    let clear_pending = || {
        let state: tauri::State<ExportState> = app.state();
        *state.pending.lock().unwrap() = None;
    };

    let ready = match settled {
        Ok(Ok(Ok(payload))) => payload,
        Ok(Ok(Err(msg))) => {
            clear_pending();
            let _ = window.close();
            return Err(format!("renderer reported a failure: {}", msg));
        }
        Ok(Err(_)) => {
            clear_pending();
            let _ = window.close();
            return Err("export channel closed unexpectedly".to_string());
        }
        Err(_) => {
            clear_pending();
            let _ = window.close();
            // The budget is named in the message: "timed out" alone cannot be
            // told apart from "timed out because the budget was too small",
            // which is exactly the confusion that cost a CI investigation.
            return Err(format!(
                "timed out waiting for preview to render (waited {}s)",
                budget.as_secs()
            ));
        }
    };
    clear_pending();

    let out_path = export_output_path(path, format);

    // The window must stay alive until the output exists: for a PDF it is the
    // very thing being printed.
    let result = match format {
        ExportFormat::Html => write_html(&out_path, ready),
        ExportFormat::Pdf => print_pdf(&window, &out_path, paper).await,
    };

    let _ = window.close();
    result.map(|()| out_path)
}
// export_one END ************************************************

//**************************************************************
// ensure_readable
//**************************************************************
/// Refuses a path the process cannot open, before any window is built.
///
/// REQ-LTTCE-XPT-00003 / REQ-LTTCE-XPT-00006 — "a given file cannot be read"
/// is a failure, and must reach the exit code. The *interactive* launch path
/// deliberately tolerates an unreadable path (`build_window_with_file_ex`
/// logs it and opens an empty window — better than no window when a file was
/// deleted between the OS event and the launch); an export must not inherit
/// that tolerance, or a missing file would quietly produce a blank document
/// and report success.
///
/// Pure and host-testable — no Tauri types. This is a guard, not a promise:
/// the file can still vanish between here and the read, which the renderer's
/// own failure then reports.
fn ensure_readable(path: &str) -> Result<(), String> {
    std::fs::File::open(path).map(|_| ()).map_err(|e| format!("cannot read '{}': {}", path, e))
}
// ensure_readable END *******************************************

//**************************************************************
// write_html
//**************************************************************
/// Writes the HTML the frontend handed back, rejecting an absent or empty
/// document rather than leaving a zero-byte file behind as a "success".
fn write_html(out_path: &std::path::Path, ready: Option<String>) -> Result<(), String> {
    let html = ready.ok_or("renderer returned no HTML")?;
    if html.is_empty() {
        return Err("renderer produced no HTML".to_string());
    }
    std::fs::write(out_path, html).map_err(|e| e.to_string())
}
// write_html END ************************************************

//**************************************************************
// print_pdf
//**************************************************************
/// Asks the host WebView to print the settled document to `out_path` on
/// `paper`, bounded by `PDF_PRINT_TIMEOUT` so a wedged print operation cannot
/// hang the whole batch (REQ-LTTCE-XPT-00006).
async fn print_pdf(
    window: &tauri::WebviewWindow,
    out_path: &std::path::Path,
    paper: PaperSize,
) -> Result<(), String> {
    remove_previous_output(out_path)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    crate::platform::print_to_pdf(window, out_path.to_path_buf(), paper, tx);

    match tokio::time::timeout(PDF_PRINT_TIMEOUT, rx).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("PDF print channel closed unexpectedly".to_string()),
        Err(_) => Err("timed out waiting for the WebView to write the PDF".to_string()),
    }
}
// print_pdf END *************************************************

//**************************************************************
// remove_previous_output
//**************************************************************
/// Deletes a file left at `out_path` by an earlier export, before the host is
/// asked to write a new one.
///
/// REQ-LTTCE-XPT-00006 — `written_pdf_result` accepts a non-empty file at the
/// path as proof of success. Without this, a host that reported success but
/// wrote nothing would be credited with the previous run's PDF. Nothing there
/// is fine; a path that cannot be cleared (a directory, a locked file) fails
/// the export instead of risking that false success.
fn remove_previous_output(out_path: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(out_path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "cannot replace the existing '{}': {}",
            out_path.display(),
            e
        )),
    }
}
// remove_previous_output END ************************************

#[cfg(test)]
mod tests {
    use super::*;

    //**************************************************************
    // export_output_path — extension rule (REQ-LTTCE-XPT-00002/00005)
    //**************************************************************

    #[test]
    fn replaces_md_extension() {
        assert_eq!(
            export_output_path("notes.md", ExportFormat::Html),
            PathBuf::from("notes.html")
        );
        assert_eq!(
            export_output_path("notes.md", ExportFormat::Pdf),
            PathBuf::from("notes.pdf")
        );
    }

    #[test]
    fn replaces_any_existing_extension() {
        assert_eq!(
            export_output_path("notes.txt", ExportFormat::Html),
            PathBuf::from("notes.html")
        );
        assert_eq!(
            export_output_path("notes.txt", ExportFormat::Pdf),
            PathBuf::from("notes.pdf")
        );
    }

    #[test]
    fn adds_extension_when_absent() {
        assert_eq!(
            export_output_path("notes", ExportFormat::Html),
            PathBuf::from("notes.html")
        );
        assert_eq!(
            export_output_path("notes", ExportFormat::Pdf),
            PathBuf::from("notes.pdf")
        );
    }

    #[test]
    fn preserves_directory_component() {
        assert_eq!(
            export_output_path("some/dir/notes.md", ExportFormat::Html),
            PathBuf::from("some/dir/notes.html")
        );
        assert_eq!(
            export_output_path("some/dir/notes.md", ExportFormat::Pdf),
            PathBuf::from("some/dir/notes.pdf")
        );
    }

    #[test]
    fn html_and_pdf_of_the_same_source_never_collide() {
        // The two modes must not be able to overwrite each other's output for
        // the same input — the extension is the only thing distinguishing them.
        let html = export_output_path("report.md", ExportFormat::Html);
        let pdf = export_output_path("report.md", ExportFormat::Pdf);
        assert_ne!(html, pdf);
    }

    //**************************************************************
    // ExportFormat — flag / token mapping
    //**************************************************************

    #[test]
    fn from_flag_maps_each_flag_to_its_format() {
        assert_eq!(
            ExportFormat::from_flag("--export-html"),
            Some(ExportFormat::Html)
        );
        assert_eq!(
            ExportFormat::from_flag("--export-pdf"),
            Some(ExportFormat::Pdf)
        );
    }

    #[test]
    fn from_flag_rejects_anything_else() {
        assert_eq!(ExportFormat::from_flag("--export"), None);
        assert_eq!(ExportFormat::from_flag("--export-html=x"), None);
        assert_eq!(ExportFormat::from_flag("notes.md"), None);
        assert_eq!(ExportFormat::from_flag(""), None);
    }

    #[test]
    fn every_format_round_trips_through_its_flag() {
        // Guards the ALL list: a format added without a from_flag arm fails here.
        for f in ExportFormat::ALL {
            assert_eq!(ExportFormat::from_flag(f.flag()), Some(f));
        }
    }

    #[test]
    fn flags_are_flags_and_names_are_distinct() {
        // collect_file_paths() skips anything starting with '-', so no export
        // flag may ever leak into the collected file-path list; and two formats
        // must never share a name (they would write to the same output path).
        let mut names = Vec::new();
        for f in ExportFormat::ALL {
            assert!(f.flag().starts_with('-'), "{} is not a flag", f.flag());
            assert!(!f.as_str().starts_with('-'));
            assert!(!names.contains(&f.as_str()), "duplicate format name");
            names.push(f.as_str());
        }
    }

    //**************************************************************
    // is_expected_sender — the stray-signal guard
    //**************************************************************

    #[test]
    fn accepts_the_window_this_export_is_waiting_on() {
        assert!(is_expected_sender(Some("lattice-7-window"), "lattice-7-window"));
    }

    #[test]
    fn rejects_a_different_window() {
        // The regression this guard exists for: file N times out, its window
        // is closed but its renderer still emits export_ready, and by then
        // file N+1 has installed its own sender. Accepting that signal would
        // write file N's document under file N+1's name and then drop file
        // N+1's real completion.
        assert!(!is_expected_sender(Some("lattice-7-window"), "lattice-8-window"));
    }

    #[test]
    fn rejects_every_window_when_nothing_is_pending() {
        // After a timeout has cleared the slot, no window may complete it.
        assert!(!is_expected_sender(None, "lattice-7-window"));
        assert!(!is_expected_sender(None, ""));
    }

    #[test]
    fn label_match_is_exact() {
        // Defensive: no prefix/substring leniency, or "lattice-1-window"
        // would be completable by "lattice-10-window".
        assert!(!is_expected_sender(Some("lattice-1-window"), "lattice-10-window"));
        assert!(!is_expected_sender(Some("lattice-10-window"), "lattice-1-window"));
        assert!(!is_expected_sender(Some("lattice-1-window"), "Lattice-1-Window"));
    }

    #[test]
    fn ensure_readable_accepts_a_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.md");
        std::fs::write(&f, "# hi").unwrap();
        assert!(ensure_readable(f.to_str().unwrap()).is_ok());
    }

    #[test]
    fn ensure_readable_rejects_a_missing_file_by_name() {
        // Regression: without this guard a missing input produced a blank
        // document and a zero exit status (found by hand, 2026-09-20).
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.md");
        let err = ensure_readable(missing.to_str().unwrap()).unwrap_err();
        assert!(err.contains("nope.md"), "error must name the path: {}", err);
    }

    #[test]
    fn ensure_readable_rejects_a_directory() {
        // A directory opens on some platforms and not others; either way it
        // is never a document, and the renderer would produce a blank page.
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let path = sub.to_str().unwrap();
        // Only assert the outcome we can guarantee everywhere: the read that
        // follows must not silently yield a document.
        if let Ok(()) = ensure_readable(path) {
            assert!(std::fs::read_to_string(path).is_err());
        }
    }

    #[test]
    fn write_html_rejects_absent_and_empty_documents() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.html");

        assert!(write_html(&out, None).is_err());
        assert!(write_html(&out, Some(String::new())).is_err());
        // Neither failure may leave a file behind.
        assert!(!out.exists());

        write_html(&out, Some("<p>hi</p>".to_string())).unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "<p>hi</p>");
    }

    #[test]
    fn write_html_overwrites_without_prompting() {
        // REQ-LTTCE-XPT-00002: an existing output file is replaced silently.
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.html");
        std::fs::write(&out, "stale").unwrap();

        write_html(&out, Some("<p>fresh</p>".to_string())).unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "<p>fresh</p>");
    }

    //**************************************************************
    // remove_previous_output_*
    //**************************************************************
    /// REQ-LTTCE-XPT-00006: a PDF from an earlier run must be gone before the
    /// host prints, so it can never be mistaken for this run's output.
    #[test]
    fn remove_previous_output_deletes_an_earlier_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.pdf");
        std::fs::write(&out, "%PDF- from an earlier run").unwrap();

        remove_previous_output(&out).unwrap();
        assert!(!out.exists());
    }

    #[test]
    fn remove_previous_output_accepts_an_absent_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(remove_previous_output(&dir.path().join("never.pdf")), Ok(()));
    }

    #[test]
    fn remove_previous_output_fails_on_a_path_it_cannot_clear() {
        // A directory where the PDF should go: printing there cannot succeed.
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.pdf");
        std::fs::create_dir(&out).unwrap();

        let err = remove_previous_output(&out).unwrap_err();
        assert!(err.contains("cannot replace"), "{err}");
        assert!(out.exists(), "a directory must never be deleted");
    }
    // remove_previous_output_* END *********************************

    //**************************************************************
    // first_export_gets_the_longer_render_budget
    //**************************************************************
    /// REQ-LTTCE-XPT-00008: the first export of a process must be allowed more
    /// time than the ones after it, because only it pays cold-start cost.
    #[test]
    fn first_export_gets_the_longer_render_budget() {
        assert_eq!(render_timeout(true), FIRST_RENDER_TIMEOUT);
        assert_eq!(render_timeout(false), RENDER_TIMEOUT);
        assert!(
            render_timeout(true) > render_timeout(false),
            "the first export must never get a smaller budget than a later one"
        );
    }
    // first_export_gets_the_longer_render_budget END ***************


    //**************************************************************
    // render_budgets_exceed_the_observed_cold_render
    //**************************************************************
    /// Guards the numbers against being tightened back to where a correct
    /// render fails. A warm render of `docs/demo/demo.md` took 17 s on a macOS
    /// arm64 CI runner and the cold one exceeded 20 s, so a budget anywhere
    /// near 20 s reintroduces the false failure of 2026-09-26.
    #[test]
    fn render_budgets_exceed_the_observed_cold_render() {
        const OBSERVED_WARM_RENDER: Duration = Duration::from_secs(17);
        assert!(
            render_timeout(false) > OBSERVED_WARM_RENDER.saturating_mul(2),
            "a later export needs comfortable headroom over the observed warm render"
        );
        assert!(
            render_timeout(true) >= render_timeout(false).saturating_mul(2),
            "the first export needs markedly more than a warm one, not a token extra"
        );
    }
    // render_budgets_exceed_the_observed_cold_render END ***********


    //**************************************************************
    // settle_budget_ends_before_the_render_budget
    //**************************************************************
    /// REQ-LTTCE-XPT-00009: the frontend's diagram wait must give up strictly
    /// before Rust's render budget does, for both budgets, or a stuck diagram
    /// is reported as Rust's bare timeout instead of by name.
    #[test]
    fn settle_budget_ends_before_the_render_budget() {
        for is_first in [true, false] {
            let render = render_timeout(is_first);
            let settle = settle_budget(render);
            assert!(settle < render, "settle {:?} must end before render {:?}", settle, render);
            assert!(!settle.is_zero(), "a zero settle budget would export before anything rendered");
        }
    }
    // settle_budget_ends_before_the_render_budget END **************


    //**************************************************************
    // settle_budget_is_not_the_old_8s_clock
    //**************************************************************
    /// Regression (CI run 36260972990, macos-intel, 2026-09-26): the frontend
    /// waited a fixed 8 s while Rust allowed 90 s, so a cold render that took
    /// ~9 s was exported with at most 2 of its 4 diagrams. The settle budget must scale
    /// with the render budget and stay well clear of that old clock.
    #[test]
    fn settle_budget_is_not_the_old_8s_clock() {
        const OLD_FRONTEND_CLOCK: Duration = Duration::from_secs(8);
        assert!(settle_budget(render_timeout(false)) > OLD_FRONTEND_CLOCK.saturating_mul(4));
        assert!(settle_budget(render_timeout(true)) > settle_budget(render_timeout(false)));
    }
    // settle_budget_is_not_the_old_8s_clock END ********************


    //**************************************************************
    // settle_budget_saturates_instead_of_underflowing
    //**************************************************************
    /// Defensive: a render budget at or below the margin yields zero rather
    /// than panicking on `Duration` underflow. (The frontend then falls back
    /// to its default; see `resolveSettleTimeout`.)
    #[test]
    fn settle_budget_saturates_instead_of_underflowing() {
        assert_eq!(settle_budget(Duration::ZERO), Duration::ZERO);
        assert_eq!(settle_budget(SETTLE_MARGIN), Duration::ZERO);
        assert_eq!(
            settle_budget(SETTLE_MARGIN + Duration::from_secs(1)),
            Duration::from_secs(1)
        );
    }
    // settle_budget_saturates_instead_of_underflowing END **********


    //**************************************************************
    // export_launch_reports_settle_budget_in_millis
    //**************************************************************
    /// `exportSettleMs` is what the frontend reads; it must be milliseconds.
    #[test]
    fn export_launch_reports_settle_budget_in_millis() {
        let launch = ExportLaunch {
            format: ExportFormat::Html,
            settle_budget: Duration::from_secs(40),
        };
        assert_eq!(launch.settle_ms(), 40_000);

        let sub_second = ExportLaunch {
            format: ExportFormat::Pdf,
            settle_budget: Duration::from_millis(1500),
        };
        assert_eq!(sub_second.settle_ms(), 1500);
    }
    // export_launch_reports_settle_budget_in_millis END ************
}
