// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! STST on Linux for REQ-LTTCE-IMP-00001 / 00002 (a picture on the system
//! clipboard, pasted into the edit pane with a real Ctrl+V, ends up saved
//! beside the document and linked from it) and REQ-LTTCE-PRV-00007 ("Copy PNG
//! image" puts the diagram on the clipboard as a picture), in the RELEASE app.
//!
//! ```text
//! cargo run --example paste_image_e2e
//! ```
//!
//! Black box, like a user: no test hook in the app. The check
//!
//! 1. stages a vault whose settings open documents in the Dual view (editor
//!    left, preview right), with one document holding a Mermaid diagram;
//! 2. puts a `PICTURE_W`×`PICTURE_H` picture on the clipboard, owned by this
//!    process through GTK — as a screenshot tool does;
//! 3. launches the release binary on the document and, through XTest (real X
//!    input events), clicks into the editor, presses Ctrl+V, then Ctrl+S, and
//!    requires the saved document to link `paste_assets/img_<n>.png` — a PNG
//!    of exactly the picture's size;
//! 4. moves the pointer over the diagram in the preview, clicks its "Copy PNG
//!    image" button and requires the clipboard to hold a picture of another
//!    size — the app's, since this process held the only other one;
//! 5. pastes and saves again, and requires a second link to a PNG of exactly
//!    that picture's size.
//!
//! WebKitGTK delivers the paste of a picture to the page with nothing in it,
//! so a pasted picture only arrives through Lattice's own clipboard read —
//! this is the end-to-end proof of that path, for a picture from another
//! program and for one Lattice copied itself. The click on "Copy PNG image"
//! is a genuine user gesture, which WebKit requires before a page may write
//! the clipboard — a scripted click would test the refusal, not the copy.
//! Linux only: on Windows the E2E harness covers the copy (scenario
//! `copy_diagram`), and Windows and macOS hand a pasted picture to the page
//! themselves. Elsewhere this prints SKIP and exits 0.
//!
//! Environment: `LATTICE_EXPORT_BIN` (explicit release binary) and
//! `LATTICE_EXPORT_REQUIRED=1` (a missing binary fails instead of skipping),
//! shared with `export_demo.rs`. Run it under `xvfb-run` or on an X11 desktop
//! (`GDK_BACKEND=x11` on a Wayland session).
//!
//! Side effects on a developer machine: the pointer moves, a window opens
//! and the clipboard ends up holding the diagram. The app runs with its own
//! HOME and XDG folders, so the real vault and recent-files list are not
//! touched. Test tooling only, never part of the shipped binary.

#[path = "support/release_app.rs"]
mod release_app;

#[cfg(target_os = "linux")]
#[path = "support/capture_linux.rs"]
mod capture;

#[cfg(target_os = "linux")]
#[path = "support/paste_linux.rs"]
mod paste;

/// Size of the clipboard picture — odd, so a scaled or default image cannot match by chance.
const PICTURE_W: i32 = 37;
const PICTURE_H: i32 = 23;

/// What the vault's settings must say so the document opens in the Dual
/// view: the editor on the left half, the preview on the right.
const VAULT_SETTINGS: &str = r#"{ "startViewWithFile": "dual" }"#;
/// The document before the pastes. The diagram comes first, so its block —
/// and the copy buttons on it — sit at the top of the preview, where no text
/// above them can move them.
const DOCUMENT: &str = "```mermaid\ngraph LR\n  A --> B\n```\n";
/// How a pasted picture is linked …
const LINK_OPEN: &str = "![Image](";
/// … and where it is saved (`<stem>_assets/` beside `paste.md`).
const ASSET_PREFIX: &str = "paste_assets/img_";


//**************************************************************
// saved_links
//**************************************************************
/// The asset paths linked after [`DOCUMENT`] in `saved`, in order, when the
/// rest of `saved` is nothing but pasted-picture links (blanks between them
/// allowed) — the pure rule the check applies to the file the app wrote.
/// `None` when the file does not start with the document or holds anything
/// else.
fn saved_links(saved: &str) -> Option<Vec<&str>> {
    let mut rest = saved.strip_prefix(DOCUMENT)?.trim();
    let mut links = Vec::new();
    while !rest.is_empty() {
        let after_open = rest.strip_prefix(LINK_OPEN)?;
        let end = after_open.find(')')?;
        let path = &after_open[..end];
        let ok = path.starts_with(ASSET_PREFIX) && path.ends_with(".png") && !path.contains(['(', '\n', ' ']);
        if !ok {
            return None;
        }
        links.push(path);
        rest = after_open[end + 1..].trim_start();
    }
    Some(links)
}
// saved_links END **********************************************


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
    /// Time for the editor and the diagram to be ready once the window is there.
    const EDITOR_SETTLE: Duration = Duration::from_secs(8);
    /// Time between Ctrl+V and Ctrl+S: host read + `save_image`.
    const PASTE_SETTLE: Duration = Duration::from_secs(2);
    /// Time for the copy buttons to appear once the pointer is over the diagram.
    const HOVER_SETTLE: Duration = Duration::from_secs(1);
    /// How long the saved document may take to show a link.
    const SAVE_TIMEOUT: Duration = Duration::from_secs(20);
    /// How long the clipboard may take to hold the copied diagram.
    const COPY_TIMEOUT: Duration = Duration::from_secs(10);
    const POLL: Duration = Duration::from_millis(500);

    /// Where the "Copy PNG image" button sits, from the window's top-right
    /// corner, with the diagram first in the preview (App.css): the block
    /// ends 12 px left of the window's edge and starts 67 px below its top;
    /// the button bar sits 8 px in from the block's top-right corner, three
    /// 28 px buttons 4 px apart, "Copy PNG image" first — so its middle is
    /// 12 + 8 + 2×(28 + 4) + 14 = 98 px from the right and 67 + 8 + 14 = 89 px
    /// from the top.
    const COPY_BUTTON_FROM_RIGHT: i32 = 98;
    const COPY_BUTTON_FROM_TOP: i32 = 89;
    /// A point on the diagram block, between the two boxes, to hover over.
    const DIAGRAM_FROM_RIGHT: i32 = 212;
    const DIAGRAM_FROM_TOP: i32 = 117;

    /// The main window's position and size on screen.
    type Rect = (i32, i32, u32, u32);

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
    fn wait_for_window(child: &mut Child) -> Result<Rect, String> {
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
    // paste_and_save
    //**************************************************************
    /// Click into the editor, press Ctrl+V and, once the paste has had time
    /// to arrive, Ctrl+S. The point is the middle of the editor half, below
    /// the text: the click focuses the editor with the cursor at the end.
    fn paste_and_save(input: &paste::Input, (x, y, w, h): Rect) -> Result<(), String> {
        input.click(x + w as i32 / 4, y + h as i32 / 2);
        input.ctrl(paste::KEY_V)?;
        thread::sleep(PASTE_SETTLE);
        input.ctrl(paste::KEY_S)
    }
    // paste_and_save END *******************************************

    //**************************************************************
    // wait_for_saved_links
    //**************************************************************
    /// Poll `doc` until it holds `count` pasted links; their asset paths.
    fn wait_for_saved_links(doc: &Path, count: usize) -> Result<Vec<String>, String> {
        let start = Instant::now();
        loop {
            let saved = fs::read_to_string(doc).unwrap_or_default().replace("\r\n", "\n");
            if let Some(links) = saved_links(&saved).filter(|l| l.len() == count) {
                return Ok(links.into_iter().map(String::from).collect());
            }
            if start.elapsed() > SAVE_TIMEOUT {
                return Err(format!(
                    "the saved document is {saved:?} after {} s, expected the diagram plus {count} {LINK_OPEN}{ASSET_PREFIX}….png) link(s)",
                    SAVE_TIMEOUT.as_secs()
                ));
            }
            thread::sleep(POLL);
        }
    }
    // wait_for_saved_links END *************************************

    //**************************************************************
    // expect_picture
    //**************************************************************
    /// `asset`, relative to `doc`, must be a PNG of exactly `size`.
    fn expect_picture(doc: &Path, asset: &str, (w, h): (i32, i32)) -> Result<(), String> {
        let png = doc.parent().unwrap_or(doc).join(asset);
        let (pw, ph) = image::image_dimensions(&png)
            .map_err(|e| format!("the linked {} is not a readable picture: {e}", png.display()))?;
        if (pw, ph) != (w as u32, h as u32) {
            return Err(format!("the saved picture {asset} is {pw}x{ph}, the clipboard held {w}x{h}"));
        }
        println!("  saved {asset} ({pw}x{ph}) and linked it");
        Ok(())
    }
    // expect_picture END *******************************************

    //**************************************************************
    // copy_diagram
    //**************************************************************
    /// Hover over the diagram, click its "Copy PNG image" button and wait
    /// for the clipboard to hold a picture other than `before`; its size.
    /// On failure a screenshot of the window is left in `scratch`.
    fn copy_diagram(
        input: &paste::Input,
        clipboard: &paste::GtkClipboard,
        (x, y, w, _): Rect,
        pid: u32,
        before: (i32, i32),
        scratch: &Path,
    ) -> Result<(i32, i32), String> {
        let right = x + w as i32;
        input.move_to(right - DIAGRAM_FROM_RIGHT, y + DIAGRAM_FROM_TOP);
        thread::sleep(HOVER_SETTLE);
        let (bx, by) = (right - COPY_BUTTON_FROM_RIGHT, y + COPY_BUTTON_FROM_TOP);
        input.click(bx, by);
        let start = Instant::now();
        let mut last = None;
        while start.elapsed() < COPY_TIMEOUT {
            last = clipboard.picture_size()?;
            if let Some(size) = last.filter(|s| *s != before) {
                println!("  \"Copy PNG image\" put a {}x{} picture on the clipboard", size.0, size.1);
                return Ok(size);
            }
            thread::sleep(POLL);
        }
        let shot = scratch.join("copy-image-failed.png");
        let saved = match capture::capture_main_window(pid, &shot) {
            Ok(true) => format!("; screenshot: {}", shot.display()),
            _ => String::new(),
        };
        Err(format!(
            "after a click on \"Copy PNG image\" at ({bx}, {by}) the clipboard holds {last:?} after {} s, \
             expected a picture other than {before:?}{saved}",
            COPY_TIMEOUT.as_secs()
        ))
    }
    // copy_diagram END *********************************************

    //**************************************************************
    // paste_and_check
    //**************************************************************
    fn paste_and_check(bin: &Path, scratch: &Path) -> Result<(), String> {
        let doc = stage(scratch)?;
        let clipboard = paste::GtkClipboard::start()?;
        let picture = (PICTURE_W, PICTURE_H);
        clipboard.offer_picture(PICTURE_W, PICTURE_H)?;
        println!("  clipboard holds a {PICTURE_W}x{PICTURE_H} picture");
        let input = paste::Input::open()?;
        let mut child = launch(bin, &doc, scratch)?;

        let result = (|| {
            let rect = wait_for_window(&mut child)?;
            let (x, y, w, h) = rect;
            println!("  window {w}x{h}+{x}+{y}; letting the editor settle for {} s …", EDITOR_SETTLE.as_secs());
            thread::sleep(EDITOR_SETTLE);

            println!("  1. paste a picture from another program");
            paste_and_save(&input, rect)?;
            let links = wait_for_saved_links(&doc, 1)?;
            expect_picture(&doc, &links[0], picture)?;

            println!("  2. copy the diagram with \"Copy PNG image\", then paste it");
            let copied = copy_diagram(&input, &clipboard, rect, child.id(), picture, scratch)?;
            paste_and_save(&input, rect)?;
            let links = wait_for_saved_links(&doc, 2)?;
            expect_picture(&doc, &links[1], copied)
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
        let _ = (PICTURE_W, PICTURE_H, VAULT_SETTINGS, saved_links);
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
        assert_eq!(saved_links(&saved), Some(vec!["paste_assets/img_1794.png"]));
    }

    #[test]
    fn two_pasted_links_count_in_order_on_one_line_or_two() {
        let one_line = format!("{DOCUMENT}![Image](paste_assets/img_1.png)![Image](paste_assets/img_2.png)");
        let two_lines = format!("{DOCUMENT}![Image](paste_assets/img_1.png)\n![Image](paste_assets/img_2.png)\n");
        let both = Some(vec!["paste_assets/img_1.png", "paste_assets/img_2.png"]);
        assert_eq!(saved_links(&one_line), both);
        assert_eq!(saved_links(&two_lines), both);
    }

    #[test]
    fn an_unchanged_document_has_no_link() {
        assert_eq!(saved_links(DOCUMENT), Some(vec![]));
        assert_eq!(saved_links(""), None);
    }

    #[test]
    fn a_link_elsewhere_or_other_text_does_not_count() {
        assert_eq!(saved_links(&format!("{DOCUMENT}![Image](other/img_1.png)")), None);
        assert_eq!(saved_links(&format!("{DOCUMENT}![Image](paste_assets/img_1.jpg)")), None);
        assert_eq!(saved_links(&format!("{DOCUMENT}text ![Image](paste_assets/img_1.png)")), None);
        assert_eq!(saved_links(&format!("{DOCUMENT}![Image](paste_assets/img_1.png) text")), None);
        assert_eq!(saved_links(&format!("{DOCUMENT}![Image](paste_assets/img_1.png")), None);
    }
}
// tests END ****************************************************
