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
    # Pre-build checks and setup
    . "$PSScriptRoot\_pre-build.ps1" -DefaultBuildNo "LocalDocs" -ScriptName "build-docs.ps1"

    # Ensure docs/gen exists and is clean
    $docsGenPath = "docs/gen"
    if (Test-Path $docsGenPath) {
        Remove-Item -Path $docsGenPath -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $docsGenPath | Out-Null

    # 1. Frontend Docs
    echo "Generating Frontend Docs..."
    npm run doc
    # Expect output in docs/gen/frontend (configured in typedoc or mv needed? workflow says npm run doc puts it there?)
    # Workflow says: npm run doc -> then workflow uploads docs/gen.
    # Wait, let's double check buildAndTest.yml logic.
    # It says: npm run doc (step 380)
    # And then: mv src-tauri/target/doc docs/gen/backend
    # Implication: npm run doc MUST output to docs/gen/frontend ALREADY.
    # If not, this script might need adjustment, but mirroring workflow:

    # 2. Backend Docs
    echo "Generating Backend Docs..."
    Push-Location src-tauri
    # cargo doc outputs to target/doc
    cargo doc --no-deps
    Pop-Location

    # Move backend docs
    $backendTarget = "$docsGenPath/backend"
    if (Test-Path "src-tauri/target/doc") {
        Move-Item -Path "src-tauri/target/doc" -Destination $backendTarget -Force
    }
    else {
        echo "Error: Backend docs not found in src-tauri/target/doc"
    }

    echo "Documentation generated in docs/gen"

}
finally {
    # restore the old environment variable -- it will work even for "no vallue"
    if ($oldEnv) {
        $env:LATTICEBUILD_NO = $oldEnv
        Write-Output "Restored LATTICEBUILD_NO to $env:LATTICEBUILD_NO"
    }
    else {
        Remove-Item Env:LATTICEBUILD_NO 
        Write-Output "LATTICEBUILD_NO unset as before tunning the script."
    }
}