// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! One screenshot of the running app per CI leg, so anyone can see what
//! Lattice looks like on each desktop without installing it.
//!
//! Launches the same RELEASE binary the CLI export check uses (the `.app`
//! inside the `.dmg` on macOS — see `support/release_app.rs`) on a copy of
//! `docs/demo/demo.md`, waits for its main window, lets the preview render,
//! captures the main window only, and quits the app.
//!
//! ```text
//! cargo run --example app_screenshot -- [--out <dir>] [--label <name>]
//! ```
//!
//! * `--out <dir>`     where `screenshot-<label>.png` goes; default
//!   `src-tauri/target/app-screenshot/`.
//! * `--label <name>`  platform label in the file name; defaults to the host OS.
//!
//! Environment: `LATTICE_EXPORT_BIN` — explicit release binary (shared with
//! `export_demo.rs`).
//!
//! **Never fails the build.** A screenshot is documentation, not a test: on
//! any problem it prints the reason (a `::warning::` annotation under GitHub
//! Actions) and exits 0, so a flaky display cannot turn a leg red. Only a bad
//! command line exits non-zero.
//!
//! Capturing is per OS — `support/capture_{windows,macos,linux}.rs`, one
//! contract (`capture_main_window(pid, png) -> Result<bool, String>`), chosen
//! below by target. This is test tooling, never part of the shipped binary.

use lattice_lib::e2e::WEBVIEW2_USER_DATA_ENV;
use std::fs;
use std::path::Path;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

#[path = "support/release_app.rs"]
mod release_app;
use release_app::*;

#[cfg(target_os = "windows")]
#[path = "support/capture_windows.rs"]
mod capture;
#[cfg(target_os = "macos")]
#[path = "support/capture_macos.rs"]
mod capture;
#[cfg(target_os = "linux")]
#[path = "support/capture_linux.rs"]
mod capture;

/// How long the app may take to show its main window (cold WebView start).
const WINDOW_TIMEOUT: Duration = Duration::from_secs(60);
/// How often to look for the window meanwhile.
const POLL: Duration = Duration::from_millis(500);
/// Time for the preview to finish rendering once the window is there —
/// demo.md has Mermaid diagrams, KaTeX and highlighted code.
const RENDER_SETTLE: Duration = Duration::from_secs(10);


//**************************************************************
// warn
//**************************************************************
/// Report a problem without failing the build.
fn warn(msg: &str) {
    if std::env::var("GITHUB_ACTIONS").as_deref() == Ok("true") {
        println!("::warning title=App screenshot::{msg}");
    } else {
        println!("[WARN] {msg}");
    }
}
// warn END *****************************************************


//**************************************************************
// is_blank
//**************************************************************
/// `true` when every pixel has the same colour — what a capture without the
/// needed permission, or of a window that never painted, looks like.
fn is_blank(png: &Path) -> Result<bool, String> {
    let img = image::open(png)
        .map_err(|e| format!("cannot read back {}: {e}", png.display()))?
        .to_rgba8();
    let mut pixels = img.pixels();
    let first = pixels.next().copied();
    Ok(pixels.all(|p| Some(*p) == first))
}
// is_blank END *************************************************


//**************************************************************
// wait_for_window
//**************************************************************
/// Poll until the app has a main window, proving capture works on this host.
fn wait_for_window(child: &mut Child, probe: &Path) -> Result<(), String> {
    let pid = child.id();
    let start = Instant::now();
    loop {
        if capture::capture_main_window(pid, probe)? {
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("the app exited ({status}) before showing a window"));
        }
        if start.elapsed() > WINDOW_TIMEOUT {
            return Err(format!("no main window within {} s", WINDOW_TIMEOUT.as_secs()));
        }
        thread::sleep(POLL);
    }
}
// wait_for_window END ******************************************


//**************************************************************
// screenshot
//**************************************************************
/// Launch `bin` on `document`, capture its main window to `png`, quit it.
fn screenshot(bin: &Path, document: &Path, scratch: &Path, png: &Path) -> Result<(), String> {
    println!("  $ {} {}", bin.display(), document.display());
    let mut child = Command::new(bin)
        .arg(document)
        .current_dir(scratch)
        // Its own WebView profile: opening the document must not reach the
        // developer's recent-files list (lattice_lib::e2e::WEBVIEW2_USER_DATA_ENV).
        .env(WEBVIEW2_USER_DATA_ENV, scratch.join("webview2"))
        .spawn()
        .map_err(|e| format!("cannot launch {}: {e}", bin.display()))?;

    let result = wait_for_window(&mut child, &scratch.join("probe.png")).and_then(|()| {
        println!("  window is up; letting the preview render for {} s …", RENDER_SETTLE.as_secs());
        thread::sleep(RENDER_SETTLE);
        if !capture::capture_main_window(child.id(), png)? {
            return Err("the main window disappeared before the capture".into());
        }
        if is_blank(png)? {
            return Err(format!("{} is a single flat colour", png.display()));
        }
        Ok(())
    });

    // The release binary has no remote "quit"; it holds no unsaved state here.
    let _ = child.kill();
    let _ = child.wait();
    result
}
// screenshot END ***********************************************


//**************************************************************
// run
//**************************************************************
fn run() -> i32 {
    println!("══════════════════════════════════════════════════════");
    println!("  Lattice app screenshot (docs/demo/demo.md)");
    println!("══════════════════════════════════════════════════════");

    let args = match Args::parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[ERROR] {e}");
            eprintln!("usage: cargo run --example app_screenshot -- [--out <dir>] [--label <name>]");
            return 2;
        }
    };

    let root = repo_root();
    let demo = root.join("docs").join("demo").join("demo.md");
    // `_dmg` is named, not `_`: binding to `_` would detach the volume at once.
    let Some((bin, _dmg)) = locate_binary(&root) else {
        warn("no RELEASE lattice binary found — no screenshot taken (build a release first)");
        return 0;
    };
    println!("[INFO] Binary    : {}", bin.display());
    println!("[INFO] Label     : {}", args.label);

    let scratch = root.join("src-tauri").join("target").join("app-screenshot");
    let document = match stage_demo(&demo, &scratch) {
        Ok(d) => d,
        Err(e) => {
            warn(&e);
            return 0;
        }
    };
    let out_dir = args.out_dir.unwrap_or_else(|| scratch.clone());
    if let Err(e) = fs::create_dir_all(&out_dir) {
        warn(&format!("cannot create {}: {e}", out_dir.display()));
        return 0;
    }
    let png = out_dir.join(format!("screenshot-{}.png", args.label));
    let _ = fs::remove_file(&png);

    match screenshot(&bin, &document, &scratch, &png) {
        Ok(()) => {
            let (w, h) = image::image_dimensions(&png).unwrap_or_default();
            println!("[PASS] {} ({w}×{h})", png.display());
        }
        Err(e) => {
            // A failed run must not leave a half-written or blank file behind
            // for CI to publish as if it were the app.
            let _ = fs::remove_file(&png);
            warn(&format!("no screenshot for {}: {e}", args.label));
        }
    }
    0
}
// run END ******************************************************


//**************************************************************
// main
//**************************************************************
/// Thin wrapper so `run()`'s destructors — the DMG detach — run before exit.
fn main() {
    std::process::exit(run());
}
// main END *****************************************************
