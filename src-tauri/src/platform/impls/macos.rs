// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// macOS platform implementation — file-association via CLI args + Apple Events.
//
// open_windows_on_startup only opens windows for explicit CLI-arg paths.
// It deliberately does NOT open an empty fallback window: on macOS, files
// opened via double-click arrive as RunEvent::Opened (Apple Events), and
// plain launches (dock/Spotlight) are handled by RunEvent::Ready below.
//
// handle_run_event is macOS-specific: it handles NSOpenDocument Apple Events
// that Tauri surfaces as RunEvent::Opened { urls }, and creates an empty window
// on RunEvent::Ready when no windows exist yet.

// Shared CLI desktop helpers — macOS-specific open_windows_on_startup delegates
// to these, while other platforms use the shared CLI arg collection logic.
// This is one of the ways to mimic ("override only changed " static) inheritance 
// in Rust
include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/platform/impls/cli_desktop.rs"
));

use log::{error, info};
use tauri::Manager;

pub(super) struct PlatformImpl;

impl Platform for PlatformImpl {
    //**************************************************************************
    // open_windows_on_startup
    //**************************************************************************
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // On macOS, files opened via double-click / "Open With" are delivered as
        // RunEvent::Opened Apple Events — NOT as CLI arguments.  So we must NOT
        // open an empty fallback window here when there are no CLI args: the
        // file window will arrive via Opened, and the empty-window fallback is
        // handled by RunEvent::Ready (which checks webview_windows().is_empty()).
        //
        // Without this guard the sequence was:
        //   1. setup: no CLI args → empty window created  ← bug
        //   2. RunEvent::Opened fires → file window created on top
        // resulting in two windows every time a file was double-clicked.
        //
        // With this guard:
        //   • Double-click: setup does nothing; Opened fires → one file window.
        //   • CLI open (`lattice foo.md`): paths found → one file window.
        //   • Plain launch (dock/Spotlight): setup does nothing; Ready fires
        //     (no windows yet) → one empty window.
        let paths = cli_args::collect_file_paths();
        let handle = app.handle().clone();
        cli_desktop_open_file_paths(&handle, paths, "macos")?;
        // No fallback empty window here — see RunEvent::Ready below.
        Ok(())
    }
    // open_windows_on_startup END ***********************************************

    //**************************************************************************
    // handle_run_event
    //**************************************************************************
    /// Called for every `RunEvent` from the Tauri event loop.
    ///
    /// Handles `Opened` (file association) and `Ready` (empty-window fallback).
    /// All other events are explicitly ignored — not swallowed by a wildcard.
    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent) {
        match event {
            tauri::RunEvent::Opened { urls } => {
                for url in &urls {
                    match url.to_file_path() {
                        Ok(path) => {
                            let path_str = path.to_string_lossy().to_string();
                            info!("macOS Opened: opening '{}'", path_str);
                            if let Err(e) = super::build_window_with_file(app, Some(path_str)) {
                                error!("macOS Opened: window creation failed: {}", e);
                            }
                        }
                        Err(_) => {
                            // Silently skip non-file URLs (custom scheme, http, etc.)
                            info!("macOS Opened: non-file URL '{}', skipping", url);
                        }
                    }
                }
            }
            // Launched via dock icon / Spotlight — no Opened event fires.
            // Also fires after double-click, but by then Opened has already
            // created the file window, so the is_empty() guard prevents a
            // second empty window (that Ready falls through to `_` below).
            tauri::RunEvent::Ready if app.webview_windows().is_empty() => {
                info!("macOS Ready: no windows; creating empty editor window.");
                if let Err(e) = super::build_window_with_file(app, None) {
                    error!("macOS Ready: empty window creation failed: {}", e);
                }
            }
            // Every other RunEvent (ExitRequested, Exit, WindowEvent, …) is
            // intentionally not handled here — no wildcard swallow.
            _ => {}
        }
    }
    // handle_run_event END ******************************************************

    //**************************************************************************
    // print_to_pdf (macos)
    //**************************************************************************
    /// IMPL-LTTCE-XPT-00005 — prints the settled document with WKWebView's own
    /// print operation (`printOperationWithPrintInfo:`), i.e. the exact layout
    /// engine that rendered the preview, paginated onto the page
    /// `macos_print_info` describes and saved straight to `out_path`.
    fn print_to_pdf(
        &self,
        window: &tauri::WebviewWindow,
        out_path: std::path::PathBuf,
        paper: crate::paper::PaperSize,
        done: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) {
        let done = PdfDone::new(done);
        let on_main = std::sync::Arc::clone(&done);
        let dispatch = window.with_webview(move |webview| {
            // SAFETY: `inner()` is the live WKWebView owned by the window this
            // closure was dispatched to, and `with_webview` runs it on the
            // main thread — the only thread WebKit may be touched from.
            let wk: &objc2_web_kit::WKWebView =
                unsafe { &*(webview.inner() as *const objc2_web_kit::WKWebView) };
            macos_print_to_pdf(wk, &out_path, paper, &on_main);
        });
        if let Err(e) = dispatch {
            done.finish(Err(format!("cannot reach the WKWebView: {}", e)));
        }
    }
    // print_to_pdf (macos) END **************************************************
}

//******************************************************************************
// macos_print_to_pdf
//******************************************************************************
/// The Cocoa half of the macOS print: a real AppKit print operation, built by
/// WKWebView for its own content, saving to `out_path` with no panel shown.
///
/// The first version used `createPDFWithConfiguration:` instead. That is a
/// *snapshot* API — one page the size of the (invisible) window, no print
/// stylesheet, no pagination: the v0.3.28 release shipped an 800 × 568 pt,
/// single-page, landscape "PDF" (REQ-LTTCE-XPT-00004 / REQ-LTTCE-XPT-00012).
/// A print operation paginates the way Cmd-P does.
///
/// Completion arrives through [`pdf_print_delegate::PdfPrintDelegate`]; every
/// failure before the operation starts is reported here.
fn macos_print_to_pdf(
    webview: &objc2_web_kit::WKWebView,
    out_path: &std::path::Path,
    paper: crate::paper::PaperSize,
    done: &std::sync::Arc<PdfDone>,
) {
    let Some(window) = webview.window() else {
        done.finish(Err("the WKWebView is not attached to a window".to_string()));
        return;
    };
    let info = match macos_print_info(out_path, paper) {
        Ok(info) => info,
        Err(e) => {
            done.finish(Err(e));
            return;
        }
    };

    // SAFETY: main thread (see the caller); `info` is a fully set-up NSPrintInfo.
    let operation = unsafe { webview.printOperationWithPrintInfo(&info) };
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    // WKWebView's print view is created with a zero frame, and a zero-sized
    // view is widely reported to print blank pages; give it the web view's.
    if let Some(view) = operation.view() {
        view.setFrame(webview.frame());
    }

    let delegate =
        pdf_print_delegate::PdfPrintDelegate::new(std::sync::Arc::clone(done), out_path.to_path_buf());
    let delegate_obj: &objc2::runtime::AnyObject = &delegate;
    // SAFETY: `delegate` implements exactly this selector with the signature
    // AppKit calls it with (see `pdf_print_delegate`); `contextInfo` is unused.
    unsafe {
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window,
            Some(delegate_obj),
            Some(objc2::sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }
    // AppKit does not retain a modal delegate, so it must outlive this function
    // until the callback. Deliberately leaked rather than parked in a slot the
    // next export would overwrite: after a timeout, a late callback into a
    // freed delegate would crash the batch. One small object per exported file
    // in a process that exits when the batch ends. A future interactive
    // "Export to PDF…" reusing this routine would leak the same one object per
    // print — bounded by user clicks, not by document size — which is the
    // price of never freeing it under a callback AppKit may still make.
    std::mem::forget(delegate);
}
// macos_print_to_pdf END ******************************************************


//******************************************************************************
// macos_print_info
//******************************************************************************
/// A fresh `NSPrintInfo` for `paper`: portrait, [`crate::paper::PAGE_MARGIN_MM`]
/// on every side, fitted to the page width, saved to `out_path`.
///
/// Fresh rather than `sharedPrintInfo`, which is app-wide state that wry's
/// interactive `print()` also mutates. A non-UTF-8 path is refused here with a
/// clear message rather than handed to AppKit.
fn macos_print_info(
    out_path: &std::path::Path,
    paper: crate::paper::PaperSize,
) -> Result<objc2::rc::Retained<objc2_app_kit::NSPrintInfo>, String> {
    use crate::paper::{mm_to_points, PAGE_MARGIN_MM};
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob,
        NSPrintingPaginationMode,
    };
    use objc2_foundation::{NSSize, NSString, NSURL};

    let path = out_path
        .to_str()
        .ok_or_else(|| format!("'{}' is not a UTF-8 path", out_path.display()))?;

    let info = NSPrintInfo::new();
    let (width, height) = paper.size_points();
    info.setPaperSize(NSSize::new(width, height));
    info.setOrientation(NSPaperOrientation::Portrait);
    let margin = mm_to_points(PAGE_MARGIN_MM);
    info.setTopMargin(margin);
    info.setBottomMargin(margin);
    info.setLeftMargin(margin);
    info.setRightMargin(margin);
    info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    info.setHorizontallyCentered(false);
    info.setVerticallyCentered(false);

    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    // SAFETY: `NSPrintSaveJob` and `NSPrintJobSavingURL` are AppKit's own
    // constants; the dictionary is this print info's attribute dictionary,
    // keyed by NSPrintInfoAttributeKey (an NSString), as AppKit expects.
    unsafe {
        info.setJobDisposition(NSPrintSaveJob);
        info.dictionary()
            .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
    }
    Ok(info)
}
// macos_print_info END ********************************************************


//******************************************************************************
// pdf_print_delegate
//******************************************************************************
/// The Objective-C object AppKit calls when the print operation has run.
///
/// Its own module so the `define_class!` imports stay local.
mod pdf_print_delegate {
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
    use objc2_app_kit::NSPrintOperation;

    /// What the callback needs: where to report, and the file whose existence
    /// proves the save really happened.
    pub(super) struct Ivars {
        done: std::sync::Arc<super::PdfDone>,
        target: std::path::PathBuf,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "LatticePdfPrintDelegate"]
        #[ivars = Ivars]
        pub(super) struct PdfPrintDelegate;

        impl PdfPrintDelegate {
            /// `-printOperationDidRun:success:contextInfo:`, the selector
            /// passed to `runOperationModalForWindow:…`.
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_operation_did_run(
                &self,
                _operation: &NSPrintOperation,
                success: Bool,
                _context: *mut std::ffi::c_void,
            ) {
                let ivars = self.ivars();
                ivars
                    .done
                    .finish(super::written_pdf_result(success.as_bool(), &ivars.target));
            }
        }

        unsafe impl NSObjectProtocol for PdfPrintDelegate {}
    );

    impl PdfPrintDelegate {
        pub(super) fn new(
            done: std::sync::Arc<super::PdfDone>,
            target: std::path::PathBuf,
        ) -> Retained<Self> {
            let this = Self::alloc().set_ivars(Ivars { done, target });
            // SAFETY: plain NSObject `init` on a freshly allocated instance.
            unsafe { msg_send![super(this), init] }
        }
    }
}
// pdf_print_delegate END ******************************************************
