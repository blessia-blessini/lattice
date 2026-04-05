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
param (
    [string]$DefaultBuildNo = "LocalBuild",
    [string]$ScriptName = "unknown-script.ps1"
)

# CHECK IF i AM IN THE ROOT FOLDER BY CHECKING IF THERE IS A FOLDER CALLED "src-tauri" AND 
# subfolder "scripts"; This is not determenistic but it should work for now
if (-not ((Test-Path "src-tauri") -and (Test-Path "scripts"))) {
    Write-Output "Please navigate to the root folder OF THE PROJECT and try again."
    Write-Output "Current directory: $(Get-Location)"
    Write-Output 'THE COMMAND FROM THE PROJECT ROOT IS:'  
    Write-Output "  .\scripts\$ScriptName"
    throw "Please run the script from the root folder of the project with the command: .\scripts\$ScriptName.`n Execution aborted: Incorrect directory."
}

# Set LATTICEBUILD_NO if not set
# Write-Error $PSScriptRoot
$genPath = '$PSScriptRoot\..\buildno-gen.exe'
if (Test-Path $genPath) {
    try {
        # Execute and capture output
        $genOutput = & $genPath
        $env:LATTICEBUILD_NO = $genOutput + "-" + $ScriptName
        Write-Output "LATTICEBUILD_NO generated: $env:LATTICEBUILD_NO"
    }
    catch {
        Write-Warning "Failed to execute buildno-gen.exe: $_"
        $env:LATTICEBUILD_NO = $DefaultBuildNo
    }
}
else {
    Write-Warning "LATTICEBUILD_NO not set and generator not found. Defaulting to '$DefaultBuildNo'."
    $env:LATTICEBUILD_NO = $DefaultBuildNo
}

