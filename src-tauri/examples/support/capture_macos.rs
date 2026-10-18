// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! macOS variant of the main-window capture used by `app_screenshot.rs`.
//! Same contract in `capture_windows.rs` and `capture_linux.rs`.
//!
//! `CGWindowListCopyWindowInfo` names the largest on-screen, normal-layer
//! window of the process; the system's own `screencapture -l <id>` takes the
//! picture. `CGWindowListCreateImage`, the in-process alternative, is
//! obsoleted in the macOS 15 SDK, and `screencapture` writes PNG itself.
//! Capturing needs the Screen Recording permission for the calling process.

use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer,
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowNumber,
    kCGWindowOwnerPID,
};
use std::path::Path;
use std::process::Command;

/// Windows narrower or lower than this (points) are not the main window.
const MIN_SIDE: f64 = 200.0;

type WindowInfo = CFDictionary<CFString, CFType>;


//******************************************************************************
// number
//******************************************************************************
/// A numeric entry of a window-info dictionary.
fn number(dict: &WindowInfo, key: CFStringRef) -> Option<f64> {
    // SAFETY: `key` is one of CoreGraphics' constant CFString keys.
    let key = unsafe { CFString::wrap_under_get_rule(key) };
    dict.find(&key)?.downcast::<CFNumber>()?.to_f64()
}
// number END ******************************************************************


//******************************************************************************
// size_of_window
//******************************************************************************
/// Width × height from the window's `kCGWindowBounds` dictionary.
fn size_of_window(dict: &WindowInfo) -> Option<(f64, f64)> {
    // SAFETY: as in `number`.
    let key = unsafe { CFString::wrap_under_get_rule(kCGWindowBounds) };
    let bounds = dict.find(&key)?.downcast::<CFDictionary>()?;
    // SAFETY: kCGWindowBounds holds a CFDictionary of CFString → CFNumber;
    // get-rule wrapping retains it for as long as `bounds` lives.
    let bounds: WindowInfo = unsafe { TCFType::wrap_under_get_rule(bounds.as_concrete_TypeRef()) };
    let get = |name: &'static str| bounds.find(&CFString::from_static_string(name))?.downcast::<CFNumber>()?.to_f64();
    Some((get("Width")?, get("Height")?))
}
// size_of_window END **********************************************************


//******************************************************************************
// find_main_window
//******************************************************************************
/// The CGWindowID of the process's largest on-screen normal window.
fn find_main_window(pid: u32) -> Option<u32> {
    let windows = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )?;
    let mut best: Option<(u32, f64)> = None;
    for item in windows.iter() {
        // SAFETY: every element of the window-info array is a CFDictionary.
        let dict: WindowInfo = unsafe { TCFType::wrap_under_get_rule(*item as CFDictionaryRef) };
        let owner = number(&dict, unsafe { kCGWindowOwnerPID });
        let layer = number(&dict, unsafe { kCGWindowLayer });
        let id = number(&dict, unsafe { kCGWindowNumber });
        let (Some(owner), Some(0.0), Some(id)) = (owner, layer, id) else { continue };
        if owner as u32 != pid {
            continue;
        }
        let Some((w, h)) = size_of_window(&dict) else { continue };
        if w >= MIN_SIDE && h >= MIN_SIDE && best.is_none_or(|(_, area)| w * h > area) {
            best = Some((id as u32, w * h));
        }
    }
    best.map(|(id, _)| id)
}
// find_main_window END ********************************************************


//******************************************************************************
// capture_main_window
//******************************************************************************
/// Write the main window of process `pid` to `png`. `Ok(false)` while the
/// process has no visible window yet; `Err` when capturing itself fails.
pub fn capture_main_window(pid: u32, png: &Path) -> Result<bool, String> {
    let Some(id) = find_main_window(pid) else {
        return Ok(false);
    };
    // -x no sound, -o no drop shadow, -l that window only.
    let output = Command::new("screencapture")
        .args(["-x", "-o", "-l"])
        .arg(id.to_string())
        .arg(png)
        .output()
        .map_err(|e| format!("cannot run screencapture: {e}"))?;
    if !output.status.success() || !png.is_file() {
        return Err(format!(
            "screencapture -l {id} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(true)
}
// capture_main_window END *****************************************************
