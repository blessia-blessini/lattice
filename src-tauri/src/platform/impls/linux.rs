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

    use_gtk_file_print_backend();

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
// Print backend constants
//******************************************************************************
/// The only GTK print backend Lattice needs: the one that writes a file.
const GTK_FILE_BACKEND: &str = "file";
/// gettext domain GTK 3 registers its own strings under.
const GTK_TEXT_DOMAIN: &str = "gtk30";
/// The untranslated name GTK's file print backend gives its printer, i.e. the
/// exact msgid passed to `_()` in GTK 3's `gtkprintbackendfile.c`.
const FILE_PRINTER_MSGID: &str = "Print to File";
/// Escape hatch for the printer name — see [`file_printer_name`].
const PRINTER_NAME_OVERRIDE: &str = "LATTICE_GTK_PRINTER";
// Print backend constants END *************************************************


//******************************************************************************
// use_gtk_file_print_backend
//******************************************************************************
/// Restricts GTK to its file print backend for this process.
///
/// IMPL-LTTCE-XPT-00005 — without this, GTK also loads the CUPS backend and
/// resolves the printer through it; on a host with no printer that fails and no
/// PDF is written. Lattice never prints to paper — `print_to_pdf` is reached
/// only from `export.rs`, which always writes a file — so narrowing the backend
/// costs no feature and removes the dependency on a configured printer.
///
/// Set on GTK's own settings object rather than through the `GTK_PRINT_BACKENDS`
/// environment variable. Two reasons, both load-bearing:
///
/// * `std::env::set_var` would be undefined behaviour here. Tokio workers, the
///   `notify` file-watcher thread and glib's own pools are all running by the
///   time an export starts, and POSIX `setenv` mutates the global `environ`
///   with no synchronisation against a concurrent `getenv`.
/// * The environment variable is not ours to defer to. A desktop environment
///   that sets `GTK_PRINT_BACKENDS=cups` would leave the file backend unloaded,
///   its printer non-existent, and every export failing — the exact bug this is
///   fixing. The setting is therefore applied unconditionally.
fn use_gtk_file_print_backend() {
    use gtk::prelude::GtkSettingsExt;

    if let Some(settings) = gtk::Settings::default() {
        settings.set_gtk_print_backends(Some(GTK_FILE_BACKEND));
    }
}
// use_gtk_file_print_backend END **********************************************


//******************************************************************************
// resolve_printer_name
//******************************************************************************
/// Chooses the printer name from an explicit override and a translated name.
///
/// Split out from [`file_printer_name`] so the decision is a pure function of
/// its inputs and can be unit-tested without any test touching the process
/// environment — which no test may do while other tests run in parallel
/// threads, and which no amount of local locking would make safe.
///
/// An empty or blank override counts as "not set", never as a nameless printer:
/// a CI expression that selects a value only on some legs yields `""` on the
/// rest, and handing that to GTK would fail where no override was intended.
fn resolve_printer_name(override_value: Option<&str>, translated: &str) -> String {
    match override_value {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => translated.to_string(),
    }
}
// resolve_printer_name END ****************************************************


//******************************************************************************
// file_printer_name
//******************************************************************************
/// Name of the printer to hand GTK, i.e. the one the file backend provides.
///
/// GTK names that printer with a **translated** string — "Print to File" in a C
/// or English locale, "In Datei drucken" under a German one — and gtk-rs 0.18
/// binds no printer enumeration at all (there is no `gtk::Printer`), so the
/// name cannot be read back from GTK without unsafe FFI into
/// `gtk_enumerate_printers`.
///
/// Instead the same translation GTK itself used is asked of gettext directly,
/// through GTK's own text domain. That makes the name correct in every locale
/// with no unsafe code, and it degrades exactly right: with no catalogue
/// installed gettext returns the msgid unchanged, which is the C-locale name.
///
/// `LATTICE_GTK_PRINTER` still overrides it, for a host whose GTK translation
/// somehow does not match what its print backend registered.
fn file_printer_name() -> String {
    let translated = glib::dgettext(Some(GTK_TEXT_DOMAIN), FILE_PRINTER_MSGID);
    let override_value = std::env::var(PRINTER_NAME_OVERRIDE).ok();
    resolve_printer_name(override_value.as_deref(), translated.as_str())
}
// file_printer_name END *******************************************************


//******************************************************************************
// tests (linux print settings)
//******************************************************************************
#[cfg(test)]
mod linux_print_tests {
    use super::*;

    //**************************************************************
    // the_translated_name_is_used_when_no_override_is_given
    //**************************************************************
    /// Whatever gettext returned for GTK's own msgid is what GTK is handed.
    #[test]
    fn the_translated_name_is_used_when_no_override_is_given() {
        assert_eq!(
            resolve_printer_name(None, "In Datei drucken"),
            "In Datei drucken"
        );
    }
    // the_translated_name_is_used_when_no_override_is_given END ****


    //**************************************************************
    // an_override_wins_over_the_translation
    //**************************************************************
    #[test]
    fn an_override_wins_over_the_translation() {
        assert_eq!(
            resolve_printer_name(Some("Imprimer dans un fichier"), FILE_PRINTER_MSGID),
            "Imprimer dans un fichier"
        );
    }
    // an_override_wins_over_the_translation END ********************


    //**************************************************************
    // a_blank_override_is_treated_as_unset
    //**************************************************************
    #[test]
    fn a_blank_override_is_treated_as_unset() {
        for blank in ["", "   ", "\t"] {
            assert_eq!(
                resolve_printer_name(Some(blank), FILE_PRINTER_MSGID),
                FILE_PRINTER_MSGID,
                "a blank override must fall back to the translated name"
            );
        }
    }
    // a_blank_override_is_treated_as_unset END *********************


    //**************************************************************
    // an_untranslated_domain_yields_the_c_locale_name
    //**************************************************************
    /// gettext returns the msgid unchanged when no catalogue is installed, so
    /// the no-translation case must still produce a usable printer name.
    #[test]
    fn an_untranslated_domain_yields_the_c_locale_name() {
        assert_eq!(resolve_printer_name(None, FILE_PRINTER_MSGID), "Print to File");
    }
    // an_untranslated_domain_yields_the_c_locale_name END **********
}
// tests (linux print settings) END ********************************************
