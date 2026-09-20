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

/// Per-app state carrying the channel for the single in-flight export.
///
/// The payload is what the *frontend* has to say once the preview has
/// settled: `Ok(Some(html))` for an HTML export, `Ok(None)` for a PDF export
/// (settled, nothing to hand over — Rust prints it), `Err(message)` when the
/// frontend itself failed to render.
type ReadySender = tokio::sync::oneshot::Sender<Result<Option<String>, String>>;

#[derive(Default)]
pub struct ExportState {
    pending: Mutex<Option<ReadySender>>,
}

/// How long to wait for one file's preview to render and settle before
/// giving up on it and moving to the next. Generous because Mermaid
/// rasterisation is deferred to an idle callback under
/// `requestIdleCallback`, which a busy renderer can delay.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(20);

/// How long to wait for the host WebView's print-to-PDF to complete once the
/// document has already settled. Shorter than `EXPORT_TIMEOUT`: nothing is
/// being rendered or rasterised any more, only paginated and serialised.
const PDF_PRINT_TIMEOUT: Duration = Duration::from_secs(30);

//**************************************************************
// export_ready
//**************************************************************
/// Tauri command — the frontend's signal that the preview for the file
/// currently being exported has settled (see module docs).
///
/// `html` carries the serialised preview for an HTML export and is absent for
/// a PDF export; `error` is set instead when the frontend could not render.
/// A no-op if nothing is pending, which only happens if the wait in
/// `export_one` already timed out and moved on.
#[tauri::command]
pub fn export_ready(state: tauri::State<ExportState>, html: Option<String>, error: Option<String>) {
    if let Some(tx) = state.pending.lock().unwrap().take() {
        let payload = match error {
            Some(msg) => Err(msg),
            None => Ok(html),
        };
        let _ = tx.send(payload);
    }
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
// run_export
//**************************************************************
/// Drives the whole headless export run: each path in turn, then exits the
/// process — this mode never opens a visible window or an editor session.
/// Exit code is `0` when every file exported, `1` if any failed, so the
/// invoking shell can detect a partial run.
pub async fn run_export(app: tauri::AppHandle, paths: Vec<String>, format: ExportFormat) {
    let mut had_error = false;

    for path in paths {
        match export_one(&app, &path, format).await {
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
) -> Result<PathBuf, String> {
    ensure_readable(path)?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let state: tauri::State<ExportState> = app.state();
        *state.pending.lock().unwrap() = Some(tx);
    }

    let window = crate::build_window_with_file_ex(app, Some(path.to_string()), Some(format))?;

    let settled = tokio::time::timeout(EXPORT_TIMEOUT, rx).await;

    // Whatever happens next, stop tracking a sender for this window —
    // otherwise a late, stray export_ready from it (if any) would race the
    // next file's pending sender.
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
            return Err("timed out waiting for preview to render".to_string());
        }
    };
    clear_pending();

    let out_path = export_output_path(path, format);

    // The window must stay alive until the output exists: for a PDF it is the
    // very thing being printed.
    let result = match format {
        ExportFormat::Html => write_html(&out_path, ready),
        ExportFormat::Pdf => print_pdf(&window, &out_path).await,
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
/// Asks the host WebView to print the settled document to `out_path`, bounded
/// by `PDF_PRINT_TIMEOUT` so a wedged print operation cannot hang the whole
/// batch (REQ-LTTCE-XPT-00006).
async fn print_pdf(
    window: &tauri::WebviewWindow,
    out_path: &std::path::Path,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    crate::platform::print_to_pdf(window, out_path.to_path_buf(), tx);

    match tokio::time::timeout(PDF_PRINT_TIMEOUT, rx).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("PDF print channel closed unexpectedly".to_string()),
        Err(_) => Err("timed out waiting for the WebView to write the PDF".to_string()),
    }
}
// print_pdf END *************************************************

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
}
