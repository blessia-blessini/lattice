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

# 1c. Run E2E / Conflict Reproducer (Rust example)
# The example spawns the full Lattice app as a child process.
# When CARGO_LLVM_COV is set, reproduce_conflict.rs forwards
# -C instrument-coverage via RUSTFLAGS to the child compilation so
# the child's profraw data is written to the same directory and merged
# into the combined HTML report in step 4.
echo "*** skipping Running E2E Conflict Reproducer..."
# pushd src-tauri || exit
   # Use 'cargo llvm-cov run' (not the default test-harness mode) so that
   # main() is actually called. Without 'run', cargo routes --example through
   # the test harness, finds 0 #[test] functions, and exits in 0.00s without
   # ever executing the binary.
#   if [ "$(uname)" == "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
#       RUSTFLAGS="--cfg integration_test" xvfb-run --auto-servernum cargo llvm-cov run --no-report --example reproduce_conflict 2>&1 | tee "$RUST_OUT_E2E"
#   else
#       RUSTFLAGS="--cfg integration_test" cargo llvm-cov run --no-report --example reproduce_conflict 2>&1 | tee "$RUST_OUT_E2E"
#   fi
   # source ./scripts/Test-Conflict.sh
#   E2E_RESULT=${PIPESTATUS[0]}
# popd  || exit

if [ $E2E_RESULT -ne 0 ]; then
  echo "E2E Conflict Reproducer failed!"
  exit $E2E_RESULT
fi

pushd src-tauri || exit
  echo "****************************************************"
  echo "Gather and print all data in an output table ..."
  echo "Print on console this is done later once again after"
  echo " HTML report generation as a summary"
  cargo llvm-cov report 2>&1 | tee "$RUST_OUT_COV"
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
