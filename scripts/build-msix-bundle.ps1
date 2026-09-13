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
# -- MSIX bundle for the Microsoft Store (multi-architecture) -----------
# Combines the per-architecture packages produced by build-msix.ps1
# (dist-msix-x64.msix, dist-msix-arm64.msix) into a single unsigned
# .msixbundle. Submit the bundle to Partner Center instead of the
# individual .msix files -- the Store then serves each device the
# architecture it needs from one product listing, no separate submission.
#
# All packages in a bundle must share Identity Name/Publisher/Version and
# differ only in ProcessorArchitecture -- build-msix.ps1 already guarantees
# that, since both are stamped from the same tauri.conf.json version.
#
# Prerequisite: build-msix.ps1 has already produced dist-msix-x64.msix.
# dist-msix-arm64.msix is optional -- it is skipped with a warning if
# absent (e.g. the arm64 leg is on hold or wasn't part of this run), and
# the bundle is still produced from whatever single-arch packages exist,
# since a one-package bundle is valid and still installable via the Store.

$bundleDir = "dist-msix-bundle"
$bundleOut = "lattice-md.msixbundle"
$packages  = @("dist-msix-x64.msix", "dist-msix-arm64.msix") |
    Where-Object { Test-Path $_ }

if ($packages.Count -eq 0) {
    Write-Warning "No .msix packages found (expected dist-msix-x64.msix / dist-msix-arm64.msix) -- skipping bundle."
    return
}

foreach ($missing in @("dist-msix-x64.msix", "dist-msix-arm64.msix") | Where-Object { $_ -notin $packages }) {
    Write-Warning "$missing not found -- bundling without it."
}

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
    Write-Warning "makeappx.exe not found (Windows SDK) -- skipping bundle."
    return
}

Remove-Item -Recurse -Force $bundleDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
foreach ($pkg in $packages) {
    Copy-Item -Path $pkg -Destination $bundleDir -Force
}

Remove-Item $bundleOut -ErrorAction SilentlyContinue
& $makeappx bundle /d $bundleDir /p $bundleOut
if ($LASTEXITCODE -ne 0) { throw "makeappx bundle failed ($LASTEXITCODE)" }
Write-Output "Unsigned MSIX bundle written to $bundleOut ($($packages.Count) architecture(s)) -- upload this one to Partner Center."
