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


# 1. Run Backend Unit Tests (Rust)
# --no-report accumulates coverage data without generating a report yet,
# so it can be merged with the integration-test run below into one table.
echo "Running Backend Unit Tests..."
pushd src-tauri || exit
cargo llvm-cov --no-report --lib
CARGO_RESULT=$?
popd || exit

if [ $CARGO_RESULT -ne 0 ]; then
    echo "Backend unit tests failed!"
    exit $CARGO_RESULT
fi

# 1b. Run Integration Tests (Rust)
# --no-report keeps accumulating into the same coverage data set.
# Tests run exactly once; no duplication with the unit-test run above.
echo "Running Integration Tests..."
pushd src-tauri || exit
cargo llvm-cov --no-report --test wiring
INTEGRATION_RESULT=$?
popd || exit

if [ $INTEGRATION_RESULT -ne 0 ]; then
    echo "Integration tests failed!"
    exit $INTEGRATION_RESULT
fi

# 1c. Run E2E / Conflict Reproducer (Rust example)
# The example spawns the full Lattice app as a child process.
# When CARGO_LLVM_COV is set, reproduce_conflict.rs forwards
# -C instrument-coverage via RUSTFLAGS to the child compilation so
# the child's profraw data is written to the same directory and merged
# into the combined HTML report in step 4.
echo "Running E2E Conflict Reproducer..."
pushd src-tauri || exit
if [ "$(uname)" == "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run --auto-servernum cargo llvm-cov --no-report --example reproduce_conflict
else
    cargo llvm-cov --no-report --example reproduce_conflict
fi
E2E_RESULT=$?
popd || exit

if [ $E2E_RESULT -ne 0 ]; then
    echo "E2E Conflict Reproducer failed!"
    exit $E2E_RESULT
fi

echo "Gather and print all data in an output table ..."
cargo llvm-cov report

# 2. Run Frontend Tests
# echo "Running Frontend Tests..."
# npm run test:run

# 2b. Run Frontend Coverage
echo "Running Frontend Coverage... --> in folder coverage"
npm run test:coverage --html

# 3. Rust Analysis & Coverage
echo "Running Rust Analysis & Coverage..."
pushd src-tauri || exit

echo "Running 2nd Linter (Clippy)..."
cargo clippy -- -D warnings

cargo install cargo-llvm-cov
rustup component add llvm-tools-preview

if cargo llvm-cov --version >/dev/null 2>&1; then
    echo "cargo-llvm-cov found. Generating combined html coverage report..."
    cargo llvm-cov --version
    # Neither call re-runs any tests — they only read the profraw files
    # written by steps 1, 1b, and 1c.
    cargo llvm-cov report --html        # HTML file in target/llvm-cov/html/
    cargo llvm-cov report               # Text summary table printed to console
else
    echo "WARNING: cargo-llvm-cov not found. Skipping Rust coverage generation."
    echo "To enable coverage on Linux, install: cargo install cargo-llvm-cov"
    echo "                                    rustup component add llvm-tools-preview"
fi

popd || exit
