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
    . "$PSScriptRoot\_pre-build.ps1" -DefaultBuildNo "LocalRelease" -ScriptName "build-release.ps1"

    # Run Cargo Build
    npm run tauri build

    # ── Copy demo documents alongside the build output ──────────────────────
    # Mirrors the step in the GitHub Actions workflow (step 905).
    # Destination: docs/gen/demo  (staged with the rest of the generated docs).
    $demoSrc  = "docs/demo"
    $demoDest = "docs/gen/demo"
    if (Test-Path $demoSrc) {
        New-Item -ItemType Directory -Force -Path $demoDest | Out-Null
        Copy-Item -Path "$demoSrc/*" -Destination $demoDest -Recurse -Force
        Write-Output "Demo docs copied to $demoDest"
    } else {
        Write-Warning "docs/demo not found — skipping demo docs copy."
    }
    # ─────────────────────────────────────────────────────────────────────────

}
finally {
    # restore the old environment variable -- it will work even for "no vallue"
    if ($oldEnv) {
        $env:LATTICEBUILD_NO = $oldEnv
        Write-Output "Restored LATTICEBUILD_NO to $env:LATTICEBUILD_NO"
    }
    else {
        Remove-Item Env:LATTICEBUILD_NO
        Write-Output "LATTICEBUILD_NO unset as before running the script."
    }
}
