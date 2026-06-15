// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.

//! E2E build flag — compile-time constant, zero runtime overhead.
//!
//! # Production builds  (`--features e2e_test` NOT passed)
//! [`is_e2e_tst_build`] is an `#[inline(always)] const fn` returning `false`.
//! The compiler dead-code-eliminates every `if is_e2e_tst_build() { … }` block;
//! none of the E2E machinery exists in the production binary.
//!
//! # E2E builds  (`cargo build --bin lattice --features e2e_test`)
//! [`is_e2e_tst_build`] returns `true`.  The binary is otherwise identical to
//! a debug build — same code paths, just with coverage instrumentation and the
//! E2E hooks compiled in.  `build.rs` emits `cargo:rustc-cfg=e2e_test` when
//! the feature is active, so `#[cfg(e2e_test)]` works without touching RUSTFLAGS.
//!
//! # Security property
//! There is no runtime switch.  A production binary **cannot** be made to
//! behave as an E2E build regardless of environment variables.

/// Returns `false` in every production build.
/// The compiler eliminates all guarded code at compile time.
#[cfg(not(e2e_test))]
#[inline(always)]
pub const fn is_e2e_tst_build() -> bool {
    false
}

/// Returns `true` in E2E builds (`--features e2e_test`).
#[cfg(e2e_test)]
#[inline(always)]
pub const fn is_e2e_tst_build() -> bool {
    true
}
