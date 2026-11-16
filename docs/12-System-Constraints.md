# Lattice — System Constraints

This document records Lattice's **internal constraints**: limits the implementation must respect that a
user does not observe as behaviour, and which therefore are not product requirements. A constraint says
what the code SHALL or SHALL NOT do, why, and where the design that honours it is described.

Each constraint is tagged with an anchor comment of the form `<!--CSTR-PPPPP-SSS-NNNNN-->`, using the
same product and subsystem codes as the requirements; the ID schema is defined in
`11-Traceability-Requirements.md`. An architecture section or implementation unit that honours a
constraint lists `covers CSTR-…` in its `.trace-cov.md` satellite, exactly as for a requirement.

A change that introduces or changes an internal constraint records it here.

---

## Table of Contents
<!-- TOC -->
- [Lattice — System Constraints](#lattice-system-constraints)
  - [Table of Contents](#table-of-contents)
  - [Chapter PLT — Platform Layer](#chapter-plt-platform-layer)
  - [Chapter XPT — Headless CLI Export](#chapter-xpt-headless-cli-export)
  - [Chapter FOS — Third-Party Licence Compliance](#chapter-fos-third-party-licence-compliance)
  - [Chapter BLD — Build Outputs](#chapter-bld-build-outputs)
<!-- /TOC -->

---

## Chapter PLT — Platform Layer

<!--CSTR-LTTCE-PLT-00001-->
**CSTR-LTTCE-PLT-00001** — The platform variant (Windows, macOS, Linux, Android, iOS) SHALL be selected by
the build, never in source: `build.rs` copies exactly one `platform/impls/<os>.rs`, and host crates are
declared under per-target dependency tables in `src-tauri/Cargo.toml`. No source file SHALL contain
`#[cfg(target_os = …)]` to choose platform behaviour. Build-configuration `cfg` (test, debug/release)
remains allowed.

*Rationale*: a consumer depends on the `Platform` trait only and never picks the implementation, as a C
caller sees only a header and the linker fills the slot. Off-target code is not compiled at all, so it
cannot leak into another platform's binary.
*Design*: ARCH-LTTCE-XPT-00002 ("Selection is a manifest concern").

<!--CSTR-LTTCE-PLT-00002-->
**CSTR-LTTCE-PLT-00002** — The process environment SHALL NOT be modified once the application runs: no
`std::env::set_var` / `remove_var`, no POSIX[^posix] `setenv`. A setting that a library also accepts as an
environment variable SHALL be made through the library's API instead.

*Rationale*: by the time any feature runs, tokio workers, the file watcher's thread and glib's thread
pools are live, and `setenv` mutates the global `environ` with no synchronisation against a concurrent
`getenv` in those threads — undefined behaviour, not merely a race.
*Design*: ARCH-LTTCE-XPT-00002 (GTK's print backend set on `gtk::Settings`, not via `GTK_PRINT_BACKENDS`).

<!--CSTR-LTTCE-PLT-00003-->
**CSTR-LTTCE-PLT-00003** — The host crates Lattice uses directly (`webview2-com`, `windows`, `webkit2gtk`,
`gtk`, `glib`, `objc2` and its framework crates) SHALL be pinned to the versions `wry` resolves, and SHALL
follow `wry` after every dependency update.

*Rationale*: a differing version adds a second copy of the crate to the graph; a stale Windows pin does
not merely duplicate a crate, it breaks the build.
*Design*: ARCH-LTTCE-XPT-00002.

---

## Chapter XPT — Headless CLI Export

<!--CSTR-LTTCE-XPT-00001-->
**CSTR-LTTCE-XPT-00001** — On Linux, PDF export SHALL use only GTK's[^gtk] **file** print backend, and the
name of that backend's printer SHALL be obtained through gettext in GTK's own `gtk30` domain (the
`LATTICE_GTK_PRINTER` environment variable overrides it). Lattice SHALL NOT enumerate printers through
unsafe FFI[^ffi].

*Rationale*: GTK translates the printer's name, and gtk-rs 0.18 binds no printer enumeration, so the name
cannot be read back without unsafe FFI into `gtk_enumerate_printers`; gettext returns the exact string GTK
registered, in any locale, with no unsafe code. Consequence: Lattice has no print-to-paper on Linux —
adding one would first need this constraint lifted.
*Design*: ARCH-LTTCE-XPT-00002 ("Linux needs a named printer, and it must be the file one").

---

## Chapter FOS — Third-Party Licence Compliance

<!--CSTR-LTTCE-FOS-00001-->
**CSTR-LTTCE-FOS-00001** — The licence tooling in `scripts/foss/` SHALL run on Node 24 with Node's built-in
modules only — no npm dependencies. Its tests may use the project's existing test runner.

*Rationale*: a tool that gates the dependency graph should not enlarge it, and it runs on every pull
request into `dev`, Dependabot's included, where a dependency's install scripts are kept from running.
*Design*: ARCH-LTTCE-FOS-00004.

---

## Chapter BLD — Build Outputs

<!--CSTR-LTTCE-BLD-00001-->
**CSTR-LTTCE-BLD-00001** — A production frontend bundle SHALL contain no end-to-end test code: neither
`src/services/StaticRuntime/StaticRuntime.dev.ts` nor any `*E2EDriver.ts` module, and no name of the E2E
file protocol (`e2e_…`). Every production build SHALL check this and fail when it does not hold.

*Rationale*: the E2E drivers act on the user's files and clipboard on a harness's signal. They reach the
app only through `StaticRuntime.dev.ts`, which `vite.config.ts` replaces with the empty
`StaticRuntime.prod.ts` in production builds — correct by construction, but a construction one import
can bypass silently. The check turns that into a build failure.
*Design*: `vite-release-guard.ts` (`releaseGuard`, a Vite plugin added to production builds only; the
E2E build, `vite.e2e_test.config.ts`, is exempt). The Rust side's test hooks are compiled out by the
`e2e_test` feature (`e2e::is_e2e_tst_build()`), which no release build enables.

<!--CSTR-LTTCE-BLD-00002-->
**CSTR-LTTCE-BLD-00002** — The release notes a release build publishes — the GitHub Release text and the
release-site page — SHALL contain no bare `@name` outside code: every such name SHALL be put in code
(backticks) before publishing, so that no GitHub account is mentioned.

*Rationale*: the release notes are the commit titles collected in `CHANGELOG.md`, where `@main` is a
branch and `@page` a CSS rule, never a person. GitHub reads `@name` in a release text as a mention: the
v0.3.52 notes ("…the Legattice scan at @main…") notified the account named `main` and listed it among
that release's contributors. Text in code is never a mention and reads the same.
*Design*: `scripts/release/release-mentions.mjs` (`quoteMentions`, unit-tested in
`release-mentions.test.mjs`), run on `release-notes.md` by step 900.5 of `buildAndTest.yml`, which both
the release (904) and the release-site page (905) are made from. E-mail addresses, URL paths and text
already in code are left alone.

<!--CSTR-LTTCE-BLD-00003-->
**CSTR-LTTCE-BLD-00003** — The published Linux packages (AppImage, `.deb`, the APT repository) SHALL be
built on a pinned Ubuntu 24.04 runner image (`ubuntu-24.04`, `ubuntu-24.04-arm`), never on a moving label
such as `ubuntu-latest`. Newer Ubuntu releases SHALL be built and tested by test-only CI legs that publish nothing
but, when they fail, block a release like any other leg. These legs test packages built on the newer
release; they do not test the published 24.04 packages installed there.

*Rationale*: a Linux binary needs at least the glibc version of the system it was built on. One built on
Ubuntu 26.04 does not start on Ubuntu 24.04 LTS or current Debian, the systems REQ-LTTCE-APT-00001
promises the packages to; one built on 24.04 also runs on newer systems. `ubuntu-latest` moves to the
newest Ubuntu without a change in this repository, so it would raise that floor silently (decided by the
product owner, 2026-11-16).
*Design*: `buildAndTest.yml`, setup job matrix: `linux-desktop` and `linux-arm-desktop` on the pinned
images; `linux-u2604-desktop` and `linux-u2604-arm-desktop` on `ubuntu-26.04` / `ubuntu-26.04-arm` with
`"publish": "no"` (ARCH text under *Key CI Steps* in `30-architecture.md`).

---

[^posix]: POSIX — Portable Operating System Interface. The IEEE/ISO standard for Unix-like system
    interfaces; `setenv` and `getenv` are part of its C library.

[^gtk]: GTK — the GIMP Toolkit, the GUI library Lattice's Linux WebView (WebKitGTK) is built on.

[^ffi]: FFI — Foreign Function Interface. Calling a function of another language (here C) directly,
    outside the safe Rust bindings.
