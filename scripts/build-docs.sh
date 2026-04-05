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
export DEFAULT_BUILD_NO="LocalDocs"
export SCRIPT_NAME="build-docs.sh"
source ./scripts/_pre-build.sh

# Ensure docs/gen exists and is clean
rm -rf docs/gen
mkdir -p docs/gen

# 1. Frontend Docs
echo "Generating Frontend Docs..."
npm run doc

# 2. Backend Docs
echo "Generating Backend Docs..."
pushd src-tauri || exit
    cargo doc --no-deps
popd || exit

# Move backend docs
mkdir -p docs/gen
if [ -d "src-tauri/target/doc" ]; then
    mv src-tauri/target/doc docs/gen/backend
else
    echo "Error: Backend docs not found in src-tauri/target/doc"
fi

echo "Documentation generated in docs/gen"
