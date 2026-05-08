// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

//! Cross-platform filesystem helpers for integration tests.
//!
//! The *interface* is the same on every OS; the platform-specific *how* is
//! confined to `#[cfg(unix)]` / `#[cfg(windows)]` blocks inside each function
//! body.  All other test code uses this API exclusively — no `set_mode`,
//! `PermissionsExt`, or `#[cfg(unix)]` should appear outside this file.
//!
//! Supported platforms:
//! | Target              | make_unreadable       | can_test_unreadable |
//! |---------------------|-----------------------|---------------------|
//! | Linux / macOS       | chmod 000             | true                |
//! | Android / iOS       | chmod 000 (unix)      | true                |
//! | Windows             | no-op (ACL needs      | false               |
//! |                     | elevated privileges)  |                     |
//! | Other               | no-op                 | false               |

use std::path::Path;

// ─── PermGuard ──────────────────────────────────────────────────────────────

/// RAII guard: runs a restore closure when dropped, undoing the permission
/// change made by `make_unreadable` even if the test panics.
///
/// On platforms where `make_unreadable` is a no-op, `drop` is also a no-op.
pub struct PermGuard {
    restore: Option<Box<dyn FnOnce() + Send>>,
}

impl Drop for PermGuard {
    fn drop(&mut self) {
        if let Some(f) = self.restore.take() {
            f();
        }
    }
}

impl PermGuard {
    fn noop() -> Self {
        PermGuard { restore: None }
    }

    fn with_restore(f: impl FnOnce() + Send + 'static) -> Self {
        PermGuard {
            restore: Some(Box::new(f)),
        }
    }
}

// ─── make_unreadable ────────────────────────────────────────────────────────

/// Deny all access to `path` for the current process and return a `PermGuard`
/// that restores the original permissions on drop.
///
/// Tests that assert a "permission denied" outcome must also check
/// `can_test_unreadable()` before making those assertions, because on Windows
/// this function returns a no-op guard without modifying the file.
pub fn make_unreadable(path: &Path) -> PermGuard {
    // ── Unix branch (Linux, macOS, Android, iOS) ───────────────────────────
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let meta = std::fs::metadata(path)
            .expect("make_unreadable: cannot stat file");
        let original_mode = meta.permissions().mode();

        let mut p = meta.permissions();
        p.set_mode(0o000);
        std::fs::set_permissions(path, p)
            .expect("make_unreadable: cannot chmod file");

        let owned = path.to_path_buf();
        PermGuard::with_restore(move || {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(m) = std::fs::metadata(&owned) {
                let mut rp = m.permissions();
                rp.set_mode(original_mode);
                let _ = std::fs::set_permissions(&owned, rp);
            }
        })
    }

    // ── Windows branch ─────────────────────────────────────────────────────
    // Making a file truly unreadable on Windows requires DACL manipulation
    // via SetSecurityInfo / icacls, which requires elevated privileges and is
    // impractical in a unit-test context.  We return a no-op guard here;
    // callers should skip permission-denied assertions when
    // `can_test_unreadable()` is false.
    #[cfg(all(windows, not(unix)))]
    {
        let _ = path;
        PermGuard::noop()
    }

    // ── Fallback for any other target (e.g. WASM, exotic embedded) ─────────
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        PermGuard::noop()
    }
}

// ─── can_test_unreadable ────────────────────────────────────────────────────

/// Returns `true` on platforms where `make_unreadable` actually restricts
/// file access (currently: all Unix-family targets including Android and iOS).
///
/// Usage pattern in tests:
/// ```ignore
/// let _guard = make_unreadable(&path);
/// let result = do_something_with(&path);
/// if can_test_unreadable() {
///     assert!(result.is_err(), "expected permission-denied error");
/// }
/// ```
pub fn can_test_unreadable() -> bool {
    cfg!(unix)
}

// ─── invalid_root_path ─────────────────────────────────────────────────────

/// A path whose `parent()` is `None` on the current OS, used to exercise
/// error paths in file-creation helpers.
///
/// `Path::new("/").parent()` returns `None` on both Unix and Windows in
/// Rust's standard library, so the same literal works everywhere.
pub fn invalid_root_path() -> &'static str {
    "/"
}

// ─── native_newline ─────────────────────────────────────────────────────────

/// The OS-native line ending.
///
/// Use this when simulating "another process wrote the file natively" in
/// tests that exercise line-ending detection or conflict detection.
pub fn native_newline() -> &'static str {
    #[cfg(windows)]
    {
        "\r\n"
    }
    #[cfg(not(windows))]
    {
        "\n"
    }
}
