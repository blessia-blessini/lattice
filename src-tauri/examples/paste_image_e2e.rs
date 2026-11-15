// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! STST for REQ-LTTCE-IMP-00001 / 00002 on Linux: a picture on the system
//! clipboard, pasted into the edit pane of the RELEASE app with a real Ctrl+V,
//! ends up saved beside the document and linked from it.
//!
//! ```text
//! cargo run --example paste_image_e2e
//! ```
//!
//! Black box, like a user: no test hook in the app. The check
//!
//! 1. stages a vault whose settings open documents in the Edit view, with one
//!    document in it;
//! 2. puts a `PICTURE_W`×`PICTURE_H` picture on the clipboard, owned by this
//!    process through GTK — as a screenshot tool does;
//! 3. launches the release binary on the document, clicks into the editor and
//!    presses Ctrl+V, then Ctrl+S, through XTest (real X input events);
//! 4. requires the saved document to end with a link to
//!    `paste_assets/img_<n>.png`, and that file to be a PNG of exactly the
//!    picture's size.
//!
//! WebKitGTK delivers that paste to the page with nothing in it, so the
//! picture only arrives through Lattice's own clipboard read — this is the
//! end-to-end proof of that path. Linux only: on Windows and macOS the web
//! engine hands the picture over itself. Elsewhere this prints SKIP and exits 0.
//!
//! Environment: `LATTICE_EXPORT_BIN` (explicit release binary) and
//! `LATTICE_EXPORT_REQUIRED=1` (a missing binary fails instead of skipping),
//! shared with `export_demo.rs`. Run it under `xvfb-run` or on an X11 desktop
//! (`GDK_BACKEND=x11` on a Wayland session).
//!
//! Side effects on a developer machine: the pointer moves, a window opens
//! and the clipboard ends up holding a blue rectangle. The app runs with its
//! own HOME and XDG folders, so the real vault and recent-files list are not
//! touched. Test tooling only, never part of the shipped binary.

#[path = "support/release_app.rs"]
mod release_app;

#[cfg(target_os = "linux")]
#[allow(dead_code)] // capture_main_window is the screenshot example's
#[path = "support/capture_linux.rs"]
mod capture;

#[cfg(target_os = "linux")]
#[path = "support/paste_linux.rs"]
mod paste;

/// Size of the clipboard picture — odd, so a scaled or default image cannot match by chance.
const PICTURE_W: i32 = 37;
const PICTURE_H: i32 = 23;

/// What the vault's settings must say so the document opens in the edit pane.
const VAULT_SETTINGS: &str = r#"{ "startViewWithFile": "edit" }"#;
/// The document before the paste.
const DOCUMENT: &str = "# Paste E2E\n";
/// The link prefix the paste must append (`<stem>_assets/` beside `paste.md`).
const LINK_PREFIX: &str = "![Image](paste_assets/img_";


//**************************************************************
// saved_link
//**************************************************************
/// The asset path linked at the end of `saved`, when `saved` is [`DOCUMENT`]
/// plus exactly one pasted-picture link — the pure rule the check applies to
/// the file the app wrote.
fn saved_link(saved: &str) -> Option<&str> {
    let rest = saved.strip_prefix(DOCUMENT)?.trim_end();
    let path = rest.strip_prefix("![Image](")?.strip_suffix(')')?;
    let ok = rest.starts_with(LINK_PREFIX) && path.ends_with(".png") && !path.contains(['(', ')', '\n']);
    ok.then_some(path)
}
// saved_link END ***********************************************


#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use release_app::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command};
    use std::thread;
    use std::time::{Duration, Instant};

    /// How long the app may take to show its main window (cold WebView start).
    const WINDOW_TIMEOUT: Duration = Duration::from_secs(60);
    /// Time for the editor to be ready once the window is there.
    const EDITOR_SETTLE: Duration = Duration::from_secs(8);
    /// How long the saved document may take to show the link.
    const SAVE_TIMEOUT: Duration = Duration::from_secs(20);
    const POLL: Duration = Duration::from_millis(500);

    //**************************************************************
    // stage
    //**************************************************************
    /// A fresh vault with [`VAULT_SETTINGS`] and `paste.md`, plus an empty
    /// home for the app. Returns the document path.
    fn stage(scratch: &Path) -> Result<PathBuf, String> {
        let _ = fs::remove_dir_all(scratch);
        let vault = scratch.join("vault");
        let doc = vault.join("paste.md");
        fs::create_dir_all(vault.join(".lattice"))
            .and_then(|_| fs::write(vault.join(".lattice").join("settings.json"), VAULT_SETTINGS))
            .and_then(|_| fs::write(&doc, DOCUMENT))
            .and_then(|_| fs::create_dir_all(scratch.join("home")))
            .map_err(|e| format!("cannot stage {}: {e}", scratch.display()))?;
        Ok(doc)
    }
    // stage END ****************************************************

    //**************************************************************
    // launch
    //**************************************************************
    /// Start `bin` on `doc` with its own HOME and XDG folders under `scratch`.
    fn launch(bin: &Path, doc: &Path, scratch: &Path) -> Result<Child, String> {
        let home = scratch.join("home");
        let mut cmd = Command::new(bin);
        cmd.arg(doc)
            .current_dir(scratch)
            .env("HOME", &home)
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .env("XDG_DATA_HOME", home.join(".local").join("share"))
            .env("XDG_CACHE_HOME", home.join(".cache"));
        // A desktop session may rely on the default ~/.Xauthority, which the
        // changed HOME would hide; xvfb-run sets XAUTHORITY itself.
        if std::env::var_os("XAUTHORITY").is_none()
            && let Some(real) = std::env::var_os("HOME")
        {
            cmd.env("XAUTHORITY", Path::new(&real).join(".Xauthority"));
        }
        println!("  $ {} {}", bin.display(), doc.display());
        cmd.spawn().map_err(|e| format!("cannot launch {}: {e}", bin.display()))
    }
    // launch END ***************************************************

    //**************************************************************
    // wait_for_window
    //**************************************************************
    fn wait_for_window(child: &mut Child) -> Result<(i32, i32, u32, u32), String> {
        let start = Instant::now();
        loop {
            if let Some(rect) = capture::main_window_rect(child.id())? {
                return Ok(rect);
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
    // wait_for_saved_link
    //**************************************************************
    /// Poll `doc` until it holds the pasted link; the linked asset path.
    fn wait_for_saved_link(doc: &Path) -> Result<String, String> {
        let start = Instant::now();
        loop {
            let saved = fs::read_to_string(doc).unwrap_or_default().replace("\r\n", "\n");
            if let Some(path) = saved_link(&saved) {
                return Ok(path.to_string());
            }
            if start.elapsed() > SAVE_TIMEOUT {
                return Err(format!(
                    "the saved document is {saved:?} after {} s, expected {DOCUMENT:?} plus one {LINK_PREFIX}….png) link",
                    SAVE_TIMEOUT.as_secs()
                ));
            }
            thread::sleep(POLL);
        }
    }
    // wait_for_saved_link END **************************************

    //**************************************************************
    // paste_and_check
    //**************************************************************
    fn paste_and_check(bin: &Path, scratch: &Path) -> Result<(), String> {
        let doc = stage(scratch)?;
        let _picture = paste::ClipboardPicture::offer(PICTURE_W, PICTURE_H)?;
        println!("  clipboard holds a {PICTURE_W}x{PICTURE_H} picture");
        let input = paste::Input::open()?;
        let mut child = launch(bin, &doc, scratch)?;

        let result = (|| {
            let (x, y, w, h) = wait_for_window(&mut child)?;
            println!("  window {w}x{h}+{x}+{y}; letting the editor settle for {} s …", EDITOR_SETTLE.as_secs());
            thread::sleep(EDITOR_SETTLE);
            // The middle of the window is inside the edit pane, below the one
            // line of text: the click focuses the editor, cursor at the end.
            input.click(x + w as i32 / 2, y + h as i32 / 2);
            input.ctrl(paste::KEY_V)?;
            thread::sleep(Duration::from_secs(2)); // host read + save_image
            input.ctrl(paste::KEY_S)?;
            let asset = wait_for_saved_link(&doc)?;
            let png = doc.parent().unwrap_or(scratch).join(&asset);
            let (pw, ph) = image::image_dimensions(&png)
                .map_err(|e| format!("the linked {} is not a readable picture: {e}", png.display()))?;
            if (pw, ph) != (PICTURE_W as u32, PICTURE_H as u32) {
                return Err(format!("the saved picture is {pw}x{ph}, the clipboard held {PICTURE_W}x{PICTURE_H}"));
            }
            println!("  saved {asset} ({pw}x{ph}) and linked it");
            Ok(())
        })();
        // The release binary has no remote "quit"; its document is saved.
        let _ = child.kill();
        let _ = child.wait();
        result
    }
    // paste_and_check END ******************************************

    //**************************************************************
    // run
    //**************************************************************
    pub fn run() -> i32 {
        let root = repo_root();
        let required = std::env::var("LATTICE_EXPORT_REQUIRED").as_deref() == Ok("1");
        let Some((bin, _dmg)) = locate_binary(&root) else {
            let msg = "no RELEASE lattice binary found under src-tauri/target/[<triple>/]release/lattice";
            if required {
                eprintln!("[ERROR] {msg} (LATTICE_EXPORT_REQUIRED=1)");
                return 1;
            }
            println!("[SKIP] {msg} — build a release first, or set LATTICE_EXPORT_BIN");
            return 0;
        };
        println!("[INFO] Binary    : {}", bin.display());
        let scratch = root.join("src-tauri").join("target").join("e2e-paste-image");
        match paste_and_check(&bin, &scratch) {
            Ok(()) => {
                let _ = fs::remove_dir_all(&scratch);
                println!("[TEST RESULT] PASSED (paste image)");
                0
            }
            Err(e) => {
                println!("[TEST RESULT] FAILED (paste image): {e}; fixture kept at {}", scratch.display());
                1
            }
        }
    }
    // run END ******************************************************
}


//**************************************************************
// main
//**************************************************************
fn main() {
    println!("══════════════════════════════════════════════════════");
    println!("  Lattice paste-image check (Linux, real Ctrl+V)");
    println!("══════════════════════════════════════════════════════");
    #[cfg(target_os = "linux")]
    std::process::exit(linux::run());
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (PICTURE_W, PICTURE_H, VAULT_SETTINGS, saved_link);
        println!("[SKIP] Linux only: on Windows and macOS the web engine hands a pasted picture to the page itself.");
    }
}
// main END *****************************************************


//**************************************************************
// tests — the check's own rule, run on every OS
//**************************************************************
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_with_one_pasted_link_yields_its_asset() {
        let saved = format!("{DOCUMENT}![Image](paste_assets/img_1794.png)\n");
        assert_eq!(saved_link(&saved), Some("paste_assets/img_1794.png"));
    }

    #[test]
    fn a_link_pasted_on_the_same_line_also_counts() {
        let saved = format!("{DOCUMENT}![Image](paste_assets/img_1.png)");
        assert_eq!(saved_link(&saved), Some("paste_assets/img_1.png"));
    }

    #[test]
    fn an_unchanged_document_has_no_link() {
        assert_eq!(saved_link(DOCUMENT), None);
        assert_eq!(saved_link(""), None);
    }

    #[test]
    fn a_link_elsewhere_or_twice_does_not_count() {
        assert_eq!(saved_link(&format!("{DOCUMENT}![Image](other/img_1.png)")), None);
        assert_eq!(saved_link(&format!("{DOCUMENT}![Image](paste_assets/img_1.png)![Image](paste_assets/img_2.png)")), None);
        assert_eq!(saved_link(&format!("{DOCUMENT}text ![Image](paste_assets/img_1.png)")), None);
    }
}
// tests END ****************************************************
