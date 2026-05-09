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

### Step 1c — E2E / Conflict Reproducer
```
cargo llvm-cov --no-report --example reproduce_conflict
```
Builds and runs `src-tauri/examples/reproduce_conflict.rs` as a Cargo
`[[example]]` binary under coverage instrumentation.  The binary:

1. Detects the repo root (normalises for both `src-tauri/` cwd and repo-root
   cwd so it works whether called from `build-test.ps1` or `Test-Conflict.*`).
2. Writes `conflict_test.md` to the repo root, then launches the full Lattice
   app via `npm run tauri dev` (cwd forced to repo root).
3. When `CARGO_LLVM_COV` is set (i.e., this step runs inside the pipeline),
   appends `-C instrument-coverage` to the child's `RUSTFLAGS` so the spawned
   Lattice app is also instrumented.  `LLVM_PROFILE_FILE` is inherited
   automatically by the child process, so its profraw data lands in the same
   coverage directory and is merged into the combined HTML report in step 4.
4. Waits up to 5 minutes for `conflict_success.txt` and exits non-zero on
   timeout so the pipeline fails fast.

On Linux CI without a display, `xvfb-run` wraps the invocation.

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
Step 1   cargo llvm-cov --no-report --lib           → unit tests run, data saved
Step 1b  cargo llvm-cov --no-report --test wiring   → integration tests run, data merged
Step 1c  cargo llvm-cov --no-report --example reproduce_conflict
                                                    → E2E run, child instrumented, data merged
Step 2b  npm run test:coverage                      → frontend coverage (separate report)
Step 3   cargo clippy -- -D warnings                → linter
Step 4   cargo llvm-cov report --html               → one HTML table from steps 1 + 1b + 1c
         cargo llvm-cov report                      → text summary to console
```
