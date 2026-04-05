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
################################################################################
# _pre-build.sh
# Expected variables from caller:
#   DEFAULT_BUILD_NO - Default value if generator fails
#   SCRIPT_NAME      - Name of the calling script

# CHECK IF i AM IN THE ROOT FOLDER BY CHECKING IF THERE IS A FOLDER CALLED "src-tauri" AND 
# subfolder "scripts"
if [[ ! -d "src-tauri" || ! -d "scripts" ]]; then
    echo "Please navigate to the root folder OF THE PROJECT and try again."
    echo "Current directory: $(pwd)"
    echo "THE COMMAND FROM THE PROJECT ROOT IS:"
    echo "  ./scripts/$SCRIPT_NAME"
    echo "Execution aborted: Incorrect directory."
    exit 1
fi

# Set LATTICEBUILD_NO if not set
GEN_PATH="./buildno-gen"
# On Windows/Git Bash, it might be buildno-gen.exe
if [ ! -f "$GEN_PATH" ]; then
    GEN_PATH="./buildno-gen.exe"
fi

if [ -f "$GEN_PATH" ]; then
    # Capture output, trim whitespace
    GEN_OUTPUT=$("$GEN_PATH" 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$GEN_OUTPUT" ]; then
        export LATTICEBUILD_NO="${GEN_OUTPUT}-${SCRIPT_NAME}"
        echo "LATTICEBUILD_NO generated: $LATTICEBUILD_NO"
    else
            echo "Warning SH: Failed to execute buildno-gen or empty output."
            export LATTICEBUILD_NO="$DEFAULT_BUILD_NO"
    fi
else
    echo "Warning SH: LATTICEBUILD_NO not set and generator not found. Defaulting to '$DEFAULT_BUILD_NO'."
    export LATTICEBUILD_NO="$DEFAULT_BUILD_NO"
fi