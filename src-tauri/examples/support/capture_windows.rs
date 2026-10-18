// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! Windows variant of the main-window capture used by `app_screenshot.rs`.
//! Same contract in `capture_macos.rs` and `capture_linux.rs`; the example
//! selects one per target with `#[cfg]` + `#[path]` (test tooling only, never
//! in the shipped binary).
//!
//! Finds the largest visible, titled top-level window of the process and asks
//! it to render itself (`PrintWindow` with `PW_RENDERFULLCONTENT`, which
//! includes WebView2's DirectComposition content) into a PNG.
//!
//! Deliberately not a copy of the screen: on CI runners other windows sit on
//! top of the app (the runner's console, Windows' first-run privacy dialog),
//! and a screen copy showed those instead — run 39152079347. `PrintWindow`
//! does not care what covers the window.

use std::ffi::c_void;
use std::path::Path;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
};
use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
    PW_RENDERFULLCONTENT,
};
use windows::core::BOOL;

/// Windows narrower or lower than this are tooltips, splash or helper windows.
const MIN_SIDE: i32 = 200;


//******************************************************************************
// EnumState
//******************************************************************************
/// What the `EnumWindows` callback collects: the process to look for, and
/// the largest matching window found so far.
struct EnumState {
    pid: u32,
    best: Option<(HWND, RECT)>,
}
// EnumState END ***************************************************************


//******************************************************************************
// window_bounds
//******************************************************************************
/// The window as the user sees it: DWM's extended frame bounds exclude the
/// invisible resize border that `GetWindowRect` includes on Windows 10+.
fn window_bounds(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a live, writable RECT and the size passed is its size.
    let dwm = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    // SAFETY: as above; GetWindowRect only writes the RECT.
    if dwm.is_err() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    Some(rect)
}
// window_bounds END ***********************************************************


//******************************************************************************
// collect_window
//******************************************************************************
/// `EnumWindows` callback: keep the largest visible, titled window of the pid.
unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` is the `&mut EnumState` passed by `find_main_window`,
    // which outlives the synchronous EnumWindows call.
    let state = unsafe { &mut *(lparam.0 as *mut EnumState) };
    let mut owner = 0u32;
    // SAFETY: plain Win32 queries on a window handle EnumWindows just gave us.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
    let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
    let titled = unsafe { GetWindowTextLengthW(hwnd) } > 0;
    if owner == state.pid
        && visible
        && titled
        && let Some(rect) = window_bounds(hwnd)
    {
        let area = |r: &RECT| (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
        let big_enough = rect.right - rect.left >= MIN_SIDE && rect.bottom - rect.top >= MIN_SIDE;
        if big_enough && state.best.as_ref().is_none_or(|(_, b)| area(&rect) > area(b)) {
            state.best = Some((hwnd, rect));
        }
    }
    BOOL(1) // keep enumerating
}
// collect_window END **********************************************************


//******************************************************************************
// find_main_window
//******************************************************************************
fn find_main_window(pid: u32) -> Option<(HWND, RECT)> {
    let mut state = EnumState { pid, best: None };
    // SAFETY: the callback only dereferences `state` during this call.
    let _ = unsafe { EnumWindows(Some(collect_window), LPARAM(&mut state as *mut _ as isize)) };
    state.best
}
// find_main_window END ********************************************************


//******************************************************************************
// capture_main_window
//******************************************************************************
/// Write the main window of process `pid` to `png`. `Ok(false)` while the
/// process has no visible window yet; `Err` when capturing itself fails.
pub fn capture_main_window(pid: u32, png: &Path) -> Result<bool, String> {
    // Physical pixels: without this, a scaled display returns virtualised
    // window coordinates that do not match the screen DC.
    // SAFETY: process-wide setting with no pointers; failure (already set) is harmless.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };

    let Some((hwnd, visible)) = find_main_window(pid) else {
        return Ok(false);
    };
    // PrintWindow draws the whole window rectangle, including the invisible
    // resize border; `visible` (DWM frame bounds) is cropped out afterwards.
    let mut whole = RECT::default();
    // SAFETY: `whole` is a live, writable RECT.
    unsafe { GetWindowRect(hwnd, &mut whole) }.map_err(|e| format!("GetWindowRect failed: {e}"))?;

    let (width, height) = (whole.right - whole.left, whole.bottom - whole.top);
    let mut bgra = vec![0u8; width as usize * height as usize * 4];
    // SAFETY: every GDI object created here is released before returning;
    // `bgra` holds exactly width*height 32-bit pixels, which is what the
    // top-down 32-bpp BITMAPINFO below asks GetDIBits to write.
    let copied = unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap.into());
        let printed = PrintWindow(hwnd, memory, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // negative: top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        SelectObject(memory, previous);
        let lines = GetDIBits(
            memory, bitmap, 0, height as u32,
            Some(bgra.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS,
        );
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if !printed {
            return Err("PrintWindow failed".into());
        }
        lines
    };
    if copied != height {
        return Err(format!("GetDIBits copied {copied} of {height} lines"));
    }

    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2); // BGRA → RGBA
        px[3] = 255; // GDI leaves the alpha byte at 0
    }
    let full = image::RgbaImage::from_raw(width as u32, height as u32, bgra)
        .ok_or("pixel buffer does not match the window size")?;
    // Crop to what the user sees: the DWM frame inside the window rectangle.
    let left = (visible.left - whole.left).clamp(0, width) as u32;
    let top = (visible.top - whole.top).clamp(0, height) as u32;
    let crop_w = ((visible.right - visible.left) as u32).min(width as u32 - left);
    let crop_h = ((visible.bottom - visible.top) as u32).min(height as u32 - top);
    image::imageops::crop_imm(&full, left, top, crop_w, crop_h)
        .to_image()
        .save(png)
        .map_err(|e| format!("cannot write {}: {e}", png.display()))?;
    Ok(true)
}
// capture_main_window END *****************************************************
