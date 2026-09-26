# Automatic Testing Strategy

## Overview
For a Tauri application (React + Rust), a robust testing strategy relies on the "Test Pyramid":
1.  **Unit Tests (Frontend & Backend)**: Fast, isolated tests for individual functions and components.
2.  **Integration Tests**: Verifying that the frontend correctly calls backend commands.
3.  **End-to-End (E2E) Tests**: Testing the compiled application workflow.

## Recommended Tool Stack

### 1. Frontend: Vitest + React Testing Library
Since you are using Vite, **Vitest** is the natural choice. It is fast, compatible with Vite configuration, and shares the same API as Jest.

-   **Goal**: Test React components (`Editor`, `Settings`) and utility logic (e.g., Markdown image path resolution).
-   **Challenge**: Tauri APIs (`@tauri-apps/api`) do not work in a Node.js test environment.
-   **Solution**: Mock the Tauri API. We will create a `__mocks__` setup to simulate Tauri commands like `invoke` and `fs`.

### 2. Backend: Rust `cargo test`
Rust has a built-in test runner that is excellent. You should use it to test your commands and library logic.

-   **Goal**: Ensure file reading, hashing, and writing logic is safe.
-   **Command**: `cargo test` (runs unit tests in `src-tauri`).

### 3. End-to-End: Playwright (Desktop Web)
True Desktop E2E is complex to set up. For "scripting" and speed, we recommend **Mocked E2E**:
-   Run the web frontend in a browser (via Playwright).
-   Mock the Tauri Backend responses.
-   This allows you to test the UI flow (clicking buttons, typing text) without compiling the Rust app every time.

## Cross-Platform Validation (Android/iOS)
**Crucial Note**: The automated tests above run on your **Host Machine (Windows)**.
-   **Core Logic**: Verified on all platforms (React & Rust logic is largely shared).
-   **Platform Specifics**: Native file pickers, mobile touch events, and OS-specific behavior (e.g., Android Permissions) are **NOT** covered by Windows automation.

**Strategy for Mobile**:
Instead of expensive automated mobile farms, use **Manual Verification** on Simulators for the final mile:
1.  Run `tauri android dev` to launch the Emulator.
2.  Manually verify the "Settings" window (which has unique code for mobile).
3.  Trust the Unit Tests for the calculation/logic layers.
---

## Implemented Test Pipeline (`build-test.ps1` / `build-test.sh`)

The following is the actual pipeline as implemented, which supersedes the
"Action Plan" phases above.

### Step 1 — Backend Unit Tests
```
cargo llvm-cov --no-report --lib
```
Runs all inline `#[cfg(test)]` modules inside the Rust library (unit-test
layer). The `--no-report` flag collects raw coverage profile data without
generating any output yet, so it can be merged with the integration-test run
in the next step.

This step also covers the **CLI startup dispatch logic** via:
- `src/test_hooks.rs` — `WindowOpener` trait + `RecordingOpener` mock,
  compiled only under `cfg(test)`, invisible to all production callers.
- `src/cli_desktop_tests.rs` — four unit tests included via `#[path]` in
  `lib.rs`.  Pure logic tests (no Tauri runtime, no OS resources).

The inline `#[cfg(test)]` approach was chosen because:
- The tests are pure dispatch logic — no window creation needed.
- Inline tests share the library's private scope via `use super::*` /
  `crate::` — no public shim or feature flag required.
- `src/test_hooks.rs` is the "test-only interface": a trait file that the
  compiler strips from every production build.

### Step 1b — Integration Tests
```
cargo llvm-cov --no-report --test wiring
```
Runs `src-tauri/tests/wiring.rs` as a separate Cargo `[[test]]` binary.
This is a true integration test: it constructs a live `tauri::App<MockRuntime>`
AppHandle and calls the `load_settings` / `save_settings` Tauri command shims
end-to-end — the same code path the frontend invokes at runtime.

Each test suite runs **exactly once**. There is no duplication between steps
1 and 1b.

#### Why integration tests live in `tests/` and not inline
`tauri::test::MockRuntime` requires a Windows activation-context manifest for
Common Controls v6 (`TaskDialogIndirect` in `comctl32.dll` v6).
`build.rs` embeds that manifest into test binaries via
`cargo:rustc-link-arg-tests` — a Cargo directive that applies only to explicit
`[[test]]` targets, not to inline `#[cfg(test)]` modules compiled as part of
the `[lib]` target. Moving the wiring tests to `tests/wiring.rs` (a proper
Cargo integration-test target) is therefore not a style choice but a technical
requirement for MockRuntime to work on Windows without any new crate
dependency.

### Step 1c — E2E Desktop Harness

**Windows-only.** This step runs exclusively on the Windows CI runner. The
harness drives the instrumented GUI binary reliably under Windows, whereas the
headless paths on Linux (xvfb/WebKitGTK) and macOS (WKWebView XPC) were flaky.
`build-test.sh` gates the whole block on `uname -s` and skips it (with a log
line) on non-Windows hosts; coverage on those platforms simply excludes the
E2E profraw data.

Two sub-steps:

```
# 1c-build  (frontend assets must already be embedded via npm run build)
RUSTFLAGS="--cfg e2e_test" cargo llvm-cov build --bin lattice --no-report

# 1c-run  (xvfb-run wrapper on Linux CI)
cargo run --example e2e_harness
```

`examples/e2e_harness.rs` launches the pre-built instrumented binary once per
scenario, waits for the outcome signal, then triggers a clean exit by writing
`e2e_shutdown.txt`.  The app polls for this file every 500 ms and calls
`app_handle.exit(0)` — the portable equivalent of WM_QUIT / NSApp terminate /
GTK quit.  Each launch writes its own profraw file; all are merged into the
combined HTML report in step 4.

#### WebView cold-start warm-up
Before the timed scenarios, the harness does one throwaway launch (`warm_up`)
with a generous 30 s budget. On a fresh CI runner the *first* WebView2 launch is
slow — it creates the per-user WebView2 data folder and runs first-run
initialisation — which on GitHub Actions `windows-latest` exceeded the 15 s
per-scenario budget and failed `cli_no_args` while every later scenario passed.
Priming the runtime once lets each scenario keep its tight 15 s budget (so a
genuine hang still fails fast). The warm-up is non-fatal: if it never signals,
the scenarios still run and report the true result. Local runs are always warm
and were unaffected.

#### Why a pre-built binary instead of `npm run tauri dev`
The previous approach spawned a Vite dev server per run — slow (8 min timeout)
and fragile.  The new approach embeds frontend assets once, builds the binary
once, and launches it directly per scenario (< 5 s startup, no npm at runtime).

#### Scenarios

| Scenario | What is covered | Signal |
|---|---|---|
| `cli_no_args` | `cli_desktop_open_windows_on_startup` — zero-path branch | process alive 5 s |
| `cli_single_path` | startup with one file argument | process alive 5 s |
| `cli_multi_path` | startup with two file arguments | process alive 5 s |
| `conflict_detection` | conflict detection and resolution | `conflict_success.txt` |

### CLI export check — `examples/export_demo.rs` (ITST-LTTCE-XPT-00010)

Covers the headless export modes (`--export-html` / `--export-pdf`) end to end: the round trip
that produces a file — invisible window, IPC hand-back, host print, process exit code. Their pure
logic is unit-tested on both sides (`export.rs`, `cli_args.rs`, `platform/mod.rs`,
`print-style.test.ts`, `App.test.tsx` — see `src-tauri/src/export.trace-cov.md`); only running the
binary proves those parts are actually wired together.

This is a **separate example, not an E2E harness scenario**, and the distinction is the point.
The harness drives a visible, long-lived GUI through signal files, which is why `build-test.sh`
gates it to Windows. An export is the opposite shape — it opens an invisible window, writes a file
and exits by itself — so there is nothing to drive headlessly and it runs on **every desktop leg
of the CI matrix**. That is what finally executes the Linux and macOS `print_to_pdf` backends,
which were previously compile-verified only.

| Scenario | Asserts |
|:---------|:--------|
| `export-html` | exit `0`; `demo.html` beside the input; contains the H1 text, `data-source-line` (the rendered preview, not raw source), `<table`, `katex`, and one rasterised PNG per Mermaid block |
| `export-pdf`  | exit `0`; `demo.pdf` beside the input; starts with the `%PDF-` magic number and is not a stub |
| `missing-input` | an unreadable path exits `1` and writes no output file (the `ensure_readable` defect) |

Run by `build-test.ps1` / `build-test.sh` as step **1d**, and by CI inside step 370.2. With
`--out <dir> --label <platform>` it also copies the passing pair out; CI step 375 uploads that as
`DEMO-EXPORT-<platform>` and step 905 publishes every platform's pair on the release page, so each
desktop build's own rendering of `demo.md` is visible side by side.

Two traps this check is built around, both found by running it:

- **A binary that does not recognise the flag never exits.** An unknown argument is taken for a
  file path, which opens an ordinary editor window and waits for a human. The check kills and fails
  the run after a timeout rather than hanging the suite.
- **Only `npm run tauri build` produces a testable release binary.** A plain
  `cargo build --release` omits Tauri's `custom-protocol` feature, so the embedded assets are never
  served, no frontend JS runs, and every export times out with no other symptom.

#### `is_e2e_tst_build()` — compile-time constant
`src/e2e.rs` provides a `const fn` that returns `false` in every production
build (dead-code eliminated by the compiler) and `true` when compiled with
`RUSTFLAGS="--cfg e2e_test"`.  There is no runtime switch; a production binary
cannot be made to behave as an E2E build regardless of environment variables.

#### `LATTICE_E2E_TEST=1` — frontend E2E gate
The `conflict_detection` scenario requires the frontend to write `conflict_success.txt`
so the harness can detect that the full Rust→TS stack processed the external-edit event.
This only works if `setupTestModeListeners` is active in the embedded production assets.

`vite.config.ts` gates the `StaticRuntime` alias on two conditions:
```
npm run build                   → StaticRuntime.prod.ts  (no-op)
LATTICE_E2E_TEST=1 npm run build → StaticRuntime.dev.ts  (listeners active)
```
The build scripts (`build-test.ps1` / `build-test.sh`) set `LATTICE_E2E_TEST=1` around
the `npm run build` call for the E2E binary and clear it immediately after, so normal
production builds remain unaffected.

The compile-time constant `IS_E2E_TST_BUILD` (declared in `src/vite-env.d.ts`) mirrors
the Rust-side `is_e2e_tst_build()` and is available for guards in TypeScript code; the
bundler dead-code-eliminates any `if (IS_E2E_TST_BUILD)` blocks in non-E2E builds.

**End-to-end chain for `conflict_detection`:**
1. Harness writes initial `conflict_test.md`, launches the E2E binary with it as CLI arg.
2. App opens the file; `FileSystem.watchFile(path)` registers a Rust `notify` watcher.
3. Harness waits 6 s for WebView + React + watcher to initialise.
4. Harness overwrites `conflict_test.md` on disk (external edit).
5. Rust `notify` watcher fires → `app_handle.emit("file-changed", path)`.
6. `StaticRuntime.dev.ts::setupTestModeListeners` catches the event →
   `invoke("write_text_file", { path: "conflict_success.txt", … })`.
7. Harness polls for `conflict_success.txt` (up to 30 s) → PASS on detection.

#### Mobile placeholders
`examples/e2e_android.rs` and `examples/e2e_ios.rs` exit 0 (SKIPPED) with the
planned design documented in their module-level comments.  Android will use ADB
broadcast intents; iOS will use `xcrun simctl terminate`.

Step 1c is gated to the Windows runner (see above); the Linux `xvfb-run`
wrapper and macOS `.app`-bundle path in `build-test.sh` are retained for
reference but are not exercised in CI.

### Step 2b — Frontend Coverage
```
npm run test:coverage
```
Vitest runs all React/TypeScript tests (components, hooks, rehype plugins,
StaticRuntime mock) and produces a separate frontend coverage report.

### Step 3 — Linter
```
cargo clippy -- -D warnings
```
Treats every Clippy warning as a build error. Runs after tests so a linter
failure does not mask test failures.

### Step 4 — Combined Coverage Report
```
cargo llvm-cov report --html   # → HTML file in target/llvm-cov/html/
cargo llvm-cov report          # → text summary table printed to console
```
Both calls read the accumulated profraw data from steps 1, 1b, and 1c —
tests are **not re-run**.  The HTML file gives a browsable per-file breakdown;
the text table gives the instant per-crate summary visible in the build log.

### Pipeline summary

```
Step 1    cargo llvm-cov --no-report --lib                   → unit tests, data saved
Step 1b   cargo llvm-cov --no-report --test wiring           → integration tests, data merged
Step 1b2  cargo llvm-cov --no-report --test file_open_tests  → file-open tests, data merged
Step 1c   RUSTFLAGS="--cfg e2e_test"                         → build instrumented binary
          cargo llvm-cov build --bin lattice --no-report
          cargo run --example e2e_harness                    → E2E scenarios (Windows only), profraw merged
Step 2b   npm run test:coverage                              → frontend coverage (separate)
Step 3    cargo clippy -- -D warnings                        → linter
Step 4    cargo llvm-cov report --html                       → combined HTML from 1+1b+1b2+1c
          cargo llvm-cov report                              → text summary to console
```
