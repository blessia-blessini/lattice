// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Linux (X11) half of `paste_image_e2e.rs`: the system clipboard seen
//! through GTK, and real keyboard and mouse input.
//!
//! * [`GtkClipboard`] runs GTK on a thread of its own for as long as it
//!   lives. Through it the check puts a picture on the clipboard — the same
//!   API a screenshot tool uses; the picture stays available only while that
//!   thread's main loop answers the requests for it — and reads back the
//!   picture another program put there. GTK accepts one thread only, so
//!   every GTK call of the check goes through this one.
//! * Input goes through the XTest extension: the X server sees it exactly as
//!   it sees a real keyboard and mouse, so the app gets a genuine click and
//!   Ctrl+V. libXtst is loaded at runtime through `x11-dl`, like libX11 in
//!   `capture_linux.rs` — nothing new to link against.
//!
//! Test tooling only, never part of the shipped binary.

use std::ffi::{c_int, c_uint, c_ulong};
use std::ptr;
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use x11_dl::keysym;
use x11_dl::xlib::{self, Xlib};
use x11_dl::xtest::Xf86vmode as XTest;

/// Pause between input events, so the app handles each before the next.
const INPUT_GAP: Duration = Duration::from_millis(60);
/// How long GTK may take to start, and a clipboard job to finish.
const GTK_TIMEOUT: Duration = Duration::from_secs(10);
/// How often the GTK thread looks for a job between main-loop turns.
const GTK_TICK: Duration = Duration::from_millis(10);

/// Work for the GTK thread.
type Job = Box<dyn FnOnce() + Send>;


//******************************************************************************
// GtkClipboard
//******************************************************************************
/// The CLIPBOARD selection, used through GTK on a thread that pumps GTK's
/// main loop until this value is dropped.
pub struct GtkClipboard {
    jobs: Option<mpsc::Sender<Job>>,
    thread: Option<JoinHandle<()>>,
}

impl GtkClipboard {
    //**************************************************************
    // GtkClipboard::start
    //**************************************************************
    /// Start the GTK thread; returns once GTK is initialised there.
    pub fn start() -> Result<Self, String> {
        let (jobs_tx, jobs_rx) = mpsc::channel::<Job>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let thread = thread::spawn(move || {
            // GTK is used from this thread only: init, every job and the loop.
            if let Err(e) = gtk::init() {
                let _ = ready_tx.send(Err(format!("cannot initialise GTK: {e}")));
                return;
            }
            let _ = ready_tx.send(Ok(()));
            loop {
                while gtk::events_pending() {
                    gtk::main_iteration_do(false);
                }
                match jobs_rx.recv_timeout(GTK_TICK) {
                    Ok(job) => job(),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        let gtk = GtkClipboard { jobs: Some(jobs_tx), thread: Some(thread) };
        match ready_rx.recv_timeout(GTK_TIMEOUT) {
            Ok(Ok(())) => Ok(gtk),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(format!("GTK did not start within {} s", GTK_TIMEOUT.as_secs())),
        }
    }
    // GtkClipboard::start END ************************************

    //**************************************************************
    // GtkClipboard::run
    //**************************************************************
    /// Run `job` on the GTK thread and return its result.
    fn run<R: Send + 'static>(&self, job: impl FnOnce() -> R + Send + 'static) -> Result<R, String> {
        let stopped = || "the GTK thread has stopped".to_string();
        let (done_tx, done_rx) = mpsc::channel::<R>();
        self.jobs
            .as_ref()
            .ok_or_else(stopped)?
            .send(Box::new(move || {
                let _ = done_tx.send(job());
            }))
            .map_err(|_| stopped())?;
        done_rx
            .recv_timeout(GTK_TIMEOUT)
            .map_err(|_| format!("the clipboard did not answer within {} s", GTK_TIMEOUT.as_secs()))
    }
    // GtkClipboard::run END **************************************

    //**************************************************************
    // GtkClipboard::offer_picture
    //**************************************************************
    /// Put a plain `width`×`height` picture on the clipboard, owned by this
    /// process until the next owner takes over or this value is dropped.
    pub fn offer_picture(&self, width: i32, height: i32) -> Result<(), String> {
        self.run(move || {
            let pixbuf = gtk::gdk_pixbuf::Pixbuf::new(gtk::gdk_pixbuf::Colorspace::Rgb, false, 8, width, height)
                .ok_or("cannot allocate the picture")?;
            pixbuf.fill(0x3366_99ff);
            let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
            clipboard.set_image(&pixbuf);
            if clipboard.wait_is_image_available() {
                Ok(())
            } else {
                Err("GTK did not take the clipboard".to_string())
            }
        })?
    }
    // GtkClipboard::offer_picture END ****************************

    //**************************************************************
    // GtkClipboard::picture_size
    //**************************************************************
    /// Size of the picture on the clipboard, whoever owns it; `None` when it
    /// holds no picture.
    pub fn picture_size(&self) -> Result<Option<(i32, i32)>, String> {
        self.run(|| {
            gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD)
                .wait_for_image()
                .map(|p| (p.width(), p.height()))
        })
    }
    // GtkClipboard::picture_size END *****************************
}

impl Drop for GtkClipboard {
    fn drop(&mut self) {
        // Closing the job channel ends the thread's loop.
        self.jobs.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
// GtkClipboard END ************************************************************


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
    // Input::move_to
    //**************************************************************
    /// Move the pointer to screen position (`x`, `y`) — what hovering is.
    pub fn move_to(&self, x: c_int, y: c_int) {
        // SAFETY: `raw` is an open display; screen -1 is the pointer's screen.
        unsafe { (self.xtest.XTestFakeMotionEvent)(self.raw, -1, x, y, 0) };
        self.flush();
    }
    // Input::move_to END *****************************************

    //**************************************************************
    // Input::click
    //**************************************************************
    /// Move the pointer to screen position (`x`, `y`) and click button 1.
    /// With no window manager (the CI display) the keyboard then follows the
    /// pointer, so this also gives the window under it the keyboard.
    pub fn click(&self, x: c_int, y: c_int) {
        self.move_to(x, y);
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
