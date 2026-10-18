// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Finding and staging the RELEASE Lattice app for the examples that run it:
//! `export_demo.rs` (CLI export check) and `app_screenshot.rs` (CI screenshot).
//! Each includes this file with `#[path = "support/release_app.rs"] mod release_app;`
//! — examples are separate crates and cannot share a library module otherwise.
//! `examples/support/` has no `main.rs`, so Cargo does not take it for an example.

// Each example uses a different subset of these helpers.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

//**************************************************************
// repo_root
//**************************************************************
/// Repository root, whether invoked from the repo root or from `src-tauri`.
pub fn repo_root() -> PathBuf {
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
pub fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") { "lattice.exe" } else { "lattice" }
}
// binary_name END **********************************************

/// Architectures a Rust target triple can start with — see [`is_target_triple`].
pub const TARGET_ARCHS: [&str; 12] = [
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
pub fn is_target_triple(name: &str) -> bool {
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
pub fn build_dirs(root: &Path) -> Vec<PathBuf> {
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
pub struct MountedDmg {
    pub mount_point: PathBuf,
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
pub fn attach_dmg(dmg: &Path) -> Result<MountedDmg, String> {
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
pub fn app_binary_in(dir: &Path) -> Option<PathBuf> {
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
pub fn stage_demo(demo: &Path, dir: &Path) -> Result<PathBuf, String> {
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
pub fn sorted_paths(dir: &Path) -> Vec<PathBuf> {
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
pub fn locate_binary(root: &Path) -> Option<(PathBuf, Option<MountedDmg>)> {
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
pub fn default_label() -> &'static str {
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
pub struct Args {
    /// Where to copy the produced files for publishing, if anywhere.
    pub out_dir: Option<PathBuf>,
    /// Platform label embedded in the copied file names.
    pub label: String,
}

impl Args {
    /// Parses `--out <dir>` and `--label <name>`; unknown flags are rejected
    /// rather than ignored, so a typo in a CI step cannot silently disable
    /// the publishing half of this run.
    pub fn parse() -> Result<Args, String> {
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
