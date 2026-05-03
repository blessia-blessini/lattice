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


# 1. Run Backend Tests (Rust)
echo "Running Backend Tests..."
pushd src-tauri || exit
cargo llvm-cov --html # cargo test
CARGO_RESULT=$?
popd || exit

if [ $CARGO_RESULT -ne 0 ]; then
    echo "Backend tests failed!"
    exit $CARGO_RESULT
fi

# 2. Run Frontend Tests
# echo "Running Frontend Tests..."
# npm run test:run

# 2b. Run Frontend Coverage
echo "Running Frontend Coverage... --> in folder coverage"
npm run test:coverage --html


if [ "$(uname)" == "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
    echo "Running Conflict Test with xvfb-run..."
    xvfb-run --auto-servernum ./scripts/Test-Conflict.sh
else
    source ./scripts/Test-Conflict.sh
fi

if [ $? -ne 0 ]; then
    echo "Conflict Reproduction failed!"
    exit 1
fi

# 3. Rust Analysis & Coverage
echo "Running Rust Analysis & Coverage..."
pushd src-tauri || exit

echo "Running 2nd Linter (Clippy)..."
cargo clippy -- -D warnings

cargo install cargo-llvm-cov
rustup component add llvm-tools-preview

if cargo llvm-cov --version >/dev/null 2>&1; then
    echo "cargo-llvm-cov found. Running coverage..."
    cargo llvm-cov --version
    # cargo llvm-cov --text
    echo "Running html cover..."
    cargo llvm-cov --html
    # cargo llvm-cov --summary-only
else
    echo "WARNING: cargo-llvm-cov not found. Skipping Rust coverage generation."
    echo "To enable coverage on Linux, install: cargo install cargo-llvm-cov"
    echo "                                    rustup component add llvm-tools-preview"
fi

popd || exit
