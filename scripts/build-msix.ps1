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
#
# -- MSIX package for the Microsoft Store -------------------------------
# Produces an UNSIGNED dist-msix/lattice-md.msix. Unsigned is correct:
# the Store re-signs MSIX after certification, and self-signing before
# submission causes publisher-mismatch validation failures.
# See packaging/msix/README.md for the identity rules and for how to
# sign a separate copy when you want to install it locally.
#
# Single source of truth for MSIX packaging: called from both
# build-release.ps1 (local release builds) and buildAndTest.yml (CI),
# so the packaging logic never has to be kept in sync in two places.
#
# Prerequisite: `npm run tauri build` (with -Arch arm64: the aarch64-pc-windows-msvc
# target) has already produced the platform's lattice.exe -- this script does
# not build it.
#
# winapp init is deliberately NOT used: it is interactive, and everything
# it would ask is already fixed in packaging/msix/Package.appxmanifest.
#
# -Arch selects the processor architecture: x64 (default) or arm64. Each
# architecture is packaged as its own single-arch .msix; see
# build-msix-bundle.ps1 to combine them into one .msixbundle for the Store.
param(
    [ValidateSet("x64", "arm64")]
    [string]$Arch = "x64"
)

$exePaths = @{
    "x64"   = "src-tauri\target\release\lattice.exe"
    "arm64" = "src-tauri\target\aarch64-pc-windows-msvc\release\lattice.exe"
}

$msixDir  = "dist-msix-$Arch"
$msixOut  = "dist-msix-$Arch.msix"
$manifest = "packaging\msix\Package.appxmanifest"
$exe      = $exePaths[$Arch]

# makeappx ships with the Windows SDK and is on PATH on GitHub's
# windows-latest runners; fall back to the newest installed SDK.
$makeappx = (Get-Command makeappx.exe -ErrorAction SilentlyContinue)?.Source
if (-not $makeappx) {
    $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $makeappx = Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "x64\makeappx.exe" } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1
}

if (-not $makeappx) {
    Write-Warning "makeappx.exe not found (Windows SDK) -- skipping MSIX packaging."
}
elseif (-not (Test-Path $exe)) {
    Write-Warning "$exe not found -- skipping MSIX packaging."
}
else {
    Remove-Item -Recurse -Force $msixDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path "$msixDir\Assets" | Out-Null

    # Inside the package the manifest MUST be named AppxManifest.xml.
    Copy-Item -Path $manifest -Destination "$msixDir\AppxManifest.xml" -Force
    Copy-Item -Path $exe      -Destination $msixDir -Force

    # Keep in sync with the Assets\ paths in Package.appxmanifest.
    foreach ($logo in "StoreLogo", "Square44x44Logo", "Square71x71Logo",
                      "Square150x150Logo") {
        Copy-Item -Path "src-tauri\icons\$logo.png" -Destination "$msixDir\Assets\" -Force
    }

    # Keep Identity/Version in step with tauri.conf.json: MSIX wants a
    # 4-part version whose Revision is 0, and the Store rejects a
    # re-upload of a version it has already seen. ProcessorArchitecture must
    # match the packaged exe -- a bundle's packages are told apart by this
    # attribute alone (Name/Publisher/Version are identical across arches).
    $cfgVersion = (Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
    $parts = @($cfgVersion -split '\.')
    while ($parts.Count -lt 3) { $parts += '0' }
    $msixVersion = "{0}.{1}.{2}.0" -f $parts[0], $parts[1], $parts[2]

    $xmlPath = (Resolve-Path "$msixDir\AppxManifest.xml").Path
    [xml]$mx  = Get-Content $xmlPath
    $identity = $mx.DocumentElement.SelectSingleNode("*[local-name()='Identity']")
    if (-not $identity) { throw "No <Identity> element in $manifest" }
    $identity.SetAttribute("Version", $msixVersion)
    $identity.SetAttribute("ProcessorArchitecture", $Arch)
    $mx.Save($xmlPath)
    Write-Output "MSIX Identity/Version set to $msixVersion ($Arch)"

    Remove-Item $msixOut -ErrorAction SilentlyContinue
    & $makeappx pack /d $msixDir /p $msixOut /o
    if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }
    Write-Output "Unsigned MSIX written to $msixOut -- combine with build-msix-bundle.ps1 or upload directly to Partner Center."
}
