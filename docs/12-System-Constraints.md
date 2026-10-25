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

[^posix]: POSIX — Portable Operating System Interface. The IEEE/ISO standard for Unix-like system
    interfaces; `setenv` and `getenv` are part of its C library.

[^gtk]: GTK — the GIMP Toolkit, the GUI library Lattice's Linux WebView (WebKitGTK) is built on.

[^ffi]: FFI — Foreign Function Interface. Calling a function of another language (here C) directly,
    outside the safe Rust bindings.
