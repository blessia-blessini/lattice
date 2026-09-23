// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

// Linux platform implementation — file-association via CLI arguments.
//
// On Linux, double-clicking a `.md` file (via a desktop environment that
// honours the `.desktop` file association) causes the OS to launch the
// process with the file path as a plain CLI argument.
//
// Both trait methods delegate to the shared CLI helpers in cli_desktop.rs.

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/platform/impls/cli_desktop.rs"));

pub(super) struct PlatformImpl;

impl Platform for PlatformImpl {
    fn open_windows_on_startup(
        &self,
        app: &mut tauri::App,
    ) -> Result<(), Box<dyn std::error::Error>> {
        cli_desktop_open_windows_on_startup(app, "linux")
    }

    fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent) {
        cli_desktop_handle_run_event(app, event)
    }

    //**************************************************************
    // print_to_pdf (linux)
    //**************************************************************
    /// IMPL-LTTCE-XPT-00005 — prints the settled document with WebKitGTK's own
    /// `WebKitPrintOperation`, i.e. the exact layout engine that rendered the
    /// preview, driven straight to a file through GTK's `output-uri` /
    /// `output-file-format` print settings so no printer dialog is ever shown.
    fn print_to_pdf(
        &self,
        window: &tauri::WebviewWindow,
        out_path: std::path::PathBuf,
        done: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) {
        let done = PdfDone::new(done);
        let on_main = std::sync::Arc::clone(&done);
        let dispatch = window.with_webview(move |webview| {
            linux_print_to_pdf(&webview.inner(), &out_path, &on_main);
        });
        if let Err(e) = dispatch {
            done.finish(Err(format!("cannot reach the WebKitGTK webview: {}", e)));
        }
    }
    // print_to_pdf (linux) END **********************************
}

//******************************************************************************
// linux_print_to_pdf
//******************************************************************************
/// The GTK half of the Linux print. Runs on the main thread (GTK's only legal
/// thread), which `with_webview` guarantees.
///
/// `output-uri` must be an absolute `file://` URI; a relative or non-UTF-8
/// path is rejected here rather than handed to GTK, which would fail with a
/// far less useful message.
fn linux_print_to_pdf(
    webview: &webkit2gtk::WebView,
    out_path: &std::path::Path,
    done: &std::sync::Arc<PdfDone>,
) {
    use gtk::prelude::*;
    use webkit2gtk::PrintOperationExt;

    let uri = match glib::filename_to_uri(out_path, None) {
        Ok(uri) => uri,
        Err(e) => {
            done.finish(Err(format!(
                "cannot express '{}' as a file:// URI: {}",
                out_path.display(),
                e
            )));
            return;
        }
    };

    let settings = gtk::PrintSettings::new();
    settings.set("output-uri", Some(uri.as_str()));
    settings.set("output-file-format", Some("pdf"));

    let operation = webkit2gtk::PrintOperation::new(webview);
    operation.set_print_settings(&settings);

    // The operation must outlive `print()` — WebKit reports completion through
    // these signals long after this function returns. Each callback drops the
    // strong reference it is holding, so the op -> closure -> op cycle is
    // broken as soon as either one fires; a print that never reports is
    // covered by the bounded timeout in `export.rs`.
    let keep_alive = std::rc::Rc::new(std::cell::RefCell::new(Some(operation.clone())));

    let on_ok = std::sync::Arc::clone(done);
    let released = std::rc::Rc::clone(&keep_alive);
    operation.connect_finished(move |_| {
        released.borrow_mut().take();
        on_ok.finish(Ok(()));
    });

    let on_err = std::sync::Arc::clone(done);
    let released = std::rc::Rc::clone(&keep_alive);
    operation.connect_failed(move |_, error| {
        released.borrow_mut().take();
        on_err.finish(Err(format!("WebKitGTK print failed: {}", error)));
    });

    operation.print();
}
// linux_print_to_pdf END ******************************************************
