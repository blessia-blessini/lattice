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

cargo llvm-cov clean

# 1a. Run Backend Unit Tests (Rust)
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

# 1b. Run Integration Tests (Rust) — settings wiring
# --no-report keeps accumulating into the same coverage data set.
# Tests run exactly once; no duplication with the unit-test run above.
echo "Running Integration Tests (wiring)..."
pushd src-tauri || exit
cargo llvm-cov --no-report --test wiring
INTEGRATION_RESULT=$?
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
cargo llvm-cov --no-report --test file_open_tests
FILE_OPEN_RESULT=$?
popd || exit

if [ $FILE_OPEN_RESULT -ne 0 ]; then
    echo "Integration tests (file_open_tests) failed!"
    exit $FILE_OPEN_RESULT
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
       RUSTFLAGS="--cfg integration_test" xvfb-run --auto-servernum cargo llvm-cov --no-report --example reproduce_conflict
   else
       RUSTFLAGS="--cfg integration_test" cargo llvm-cov --no-report --example reproduce_conflict
   fi
   # source ./scripts/Test-Conflict.sh
   E2E_RESULT=$?
popd  || exit

if [ $E2E_RESULT -ne 0 ]; then
  echo "E2E Conflict Reproducer failed!"
  exit $E2E_RESULT
fi

pushd src-tauri || exit
  echo "****************************************************"
  echo "Gather and print all data in an output table ..."
  echo "Print on console this is done later once again after"
  echo " HTML report generation as a summary"
  cargo llvm-cov report
  echo "****************************************************"
popd || exit

# 2. Run Frontend Tests Run Later with Coverage
# echo "Running Frontend Tests..."
# npm run test:run

# 2b. Run Frontend Coverage
# runs in project root
echo "Running Frontend Coverage..."
# param pool=forks prevents caching while keeping the
#   coverage results merged
npm run test:coverage -- --pool=forks
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
  cargo llvm-cov report --html        # HTML file in target/llvm-cov/html/
  cargo llvm-cov report               # Text summary table printed to console
  # print out the llvm-cov version
  cargo llvm-cov --version
popd || exit
