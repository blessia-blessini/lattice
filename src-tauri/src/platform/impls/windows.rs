// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// Windows platform implementation — file-association via CLI arguments.
//
// On Windows, double-clicking a `.md` file associated with Lattice causes the
// OS to launch the process with the file path as a plain CLI argument.
//
// Both trait methods delegate to the shared CLI helpers in cli_desktop.rs.

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/platform/impls/cli_desktop.rs"));

pub(super) struct PlatformImpl;

impl Platform for PlatformImpl {
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>> {
        cli_desktop_open_windows_on_startup(app, "windows")
    }

    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent) {
        cli_desktop_handle_run_event(app, event)
    }

    //**************************************************************
    // print_to_pdf (windows)
    //**************************************************************
    /// IMPL-LTTCE-XPT-00005 — prints the settled document with WebView2's own
    /// `ICoreWebView2_7::PrintToPdf`, i.e. the exact layout engine that
    /// rendered the preview, on the page `windows_print_settings` describes.
    fn print_to_pdf(
        &self,
        window: &tauri::WebviewWindow,
        out_path: std::path::PathBuf,
        paper: crate::paper::PaperSize,
        done: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) {
        let done = PdfDone::new(done);
        // `with_webview` hands the controller over on the main thread; both
        // that hop and the print itself can fail, and either way exactly one
        // result must reach the caller — hence the shared sink.
        let on_main = std::sync::Arc::clone(&done);
        let dispatch = window.with_webview(move |webview| {
            if let Err(e) = windows_print_to_pdf(&webview, &out_path, paper, &on_main) {
                on_main.finish(Err(format!("WebView2 PrintToPdf failed to start: {}", e)));
            }
        });
        if let Err(e) = dispatch {
            done.finish(Err(format!("cannot reach the WebView2 controller: {}", e)));
        }
    }
    // print_to_pdf (windows) END ********************************
}

//******************************************************************************
// windows_print_to_pdf
//******************************************************************************
/// The COM half of the Windows print: resolve `ICoreWebView2_7` off the
/// controller and start `PrintToPdf`, reporting through `done` when the
/// completion handler fires.
///
/// Separated from the trait method so the whole start-up sequence is one
/// `?`-chained fallible expression; the caller turns any `Err` here into a
/// single reported failure.
fn windows_print_to_pdf(
    webview: &tauri::webview::PlatformWebview,
    out_path: &std::path::Path,
    paper: crate::paper::PaperSize,
    done: &std::sync::Arc<PdfDone>,
) -> windows::core::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, PCWSTR};

    // PCWSTR is a borrowed pointer: `wide` must outlive the PrintToPdf call.
    // It does — PrintToPdf copies the path before returning; only the
    // *completion* is deferred.
    let wide: Vec<u16> = out_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let core = unsafe { webview.controller().CoreWebView2()? };
    let core7: ICoreWebView2_7 = core.cast()?;
    let settings = windows_print_settings(&core, paper)?;

    let on_done = std::sync::Arc::clone(done);
    let target = out_path.to_path_buf();
    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, is_successful| {
        match result {
            Ok(()) if is_successful => on_done.finish(written_pdf_result(true, &target)),
            // A successful HRESULT with is_successful == false is WebView2's
            // way of saying "I could not write that file" (bad path, denied
            // directory) — a real failure, not a silent no-op.
            Ok(()) => on_done.finish(Err(
                "WebView2 could not write the PDF (path not writable?)".to_string(),
            )),
            Err(e) => on_done.finish(Err(format!("WebView2 PrintToPdf failed: {}", e))),
        }
        Ok(())
    }));

    unsafe { core7.PrintToPdf(PCWSTR(wide.as_ptr()), &settings, &handler) }
}
// windows_print_to_pdf END ****************************************************


//******************************************************************************
// windows_print_settings
//******************************************************************************
/// WebView2 print settings for `paper`: portrait, page size and
/// [`crate::paper::PAGE_MARGIN_MM`] on every side, all in inches.
///
/// Passing `None` to `PrintToPdf` instead — as the first version did — takes
/// WebView2's defaults, which are US Letter regardless of the requested paper.
/// The margins equal the CSS `@page` margin Chromium would otherwise apply, so
/// the page is identical to an interactive print; they are set anyway so the
/// geometry is one explicit value on every platform rather than a default.
fn windows_print_settings(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    paper: crate::paper::PaperSize,
) -> windows::core::Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings>
{
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, ICoreWebView2_2, ICoreWebView2Environment6,
    };
    use windows::core::Interface;

    let core2: ICoreWebView2_2 = core.cast()?;
    let environment: ICoreWebView2Environment6 = unsafe { core2.Environment()? }.cast()?;
    let settings = unsafe { environment.CreatePrintSettings()? };

    use crate::paper::{mm_to_inches, PAGE_MARGIN_MM};
    let (width_mm, height_mm) = paper.size_mm();
    let (width, height) = (mm_to_inches(width_mm), mm_to_inches(height_mm));
    let margin = mm_to_inches(PAGE_MARGIN_MM);
    // SAFETY: plain property setters on a settings object this function owns.
    unsafe {
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
        settings.SetPageWidth(width)?;
        settings.SetPageHeight(height)?;
        settings.SetMarginTop(margin)?;
        settings.SetMarginBottom(margin)?;
        settings.SetMarginLeft(margin)?;
        settings.SetMarginRight(margin)?;
    }
    Ok(settings)
}
// windows_print_settings END **************************************************
