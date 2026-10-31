// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Linux (X11) variant of the main-window capture used by `app_screenshot.rs`.
//! Same contract in `capture_windows.rs` and `capture_macos.rs`.
//!
//! Made for the CI display: `xvfb-run` with no window manager, where every
//! top-level window is a direct child of the root window. The window is
//! matched by `_NET_WM_PID` (GDK sets it), and its area is read from the
//! *root* window, i.e. what is actually on screen. Xlib is loaded at runtime
//! through `x11-dl`, as tao already does — nothing new to link against.

use std::ffi::{c_int, c_uchar, c_uint, c_ulong};
use std::path::Path;
use std::ptr;
use x11_dl::xlib::{self, Xlib};

/// Windows narrower or lower than this are not the main window.
const MIN_SIDE: c_int = 200;


//******************************************************************************
// Display
//******************************************************************************
/// An open X display, closed on drop so no early return can leak it.
struct Display<'a> {
    xlib: &'a Xlib,
    raw: *mut xlib::Display,
}

impl Drop for Display<'_> {
    fn drop(&mut self) {
        // SAFETY: `raw` came from XOpenDisplay and is closed exactly once.
        unsafe { (self.xlib.XCloseDisplay)(self.raw) };
    }
}
// Display END *****************************************************************


//******************************************************************************
// window_pid
//******************************************************************************
/// The `_NET_WM_PID` of `window`, if it has one.
fn window_pid(d: &Display, window: c_ulong, atom: c_ulong) -> Option<u32> {
    let (mut kind, mut format, mut items, mut after) = (0, 0, 0, 0);
    let mut data: *mut c_uchar = ptr::null_mut();
    // SAFETY: all out-pointers are live locals; `data` is freed below.
    let status = unsafe {
        (d.xlib.XGetWindowProperty)(
            d.raw, window, atom, 0, 1, xlib::False, xlib::XA_CARDINAL,
            &mut kind, &mut format, &mut items, &mut after, &mut data,
        )
    };
    if status != xlib::Success as c_int || data.is_null() {
        return None;
    }
    // Format-32 properties are delivered as C `long`s, whatever their width.
    let pid = if format == 32 && items == 1 {
        // SAFETY: on this branch, XGetWindowProperty returned one 32-bit item in `data`.
        // Use unaligned read to avoid relying on pointer alignment guarantees.
        Some(unsafe { ptr::read_unaligned(data as *const c_ulong) as u32 })
    } else {
        None
    };
    // SAFETY: `data` was allocated by Xlib for this call.
    unsafe { (d.xlib.XFree)(data.cast()) };
    pid
}
// window_pid END **************************************************************


//******************************************************************************
// find_main_window
//******************************************************************************
/// Position and size (clipped to the screen) of the largest viewable
/// top-level window owned by `pid`.
fn find_main_window(d: &Display, root: c_ulong, pid: u32) -> Option<(c_int, c_int, c_uint, c_uint)> {
    // SAFETY: the atom name is a NUL-terminated literal.
    let atom = unsafe { (d.xlib.XInternAtom)(d.raw, c"_NET_WM_PID".as_ptr(), xlib::True) };
    if atom == 0 {
        return None; // no client has set the property yet
    }
    let (mut root_ret, mut parent) = (0, 0);
    let mut children: *mut c_ulong = ptr::null_mut();
    let mut count: c_uint = 0;
    // SAFETY: out-pointers are live locals; `children` is freed below.
    let ok = unsafe { (d.xlib.XQueryTree)(d.raw, root, &mut root_ret, &mut parent, &mut children, &mut count) };
    if ok == 0 || children.is_null() {
        return None;
    }
    // SAFETY: XQueryTree returned `count` window ids at `children`.
    let windows = unsafe { std::slice::from_raw_parts(children, count as usize) }.to_vec();
    // SAFETY: allocated by Xlib for this call.
    unsafe { (d.xlib.XFree)(children.cast()) };

    let mut screen: xlib::XWindowAttributes = unsafe { std::mem::zeroed() };
    // SAFETY: `screen` is a live, writable attributes struct.
    unsafe { (d.xlib.XGetWindowAttributes)(d.raw, root, &mut screen) };

    let mut best: Option<(c_int, c_int, c_uint, c_uint)> = None;
    for window in windows {
        let mut attr: xlib::XWindowAttributes = unsafe { std::mem::zeroed() };
        // SAFETY: as above.
        if unsafe { (d.xlib.XGetWindowAttributes)(d.raw, window, &mut attr) } == 0
            || attr.map_state != xlib::IsViewable
            || attr.width < MIN_SIDE
            || attr.height < MIN_SIDE
            || window_pid(d, window, atom) != Some(pid)
        {
            continue;
        }
        // XGetImage fails with BadMatch outside the screen: clip first.
        let x = attr.x.max(0);
        let y = attr.y.max(0);
        let w = (attr.x + attr.width).min(screen.width) - x;
        let h = (attr.y + attr.height).min(screen.height) - y;
        if w <= 0 || h <= 0 {
            continue;
        }
        let area = w as i64 * h as i64;
        if best.is_none_or(|(_, _, bw, bh)| area > bw as i64 * bh as i64) {
            best = Some((x, y, w as c_uint, h as c_uint));
        }
    }
    best
}
// find_main_window END ********************************************************


//******************************************************************************
// channel
//******************************************************************************
/// Extract the 8-bit channel selected by `mask` from an X pixel value.
fn channel(pixel: c_ulong, mask: c_ulong) -> u8 {
    if mask == 0 {
        return 0;
    }
    let shifted = (pixel & mask) >> mask.trailing_zeros();
    let max = mask >> mask.trailing_zeros();
    (shifted * 255 / max) as u8
}
// channel END *****************************************************************


//******************************************************************************
// capture_main_window
//******************************************************************************
/// Write the main window of process `pid` to `png`. `Ok(false)` while the
/// process has no visible window yet; `Err` when capturing itself fails.
pub fn capture_main_window(pid: u32, png: &Path) -> Result<bool, String> {
    let xlib = Xlib::open().map_err(|e| format!("cannot load libX11: {e}"))?;
    // SAFETY: NULL selects $DISPLAY.
    let raw = unsafe { (xlib.XOpenDisplay)(ptr::null()) };
    if raw.is_null() {
        return Err("cannot open the X display (is DISPLAY set?)".into());
    }
    let d = Display { xlib: &xlib, raw };
    // SAFETY: `d.raw` is an open display.
    let root = unsafe { (xlib.XDefaultRootWindow)(d.raw) };
    let Some((x, y, w, h)) = find_main_window(&d, root, pid) else {
        return Ok(false);
    };

    // SAFETY: the area lies inside the root window (clipped above).
    let img = unsafe { (xlib.XGetImage)(d.raw, root, x, y, w, h, !0, xlib::ZPixmap) };
    if img.is_null() {
        return Err(format!("XGetImage failed for {w}x{h}+{x}+{y}"));
    }
    // SAFETY: `img` is a valid XImage until destroyed below.
    let (red, green, blue) = unsafe { ((*img).red_mask, (*img).green_mask, (*img).blue_mask) };
    let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
    for row in 0..h as c_int {
        for col in 0..w as c_int {
            // SAFETY: (col, row) is inside the w×h image.
            let pixel = unsafe { (xlib.XGetPixel)(img, col, row) };
            rgba.extend_from_slice(&[channel(pixel, red), channel(pixel, green), channel(pixel, blue), 255]);
        }
    }
    // XDestroyImage is a C macro over the image's own destructor.
    // SAFETY: `img` is destroyed exactly once and not used afterwards.
    unsafe {
        if let Some(destroy) = (*img).funcs.destroy_image {
            destroy(img);
        }
    }

    image::RgbaImage::from_raw(w, h, rgba)
        .ok_or("pixel buffer does not match the window size")?
        .save(png)
        .map_err(|e| format!("cannot write {}: {e}", png.display()))?;
    Ok(true)
}
// capture_main_window END *****************************************************
