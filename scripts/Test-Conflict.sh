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
# scripts/Test-Conflict.sh
# Bash version of Test-Conflict.ps1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT" || exit 1

echo -e "\033[0;36m------------------------------------------------------------------\033[0m"
echo -e "\033[0;36m  Lattice Conflict Reproduction Test\033[0m"
echo -e "\033[0;36m------------------------------------------------------------------\033[0m"

# Run the Reproduction Tool
echo -e "\033[0;33mLaunching Conflict Reproducer...\033[0m"
cargo run --example reproduce_conflict --manifest-path src-tauri/Cargo.toml

EXIT_CODE=$?

echo -e "\033[0;33mCleaning up processes...\033[0m"
# Cleanup lingering processes if any (equivalent to taskkill logic)
# We don't want to kill ALL 'node', just ours ideally, but for tests:
pkill -f "lattice" 2>/dev/null
pkill -f "node" 2>/dev/null 

# Note: On macOS/Linux, the Rust 'reproduce_conflict' tool should handle its child.
# But pkill is a good safety net.

echo -e "\033[0;36mDone.\033[0m"

exit $EXIT_CODE

