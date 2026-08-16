#!/bin/bash
# LEGAL NOTE:
# LATTICE (tm) - The Portable and standard Markdown Editor
# Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
# email: blessia AT blessini.com
#
# GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# See LICENCE file in GitHUB root folder of the repository.
# END OF NOTE

# Pre-build checks and setup
export DEFAULT_BUILD_NO="TESTVERSION"
export SCRIPT_NAME="build-test.sh"
source ./scripts/_pre-build.sh

#**************************************************************
# fast_tests
#**************************************************************
# FAST mode: test only the crates touched by *uncommitted* changes
# (working tree vs HEAD + untracked files), skipping coverage,
# integration, E2E and the HTML report. Inner dev loop only; the full
# (no "fast" arg) run stays the gate required for "Done".
# See code-prompt-DoD.md / DRY-and-Variants.md.
#
# NOTE: this block must run *after* `_pre-build.sh` (above), which sets
# LATTICEBUILD_NO. vite.config.ts throws "LATTICEBUILD_NO environment
# variable is not defined" otherwise — `npx vitest related` below needs it.
if [ "$1" = "fast" ] || [ "$1" = "--fast" ] || [ "$1" = "-Fast" ]; then
    echo "FAST mode: testing only crates with uncommitted changes..."
    mapfile -t CHANGED < <( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u )
    [ ${#CHANGED[@]} -eq 0 ] && { echo "No uncommitted changes. Nothing to test."; exit 0; }

    # Map each changed *.rs file to its owning crate (nearest Cargo.toml with a name).
    declare -A PKGSET
    for f in "${CHANGED[@]}"; do
        case "$f" in *.rs) ;; *) continue ;; esac
        dir=$(dirname "$f")
        while [ -n "$dir" ] && [ "$dir" != "." ] && [ "$dir" != "/" ]; do
            if [ -f "$dir/Cargo.toml" ]; then
                name=$(grep -m1 -E '^[[:space:]]*name[[:space:]]*=[[:space:]]*"' "$dir/Cargo.toml" | sed -E 's/.*"([^"]+)".*/\1/')
                [ -n "$name" ] && PKGSET["$name"]=1 && break
            fi
            dir=$(dirname "$dir")
        done
    done

    FAILED=0
    if [ ${#PKGSET[@]} -gt 0 ]; then
        PKG_ARGS=(); for p in "${!PKGSET[@]}"; do PKG_ARGS+=( -p "$p" ); done
        echo "Rust crates: ${!PKGSET[*]}"
        pushd src-tauri || exit
            cargo test --lib "${PKG_ARGS[@]}" || FAILED=1
            [ $FAILED -eq 0 ] && { cargo clippy "${PKG_ARGS[@]}" -- -D warnings || FAILED=1; }
        popd || exit
    else
        echo "No Rust crate changes detected."
    fi

    # Frontend: run only the vitest suites related to changed .ts/.tsx files.
    FE=(); for f in "${CHANGED[@]}"; do case "$f" in *.ts|*.tsx) FE+=("$f") ;; esac; done
    if [ ${#FE[@]} -gt 0 ] && [ $FAILED -eq 0 ]; then
        echo "Frontend: vitest related (${#FE[@]} changed file(s))"
        npx vitest related "${FE[@]}" --run || FAILED=1
    fi

    [ $FAILED -ne 0 ] && { echo "FAST tests FAILED."; exit 1; }
    echo "FAST tests passed."; exit 0
fi
# fast_tests END **********************************************

pushd src-tauri || exit
cargo llvm-cov clean
popd

# Temp files to capture Rust test result lines for the GitHub Actions summary.
# Each file holds the stdout of one cargo test run so we can extract the
# "test result: ok. N passed" line at the end.
RUST_OUT_UNIT=$(mktemp)
RUST_OUT_WIRING=$(mktemp)
RUST_OUT_FILEOPEN=$(mktemp)
RUST_OUT_E2E=$(mktemp)
RUST_OUT_COV=$(mktemp)

# 1a. Run Backend Unit Tests (Rust)
# --no-report accumulates coverage data without generating a report yet,
# so it can be merged with the integration-test run below into one table.
echo "Running Backend Unit Tests..."
pushd src-tauri || exit
cargo llvm-cov --no-report --lib 2>&1 | tee "$RUST_OUT_UNIT"
CARGO_RESULT=${PIPESTATUS[0]}
popd || exit

if [ $CARGO_RESULT -ne 0 ]; then
    echo "Backend unit tests failed!"
    exit $CARGO_RESULT
fi

# 1b. Run Integration Tests (Rust) — settings wiring
# --no-report keeps accumulating into the same coverage data set.
# Tests run exactly once; no duplication with the unit-test run above.
echo "Running Integration Tests (wiring)..."
pushd src-tauri || exit
cargo llvm-cov --no-report --test wiring 2>&1 | tee "$RUST_OUT_WIRING"
INTEGRATION_RESULT=${PIPESTATUS[0]}
popd || exit

if [ $INTEGRATION_RESULT -ne 0 ]; then
    echo "Integration tests (wiring) failed!"
    exit $INTEGRATION_RESULT
fi

# 1b2. Run Integration Tests (Rust) — file-open / file-association
# Verifies Direct Push content loading works on all 3 desktop platforms.
# macOS-specific URL conversion tests are gated by #[cfg(target_os = "macos")].
echo "Running Integration Tests (file_open_tests)..."
pushd src-tauri || exit
cargo llvm-cov --no-report --test file_open_tests 2>&1 | tee "$RUST_OUT_FILEOPEN"
FILE_OPEN_RESULT=${PIPESTATUS[0]}
popd || exit

if [ $FILE_OPEN_RESULT -ne 0 ]; then
    echo "Integration tests (file_open_tests) failed!"
    exit $FILE_OPEN_RESULT
fi

# 1c. E2E Desktop Harness
# Step 1: build the instrumented Lattice binary (frontend must already be built).
# Step 2: run the e2e_harness example which launches the binary for each scenario.
#
# The binary is compiled with --features e2e_test; build.rs emits
# cargo:rustc-cfg=e2e_test so is_e2e_tst_build() returns true,
# enabling the shutdown signal listener and E2E hooks.
# The harness sets LLVM_PROFILE_FILE per scenario; profraw data lands in the
# coverage directory and is merged into the HTML report in step 4.
# E2E Desktop Harness runs ONLY on Windows.
# Rationale: the harness launches the instrumented GUI binary; driving it
# headlessly is reliable on Windows but flaky elsewhere (Linux xvfb/WebKitGTK,
# macOS WKWebView XPC). The per-OS launch branches below are kept for reference
# but the whole block is gated to Git Bash on Windows (MINGW/MSYS/CYGWIN).
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) RUN_E2E=1 ;;
    *)                    RUN_E2E=0 ;;
esac

if [ "$RUN_E2E" -eq 1 ]; then
echo "Running E2E Desktop Harness..."
pushd src-tauri || exit

echo "  [1c-build] Building instrumented Lattice binary..."
# Avoid show-env: its single-quoted Windows paths cause os error 123.
# Set flags directly instead.
# Clear RUSTC_WRAPPER so any leftover from a previous llvm-cov run
# in this shell session does not interfere.
unset RUSTC_WRAPPER
# tauri-build reads TAURI_DEV_SERVER_URL at *build time* and bakes it as a
# compile-time constant.  If set from a previous `tauri dev` session, the
# E2E binary will always try localhost instead of its embedded dist/ assets.
unset TAURI_DEV_SERVER_URL
# build:e2e_test uses vite.e2e_test.config.ts which calls makeViteConfig(true),
# baking IS_E2E_TST_BUILD=true into the bundle — the TS equivalent of --cfg e2e_test.
echo "  [1c-frontend] Building frontend assets (npm run build:e2e_test)..."
pushd .. || exit
npm run build:e2e_test
NPM_RESULT=$?
popd || exit
if [ $NPM_RESULT -ne 0 ]; then
    echo "Frontend build failed!"
    popd || exit
    exit $NPM_RESULT
fi

COVERAGE_DIR="$(pwd)/target/llvm-cov"

# Step A: Register the lattice binary with cargo-llvm-cov so it appears as a
# source-mapping object in `cargo llvm-cov report` (needed for cli_desktop.rs,
# e2e.rs etc. which are only compiled with --features e2e_test).
# The binary checks for `e2e_register_only.txt` at startup and exits before
# Tauri even starts — so this step completes in <1 s instead of ~15 s.
echo "  [1c-register] Registering lattice binary with cargo-llvm-cov..."
echo "register" > e2e_register_only.txt
cargo llvm-cov --no-report run --bin lattice --features e2e_test 2>&1
REGISTER_RESULT=${PIPESTATUS[0]}
rm -f e2e_register_only.txt   # safety net (run() already removes it)
if [ $REGISTER_RESULT -ne 0 ]; then
    echo "E2E binary registration failed!"
    popd || exit
    exit $REGISTER_RESULT
fi

# Step B: Locate the binary that cargo-llvm-cov just built and ensure it exists at
# target/debug/lattice (the path that lattice_bin() in the harness falls back to).
# cargo-llvm-cov's binary output location varies by version and host config:
#   - target/llvm-cov/debug/lattice  (clean CI build — cargo-llvm-cov sets CARGO_TARGET_DIR)
#   - target/debug/lattice           (warm-cache local build — binary already present)
# We search both paths, then fall back to a find, and copy to target/debug/ if needed.
# Copying is safe: the copy has the same build-ID as the original registered binary,
# so profraw files from harness subprocesses still map correctly in `cargo llvm-cov report`.
echo "  [1c-locate] Locating E2E binary (cargo-llvm-cov output dir varies by platform)..."
# Binary name differs on Windows (.exe suffix).
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) _BIN="lattice.exe" ;;
    *) _BIN="lattice" ;;
esac
_LLVM_BIN="$(pwd)/target/llvm-cov/debug/$_BIN"
_DBG_BIN="$(pwd)/target/debug/$_BIN"
if [ -f "$_LLVM_BIN" ]; then
    _FOUND="$_LLVM_BIN"
elif [ -f "$_DBG_BIN" ]; then
    _FOUND="$_DBG_BIN"
else
    # Unexpected layout — search the whole target tree (excludes examples and .d files)
    _FOUND=$(find "$(pwd)/target" -name "$_BIN" -type f \
        ! -path "*/examples/*" ! -name "*.d" 2>/dev/null | head -1)
fi
if [ -z "$_FOUND" ]; then
    echo "ERROR: E2E binary not found anywhere in target/ after Step A!"
    find "$(pwd)/target" -maxdepth 5 -name "lattice*" 2>/dev/null | head -20 || true
    popd || exit
    exit 1
fi
echo "  [1c-locate] Found: $_FOUND"
# Copy to target/debug/ so the harness finds it at the expected path.
# The copy has the same build-ID as the registered binary, so profraw files
# from harness subprocesses still map correctly in `cargo llvm-cov report`.
if [ "$_FOUND" != "$_DBG_BIN" ]; then
    mkdir -p "$(dirname "$_DBG_BIN")"
    cp "$_FOUND" "$_DBG_BIN"
    echo "  [1c-locate] Copied to: $_DBG_BIN"
fi

# Set LLVM_PROFILE_FILE so each lattice subprocess launched by the harness writes
# its own e2e_{PID}.profraw into the llvm-cov directory for the report step.
export LLVM_PROFILE_FILE="$COVERAGE_DIR/e2e_%p.profraw"

echo "  [1c-run] Running E2E harness scenarios..."
if [ "$(uname)" == "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
    # WebKitGTK headless CI fixes (Ubuntu 24.04 / Noble):
    #
    #   WEBKIT_FORCE_SANDBOX=0          — disables WebKitGTK's bubblewrap sandbox.
    #   WEBKIT_DISABLE_COMPOSITING_MODE=1 — disables GPU compositing; falls back to
    #                                       software rendering (no GPU on CI).
    #   WEBKIT_DISABLE_DMABUF_RENDERER=1  — WebKit 2.42+ introduced a DMA-BUF renderer
    #                                       that requires a GPU; disable it on CI.
    #   GDK_BACKEND=x11                 — Ubuntu 24.04 defaults GTK to Wayland when
    #                                       possible; no Wayland compositor runs on CI so
    #                                       GTK may error or hang.  Force X11 to use the
    #                                       Xvfb display xvfb-run provides.
    #   NO_AT_BRIDGE=1                  — suppresses AT-SPI accessibility bus errors.
    #   RUST_LOG=error                  — surface Rust-level errors in the harness log
    #                                       (otherwise the app runs completely silently).
    #   --server-args="-screen 0 1280x1024x24" — 24-bit colour depth; some WebKit
    #                                       versions reject the default 8-bit xvfb screen.
    #
    # Ubuntu 24.04 AppArmor fix:
    #   Noble sets kernel.apparmor_restrict_unprivileged_userns=1 by default, blocking
    #   unprivileged user namespaces system-wide.  bwrap (bubblewrap) needs user
    #   namespaces even when WEBKIT_FORCE_SANDBOX=0 is set, because bwrap runs before
    #   WebKitGTK can bypass it.  Relaxing this sysctl restores the namespace permission.
    #   (sudo is available passwordless on all GitHub Actions Linux runners.)
    sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 2>/dev/null || true
    GDK_BACKEND=x11 \
    WEBKIT_FORCE_SANDBOX=0 \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    NO_AT_BRIDGE=1 \
    RUST_LOG=error \
    xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" \
        cargo run --example e2e_harness 2>&1 | tee "$RUST_OUT_E2E"
elif [ "$(uname)" == "Darwin" ]; then
    # macOS CI fix: wrap the binary in a minimal .app bundle so WKWebView works.
    #
    # On macOS 14+ (Sonoma/Sequoia), WKWebView spawns its renderer in the separate
    # XPC service com.apple.WebKit.WebContent.  The OS requires the HOST APP to have
    # a valid .app bundle with a CFBundleIdentifier in Info.plist before the XPC
    # service is permitted to start.  A bare cargo debug binary has no bundle context,
    # so the XPC service is terminated immediately → "web content process terminated"
    # fires in every scenario → the frontend JS never runs → e2e_startup_ok.txt is
    # never written → 15 s timeout.
    #
    # Fix: copy the instrumented binary into a minimal .app bundle structure that
    # carries the same CFBundleIdentifier as tauri.conf.json, ad-hoc sign the whole
    # bundle, then set LATTICE_E2E_BIN so the harness's lattice_bin() picks up the
    # bundled binary instead of the bare one in target/.
    #
    # NOTE: $_LLVM_BIN / $_DBG_BIN were set by the 1c-locate step above.
    echo "  [1c-bundle] Creating minimal .app bundle for macOS WKWebView XPC..."
    _E2E_APP="/tmp/LatticeE2E.app"
    rm -rf "$_E2E_APP"
    mkdir -p "$_E2E_APP/Contents/MacOS"

    # Pick the coverage-instrumented binary (CI path first, warm-cache fallback).
    if [ -f "$_LLVM_BIN" ]; then
        _BUNDLE_SRC="$_LLVM_BIN"
    else
        _BUNDLE_SRC="$_DBG_BIN"
    fi
    cp "$_BUNDLE_SRC" "$_E2E_APP/Contents/MacOS/lattice"
    echo "  [1c-bundle]   binary source : $_BUNDLE_SRC"

    # Info.plist — CFBundleIdentifier MUST match tauri.conf.json "identifier" field
    # so that Tauri's internal bundle-ID checks (used by some plugin APIs) don't fail.
    cat > "$_E2E_APP/Contents/Info.plist" << 'EOPLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>lattice</string>
  <key>CFBundleIdentifier</key><string>com.blessia-blessini.lattice-app</string>
  <key>CFBundleName</key><string>Lattice</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
EOPLIST

    # Ad-hoc sign the entire bundle (--deep signs the nested binary too).
    # No Hardened Runtime needed — ad-hoc signing alone satisfies the XPC policy.
    codesign --sign - --force --deep "$_E2E_APP" \
        && echo "  [1c-bundle]   bundle signed : $_E2E_APP" \
        || echo "  [1c-bundle]   WARN: codesign failed (non-fatal on older macOS)"

    # Point the harness at the bundled binary via env var.
    # The harness keeps .current_dir(root) so CWD stays the repo root —
    # e2e_startup_ok.txt is still written to the expected location.
    export LATTICE_E2E_BIN="$_E2E_APP/Contents/MacOS/lattice"
    echo "  [1c-bundle]   LATTICE_E2E_BIN=$LATTICE_E2E_BIN"

    cargo run --example e2e_harness 2>&1 | tee "$RUST_OUT_E2E"
else
    cargo run --example e2e_harness 2>&1 | tee "$RUST_OUT_E2E"
fi
E2E_RESULT=${PIPESTATUS[0]}
popd || exit

if [ $E2E_RESULT -ne 0 ]; then
    echo "E2E Desktop Harness failed!"
    exit $E2E_RESULT
fi
else
    echo "Skipping E2E Desktop Harness — runs on Windows only (see scripts/build-test.sh)."
fi

pushd src-tauri || exit
  echo "****************************************************"
  echo "Gather and print all data in an output table ..."
  echo "Print on console this is done later once again after"
  echo " HTML report generation as a summary"
  # main.rs is a 3-line entry-point shim; platform/mod.rs is a Tauri forwarding
  # shim — both require a live Tauri runtime and cannot be unit-tested.
  IGNORE="main\.rs|platform.mod\.rs"
  cargo llvm-cov report --ignore-filename-regex "$IGNORE" 2>&1 | tee "$RUST_OUT_COV"
  echo "****************************************************"
popd || exit

# Write Rust test results to the GitHub Actions job summary.
# GITHUB_STEP_SUMMARY is only set inside GitHub Actions; this block
# is a no-op when build-test.sh is run locally.
if [ -n "${GITHUB_STEP_SUMMARY}" ]; then
  echo "## Rust Backend Tests" >> "$GITHUB_STEP_SUMMARY"
  echo "| Suite | Result |" >> "$GITHUB_STEP_SUMMARY"
  echo "|:------|:-------|" >> "$GITHUB_STEP_SUMMARY"
  for entry in \
      "test|Unit (lib)|$RUST_OUT_UNIT" \
      "test|Integration — wiring|$RUST_OUT_WIRING" \
      "test|Integration — file_open|$RUST_OUT_FILEOPEN" \
      "bin|E2E — conflict reproducer|$RUST_OUT_E2E"; do
    kind="${entry%%|*}";  rest="${entry#*|}"
    label="${rest%%|*}";  file="${rest##*|}"
    if [ "$kind" = "test" ]; then
      # Cargo test binaries print "test result: ok. N passed; ..." at the end
      result_line=$(grep -m1 "^test result:" "$file" 2>/dev/null || echo "test result: (no output)")
    else
      # The E2E example is a plain binary; it prints "[TEST RESULT] PASSED/FAILED"
      result_line=$(grep -m1 "^\[TEST RESULT\]" "$file" 2>/dev/null || echo "[TEST RESULT] (no output)")
    fi
    echo "| $label | \`$result_line\` |" >> "$GITHUB_STEP_SUMMARY"
  done
  echo "" >> "$GITHUB_STEP_SUMMARY"
  echo "### Coverage Table (Rust)" >> "$GITHUB_STEP_SUMMARY"
  echo '```' >> "$GITHUB_STEP_SUMMARY"
  cat "$RUST_OUT_COV" >> "$GITHUB_STEP_SUMMARY"
  echo '```' >> "$GITHUB_STEP_SUMMARY"
fi

rm -f "$RUST_OUT_UNIT" "$RUST_OUT_WIRING" "$RUST_OUT_FILEOPEN" "$RUST_OUT_E2E" "$RUST_OUT_COV"

# 2. Run Frontend Tests Run Later with Coverage
# echo "Running Frontend Tests..."
# npm run test:run

# 2b. Run Frontend Coverage
# runs in project root
echo "Running Frontend Coverage..."
# vitest discovers all *.test.{ts,tsx} files automatically.
# This includes both App.test.tsx and App.link-routing.test.tsx
# (the link-routing suite was split to allow sandbox isolation runs).
# pool=forks (prevents caching while keeping the coverage results merged)
# now lives in vite.config.ts -> test.pool. Passing it as `-- --pool=forks`
# made npm >= 11.2 warn "Unknown cli config".
npm run test:coverage
FRONTEND_RESULT=$?

if [ $FRONTEND_RESULT -ne 0 ]; then
    echo "Frontend tests failed!"
    exit $FRONTEND_RESULT
fi

# 3. Linter
pushd src-tauri || exit
  echo "Running 2nd Linter..."
  cargo clippy -- -D warnings
popd || exit

# 4. Generate combined coverage report from the accumulated data.
#    Neither call re-runs any tests — they only read the profraw files
#    written by steps 1, 1b, and 1c.
echo "Running combined html coverage report..."
pushd src-tauri || exit
  cargo llvm-cov report --html --ignore-filename-regex "$IGNORE"
  cargo llvm-cov report --ignore-filename-regex "$IGNORE"
  # print out the llvm-cov version
  cargo llvm-cov --version
popd || exit
