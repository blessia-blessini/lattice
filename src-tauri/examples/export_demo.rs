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
// build_dirs
//**************************************************************
/// Every directory that may hold a build of this tree, outermost first.
///
/// `src-tauri/target` for a native build, plus `src-tauri/target/<triple>` for
/// a cross build: `--target aarch64-apple-darwin` moves the whole `release/`
/// subtree one level down, which is why the macOS legs find nothing where a
/// native build leaves it. Sub-directories are discovered rather than listed,
/// so a new target triple needs no change here — and they are taken in sorted
/// order, so a tree holding two cross-builds always picks the same one.
fn build_dirs(root: &Path) -> Vec<PathBuf> {
    let target = root.join("src-tauri").join("target");
    let mut dirs = vec![target.clone()];
    for dir in sorted_paths(&target) {
        if dir.join("release").is_dir() || dir.join("debug").is_dir() {
            dirs.push(dir);
        }
    }
    dirs
}
// build_dirs END ***********************************************


//**************************************************************
// MountedDmg
//**************************************************************
/// A DMG attached for the duration of the check, detached on drop.
///
/// `Drop` is the whole point: a mount that outlives the run leaves a volume
/// attached on the developer's machine, and every failure path of this check
/// must still release it. That is why `main` funnels every exit through
/// `run()` returning a code instead of calling `std::process::exit` from the
/// middle of the check — `exit` does not run destructors.
///
/// The mount point is a fresh temporary directory, never a fixed path inside
/// `target/`: a run killed before `Drop` (Ctrl-C, a CI timeout) leaves the
/// volume attached, and a fixed path would then fail every later run with
/// "Resource busy". A unique path per run cannot collide with a leftover, and
/// keeps a live mount out of the way of `cargo clean`.
///
/// Field order matters: the struct's own `Drop` runs before its fields are
/// dropped, so the volume is detached before `TempDir` removes the directory.
struct MountedDmg {
    mount_point: PathBuf,
    /// Owns the mount-point directory; removed once `Drop` has detached.
    _dir: tempfile::TempDir,
}

impl Drop for MountedDmg {
    fn drop(&mut self) {
        // `-force` because macOS indexing daemons (`mds`, `mdworker`) routinely
        // open a freshly attached volume; a polite detach loses that race and
        // fails with "Resource busy", leaving the volume attached.
        let status = Command::new("hdiutil")
            .arg("detach")
            .arg(&self.mount_point)
            .args(["-force", "-quiet"])
            .status();
        match status {
            Ok(s) if s.success() => {}
            // Never panic in a destructor, and never fail the check over
            // cleanup: the exports have already been judged by this point.
            _ => eprintln!(
                "[WARN] could not detach {} — detach it manually",
                self.mount_point.display()
            ),
        }
    }
}
// MountedDmg END ***********************************************


//**************************************************************
// attach_dmg
//**************************************************************
/// Attaches `dmg` read-only at a fresh temporary mount point.
///
/// `-mountpoint` is given explicitly so the mount point is known without
/// parsing `hdiutil`'s output, and `-nobrowse` keeps the volume out of Finder.
fn attach_dmg(dmg: &Path) -> Result<MountedDmg, String> {
    let dir = tempfile::Builder::new()
        .prefix("lattice-export-dmg-")
        .tempdir()
        .map_err(|e| format!("cannot create a mount point: {e}"))?;
    let mount_point = dir.path().to_path_buf();

    let output = Command::new("hdiutil")
        .arg("attach")
        .arg(dmg)
        .args(["-nobrowse", "-readonly", "-noverify", "-mountpoint"])
        .arg(&mount_point)
        .output()
        .map_err(|e| format!("cannot run hdiutil: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "hdiutil attach {} failed: {}",
            dmg.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(MountedDmg { mount_point, _dir: dir })
}
// attach_dmg END ***********************************************


//**************************************************************
// app_binary_in
//**************************************************************
/// The executable inside the first `.app` directly under `dir`, if any.
///
/// Matching on the `.app` extension rather than on `lattice.app` means a
/// `productName` change cannot silently downgrade this to a path that does not
/// exist. The executable inside is named after the bundle, not after the
/// crate, so it is derived from the bundle name.
///
/// Both directory scans are **sorted by name**. `read_dir` order is
/// unspecified — filesystem-dependent — so an unsorted scan would pick an
/// arbitrary bundle where several exist, and an arbitrary executable from a
/// bundle carrying more than one. Sorting makes the choice the same on every
/// run and every machine, which is what makes a failure reproducible.
fn app_binary_in(dir: &Path) -> Option<PathBuf> {
    for app in sorted_paths(dir) {
        if app.extension().is_some_and(|e| e == "app") {
            let macos = app.join("Contents").join("MacOS");
            // The bundle's own stem first (lattice.app -> MacOS/lattice), then
            // whatever single executable the bundle carries.
            if let Some(stem) = app.file_stem() {
                let named = macos.join(stem);
                if named.is_file() {
                    return Some(named);
                }
            }
            if let Some(exe) = sorted_paths(&macos).into_iter().find(|p| p.is_file()) {
                return Some(exe);
            }
        }
    }
    None
}
// app_binary_in END ********************************************


//**************************************************************
// sorted_paths
//**************************************************************
/// Entries of `dir` in a deterministic order; empty when it cannot be read.
fn sorted_paths(dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries.flatten().map(|e| e.path()).collect(),
        Err(_) => return Vec::new(),
    };
    paths.sort();
    paths
}
// sorted_paths END *********************************************


//**************************************************************
// locate_binary
//**************************************************************
/// The Lattice binary to exercise, or `None` when this tree has none built.
///
/// Returns the guard for any DMG it had to attach alongside the path: the
/// caller must hold it for as long as the binary is used.
///
/// Order, closest to what a user runs first:
///
/// 1. **macOS — the DMG.** The DMG is the file a user downloads, and on macOS
///    it is also the *only* artefact that survives: Tauri's dmg bundler treats
///    `bundle/macos/lattice.app` as an intermediate and deletes it once the
///    DMG is written (`Cleaning …/lattice.app` in the build log). Testing the
///    mounted DMG therefore both fixes the missing-binary failure and moves
///    the check closer to reality — it exercises the shipped container.
/// 2. **macOS — an un-deleted `.app`.** Present when `app` is among
///    `bundle.targets`, or for a `--no-bundle`-style build.
/// 3. **The bare release binary**, then the debug one, for a local tree where
///    only those exist. On macOS this is a last resort that is expected to
///    fail: macOS 14+ refuses to start WKWebView's
///    `com.apple.WebKit.WebContent` XPC service for a host without a `.app`
///    carrying a `CFBundleIdentifier`, so it renders nothing and the export
///    times out — a loud failure, which is better than "no binary found".
fn locate_binary(root: &Path) -> Option<(PathBuf, Option<MountedDmg>)> {
    // An empty value is "not set": a GitHub Actions expression that selects a
    // path only for some matrix legs yields "" on the others, and treating
    // that as a real path would print a warning on every one of them.
    match std::env::var("LATTICE_EXPORT_BIN") {
        Ok(explicit) if !explicit.is_empty() => {
            let p = PathBuf::from(&explicit);
            if p.exists() {
                return Some((p, None));
            }
            eprintln!("[WARN] LATTICE_EXPORT_BIN={explicit} does not exist; falling back");
        }
        _ => {}
    }

    let dirs = build_dirs(root);

    if cfg!(target_os = "macos") {
        for dir in &dirs {
            let dmgs = dir.join("release").join("bundle").join("dmg");
            for dmg in sorted_paths(&dmgs) {
                if dmg.extension().is_some_and(|e| e == "dmg") {
                    match attach_dmg(&dmg) {
                        Ok(guard) => {
                            println!("[INFO] Mounted   : {}", dmg.display());
                            if let Some(bin) = app_binary_in(&guard.mount_point) {
                                return Some((bin, Some(guard)));
                            }
                            eprintln!(
                                "[WARN] no .app with an executable inside {}; falling back",
                                dmg.display()
                            );
                        }
                        Err(e) => eprintln!("[WARN] {e}; falling back"),
                    }
                }
            }
        }

        for dir in &dirs {
            if let Some(bin) = app_binary_in(&dir.join("release").join("bundle").join("macos")) {
                return Some((bin, None));
            }
        }
    }

    dirs.iter()
        .flat_map(|d| [d.join("release"), d.join("debug")])
        .map(|d| d.join(binary_name()))
        .find(|p| p.exists())
        .map(|p| (p, None))
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
// run
//**************************************************************
/// The whole check, returning the process exit code.
///
/// Every exit is a `return` rather than `std::process::exit` so that the
/// `MountedDmg` guard is dropped — and the DMG detached — on every path,
/// including the failing ones. `exit` skips destructors.
fn run() -> i32 {
    println!("══════════════════════════════════════════════════════");
    println!("  Lattice CLI Export Check (docs/demo/demo.md)");
    println!("══════════════════════════════════════════════════════");

    let args = match Args::parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[ERROR] {e}");
            eprintln!("usage: cargo run --example export_demo -- [--out <dir>] [--label <name>]");
            return 2;
        }
    };

    let root = repo_root();
    let demo = root.join("docs").join("demo").join("demo.md");
    if !demo.exists() {
        eprintln!("[ERROR] demo document not found: {}", demo.display());
        return 1;
    }

    // A missing binary is a skip locally and a failure in CI — a tree that
    // has never been built must not fail the suite, but a CI leg that
    // silently exported nothing must not report success either.
    let required = std::env::var("LATTICE_EXPORT_REQUIRED").as_deref() == Ok("1");
    // `_dmg` is named, not `_`: binding it to `_` would drop the guard here and
    // detach the volume before the binary inside it is ever run.
    let (bin, _dmg) = match locate_binary(&root) {
        Some(found) => found,
        None => {
            let msg = format!(
                "no lattice binary found under src-tauri/target/[<triple>/]{{release,debug}}/{}{}",
                binary_name(),
                if cfg!(target_os = "macos") { " and no .dmg to mount" } else { "" }
            );
            if required {
                eprintln!("[ERROR] {msg} (LATTICE_EXPORT_REQUIRED=1)");
                return 1;
            }
            println!("[SKIP] {msg}");
            println!("       Build one first, or set LATTICE_EXPORT_BIN.");
            return 0;
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
        return 1;
    }
    let source = scratch.join("demo.md");
    if let Err(e) = fs::copy(&demo, &source) {
        eprintln!("[ERROR] cannot copy demo.md into {}: {e}", scratch.display());
        return 1;
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
        return 0;
    }
    println!("[TEST RESULT] FAILED (CLI export)");
    1
}
// run END *****************************************************


//**************************************************************
// main
//**************************************************************
/// Thin wrapper: all work is in `run()` so its destructors — notably the
/// `MountedDmg` detach — run before the process exits.
fn main() {
    std::process::exit(run());
}
// main END *****************************************************
