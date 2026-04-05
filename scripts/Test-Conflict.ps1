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
<#
.SYNOPSIS
    Runs the Conflict Reproduction tool.

.DESCRIPTION
    This script runs the 'reproduce_conflict' binary.
    The binary itself now launches 'npm run tauri dev', so no pre-build of Lattice is needed in this script.

.EXAMPLE
    .\scripts\Test-Conflict.ps1
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Lattice Conflict Reproduction Test" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------" -ForegroundColor Cyan

# Run the Reproduction Tool
Write-Host "Launching Conflict Reproducer..." -ForegroundColor Yellow
# Using direct invocation instead of Start-Process to avoid handle-inheritance hangs
& cargo run --example reproduce_conflict --manifest-path src-tauri/Cargo.toml
$TestExitCode = $LASTEXITCODE

Write-Host "Cleaning up processes..." -ForegroundColor Yellow

# Force kill potential lingering processes
Stop-Process -Name "lattice" -ErrorAction SilentlyContinue -Force
Stop-Process -Name "node" -ErrorAction SilentlyContinue -Force

# Force kill potential lingering processes using taskkill (more robust for GUI apps)
taskkill /F /IM "lattice.exe" 2>$null
taskkill /F /IM "node.exe" 2>$null
# Note: output redirected to null to avoid noise if process not found

if ($TestExitCode -ne 0) {
    Write-Error "Conflict Reproduction failed with code $TestExitCode"
    exit $TestExitCode
}

Write-Host "Done." -ForegroundColor Cyan
exit 0
