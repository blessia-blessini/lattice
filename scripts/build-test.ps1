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
$oldEnv = $env:LATTICEBUILD_NO

Push-Location src-tauri
try {
  cargo llvm-cov clean
} finally {
    Pop-Location
}

try {

    # call the preambule script
    . "$PSScriptRoot\_pre-build.ps1" -DefaultBuildNo "TESTVERSION" -ScriptName "build-test.ps1"

    # 1a. Run Backend Unit Tests (Rust)
    # --no-report accumulates coverage data without generating a report yet,
    # so it can be merged with the integration-test run below into one table.
    Write-Output "Running Backend Unit Tests..."
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

    # 1c. Run E2E / Conflict Reproducer (Rust example)
    # The example spawns the full Lattice app as a child process.
    # When CARGO_LLVM_COV is set, reproduce_conflict.rs forwards
    # -C instrument-coverage via RUSTFLAGS to the child compilation so
    # the child's profraw data is written to the same directory and merged
    # into the combined HTML report in step 4.
    Write-Output "****************************************************"
    Write-Output "Running E2E Conflict Reproducer..."
    $savedRustFlags = $env:RUSTFLAGS
    Push-Location ..
    try {
        # if rustflags do not contain "--cfg integration_test" then add it
        if ($env:RUSTFLAGS -notlike "*integration_test*" ) {
            $env:RUSTFLAGS += " --cfg integration_test"
        }
        #cargo llvm-cov --no-report --example reproduce_conflict
        & cargo run --example reproduce_conflict --manifest-path src-tauri/Cargo.toml
        $exittodeX = $LASTEXITCODE
        Start-Sleep -s 5
        Write-Host "*** Cleaning up processes..." -ForegroundColor Yellow
        # Force kill potential lingering processes
        Stop-Process -Name "lattice" -ErrorAction SilentlyContinue -Force
        Stop-Process -Name "node" -ErrorAction SilentlyContinue -Force
        if ($exittodeX -ne 0) {
            Write-Output "*** E2E Conflict Reproducer failed!"
            exit $exittodeX
        }
        # exit 2
    }
    finally {
        Pop-Location
        $env:RUSTFLAGS = $savedRustFlags
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
        # param pool=forks prevents caching while keeping the
        #   coverage results merged
        npm run test:coverage -- --pool=forks
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
    #    written by steps 1, 1b, and 1c.
    Write-Output "Running combined html coverage report..."
    cargo llvm-cov report --html --ignore-filename-regex $IGNORE
    cargo llvm-cov report --ignore-filename-regex $IGNORE
    # print out the llvm-cov version
    cargo llvm-cov --version

}
finally {
    Write-Output "Restoring working directory ..."
    Pop-Location

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
