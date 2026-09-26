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

    force_gtk_file_print_backend();

    let settings = gtk::PrintSettings::new();
    settings.set("output-uri", Some(uri.as_str()));
    settings.set("output-file-format", Some("pdf"));
    // Naming the printer is not optional. `output-uri` says *where* the output
    // goes; it does not say *who* produces it. With no printer name GTK looks
    // up the default printer through the CUPS backend, and on a machine with no
    // printer configured — every CI runner, and any printer-less desktop — that
    // lookup fails with "Printer not found" and the export produces nothing.
    settings.set_printer(&file_printer_name());

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

//******************************************************************************
// GTK_PRINT_BACKENDS / LATTICE_GTK_PRINTER
//******************************************************************************
/// Environment variable through which GTK is told which print backends to load.
const GTK_PRINT_BACKENDS: &str = "GTK_PRINT_BACKENDS";
/// The only backend Lattice needs: the one that writes a file.
const GTK_FILE_BACKEND: &str = "file";
/// Escape hatch for the localized printer name — see [`file_printer_name`].
const PRINTER_NAME_OVERRIDE: &str = "LATTICE_GTK_PRINTER";
/// The name GTK's file print backend gives its printer in the C locale.
const DEFAULT_FILE_PRINTER: &str = "Print to File";


//******************************************************************************
// force_gtk_file_print_backend
//******************************************************************************
/// Restricts GTK to its file print backend for this process.
///
/// IMPL-LTTCE-XPT-00005 — without this, GTK also loads the CUPS backend and
/// resolves the printer through it; on a host with no printer that fails and no
/// PDF is written. Lattice never prints to paper — `print_to_pdf` is reached
/// only from `export.rs`, which always writes a file — so narrowing the backend
/// costs no feature and removes the dependency on a configured printer.
///
/// An existing value is respected: someone who set it deliberately outranks us.
fn force_gtk_file_print_backend() {
    if std::env::var_os(GTK_PRINT_BACKENDS).is_some() {
        return;
    }
    // SAFETY: `set_var` is unsound only when another thread reads the
    // environment concurrently. This runs on the GTK main thread inside
    // `with_webview`, before the first `PrintOperation` of the process exists,
    // which is when GTK first loads its print backends; no Lattice thread reads
    // the environment at that point.
    unsafe {
        std::env::set_var(GTK_PRINT_BACKENDS, GTK_FILE_BACKEND);
    }
}
// force_gtk_file_print_backend END ********************************************


//******************************************************************************
// file_printer_name
//******************************************************************************
/// Name of the printer to hand GTK, i.e. the one the file backend provides.
///
/// KNOWN LIMITATION — GTK names that printer with a *translated* string
/// ("Print to File" in the C locale, "In Datei drucken" under a German one), and
/// gtk-rs 0.18 exposes no safe printer enumeration to look it up, so the name
/// cannot be discovered without unsafe FFI into `gtk_enumerate_printers`. The C
/// name is therefore used by default — correct in CI and on any host running a
/// C/English locale — and `LATTICE_GTK_PRINTER` overrides it, so a localized
/// host can be corrected without a rebuild.
fn file_printer_name() -> String {
    match std::env::var(PRINTER_NAME_OVERRIDE) {
        Ok(name) if !name.trim().is_empty() => name,
        _ => DEFAULT_FILE_PRINTER.to_string(),
    }
}
// file_printer_name END *******************************************************


//******************************************************************************
// tests (linux print settings)
//******************************************************************************
#[cfg(test)]
mod linux_print_tests {
    use super::*;

    /// These tests read and write *process-global* environment variables, so
    /// they must not run concurrently with each other — cargo runs tests in
    /// parallel threads by default. One mutex around every body serializes
    /// them without pulling in a test-only dependency.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Held for the body of each test. `unwrap_or_else` takes the guard even
    /// after another test panicked while holding it, so one failure does not
    /// cascade into poisoned-mutex failures in the rest.
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    //**************************************************************
    // file_printer_name_defaults_to_the_c_locale_name
    //**************************************************************
    #[test]
    fn file_printer_name_defaults_to_the_c_locale_name() {
        let _lock = env_guard();
        // SAFETY: single-threaded test, see force_gtk_file_print_backend.
        unsafe { std::env::remove_var(PRINTER_NAME_OVERRIDE) };
        assert_eq!(file_printer_name(), DEFAULT_FILE_PRINTER);
    }
    // file_printer_name_defaults_to_the_c_locale_name END **********


    //**************************************************************
    // file_printer_name_honours_the_override
    //**************************************************************
    #[test]
    fn file_printer_name_honours_the_override() {
        let _lock = env_guard();
        // SAFETY: single-threaded test, see force_gtk_file_print_backend.
        unsafe { std::env::set_var(PRINTER_NAME_OVERRIDE, "In Datei drucken") };
        assert_eq!(file_printer_name(), "In Datei drucken");
        unsafe { std::env::remove_var(PRINTER_NAME_OVERRIDE) };
    }
    // file_printer_name_honours_the_override END *******************


    //**************************************************************
    // file_printer_name_ignores_a_blank_override
    //**************************************************************
    /// An empty variable is "unset", not "a printer with no name": a CI
    /// expression that selects a value only on some legs yields "" on the rest,
    /// and handing that to GTK would fail where no override was intended.
    #[test]
    fn file_printer_name_ignores_a_blank_override() {
        let _lock = env_guard();
        // SAFETY: single-threaded test, see force_gtk_file_print_backend.
        unsafe { std::env::set_var(PRINTER_NAME_OVERRIDE, "   ") };
        assert_eq!(file_printer_name(), DEFAULT_FILE_PRINTER);
        unsafe { std::env::remove_var(PRINTER_NAME_OVERRIDE) };
    }
    // file_printer_name_ignores_a_blank_override END ***************


    //**************************************************************
    // backend_forcing_respects_an_existing_value
    //**************************************************************
    #[test]
    fn backend_forcing_respects_an_existing_value() {
        let _lock = env_guard();
        // SAFETY: single-threaded test, see force_gtk_file_print_backend.
        unsafe { std::env::set_var(GTK_PRINT_BACKENDS, "cups") };
        force_gtk_file_print_backend();
        assert_eq!(std::env::var(GTK_PRINT_BACKENDS).as_deref(), Ok("cups"));
        unsafe { std::env::remove_var(GTK_PRINT_BACKENDS) };
    }
    // backend_forcing_respects_an_existing_value END ***************


    //**************************************************************
    // backend_forcing_sets_the_file_backend_when_unset
    //**************************************************************
    #[test]
    fn backend_forcing_sets_the_file_backend_when_unset() {
        let _lock = env_guard();
        // SAFETY: single-threaded test, see force_gtk_file_print_backend.
        unsafe { std::env::remove_var(GTK_PRINT_BACKENDS) };
        force_gtk_file_print_backend();
        assert_eq!(
            std::env::var(GTK_PRINT_BACKENDS).as_deref(),
            Ok(GTK_FILE_BACKEND)
        );
        unsafe { std::env::remove_var(GTK_PRINT_BACKENDS) };
    }
    // backend_forcing_sets_the_file_backend_when_unset END *********
}
// tests (linux print settings) END ********************************************
