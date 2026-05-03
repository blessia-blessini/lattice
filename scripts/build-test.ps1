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
try {


    # Run the Reproduction Tool
    Write-Output "Running Conflict Reproducer..."
    ./scripts/Test-Conflict.ps1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Conflict Reproduction failed OR caused failure!"
        exit $LASTEXITCODE
    }


    # call the preambule script
    . "$PSScriptRoot\_pre-build.ps1" -DefaultBuildNo "TESTVERSION" -ScriptName "build-test.ps1"
    # 1. Run Backend Tests (Rust)

    Write-Output "Running Backend Tests..."
    Push-Location src-tauri
    if ($LASTEXITCODE -eq 0) {
        cargo llvm-cov # cargo test
        $cargoResult = $LASTEXITCODE
    }

    if ($cargoResult -ne 0) {
        Write-Output "Backend tests failed!"
        exit $cargoResult
    }

    # 2. Run Frontend Tests Run Later with Coverage
    # Write-Output "Running Frontend Tests..."
    # npm run test:run

    # 2b. Run Frontend Coverage
    Write-Output "Running Frontend Coverage..."
    npm run test:coverage

    # 3 check version of cargo-llvm-cov
    cargo llvm-cov --version
    Write-Output "Running 2nd Linter..."
    cargo clippy -- -D warnings

    # Write-Output "Running text cover ..."
    # cargo llvm-cov --text
    Write-Output "Running html cover ..."
    cargo llvm-cov --html
    # Write-Output "Running summary cover ..."
    # cargo llvm-cov --summary-only

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
