// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Headless CLI HTML export (`--export-html file1.md file2.md ...`).
//!
//! IMPL-LTTCE-XPT-00003 — REQ-LTTCE-XPT-00001..00003 in
//! `docs/10-System-Requirements.md`. Each path
//! is opened in an invisible window carrying `exportHtml: true` in its
//! `__LATTICE_INIT_DATA__` (see `build_window_with_file_ex` in `lib.rs`); the
//! frontend renders the preview, waits for it to settle (including
//! Mermaid-diagram-to-PNG substitution — the same substitution REQ-LTTCE-MRC-
//! 00002 requires for a clipboard copy, generalised here to the whole
//! document) and hands the resulting HTML back through `export_html_ready`.
//! Files are processed one at a time — `ExportState` holds at most one
//! in-flight sender — so no window is ever left open behind another.

use log::{error, info};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// Per-app state carrying the channel for the single in-flight export.
#[derive(Default)]
pub struct ExportState {
    pending: Mutex<Option<tokio::sync::oneshot::Sender<String>>>,
}

/// How long to wait for one file's preview to render and settle before
/// giving up on it and moving to the next. Generous because Mermaid
/// rasterisation is deferred to an idle callback under
/// `requestIdleCallback`, which a busy renderer can delay.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(20);

//**************************************************************
// export_html_ready
//**************************************************************
/// Tauri command — the frontend's hand-back of the rendered preview HTML for
/// the file currently being exported (see module docs). A no-op if nothing
/// is pending, which only happens if the wait in `export_one` already timed
/// out and moved on.
#[tauri::command]
pub fn export_html_ready(state: tauri::State<ExportState>, html: String) {
    if let Some(tx) = state.pending.lock().unwrap().take() {
        let _ = tx.send(html);
    }
}
// export_html_ready END *****************************************

//**************************************************************
// export_output_path
//**************************************************************
/// The `.html` sibling of a source path: same directory and stem, extension
/// replaced (or added) unconditionally, matching REQ-LTTCE-XPT-00002.
///
/// Pure and host-testable — no Tauri types.
pub fn export_output_path(source: &str) -> PathBuf {
    let mut out = PathBuf::from(source);
    out.set_extension("html");
    out
}
// export_output_path END ****************************************

//**************************************************************
// run_export
//**************************************************************
/// Drives the whole `--export-html` run: each path in turn, then exits the
/// process — this mode never opens a visible window or an editor session.
/// Exit code is `0` when every file exported, `1` if any failed, so the
/// invoking shell can detect a partial run.
pub async fn run_export(app: tauri::AppHandle, paths: Vec<String>) {
    let mut had_error = false;

    for path in paths {
        match export_one(&app, &path).await {
            Ok(out) => info!("export-html: wrote '{}'", out.display()),
            Err(e) => {
                had_error = true;
                error!("export-html: failed for '{}': {}", path, e);
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
/// rendered HTML (or times out), writes it to disk, and closes the window
/// either way — no window from this mode is ever left open.
async fn export_one(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let state: tauri::State<ExportState> = app.state();
        *state.pending.lock().unwrap() = Some(tx);
    }

    let window = crate::build_window_with_file_ex(app, Some(path.to_string()), true)?;

    let wait = tokio::time::timeout(EXPORT_TIMEOUT, rx);
    let result = wait.await;

    let _ = window.close();
    // Whatever happens, stop tracking a sender for a window we just closed —
    // otherwise a late, stray export_html_ready from it (if any) would race
    // the next file's pending sender.
    {
        let state: tauri::State<ExportState> = app.state();
        *state.pending.lock().unwrap() = None;
    }

    let html = match result {
        Ok(Ok(html)) => html,
        Ok(Err(_)) => return Err("export channel closed unexpectedly".to_string()),
        Err(_) => return Err("timed out waiting for preview to render".to_string()),
    };

    if html.is_empty() {
        return Err("renderer produced no HTML".to_string());
    }

    let out_path = export_output_path(path);
    std::fs::write(&out_path, html).map_err(|e| e.to_string())?;
    Ok(out_path)
}
// export_one END ************************************************

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_md_extension() {
        assert_eq!(export_output_path("notes.md"), PathBuf::from("notes.html"));
    }

    #[test]
    fn replaces_any_existing_extension() {
        assert_eq!(export_output_path("notes.txt"), PathBuf::from("notes.html"));
    }

    #[test]
    fn adds_extension_when_absent() {
        assert_eq!(export_output_path("notes"), PathBuf::from("notes.html"));
    }

    #[test]
    fn preserves_directory_component() {
        let out = export_output_path("some/dir/notes.md");
        assert_eq!(out, PathBuf::from("some/dir/notes.html"));
    }
}
