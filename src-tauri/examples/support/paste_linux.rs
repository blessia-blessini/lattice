// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Linux (X11) half of `paste_image_e2e.rs`: a clipboard owner holding a
//! picture, and real keyboard and mouse input.
//!
//! * The picture is put on the clipboard by this process through GTK — the
//!   same API a screenshot tool uses — and stays available only while GTK's
//!   main loop here answers the requests for it, so the owner runs its own
//!   thread for as long as the [`ClipboardPicture`] lives.
//! * Input goes through the XTest extension: the X server sees it exactly as
//!   it sees a real keyboard and mouse, so the app gets a genuine Ctrl+V.
//!   libXtst is loaded at runtime through `x11-dl`, like libX11 in
//!   `capture_linux.rs` — nothing new to link against.
//!
//! Test tooling only, never part of the shipped binary.

use std::ffi::{c_int, c_uint, c_ulong};
use std::ptr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use x11_dl::keysym;
use x11_dl::xlib::{self, Xlib};
use x11_dl::xtest::Xf86vmode as XTest;

/// Pause between input events, so the app handles each before the next.
const INPUT_GAP: Duration = Duration::from_millis(60);


//******************************************************************************
// ClipboardPicture
//******************************************************************************
/// A `width`×`height` picture on the CLIPBOARD selection, owned by a GTK main
/// loop on its own thread until this value is dropped.
pub struct ClipboardPicture {
    stop: Arc<AtomicBool>,
    owner: Option<JoinHandle<()>>,
}

impl ClipboardPicture {
    //**************************************************************
    // ClipboardPicture::offer
    //**************************************************************
    /// Put the picture on the clipboard; returns once GTK holds it.
    pub fn offer(width: i32, height: i32) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let owner_stop = Arc::clone(&stop);
        let owner = thread::spawn(move || {
            // GTK is used from this thread only: init, ownership and the loop.
            if let Err(e) = gtk::init() {
                let _ = ready_tx.send(Err(format!("cannot initialise GTK: {e}")));
                return;
            }
            let Some(pixbuf) = gtk::gdk_pixbuf::Pixbuf::new(
                gtk::gdk_pixbuf::Colorspace::Rgb, false, 8, width, height,
            ) else {
                let _ = ready_tx.send(Err("cannot allocate the picture".into()));
                return;
            };
            pixbuf.fill(0x3366_99ff);
            let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
            clipboard.set_image(&pixbuf);
            let held = clipboard.wait_is_image_available();
            let _ = ready_tx.send(if held { Ok(()) } else { Err("GTK did not take the clipboard".into()) });
            while !owner_stop.load(Ordering::Relaxed) {
                while gtk::events_pending() {
                    gtk::main_iteration_do(false);
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        let picture = ClipboardPicture { stop, owner: Some(owner) };
        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => Ok(picture),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("the clipboard owner did not start within 10 s".into()),
        }
    }
    // ClipboardPicture::offer END ********************************
}

impl Drop for ClipboardPicture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(owner) = self.owner.take() {
            let _ = owner.join();
        }
    }
}
// ClipboardPicture END ********************************************************


//******************************************************************************
// Input
//******************************************************************************
/// The X display, driven through XTest. Closed on drop.
pub struct Input {
    xlib: Xlib,
    xtest: XTest,
    raw: *mut xlib::Display,
}

impl Input {
    //**************************************************************
    // Input::open
    //**************************************************************
    /// Open `$DISPLAY` with the XTest extension.
    pub fn open() -> Result<Self, String> {
        let xlib = Xlib::open().map_err(|e| format!("cannot load libX11: {e}"))?;
        let xtest = XTest::open().map_err(|e| format!("cannot load libXtst (XTest): {e}"))?;
        // SAFETY: NULL selects $DISPLAY.
        let raw = unsafe { (xlib.XOpenDisplay)(ptr::null()) };
        if raw.is_null() {
            return Err("cannot open the X display (is DISPLAY set?)".into());
        }
        Ok(Input { xlib, xtest, raw })
    }
    // Input::open END ********************************************

    //**************************************************************
    // Input::flush
    //**************************************************************
    fn flush(&self) {
        // SAFETY: `raw` is an open display.
        unsafe { (self.xlib.XSync)(self.raw, xlib::False) };
        thread::sleep(INPUT_GAP);
    }
    // Input::flush END *******************************************

    //**************************************************************
    // Input::click
    //**************************************************************
    /// Move the pointer to screen position (`x`, `y`) and click button 1.
    /// With no window manager (the CI display) the keyboard then follows the
    /// pointer, so this also gives the window under it the keyboard.
    pub fn click(&self, x: c_int, y: c_int) {
        // SAFETY: `raw` is an open display; screen -1 is the pointer's screen.
        unsafe { (self.xtest.XTestFakeMotionEvent)(self.raw, -1, x, y, 0) };
        self.flush();
        for down in [xlib::True, xlib::False] {
            // SAFETY: as above.
            unsafe { (self.xtest.XTestFakeButtonEvent)(self.raw, 1, down, 0) };
            self.flush();
        }
    }
    // Input::click END *******************************************

    //**************************************************************
    // Input::ctrl
    //**************************************************************
    /// Press Ctrl+`key` (`key` a keysym, e.g. `keysym::XK_v`).
    pub fn ctrl(&self, key: c_uint) -> Result<(), String> {
        let ctrl = self.keycode(keysym::XK_Control_L)?;
        let key = self.keycode(key)?;
        for (code, down) in [(ctrl, xlib::True), (key, xlib::True), (key, xlib::False), (ctrl, xlib::False)] {
            // SAFETY: `raw` is an open display; `code` is a valid keycode.
            unsafe { (self.xtest.XTestFakeKeyEvent)(self.raw, code, down, 0) };
            self.flush();
        }
        Ok(())
    }
    // Input::ctrl END ********************************************

    //**************************************************************
    // Input::keycode
    //**************************************************************
    fn keycode(&self, sym: c_uint) -> Result<c_uint, String> {
        // SAFETY: `raw` is an open display.
        let code = unsafe { (self.xlib.XKeysymToKeycode)(self.raw, sym as c_ulong) };
        if code == 0 {
            return Err(format!("the X keyboard has no key for keysym {sym:#x}"));
        }
        Ok(code as c_uint)
    }
    // Input::keycode END *****************************************
}

impl Drop for Input {
    fn drop(&mut self) {
        // SAFETY: `raw` came from XOpenDisplay and is closed exactly once.
        unsafe { (self.xlib.XCloseDisplay)(self.raw) };
    }
}
// Input END *******************************************************************

/// The keysyms the test presses.
pub const KEY_V: c_uint = keysym::XK_v;
pub const KEY_S: c_uint = keysym::XK_s;
