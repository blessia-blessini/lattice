// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Desktop E2E test harness (Windows / macOS / Linux).
//!
//! Requires a pre-built instrumented Lattice binary:
//! ```
//! npm run build:e2e_test                               # embed frontend assets (E2E mode)
//! RUSTFLAGS="-C instrument-coverage" \
//!   cargo build --bin lattice --features e2e_test      # --features, no env-var cfg needed
//! ```
//!
//! Then run this harness:
//! ```
//! cargo run --example e2e_harness --manifest-path src-tauri/Cargo.toml
//! ```
//!
//! Each scenario launches the binary, waits for a signal, writes
//! `e2e_shutdown.txt` to trigger a clean exit (portable WM_QUIT equivalent),
//! then asserts success.  Coverage profraw files are written by the binary on
//! exit and merged into the combined llvm-cov report by the build pipeline.
//!
//! # Scenarios
//! 1. `cli_no_args`        — app starts with no file paths → one empty window
//! 2. `cli_single_path`    — app starts with one file path → file window
//! 3. `cli_multi_path`     — app starts with two paths → two windows
//! 4. `conflict_detection` — reproduces the conflict scenario (replaces reproduce_conflict.rs)

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

fn repo_root() -> PathBuf {
    let cwd = std::env::current_dir().expect("cannot get cwd");
    if cwd.ends_with("src-tauri") {
        cwd.parent().expect("src-tauri has no parent").to_path_buf()
    } else {
        cwd
    }
}

/// Path to the instrumented Lattice binary.
///
/// `cargo llvm-cov --no-report run` redirects `CARGO_TARGET_DIR` to `target/llvm-cov/`
/// on a clean build (CI / first run), so the binary lands in `target/llvm-cov/debug/`.
/// On a warm-cache local build where nothing changed, cargo-llvm-cov skips
/// recompilation and runs the existing binary, leaving it in `target/debug/`.
/// We check `target/llvm-cov/debug/` first (CI path) and fall back to `target/debug/`
/// (local dev path).  Using whichever binary cargo-llvm-cov actually built ensures
/// profraw files share the same build-ID and map correctly in `cargo llvm-cov report`.
///
/// On macOS 14+/Sequoia, WKWebView's WebContent XPC service requires the host app to
/// have a `.app` bundle with `CFBundleIdentifier` in `Info.plist`.  A raw cargo binary
/// has no bundle context → XPC terminates immediately.  `build-test.sh` creates a
/// minimal bundle, copies the binary inside, signs it, and points `LATTICE_E2E_BIN`
/// at the binary within the bundle so this function picks it up.
fn lattice_bin(repo_root: &PathBuf) -> PathBuf {
    // build-test.sh (macOS) sets this to the binary inside a minimal .app bundle.
    if let Ok(override_bin) = std::env::var("LATTICE_E2E_BIN") {
        let p = PathBuf::from(&override_bin);
        if p.exists() {
            return p;
        }
        eprintln!(
            "[WARN] LATTICE_E2E_BIN={override_bin} does not exist; falling back to default path"
        );
    }
    let name = if cfg!(target_os = "windows") { "lattice.exe" } else { "lattice" };
    let src_tauri = repo_root.join("src-tauri");
    // Prefer the cargo-llvm-cov redirected target dir (clean / CI build).
    let llvm_cov = src_tauri.join("target").join("llvm-cov").join("debug").join(name);
    if llvm_cov.exists() {
        return llvm_cov;
    }
    // Fallback: warm-cache local build — binary stayed in the standard target dir.
    src_tauri.join("target").join("debug").join(name)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Launch the Lattice binary with optional CLI arguments.
/// Sets LLVM_PROFILE_FILE so each launch writes its own profraw.
fn launch(bin: &PathBuf, root: &PathBuf, args: &[&str], profile_name: &str) -> Child {
    let profraw = root
        .join("src-tauri")
        .join("target")
        .join("llvm-cov")
        .join(format!("{}.profraw", profile_name));

    Command::new(bin)
        .args(args)
        .current_dir(root)
        .env("LLVM_PROFILE_FILE", &profraw)
        .spawn()
        .unwrap_or_else(|e| panic!("Failed to launch lattice binary: {e}"))
}

/// Write the shutdown signal file.  The app polls for this every 500 ms and
/// calls `app_handle.exit(0)` — the portable WM_QUIT equivalent.
fn signal_shutdown(root: &PathBuf) {
    fs::write(root.join("e2e_shutdown.txt"), "shutdown")
        .expect("cannot write e2e_shutdown.txt");
}

/// Wait up to `timeout` for `signal_file` to appear.
/// Aborts early if the child process exits (user closed the window, crash, etc.).
/// Returns `(found, child)` — child is returned so the caller can still shut it down.
fn wait_for_signal(
    signal_file: &PathBuf,
    mut child: Child,
    timeout: Duration,
) -> (bool, Child) {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if signal_file.exists() { return (true, child); }
        // If the child already exited there is nothing left to wait for.
        match child.try_wait() {
            Ok(Some(_)) => {
                println!("\n  [child exited before signal]");
                return (false, child);
            }
            _ => {}
        }
        thread::sleep(Duration::from_millis(500));
        print!(".");
        use std::io::Write;
        std::io::stdout().flush().ok();
    }
    (false, child)
}

/// Ask the app to exit cleanly, then wait; kill as a last resort.
/// Always cleans up `e2e_shutdown.txt` — the app deletes it on a clean exit,
/// but if we fall through to kill() the file may still be on disk.
fn shutdown(mut child: Child, root: &PathBuf) {
    signal_shutdown(root);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(200));
            }
            _ => { let _ = child.kill(); break; }
        }
    }
    // Safety net: remove signal file if the app was killed before it could.
    let _ = fs::remove_file(root.join("e2e_shutdown.txt"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────────

/// Wait up to `timeout` for the frontend startup signal (`e2e_startup_ok.txt`).
/// Returns `(started, child)`.  Removes the signal file on success so it does
/// not bleed into the next scenario.
fn wait_for_startup(root: &PathBuf, child: Child, timeout: Duration) -> (bool, Child) {
    let startup = root.join("e2e_startup_ok.txt");
    let (ok, child) = wait_for_signal(&startup, child, timeout);
    if ok { let _ = fs::remove_file(&startup); }
    (ok, child)
}

/// Prime the WebView runtime before the timed scenarios begin.
///
/// On a *fresh* CI runner the very first WebView2 launch is slow: WebView2 has
/// to create its per-user data folder and perform first-run initialisation,
/// which can exceed the 15 s per-scenario startup budget. This was observed on
/// GitHub Actions `windows-latest`, where `cli_no_args` (the first scenario)
/// failed with "frontend did not signal startup within 15 s" while every later
/// scenario passed — they reused the now-warm runtime and started in < 5 s.
/// Local Windows runs always have a warm WebView2 and pass 4/4, which is why
/// this only ever reproduced in CI.
///
/// We do one throwaway launch with a generous cold-start budget so the timed
/// scenarios below all see a warm runtime and can keep their tight 15 s budget
/// (a genuinely hung scenario therefore still fails fast). A warm-up failure is
/// non-fatal: the real scenarios still run and report the true result.
fn warm_up(bin: &PathBuf, root: &PathBuf) {
    println!("\n[WARM-UP] Priming WebView runtime (first cold launch can exceed the 15 s scenario budget) …");
    let _ = fs::remove_file(root.join("e2e_startup_ok.txt")); // stale cleanup
    let child = launch(bin, root, &[], "warmup");
    let (ok, child) = wait_for_startup(root, child, Duration::from_secs(30));
    println!(
        "\n[WARM-UP] {}",
        if ok { "runtime warm — proceeding with scenarios" } else { "no startup signal (continuing anyway)" }
    );
    shutdown(child, root);
}

/// Scenario 1: no CLI args → app starts, frontend loads, no crash.
fn scenario_cli_no_args(bin: &PathBuf, root: &PathBuf) -> bool {
    println!("\n[SCENARIO] cli_no_args");
    let _ = fs::remove_file(root.join("e2e_startup_ok.txt")); // stale cleanup
    let child = launch(bin, root, &[], "cli_no_args");
    let (started, child) = wait_for_startup(root, child, Duration::from_secs(15));
    if !started {
        println!("\n → FAIL (frontend did not signal startup within 15 s)");
        shutdown(child, root);
        return false;
    }
    thread::sleep(Duration::from_secs(2)); // brief settle for coverage flush
    shutdown(child, root);
    println!(" → PASS");
    true
}

/// Scenario 2: single file path → app opens that file, frontend loads.
fn scenario_cli_single_path(bin: &PathBuf, root: &PathBuf) -> bool {
    println!("\n[SCENARIO] cli_single_path");
    let file = root.join("e2e_single.md");
    fs::write(&file, "# E2E Single Path\n").expect("cannot write test file");
    let path_str = file.to_string_lossy().into_owned();
    let _ = fs::remove_file(root.join("e2e_startup_ok.txt")); // stale cleanup
    let child = launch(bin, root, &[&path_str], "cli_single_path");
    let (started, child) = wait_for_startup(root, child, Duration::from_secs(15));
    let _ = fs::remove_file(&file);
    if !started {
        println!("\n → FAIL (frontend did not signal startup within 15 s)");
        shutdown(child, root);
        return false;
    }
    thread::sleep(Duration::from_secs(2));
    shutdown(child, root);
    println!(" → PASS");
    true
}

/// Scenario 3: multiple file paths → app opens each file, frontend loads.
fn scenario_cli_multi_path(bin: &PathBuf, root: &PathBuf) -> bool {
    println!("\n[SCENARIO] cli_multi_path");
    let file_a = root.join("e2e_multi_a.md");
    let file_b = root.join("e2e_multi_b.md");
    fs::write(&file_a, "# E2E Multi A\n").expect("cannot write test file a");
    fs::write(&file_b, "# E2E Multi B\n").expect("cannot write test file b");
    let path_a = file_a.to_string_lossy().into_owned();
    let path_b = file_b.to_string_lossy().into_owned();
    let _ = fs::remove_file(root.join("e2e_startup_ok.txt")); // stale cleanup
    let child = launch(bin, root, &[&path_a, &path_b], "cli_multi_path");
    let (started, child) = wait_for_startup(root, child, Duration::from_secs(15));
    let _ = fs::remove_file(&file_a);
    let _ = fs::remove_file(&file_b);
    if !started {
        println!("\n → FAIL (frontend did not signal startup within 15 s)");
        shutdown(child, root);
        return false;
    }
    thread::sleep(Duration::from_secs(2));
    shutdown(child, root);
    println!(" → PASS");
    true
}

/// Scenario 4: conflict (external-edit) detection.
///
/// Flow:
/// 1. Harness writes `conflict_test.md` with initial content.
/// 2. App launches with the file as CLI arg.
/// 3. Harness waits for `e2e_startup_ok.txt` (frontend loaded signal) → FAIL if absent.
/// 4. Brief settle so React + watchFile finish registering the notify watcher.
/// 5. Harness overwrites `conflict_test.md` on disk with different content.
/// 6. Rust notify watcher fires → emits `"file-changed"` Tauri event.
/// 7. `StaticRuntime.dev.ts::setupTestModeListeners` catches the event and calls
///    `invoke("write_text_file", { path: "conflict_success.txt", … })`.
///    (Active because the frontend was built with `vite.e2e_test.config.ts`.)
/// 8. Harness detects `conflict_success.txt` → PASS.
fn scenario_conflict(bin: &PathBuf, root: &PathBuf) -> bool {
    println!("\n[SCENARIO] conflict_detection");
    let test_file   = root.join("conflict_test.md");
    let success_path = root.join("conflict_success.txt");

    // Safety: clean up any leftover signals from a previous failed run.
    let _ = fs::remove_file(&success_path);
    let _ = fs::remove_file(root.join("e2e_startup_ok.txt"));

    fs::write(&test_file, "# Conflict Test\n\nInitial content.")
        .expect("cannot write conflict_test.md");

    let path_str = test_file.to_string_lossy().into_owned();
    let child = launch(bin, root, &[&path_str], "conflict");

    // Step 3: wait for frontend to load before doing anything else.
    let (started, child) = wait_for_startup(root, child, Duration::from_secs(15));
    if !started {
        println!("\n → FAIL (frontend did not signal startup within 15 s)");
        shutdown(child, root);
        let _ = fs::remove_file(&test_file);
        return false;
    }

    // Step 4: brief settle so watchFile finishes registering the notify watcher.
    println!(" settling (3 s after startup) …");
    thread::sleep(Duration::from_secs(3));

    // Step 5: external modification → triggers the notify watcher.
    println!(" writing external change to conflict_test.md …");
    fs::write(&test_file, "# Conflict Test\n\nInitial content.\n\n[EXTERNAL EDIT — conflict trigger]")
        .expect("cannot overwrite conflict_test.md");

    // Steps 6-8: wait for the frontend to write conflict_success.txt.
    let timeout = Duration::from_secs(30);
    println!(" waiting up to {}s for conflict_success.txt …", timeout.as_secs());
    let (ok, child) = wait_for_signal(&success_path, child, timeout);
    if ok {
        let content = fs::read_to_string(&success_path).unwrap_or_default();
        println!("\n  conflict_success.txt: {}", content.trim());
        let _ = fs::remove_file(&success_path);
    }

    shutdown(child, root);
    let _ = fs::remove_file(&test_file);

    if ok { println!(" → PASS"); } else { println!("\n → FAIL (timeout/exit)"); }
    ok
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    println!("══════════════════════════════════════════════════════");
    println!("  Lattice Desktop E2E Harness");
    println!("══════════════════════════════════════════════════════");

    let root = repo_root();
    let bin  = lattice_bin(&root);

    println!("[INFO] Repo root : {}", root.display());
    println!("[INFO] Binary    : {}", bin.display());

    if !bin.exists() {
        eprintln!("[ERROR] Binary not found at either:");
        eprintln!("  {}", bin.display());
        let name = if cfg!(target_os = "windows") { "lattice.exe" } else { "lattice" };
        eprintln!("  {}", root.join("src-tauri").join("target").join("llvm-cov").join("debug").join(name).display());
        eprintln!("Run: ./scripts/build-test.sh  (or build-test.ps1 on Windows)");
        std::process::exit(1);
    }

    // Prime the WebView runtime so the first timed scenario isn't penalised by
    // a cold WebView2 first-launch on fresh CI runners (see warm_up docs).
    warm_up(&bin, &root);

    let results = [
        ("cli_no_args",     scenario_cli_no_args(&bin, &root)),
        ("cli_single_path", scenario_cli_single_path(&bin, &root)),
        ("cli_multi_path",  scenario_cli_multi_path(&bin, &root)),
        ("conflict_detection", scenario_conflict(&bin, &root)),
    ];

    println!("\n══════════════════════════════════════════════════════");
    println!("  Results");
    println!("══════════════════════════════════════════════════════");
    let mut all_pass = true;
    for (name, ok) in &results {
        println!("  {:<22} {}", name, if *ok { "PASS" } else { "FAIL" });
        if !ok { all_pass = false; }
    }
    println!("══════════════════════════════════════════════════════");

    if all_pass {
        println!("[TEST RESULT] PASSED");
        std::process::exit(0);
    } else {
        println!("[TEST RESULT] FAILED");
        std::process::exit(1);
    }
}
