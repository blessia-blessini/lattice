// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Headless CLI export check for `docs/demo/demo.md`.
//!
//! ITST-LTTCE-XPT-00010 — closes the gap named in `docs/60-test-strategy.md`:
//! `--export-html` / `--export-pdf` had unit tests for every pure part and no
//! test at all for the round trip that actually produces a file.
//!
//! This is deliberately NOT part of `e2e_harness.rs`. That harness drives a
//! *visible, long-lived* GUI through signal files and is gated to Windows in
//! `build-test.sh` because headless GUI driving is flaky elsewhere. An export
//! run is the opposite shape: it opens an invisible window, writes a file and
//! exits by itself, so there is nothing to drive and it runs on every desktop
//! OS — which is the only way the Linux and macOS `print_to_pdf` backends ever
//! get executed rather than merely compiled.
//!
//! One implementation, three callers (DRY — `DRY-and-Variants.md`):
//! `build-test.ps1`, `build-test.sh`, and CI step 375, instead of the same
//! assertions written twice in two shell dialects.
//!
//! ```text
//! cargo run --example export_demo -- [--out <dir>] [--label <name>]
//! ```
//!
//! * `--out <dir>` also copy the produced files to `<dir>` as
//!   `demo-<label>.html` / `demo-<label>.pdf`, for CI to publish on the
//!   release page.
//! * `--label <name>` the platform label used in those names; defaults to the
//!   host OS.
//!
//! Environment:
//! * `LATTICE_EXPORT_BIN` explicit path to the lattice binary to test.
//! * `LATTICE_EXPORT_REQUIRED` when `1`, a missing binary is a FAILURE rather
//!   than a skip. CI sets this; a local working tree that has never been
//!   built should not hard-fail.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// Exit code the CLI must return when every requested file exported.
const EXIT_OK: i32 = 0;
/// Exit code the CLI must return when at least one file failed.
const EXIT_FAIL: i32 = 1;

/// Lower bounds that separate "a real document" from a blank or truncated one.
/// `demo.md` is ~14 KB of Markdown with tables, KaTeX and five Mermaid
/// diagrams, so both outputs are far larger than these in practice; the
/// numbers only have to exclude an empty or stub file.
const MIN_HTML_BYTES: usize = 10_000;
const MIN_PDF_BYTES: usize = 20_000;

/// How long one export run may take before it is killed and failed.
///
/// Comfortably above the app's own budget — `EXPORT_TIMEOUT` (20 s) plus
/// `PDF_PRINT_TIMEOUT` (30 s) in `src/export.rs`, plus WebView startup — so a
/// slow CI runner is never failed for being slow; this only catches a process
/// that is not going to exit at all.
const RUN_TIMEOUT: Duration = Duration::from_secs(120);

/// Number of Mermaid blocks in `docs/demo/demo.md`. Asserting the exact count
/// reached the output turns a silently half-rendered export into a failure.
const DEMO_MERMAID_BLOCKS: usize = 5;

//**************************************************************
// repo_root
//**************************************************************
/// Repository root, whether invoked from the repo root or from `src-tauri`.
fn repo_root() -> PathBuf {
    let cwd = std::env::current_dir().expect("cannot get cwd");
    if cwd.ends_with("src-tauri") {
        cwd.parent().expect("src-tauri has no parent").to_path_buf()
    } else {
        cwd
    }
}
// repo_root END ************************************************

//**************************************************************
// binary_name
//**************************************************************
/// Platform-correct file name of the Lattice executable.
fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") { "lattice.exe" } else { "lattice" }
}
// binary_name END **********************************************

//**************************************************************
// locate_binary
//**************************************************************
/// The Lattice binary to exercise, or `None` when this tree has none built.
///
/// Release first: in CI the bundle build (step 350) runs before the tests, so
/// `target/release/` holds exactly the binary users will get — the one whose
/// export output is worth publishing. The debug fallback is for a local run
/// where only the E2E build exists.
///
/// On macOS the *bundled* binary is preferred over both. macOS 14+ refuses to
/// start WKWebView's `com.apple.WebKit.WebContent` XPC service for a host
/// without a `.app` bundle carrying a `CFBundleIdentifier`, so a bare
/// `target/release/lattice` renders nothing and every export times out. This
/// is the same constraint `build-test.sh` works around for the E2E harness by
/// synthesising a bundle; here the real bundle already exists next to it.
fn locate_binary(root: &Path) -> Option<PathBuf> {
    // An empty value is "not set": a GitHub Actions expression that selects a
    // path only for some matrix legs yields "" on the others, and treating
    // that as a real path would print a warning on every one of them.
    match std::env::var("LATTICE_EXPORT_BIN") {
        Ok(explicit) if !explicit.is_empty() => {
            let p = PathBuf::from(&explicit);
            if p.exists() {
                return Some(p);
            }
            eprintln!("[WARN] LATTICE_EXPORT_BIN={explicit} does not exist; falling back");
        }
        _ => {}
    }

    let target = root.join("src-tauri").join("target");

    if cfg!(target_os = "macos") {
        // Any .app under the bundle dir — matching on the extension rather
        // than on "lattice.app" so a productName change cannot silently
        // downgrade this to the bare-binary path that cannot render.
        let bundles = target.join("release").join("bundle").join("macos");
        if let Ok(entries) = fs::read_dir(&bundles) {
            for entry in entries.flatten() {
                let app = entry.path();
                if app.extension().is_some_and(|e| e == "app") {
                    let inner = app.join("Contents").join("MacOS").join("lattice");
                    if inner.exists() {
                        return Some(inner);
                    }
                }
            }
        }
    }

    [target.join("release"), target.join("debug")]
        .into_iter()
        .map(|d| d.join(binary_name()))
        .find(|p| p.exists())
}
// locate_binary END ********************************************

//**************************************************************
// default_label
//**************************************************************
/// Fallback platform label when `--label` is not given.
fn default_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}
// default_label END ********************************************

//**************************************************************
// Args
//**************************************************************
/// Parsed command line of this example.
struct Args {
    /// Where to copy the produced files for publishing, if anywhere.
    out_dir: Option<PathBuf>,
    /// Platform label embedded in the copied file names.
    label: String,
}

impl Args {
    /// Parses `--out <dir>` and `--label <name>`; unknown flags are rejected
    /// rather than ignored, so a typo in a CI step cannot silently disable
    /// the publishing half of this run.
    fn parse() -> Result<Args, String> {
        let mut out_dir = None;
        let mut label = default_label().to_string();
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--out" => {
                    let v = it.next().ok_or("--out needs a directory")?;
                    out_dir = Some(PathBuf::from(v));
                }
                "--label" => {
                    label = it.next().ok_or("--label needs a name")?;
                }
                other => return Err(format!("unknown argument '{other}'")),
            }
        }
        Ok(Args { out_dir, label })
    }
}
// Args END *****************************************************

//**************************************************************
// run_export
//**************************************************************
/// Runs `<bin> <flag> <file>` and returns its exit code, killing it if it
/// outlives [`RUN_TIMEOUT`].
///
/// `current_dir` is the scratch directory, so a relative output path (and any
/// stray file the app might drop) lands there and never in the working tree.
///
/// The timeout is not defensive decoration. An export run is only headless
/// because the binary *recognises the flag*: hand an older or wrongly-built
/// binary a flag it does not know and the argument is taken for a file path,
/// which opens an ordinary editor window and waits for a human forever.
/// Observed exactly that on 2026-09-26 against a pre-`--export-pdf` binary —
/// without this, that hangs the whole test suite and, in CI, burns the job's
/// wall clock instead of reporting a failure.
fn run_export(bin: &Path, scratch: &Path, flag: &str, file: &Path) -> Result<i32, String> {
    println!("  $ {} {} {}", bin.display(), flag, file.display());
    let mut child = Command::new(bin)
        .arg(flag)
        .arg(file)
        .current_dir(scratch)
        .spawn()
        .map_err(|e| format!("cannot launch {}: {e}", bin.display()))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            // `code()` is None when a signal killed it (never on Windows);
            // -1 reports that as a number rather than panicking on unwrap.
            Ok(Some(status)) => return Ok(status.code().unwrap_or(-1)),
            Ok(None) => {}
            Err(e) => return Err(format!("cannot wait for {}: {e}", bin.display())),
        }
        if start.elapsed() >= RUN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "did not exit within {}s — the binary is most likely ignoring '{flag}' and \
                 waiting as an interactive window",
                RUN_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}
// run_export END ***********************************************

//**************************************************************
// check_html
//**************************************************************
/// Asserts the exported HTML is the *rendered* demo document.
///
/// Every check below distinguishes a correct export from a specific way it
/// has actually been seen to go wrong, rather than merely proving the file is
/// non-empty:
///
/// * the heading text — proves the document that rendered is `demo.md`;
/// * `data-source-line` — proves the preview DOM was serialised, not the raw
///   Markdown source (the `data-view-mode` trap documented in `App.tsx`).
///   Only the preview renderer emits that attribute. Note what this check may
///   NOT be: "contains no ``` fence" looks equivalent and is wrong — demo.md
///   says "Lattice renders ```mermaid fenced blocks" as inline code, so the
///   fence appears in a *correct* export;
/// * `<table` and `katex` — proves the renderer ran, not just the parser;
/// * one `<img>` per Mermaid block — proves diagram rasterisation settled
///   before the export fired (REQ-LTTCE-XPT-00001).
fn check_html(path: &Path) -> Vec<String> {
    let mut problems = Vec::new();
    let html = match fs::read_to_string(path) {
        Ok(h) => h,
        Err(e) => return vec![format!("cannot read {}: {e}", path.display())],
    };

    if html.len() < MIN_HTML_BYTES {
        problems.push(format!(
            "HTML is {} bytes, expected at least {MIN_HTML_BYTES}",
            html.len()
        ));
    }
    if !html.contains("Feature Showcase") {
        problems.push("HTML does not contain the demo document's H1 text".into());
    }
    if !html.contains("data-source-line") {
        problems.push(
            "HTML carries no data-source-line attribute — raw source was exported instead of \
             the rendered preview"
                .into(),
        );
    }
    if !html.contains("<table") {
        problems.push("HTML contains no <table> — the demo's tables did not render".into());
    }
    if !html.contains("katex") {
        problems.push("HTML contains no KaTeX markup — the demo's math did not render".into());
    }

    let diagrams = html.matches("data:image/png").count();
    if diagrams < DEMO_MERMAID_BLOCKS {
        problems.push(format!(
            "HTML carries {diagrams} rasterised diagram(s), expected {DEMO_MERMAID_BLOCKS} — \
             the export fired before Mermaid settled"
        ));
    }

    problems
}
// check_html END ***********************************************

//**************************************************************
// check_pdf
//**************************************************************
/// Asserts the exported file really is a PDF and not a stub.
///
/// The magic number is checked on the raw bytes because a PDF is not UTF-8;
/// reading it as a string would fail before the check could run.
fn check_pdf(path: &Path) -> Vec<String> {
    let mut problems = Vec::new();
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => return vec![format!("cannot read {}: {e}", path.display())],
    };

    if !bytes.starts_with(b"%PDF-") {
        problems.push(format!(
            "{} does not start with the %PDF- magic number",
            path.display()
        ));
    }
    if bytes.len() < MIN_PDF_BYTES {
        problems.push(format!(
            "PDF is {} bytes, expected at least {MIN_PDF_BYTES}",
            bytes.len()
        ));
    }

    problems
}
// check_pdf END ************************************************

//**************************************************************
// report
//**************************************************************
/// Prints one scenario's verdict and folds it into the running result.
fn report(name: &str, problems: Vec<String>, all_pass: &mut bool) -> bool {
    if problems.is_empty() {
        println!("  → PASS  {name}");
        true
    } else {
        for p in &problems {
            println!("  → FAIL  {name}: {p}");
        }
        *all_pass = false;
        false
    }
}
// report END ***************************************************

//**************************************************************
// scenario_export
//**************************************************************
/// One format's round trip: run the CLI, assert the exit code, assert the
/// file beside the input. Returns the output path on success.
fn scenario_export(
    bin: &Path,
    scratch: &Path,
    source: &Path,
    flag: &str,
    ext: &str,
    check: fn(&Path) -> Vec<String>,
    all_pass: &mut bool,
) -> Option<PathBuf> {
    let name = flag.trim_start_matches("--");
    println!("\n[SCENARIO] {name}");

    let out = source.with_extension(ext);
    let _ = fs::remove_file(&out); // stale output from a previous run

    let code = match run_export(bin, scratch, flag, source) {
        Ok(c) => c,
        Err(e) => {
            report(name, vec![e], all_pass);
            return None;
        }
    };

    let mut problems = Vec::new();
    if code != EXIT_OK {
        problems.push(format!("exit code {code}, expected {EXIT_OK}"));
    }
    if !out.exists() {
        problems.push(format!("{} was not created", out.display()));
    } else {
        problems.extend(check(&out));
    }

    if report(name, problems, all_pass) { Some(out) } else { None }
}
// scenario_export END ******************************************

//**************************************************************
// scenario_missing_file
//**************************************************************
/// A path the process cannot read must fail loudly.
///
/// This is the defect `ensure_readable` was added for: the interactive launch
/// path tolerates an unreadable file, and an export that inherited that
/// tolerance produced a blank document and exited `0`. Unit tests cover
/// `ensure_readable` itself; only running the binary proves the refusal
/// actually reaches the exit code.
fn scenario_missing_file(bin: &Path, scratch: &Path, all_pass: &mut bool) {
    println!("\n[SCENARIO] missing-input");
    let missing = scratch.join("no-such-document.md");
    let _ = fs::remove_file(&missing);
    let would_be = missing.with_extension("html");

    let mut problems = Vec::new();
    match run_export(bin, scratch, "--export-html", &missing) {
        Ok(code) if code == EXIT_FAIL => {}
        Ok(code) => problems.push(format!("exit code {code}, expected {EXIT_FAIL}")),
        Err(e) => problems.push(e),
    }
    if would_be.exists() {
        problems.push("an output file was written for an unreadable input".into());
        let _ = fs::remove_file(&would_be);
    }

    report("missing-input", problems, all_pass);
}
// scenario_missing_file END ************************************

//**************************************************************
// publish
//**************************************************************
/// Copies the produced files into `out_dir` under platform-labelled names, so
/// several matrix legs can publish side by side without colliding.
fn publish(out_dir: &Path, label: &str, produced: &[(PathBuf, &str)]) -> Result<(), String> {
    fs::create_dir_all(out_dir).map_err(|e| format!("cannot create {}: {e}", out_dir.display()))?;
    for (src, ext) in produced {
        let dest = out_dir.join(format!("demo-{label}.{ext}"));
        fs::copy(src, &dest)
            .map_err(|e| format!("cannot copy {} -> {}: {e}", src.display(), dest.display()))?;
        println!("  published {}", dest.display());
    }
    Ok(())
}
// publish END **************************************************

//**************************************************************
// main
//**************************************************************
fn main() {
    println!("══════════════════════════════════════════════════════");
    println!("  Lattice CLI Export Check (docs/demo/demo.md)");
    println!("══════════════════════════════════════════════════════");

    let args = match Args::parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[ERROR] {e}");
            eprintln!("usage: cargo run --example export_demo -- [--out <dir>] [--label <name>]");
            std::process::exit(2);
        }
    };

    let root = repo_root();
    let demo = root.join("docs").join("demo").join("demo.md");
    if !demo.exists() {
        eprintln!("[ERROR] demo document not found: {}", demo.display());
        std::process::exit(1);
    }

    // A missing binary is a skip locally and a failure in CI — a tree that
    // has never been built must not fail the suite, but a CI leg that
    // silently exported nothing must not report success either.
    let required = std::env::var("LATTICE_EXPORT_REQUIRED").as_deref() == Ok("1");
    let bin = match locate_binary(&root) {
        Some(b) => b,
        None => {
            let msg = format!(
                "no lattice binary found at src-tauri/target/{{release,debug}}/{}",
                binary_name()
            );
            if required {
                eprintln!("[ERROR] {msg} (LATTICE_EXPORT_REQUIRED=1)");
                std::process::exit(1);
            }
            println!("[SKIP] {msg}");
            println!("       Build one first, or set LATTICE_EXPORT_BIN.");
            std::process::exit(0);
        }
    };

    println!("[INFO] Repo root : {}", root.display());
    println!("[INFO] Binary    : {}", bin.display());
    println!("[INFO] Label     : {}", args.label);

    // Export writes its output beside the input, so the demo is copied into a
    // scratch directory first: the working tree stays clean and a stale
    // artefact from an earlier run cannot be mistaken for this run's output.
    let scratch = root.join("src-tauri").join("target").join("export-demo");
    let _ = fs::remove_dir_all(&scratch);
    if let Err(e) = fs::create_dir_all(&scratch) {
        eprintln!("[ERROR] cannot create {}: {e}", scratch.display());
        std::process::exit(1);
    }
    let source = scratch.join("demo.md");
    if let Err(e) = fs::copy(&demo, &source) {
        eprintln!("[ERROR] cannot copy demo.md into {}: {e}", scratch.display());
        std::process::exit(1);
    }
    // demo.md references images from demo_assets/; copy them so the preview
    // renders the same document the release page shows.
    let assets_src = demo.with_file_name("demo_assets");
    if assets_src.is_dir() {
        let assets_dest = scratch.join("demo_assets");
        let _ = fs::create_dir_all(&assets_dest);
        if let Ok(entries) = fs::read_dir(&assets_src) {
            for entry in entries.flatten().filter(|e| e.path().is_file()) {
                let _ = fs::copy(entry.path(), assets_dest.join(entry.file_name()));
            }
        }
    }

    let mut all_pass = true;
    let mut produced: Vec<(PathBuf, &str)> = Vec::new();

    if let Some(p) = scenario_export(
        &bin, &scratch, &source, "--export-html", "html", check_html, &mut all_pass,
    ) {
        produced.push((p, "html"));
    }
    if let Some(p) = scenario_export(
        &bin, &scratch, &source, "--export-pdf", "pdf", check_pdf, &mut all_pass,
    ) {
        produced.push((p, "pdf"));
    }
    scenario_missing_file(&bin, &scratch, &mut all_pass);

    // Publish only a complete, passing pair: a release page must never carry
    // a document that this very run just judged wrong.
    if let Some(out_dir) = &args.out_dir {
        println!("\n[PUBLISH] {}", out_dir.display());
        if !all_pass {
            println!("  skipped — the export checks did not pass");
        } else if let Err(e) = publish(out_dir, &args.label, &produced) {
            println!("  → FAIL  publish: {e}");
            all_pass = false;
        }
    }

    println!("\n══════════════════════════════════════════════════════");
    if all_pass {
        println!("[TEST RESULT] PASSED (CLI export)");
        std::process::exit(0);
    }
    println!("[TEST RESULT] FAILED (CLI export)");
    std::process::exit(1);
}
// main END *****************************************************
