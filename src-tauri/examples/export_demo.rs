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

use lattice_lib::paper::PaperSize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// Exit code the CLI must return when every requested file exported.
const EXIT_OK: i32 = 0;
/// Exit code the CLI must return when at least one file failed.
const EXIT_FAIL: i32 = 1;

/// Lower bounds that separate "a real document" from a blank or truncated one.
/// `demo.md` is ~14 KB of Markdown with tables, KaTeX and four Mermaid
/// diagrams, so both outputs are far larger than these in practice; the
/// numbers only have to exclude an empty or stub file.
const MIN_HTML_BYTES: usize = 10_000;
const MIN_PDF_BYTES: usize = 20_000;

/// How far a PDF page may deviate from the requested paper, in points.
/// Hosts round differently — WebView2 writes A4 as 594.96 × 841.92 pt against
/// the nominal 595.28 × 841.89 — so an exact match would fail a correct page,
/// while a wrong paper is off by 17 pt (A4 vs Letter) or more.
const PAGE_SIZE_TOLERANCE_PT: f64 = 1.5;

/// How long one export run may take before it is killed and failed.
///
/// Must stay comfortably above the app's own budget, or this harness kills a
/// run the app would have completed and reports it as a hang. That budget is
/// `FIRST_RENDER_TIMEOUT` (90 s) plus `PDF_PRINT_TIMEOUT` (30 s) in
/// `src/export.rs`, plus process and WebView startup: 120 s were *below* the
/// worst legitimate case once the render budget grew, so this is 300 s. A slow
/// CI runner must never be failed for being slow; this only catches a process
/// that is not going to exit at all.
const RUN_TIMEOUT: Duration = Duration::from_secs(300);

/// The `alt` text `substituteDiagrams` (`src/lib/preview-copy.ts`,
/// `DIAGRAM_ALT`) gives every rasterised diagram. It is what tells a diagram's
/// `<img>` apart from an ordinary embedded picture: both are
/// `data:image/png` URIs, and counting those instead is how this check once
/// accepted an export with a diagram missing (`demo.md` has 4 diagrams *and*
/// 2 pictures, and the old threshold was "at least 5 PNGs"). Mirrors a TS
/// constant this harness cannot import; if one changes, change both.
const DIAGRAM_IMG_ALT: &str = "alt=\"Mermaid diagram\"";

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

/// Architectures a Rust target triple can start with — see [`is_target_triple`].
const TARGET_ARCHS: [&str; 12] = [
    "aarch64",
    "arm",
    "armv7",
    "i586",
    "i686",
    "loongarch64",
    "powerpc64",
    "riscv64gc",
    "s390x",
    "thumbv7neon",
    "universal",
    "x86_64",
];

//**************************************************************
// is_target_triple
//**************************************************************
/// Whether a directory name under `target/` is a Rust target triple.
///
/// **Not** merely "a directory with a `release/` or `debug/` inside": cargo and
/// its subcommands keep their own build trees next to the triples, and
/// `cargo-llvm-cov` uses `target/llvm-cov-target/`, which has exactly that
/// shape. Treating it as a build root made the android CI leg pick up the
/// coverage-**instrumented debug** binary and time out twice (2026-09-26) on a
/// leg whose `export_mode` is `skip` — a build that cannot meet the app's
/// render budget under any circumstances, so the failure was manufactured.
///
/// Matching the first component against known architectures rejects that while
/// still needing no change for a new triple.
fn is_target_triple(name: &str) -> bool {
    name.split('-')
        .next()
        .is_some_and(|arch| TARGET_ARCHS.contains(&arch))
}
// is_target_triple END *****************************************


//**************************************************************
// build_dirs
//**************************************************************
/// Every directory that may hold a build of this tree, outermost first.
///
/// `src-tauri/target` for a native build, plus `src-tauri/target/<triple>` for
/// a cross build: `--target aarch64-apple-darwin` moves the whole `release/`
/// subtree one level down, which is why the macOS legs find nothing where a
/// native build leaves it. Triples are discovered rather than listed, so a new
/// one needs no change here — and they are taken in sorted order, so a tree
/// holding two cross-builds always picks the same one.
fn build_dirs(root: &Path) -> Vec<PathBuf> {
    let target = root.join("src-tauri").join("target");
    let mut dirs = vec![target.clone()];
    for dir in sorted_paths(&target) {
        let is_triple = dir
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(is_target_triple);
        if is_triple && (dir.join("release").is_dir() || dir.join("debug").is_dir()) {
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
// stage_demo
//**************************************************************
/// Copies `demo.md` and its assets into `dir`, returning the staged source.
///
/// Export writes its output beside the input, so the demo is staged in a
/// scratch directory rather than exported in place: the working tree stays
/// clean, and a stale artefact from an earlier run cannot be mistaken for this
/// run's output — `dir` is recreated empty every time.
fn stage_demo(demo: &Path, dir: &Path) -> Result<PathBuf, String> {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;

    let source = dir.join("demo.md");
    fs::copy(demo, &source)
        .map_err(|e| format!("cannot copy demo.md into {}: {e}", dir.display()))?;

    // demo.md references images from demo_assets/; copy them so the preview
    // renders the same document the release page shows.
    let assets_src = demo.with_file_name("demo_assets");
    if assets_src.is_dir() {
        let assets_dest = dir.join("demo_assets");
        let _ = fs::create_dir_all(&assets_dest);
        for asset in sorted_paths(&assets_src).into_iter().filter(|p| p.is_file()) {
            if let Some(name) = asset.file_name() {
                let _ = fs::copy(&asset, assets_dest.join(name));
            }
        }
    }
    Ok(source)
}
// stage_demo END ***********************************************


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
/// 3. **The bare release binary.** On macOS this is a last resort expected to
///    fail: macOS 14+ refuses to start WKWebView's
///    `com.apple.WebKit.WebContent` XPC service for a host without a `.app`
///    carrying a `CFBundleIdentifier`, so it renders nothing and the export
///    times out — a loud failure, which is better than "no binary found".
///
/// **`target/debug/` is deliberately NOT searched.** A debug build boots the
/// frontend but is far too slow for the app's own 20 s `EXPORT_TIMEOUT`, and a
/// coverage-instrumented one is slower still, so testing either manufactures a
/// failure that says nothing about the export path. A clear skip ("build a
/// release first") is worth more than a red leg with a misleading cause. A leg
/// that genuinely requires an export sets `LATTICE_EXPORT_REQUIRED=1` and still
/// fails loudly when no release build exists, so nothing is silently skipped.
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
        .map(|d| d.join("release").join(binary_name()))
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
/// Runs `<bin> <args...> <file>` and returns its exit code, killing it if it
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
fn run_export(bin: &Path, scratch: &Path, args: &[&str], file: &Path) -> Result<i32, String> {
    println!("  $ {} {} {}", bin.display(), args.join(" "), file.display());
    let flag = args.first().copied().unwrap_or_default();
    let mut child = Command::new(bin)
        .args(args)
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

    // The expected count comes from the staged source beside the output
    // (`<dir>/demo.md` → `<dir>/demo.html`), not from a constant that has to be
    // kept in step with the document by hand — it was, once, and was wrong.
    let source = path.with_extension("md");
    match fs::read_to_string(&source) {
        Ok(md) => problems.extend(check_diagrams(&html, count_mermaid_fences(&md))),
        Err(e) => problems.push(format!("cannot read staged source {}: {e}", source.display())),
    }

    problems
}
// check_html END ***********************************************


//**************************************************************
// count_mermaid_fences
//**************************************************************
/// Number of ```` ```mermaid ```` fences opening a line in `markdown` — the
/// diagrams the preview will render. An inline mention inside a sentence, as
/// demo.md's prose has, does not start a line and is not counted.
fn count_mermaid_fences(markdown: &str) -> usize {
    markdown
        .lines()
        .filter(|l| l.trim_start().starts_with("```mermaid"))
        .count()
}
// count_mermaid_fences END *************************************


//**************************************************************
// check_diagrams
//**************************************************************
/// REQ-LTTCE-XPT-00001 / 00009 — every diagram in the source reached the HTML
/// as a rasterised `<img>`, and none was left behind as a live `.mermaid`
/// container (the shape of an export that fired before the diagram settled).
/// Pure, so the counting rule is unit-tested without an app binary.
fn check_diagrams(html: &str, expected: usize) -> Vec<String> {
    let mut problems = Vec::new();
    if expected == 0 {
        problems.push("staged demo.md has no ```mermaid block — the check would prove nothing".into());
        return problems;
    }
    let diagrams = html.matches(DIAGRAM_IMG_ALT).count();
    if diagrams != expected {
        problems.push(format!(
            "HTML carries {diagrams} rasterised diagram(s), expected {expected} — \
             the export fired before Mermaid settled"
        ));
    }
    let unsettled = html.matches("class=\"mermaid\"").count();
    if unsettled > 0 {
        problems.push(format!(
            "HTML still contains {unsettled} un-rasterised .mermaid container(s)"
        ));
    }
    problems
}
// check_diagrams END *******************************************

//**************************************************************
// check_pdf
//**************************************************************
/// Asserts the exported file really is a PDF, not a stub, laid out on `paper`.
///
/// The magic number is checked on the raw bytes because a PDF is not UTF-8;
/// reading it as a string would fail before the check could run.
fn check_pdf(path: &Path, paper: PaperSize) -> Vec<String> {
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
    problems.extend(check_page_size(&bytes, paper));

    problems
}
// check_pdf END ************************************************


//**************************************************************
// pdf_page_size
//**************************************************************
/// Width and height, in points, of the first `/MediaBox [x0 y0 x1 y1]` in a
/// PDF, or `None` if there is none in plain text.
///
/// Scanned on the raw bytes: page objects keep their `/MediaBox` outside the
/// compressed content streams in the output of all three hosts (checked on the
/// v0.3.28 release PDFs), so no PDF library is needed. Pure and unit-tested.
fn pdf_page_size(bytes: &[u8]) -> Option<(f64, f64)> {
    const KEY: &[u8] = b"/MediaBox";
    let after = bytes.windows(KEY.len()).position(|w| w == KEY)? + KEY.len();
    let rest = &bytes[after..];
    // The array follows the key directly, give or take whitespace; a '[' found
    // further away belongs to something else.
    let open = rest.iter().take(8).position(|&b| b == b'[')?;
    let close = open + rest[open..].iter().position(|&b| b == b']')?;
    let numbers: Vec<f64> = std::str::from_utf8(&rest[open + 1..close])
        .ok()?
        .split_whitespace()
        .map(|t| t.parse().ok())
        .collect::<Option<_>>()?;
    let [x0, y0, x1, y1] = numbers[..] else {
        return None;
    };
    Some(((x1 - x0).abs(), (y1 - y0).abs()))
}
// pdf_page_size END ********************************************


//**************************************************************
// check_page_size
//**************************************************************
/// REQ-LTTCE-XPT-00011 / 00012 — the page is `paper`, portrait, within
/// [`PAGE_SIZE_TOLERANCE_PT`]. Catches both defects this was added for: a
/// window-sized snapshot instead of a page (macOS, 800 × 568 pt) and a host
/// default paper instead of the requested one (Windows, US Letter).
fn check_page_size(bytes: &[u8], paper: PaperSize) -> Vec<String> {
    let (want_w, want_h) = paper.size_points();
    match pdf_page_size(bytes) {
        None => vec!["no /MediaBox found — the page size cannot be checked".into()],
        Some((w, h))
            if (w - want_w).abs() <= PAGE_SIZE_TOLERANCE_PT
                && (h - want_h).abs() <= PAGE_SIZE_TOLERANCE_PT =>
        {
            Vec::new()
        }
        Some((w, h)) => vec![format!(
            "page is {w:.0} x {h:.0} pt, expected {} portrait, {want_w:.0} x {want_h:.0} pt",
            paper.name()
        )],
    }
}
// check_page_size END ******************************************

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
/// One export round trip: run the CLI with `args`, assert the exit code,
/// assert the file beside the input. Returns the output path on success.
#[allow(clippy::too_many_arguments)] // one call site per scenario; a struct would only rename them
fn scenario_export(
    bin: &Path,
    scratch: &Path,
    source: &Path,
    name: &str,
    args: &[&str],
    ext: &str,
    check: &dyn Fn(&Path) -> Vec<String>,
    all_pass: &mut bool,
) -> Option<PathBuf> {
    println!("\n[SCENARIO] {name}");

    let out = source.with_extension(ext);
    let _ = fs::remove_file(&out); // stale output from a previous run

    let code = match run_export(bin, scratch, args, source) {
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
    match run_export(bin, scratch, &["--export-html"], &missing) {
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
// scenario_bad_paper
//**************************************************************
/// REQ-LTTCE-XPT-00011 — an unknown `--paper` value fails the run up front:
/// exit code 1 and no file, rather than a silent fallback to the default
/// paper. The parser is unit-tested; only the binary proves the refusal
/// reaches the exit code before any window or file exists.
fn scenario_bad_paper(bin: &Path, scratch: &Path, source: &Path, all_pass: &mut bool) {
    const NAME: &str = "export-pdf --paper a5 (unknown)";
    println!("\n[SCENARIO] {NAME}");
    let out = source.with_extension("pdf");
    let _ = fs::remove_file(&out);

    let mut problems = Vec::new();
    match run_export(bin, scratch, &["--export-pdf", "--paper", "a5"], source) {
        Ok(code) if code == EXIT_FAIL => {}
        Ok(code) => problems.push(format!("exit code {code}, expected {EXIT_FAIL}")),
        Err(e) => problems.push(e),
    }
    if out.exists() {
        problems.push("a PDF was written despite the unknown paper size".into());
        let _ = fs::remove_file(&out);
    }

    report(NAME, problems, all_pass);
}
// scenario_bad_paper END ***************************************

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
                "no RELEASE lattice binary found under src-tauri/target/[<triple>/]release/{}{}",
                binary_name(),
                if cfg!(target_os = "macos") { " and no .dmg to mount" } else { "" }
            );
            if required {
                eprintln!("[ERROR] {msg} (LATTICE_EXPORT_REQUIRED=1)");
                return 1;
            }
            println!("[SKIP] {msg}");
            println!("       A debug build is not usable here — it cannot render inside the");
            println!("       app's own export timeout. Run `npm run tauri build`, or set");
            println!("       LATTICE_EXPORT_BIN to a release binary.");
            return 0;
        }
    };

    println!("[INFO] Repo root : {}", root.display());
    println!("[INFO] Binary    : {}", bin.display());
    println!("[INFO] Label     : {}", args.label);

    let scratch = root.join("src-tauri").join("target").join("export-demo");
    let source = match stage_demo(&demo, &scratch) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[ERROR] {e}");
            return 1;
        }
    };

    // No warm-up run here, deliberately. A warm-up would hide the cold start
    // from the graded scenarios — and the cold start is precisely what a user
    // does: install, then export. REQ-LTTCE-XPT-00008 makes the app tolerate it,
    // so the first scenario below is left to prove that on the real artefact.

    let mut all_pass = true;
    let mut produced: Vec<(PathBuf, &str)> = Vec::new();

    if let Some(p) = scenario_export(
        &bin, &scratch, &source, "export-html", &["--export-html"], "html", &check_html,
        &mut all_pass,
    ) {
        produced.push((p, "html"));
    }
    // Default paper, no --paper given: this is the PDF the release page shows.
    if let Some(p) = scenario_export(
        &bin, &scratch, &source, "export-pdf (default paper)", &["--export-pdf"], "pdf",
        &|p| check_pdf(p, PaperSize::default()), &mut all_pass,
    ) {
        produced.push((p, "pdf"));
    }
    // A non-default paper, end to end on every leg (REQ-LTTCE-XPT-00011). A
    // separate staged copy, so it cannot overwrite the default PDF above.
    let a3_source = scratch.join("demo-a3.md");
    match fs::copy(&source, &a3_source) {
        Ok(_) => {
            scenario_export(
                &bin, &scratch, &a3_source, "export-pdf --paper a3", &["--export-pdf", "--paper", "a3"],
                "pdf", &|p| check_pdf(p, PaperSize::A3), &mut all_pass,
            );
        }
        Err(e) => {
            report(
                "export-pdf --paper a3",
                vec![format!("cannot stage {}: {e}", a3_source.display())],
                &mut all_pass,
            );
        }
    }
    scenario_bad_paper(&bin, &scratch, &source, &mut all_pass);
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


//**************************************************************
// tests
//**************************************************************
/// Run with `cargo test --example export_demo`. The harness itself runs on
/// every desktop CI leg; these pin the counting rule that decides whether it
/// passes, which is the part that was once wrong.
#[cfg(test)]
mod tests {
    use super::*;

    const DIAGRAM: &str = r#"<img src="data:image/png;base64,AA" alt="Mermaid diagram" width="10">"#;
    const PICTURE: &str = r#"<img alt="Image" src="data:image/png;base64,BB">"#;

    #[test]
    fn counts_only_fences_that_open_a_line() {
        let md = "Lattice renders ` ```mermaid ``` ` inline.\n\n```mermaid\ngraph LR\n```\n\n  ```mermaid\npie\n```\n```rust\nfn x(){}\n```\n";
        assert_eq!(count_mermaid_fences(md), 2);
    }

    #[test]
    fn the_real_demo_document_has_four_diagrams() {
        let md = fs::read_to_string(repo_root().join("docs").join("demo").join("demo.md")).unwrap();
        assert_eq!(count_mermaid_fences(&md), 4);
    }

    #[test]
    fn a_complete_export_passes() {
        let html = format!("{DIAGRAM}{DIAGRAM}{PICTURE}{PICTURE}");
        assert!(check_diagrams(&html, 2).is_empty());
    }

    #[test]
    fn embedded_pictures_do_not_stand_in_for_missing_diagrams() {
        // Regression: 1 diagram + 2 pictures is 3 PNGs, which the old
        // "count every data:image/png" rule would have accepted for 2 diagrams.
        let html = format!("{DIAGRAM}{PICTURE}{PICTURE}");
        let problems = check_diagrams(&html, 2);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("1 rasterised diagram(s), expected 2"));
    }

    #[test]
    fn a_leftover_mermaid_container_is_reported() {
        let html = format!("{DIAGRAM}<div class=\"mermaid\"><svg></svg></div>");
        let problems = check_diagrams(&html, 2);
        assert!(problems.iter().any(|p| p.contains("un-rasterised")), "{problems:?}");
    }

    #[test]
    fn a_source_without_diagrams_cannot_pass_vacuously() {
        assert_eq!(check_diagrams("", 0).len(), 1);
    }

    // ── page size ───────────────────────────────────────────────────────────
    // The MediaBox strings below are the ones the real hosts wrote on
    // 2026-09-27: WebView2 A4 after the fix, WebKitGTK A4, and the macOS
    // snapshot of v0.3.28 that this check exists to reject.

    #[test]
    fn reads_the_media_box_in_the_spellings_hosts_write() {
        assert_eq!(pdf_page_size(b"<< /MediaBox [0 0 595 842] >>"), Some((595.0, 842.0)));
        assert_eq!(pdf_page_size(b"/MediaBox[0 0 612 792]"), Some((612.0, 792.0)));
        let (w, h) = pdf_page_size(b"/MediaBox [ 0 0 594.96 841.92 ]").unwrap();
        assert!((w - 594.96).abs() < 1e-9 && (h - 841.92).abs() < 1e-9);
    }

    #[test]
    fn no_or_malformed_media_box_is_none() {
        assert_eq!(pdf_page_size(b"%PDF-1.4 no page tree here"), None);
        assert_eq!(pdf_page_size(b"/MediaBox [0 0 595]"), None);
        assert_eq!(pdf_page_size(b"/MediaBox [0 0 a b]"), None);
        // A '[' far after the key belongs to something else.
        assert_eq!(pdf_page_size(b"/MediaBox /Other 1 0 R /Kids [0 0 595 842]"), None);
    }

    #[test]
    fn a_correct_page_passes_within_host_rounding() {
        assert!(check_page_size(b"/MediaBox [0 0 594.96 841.92]", PaperSize::A4).is_empty());
        assert!(check_page_size(b"/MediaBox [0 0 842 1191]", PaperSize::A3).is_empty());
        assert!(check_page_size(b"/MediaBox [0 0 612 792]", PaperSize::Letter).is_empty());
    }

    #[test]
    fn the_macos_snapshot_page_is_rejected() {
        let problems = check_page_size(b"/MediaBox [0 0 800 568]", PaperSize::A4);
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(problems[0].contains("800 x 568"), "{problems:?}");
    }

    #[test]
    fn the_wrong_paper_is_rejected() {
        // Letter where A4 was asked for: WebView2's default before the fix.
        assert_eq!(check_page_size(b"/MediaBox [0 0 612 792]", PaperSize::A4).len(), 1);
        // Landscape A4 is not A4.
        assert_eq!(check_page_size(b"/MediaBox [0 0 842 595]", PaperSize::A4).len(), 1);
    }

    #[test]
    fn a_pdf_without_a_media_box_fails_rather_than_passing_silently() {
        assert_eq!(check_page_size(b"%PDF-1.7", PaperSize::A4).len(), 1);
    }
}
// tests END ****************************************************
