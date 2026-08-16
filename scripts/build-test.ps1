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
param([switch]$Fast)

# Pre-build checks and setup
$oldEnv = $env:LATTICEBUILD_NO

# Capture starting directory once so the finally block can always return
# here — even if nested Push/Pop calls are misaligned by a failure or Ctrl-C.
$startDir = Get-Location

Push-Location src-tauri
try {
  cargo llvm-cov clean
} finally {
    Set-Location $startDir
}

try {

    # call the preambule script
    . "$PSScriptRoot\_pre-build.ps1" -DefaultBuildNo "TESTVERSION" -ScriptName "build-test.ps1"

    #**************************************************************
    # Invoke-FastTests
    #**************************************************************
    # FAST mode: test only the crates touched by *uncommitted* changes
    # (working tree vs HEAD + untracked files), skipping coverage,
    # integration, E2E and the HTML report. Meant for the inner dev loop;
    # the full (no -Fast) run remains the gate required for "Done".
    # See code-prompt-DoD.md / DRY-and-Variants.md.
    if ($Fast) {
        Write-Output "FAST mode: testing only crates with uncommitted changes..."

        $changed = @()
        $changed += git diff --name-only HEAD
        $changed += git ls-files --others --exclude-standard
        $changed = $changed | Where-Object { $_ } | Sort-Object -Unique
        if (-not $changed) { Write-Output "No uncommitted changes. Nothing to test."; exit 0 }

        # Map each changed *.rs file to its owning crate (nearest Cargo.toml with a name).
        $pkgs = @()
        foreach ($f in $changed) {
            if ($f -notmatch '\.rs$') { continue }
            $dir = Split-Path -Parent $f
            while ($dir -and (Test-Path $dir)) {
                $manifest = Join-Path $dir 'Cargo.toml'
                if (Test-Path $manifest) {
                    $m = Select-String -Path $manifest -Pattern '^\s*name\s*=\s*"([^"]+)"' | Select-Object -First 1
                    if ($m) { $pkgs += $m.Matches.Groups[1].Value; break }
                }
                $parent = Split-Path -Parent $dir
                if (-not $parent -or $parent -eq $dir) { break }
                $dir = $parent
            }
        }
        $pkgs = $pkgs | Sort-Object -Unique

        $failed = 0
        if ($pkgs) {
            $pkgArgs = @(); foreach ($p in $pkgs) { $pkgArgs += '-p'; $pkgArgs += $p }
            Write-Output "Rust crates: $($pkgs -join ', ')"
            Push-Location src-tauri
            try {
                cargo test --lib @pkgArgs
                if ($LASTEXITCODE -ne 0) { $failed = 1 }
                if ($failed -eq 0) {
                    cargo clippy @pkgArgs -- -D warnings
                    if ($LASTEXITCODE -ne 0) { $failed = 1 }
                }
            } finally { Pop-Location }
        } else {
            Write-Output "No Rust crate changes detected."
        }

        # Frontend: run only the vitest suites related to changed .ts/.tsx files.
        $fe = $changed | Where-Object { $_ -match '\.(ts|tsx)$' }
        if ($fe -and $failed -eq 0) {
            Write-Output "Frontend: vitest related ($($fe.Count) changed file(s))"
            # vite.config.ts requires LATTICEBUILD_NO to be set (it throws otherwise).
            # Now covered by the preamble sourced once above (line 40), which runs
            # before this Fast branch — no need to source it again here.
            npx vitest related @fe --run
            if ($LASTEXITCODE -ne 0) { $failed = 1 }
        }

        if ($failed -ne 0) { Write-Output "FAST tests FAILED."; exit 1 }
        Write-Output "FAST tests passed."
        exit 0
    }
    # Invoke-FastTests END *****************************************

    # 1a. Run Backend Unit Tests (Rust)
    # --no-report accumulates coverage data without generating a report yet,
    # so it can be merged with the integration-test run below into one table.
    Write-Output "Running Backend Unit Tests..."
    # Thus Pushlocation is already in a try so reverting back is already guaranteer
    Push-Location src-tauri
    cargo llvm-cov --no-report --lib
    $cargoResult = $LASTEXITCODE

    if ($cargoResult -ne 0) {
        Write-Output "Backend unit tests failed!"
        exit $cargoResult
    }

    # 1b. Run Integration Tests (Rust) — settings wiring
    # --no-report keeps accumulating into the same coverage data set.
    # Tests run exactly once; no duplication with the unit-test run above.
    Write-Output "Running Integration Tests (wiring)..."
    cargo llvm-cov --no-report --test wiring
    if ($LASTEXITCODE -ne 0) {
        Write-Output "Integration tests (wiring) failed!"
        exit $LASTEXITCODE
    }

    # 1b2. Run Integration Tests (Rust) — file-open / file-association
    # Verifies Direct Push content loading works on all 3 desktop platforms.
    # macOS-specific URL conversion tests are gated by #[cfg(target_os = "macos")].
    Write-Output "Running Integration Tests (file_open_tests)..."
    cargo llvm-cov --no-report --test file_open_tests
    if ($LASTEXITCODE -ne 0) {
        Write-Output "Integration tests (file_open_tests) failed!"
        exit $LASTEXITCODE
    }

    # 1c. E2E Desktop Harness
    # Step 1: build the instrumented Lattice binary (frontend must already be built).
    # Step 2: run the e2e_harness example which launches the binary for each scenario.
    #
    # The binary is compiled with --features e2e_test; build.rs emits
    # cargo:rustc-cfg=e2e_test so is_e2e_tst_build() returns true,
    # enabling the shutdown signal listener and E2E hooks.
    # The harness sets LLVM_PROFILE_FILE per scenario; profraw data lands in the
    # coverage directory and is merged into the HTML report in step 4.
    Write-Output "****************************************************"
    Write-Output "Running E2E Desktop Harness..."
    # Save ALL env vars that cargo-llvm-cov show-env may have set in a
    # previous run — a bad value in any of these poisons later steps.
    $e2eSaved = @{
        RUSTFLAGS              = $env:RUSTFLAGS
        RUSTC_WRAPPER          = $env:RUSTC_WRAPPER
        LLVM_PROFILE_FILE      = $env:LLVM_PROFILE_FILE
        CARGO_LLVM_COV         = $env:CARGO_LLVM_COV
        CARGO_LLVM_COV_TARGET_DIR = $env:CARGO_LLVM_COV_TARGET_DIR
        # tauri-build reads TAURI_DEV_SERVER_URL at *build time* and bakes it as a
        # compile-time constant.  If set (e.g. from a previous `tauri dev` session),
        # the E2E binary always tries localhost instead of its embedded dist/ assets.
        TAURI_DEV_SERVER_URL   = $env:TAURI_DEV_SERVER_URL
    }
    try {
        Write-Output "  [1c-build] Building instrumented Lattice binary..."
        # Avoid show-env: on Windows it emits single-quoted paths that cargo
        # cannot parse (os error 123).  Clear all llvm-cov env vars first,
        # then set only what we need directly.
        foreach ($k in $e2eSaved.Keys) {
            Remove-Item "Env:$k" -ErrorAction SilentlyContinue
        }
        # build:e2e_test uses vite.e2e_test.config.ts which calls makeViteConfig(true),
        # baking IS_E2E_TST_BUILD=true into the bundle — the TS equivalent of --cfg e2e_test.
        Write-Output "  [1c-frontend] Building frontend assets (npm run build:e2e_test)..."
        Push-Location ..
        npm run build:e2e_test
        $npmResult = $LASTEXITCODE
        Pop-Location
        if ($npmResult -ne 0) {
            Write-Output "Frontend build failed!"
            exit $npmResult
        }

        $coverageDir = "$(Get-Location)\target\llvm-cov"

        # Step A: Register the lattice binary with cargo-llvm-cov so it appears as a
        # source-mapping object in `cargo llvm-cov report` (needed for cli_desktop.rs,
        # e2e.rs etc. which are only compiled with --features e2e_test).
        # The binary checks for `e2e_register_only.txt` at startup and exits before
        # Tauri ever starts — so this step completes in <1 s instead of ~15 s.
        Write-Output "  [1c-register] Registering lattice binary with cargo-llvm-cov..."
        "register" | Set-Content -NoNewline e2e_register_only.txt
        cargo llvm-cov --no-report run --bin lattice --features e2e_test
        Remove-Item -Force e2e_register_only.txt -ErrorAction SilentlyContinue
        if ($LASTEXITCODE -ne 0) {
            Write-Output "E2E binary registration failed!"
            exit $LASTEXITCODE
        }

        # Step B: Locate the binary that cargo-llvm-cov just built and ensure it exists at
        # target\debug\lattice.exe (the fallback path that lattice_bin() uses in the harness).
        # cargo-llvm-cov's binary output location varies by version and host config:
        #   - target\llvm-cov\debug\lattice.exe  (clean CI — cargo-llvm-cov sets CARGO_TARGET_DIR)
        #   - target\debug\lattice.exe           (warm-cache — binary already present)
        Write-Output "  [1c-locate] Locating E2E binary (cargo-llvm-cov output dir varies by platform)..."
        $llvmBin  = "target\llvm-cov\debug\lattice.exe"
        $debugBin = "target\debug\lattice.exe"
        if (Test-Path $llvmBin) {
            $foundBin = $llvmBin
        } elseif (Test-Path $debugBin) {
            $foundBin = $debugBin
        } else {
            # Unexpected layout — search the whole target tree
            $foundBin = Get-ChildItem -Path "target" -Recurse -Filter "lattice.exe" `
                | Where-Object { $_.FullName -notmatch "\\examples\\" } `
                | Select-Object -First 1 -ExpandProperty FullName
        }
        if (-not $foundBin) {
            Write-Output "ERROR: E2E binary not found anywhere in target\ after Step A!"
            Get-ChildItem -Path "target" -Recurse -Filter "lattice*" -ErrorAction SilentlyContinue `
                | Select-Object -First 20 | ForEach-Object { Write-Output $_.FullName }
            exit 1
        }
        Write-Output "  [1c-locate] Found: $foundBin"
        if ($foundBin -ne $debugBin) {
            $null = New-Item -ItemType Directory -Force -Path "target\debug"
            Copy-Item -Force $foundBin $debugBin
            Write-Output "  [1c-locate] Copied to: $debugBin"
        }

        # Set LLVM_PROFILE_FILE so each lattice subprocess launched by the harness writes
        # its own e2e_{PID}.profraw into the llvm-cov directory for the report step.
        $env:LLVM_PROFILE_FILE = "$coverageDir\e2e_%p.profraw"

        Write-Output "  [1c-run] Running E2E harness scenarios..."
        cargo run --example e2e_harness
        if ($LASTEXITCODE -ne 0) {
            Write-Output "E2E Desktop Harness failed!"
            exit $LASTEXITCODE
        }
    }
    finally {
        # Restore all saved env vars (null = was unset → remove).
        foreach ($k in $e2eSaved.Keys) {
            if ($null -ne $e2eSaved[$k]) {
                [System.Environment]::SetEnvironmentVariable($k, $e2eSaved[$k], 'Process')
            } else {
                Remove-Item "Env:$k" -ErrorAction SilentlyContinue
            }
        }
        # Clean up any lingering lattice processes (safety net only —
        # the harness sends e2e_shutdown.txt for a clean exit first).
        Stop-Process -Name "lattice" -ErrorAction SilentlyContinue -Force
    }
    Write-Output "****************************************************"

    Write-Output "****************************************************"
    Write-Output "Gather and print all data in an output table ..."
    Write-Output "Print on console this is done later once again after"
    Write-Output " HTML report generation as a summary"
    # main.rs is a 3-line entry-point shim that calls lattice_lib::run() — it can
    # only be exercised by running the full binary, never by unit/integration tests.
    # platform/mod.rs is a Tauri forwarding shim (PlatformImpl calls require a
    # live Tauri App instance). Both are excluded so they don't drag down the total.
    $IGNORE = "main\.rs|platform.mod\.rs"
    cargo llvm-cov report --ignore-filename-regex $IGNORE
    Write-Output "****************************************************"

    # 2. Run Frontend Tests Run Later with Coverage
    # Write-Output "Running Frontend Tests..."
    # npm run test:run

    # 2b. Run Frontend Coverage
    Write-Output "Running Frontend Coverage..."
    # reverse push/pop Location
    Push-Location ..
    try {
        # vitest discovers all *.test.{ts,tsx} files automatically.
        # This includes both App.test.tsx and App.link-routing.test.tsx
        # (the link-routing suite was split to allow sandbox isolation runs).
        # vitest discovers all *.test.{ts,tsx} files automatically.
        # This includes both App.test.tsx and App.link-routing.test.tsx
        # (the link-routing suite was split to allow sandbox isolation runs).
        # pool=forks (prevents caching while keeping the coverage results
        # merged) now lives in vite.config.ts -> test.pool. Passing it as
        # `-- --pool=forks` made npm >= 11.2 warn "Unknown cli config".
        npm run test:coverage
        $frontendResult = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($frontendResult -ne 0) {
        Write-Output "Frontend tests failed!"
        exit $frontendResult
    }

    # 3. Linter
    Write-Output "Running 2nd Linter..."
    cargo clippy -- -D warnings

    # 4. Generate combined coverage report from the accumulated data.
    #    Neither call re-runs any tests — they only read the profraw files
    #    written by steps 1, 1b, 1c, and 1d.
    Write-Output "Running combined html coverage report..."
    cargo llvm-cov report --html --ignore-filename-regex $IGNORE
    cargo llvm-cov report --ignore-filename-regex $IGNORE
    # print out the llvm-cov version
    cargo llvm-cov --version

}
finally {
    Write-Output "Restoring working directory ..."
    Set-Location $startDir

    # restore the old environment variable -- it will work even for "no vallue"
    if ($oldEnv) {
        $env:LATTICEBUILD_NO = $oldEnv
        Write-Output "Restored LATTICEBUILD_NO to $env:LATTICEBUILD_NO"
    }
    else {
        if (Test-Path Env:LATTICEBUILD_NO) {
            Remove-Item Env:LATTICEBUILD_NO
            Write-Output "LATTICEBUILD_NO unset as before running the script."
        }
    }

}
