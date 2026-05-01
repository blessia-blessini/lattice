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
Write-Host "=========================================="
Write-Host " Lattice Environment Setup (Windows)"
Write-Host "=========================================="

# 1. Check Node.js
$nodeVersion = 0
if (Get-Command "node" -ErrorAction SilentlyContinue) {
    try {
        $nodeVersion = [int]((node --version) -replace 'v', '').Split('.')[0]
        Write-Host "[OK] Node.js is present: $((node --version).Trim())"
    }
    catch {
        Write-Host "[WARN] Could not parse Node version."
    }
}

$nodeTargetVersion = 24
if ($nodeVersion -lt $nodeTargetVersion) {
    Write-Host "[INFO] Node version ($nodeVersion) is less than ($nodeTargetVersion). Installing LTS..."

    # this never worked on an actions runner that is why actions/setup-node@v4x  is also used
    choco install nvm -y
    Import-Module $env:ChocolateyInstall\helpers\chocolateyProfile.psm1
    refreshenv
    nvm install --lts
}

# 2. Check Rust
if (Get-Command "cargo" -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Rust is present: $((cargo --version).Trim())"
}
else {
    Write-Host "[INFO] Rust not found. Attempting installation ..."
    Invoke-WebRequest -Uri https://win.rustup.rs/ -OutFile rustup-init.exe
    Write-Host "[INFO] Installing Rust ..."
    .\rustup-init.exe -y
}

# 3. Install NPM Dependencies
Write-Host "[INFO] Installing NPM dependencies..."
npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Error "[ERROR] npm ci failed."
    exit $LASTEXITCODE
}

npx tauri icon ./public/lattice.svg


Write-Host " ==>> BUILDING THE UTILs"
Push-Location .\utils\buildno-gen
.\build.ps1 # now we are in  .\utils\buildno-gen
Pop-Location
Copy-Item .\utils\buildno-gen\buildno-gen.exe  .

Write-Host " ==>> BUILDING changelog-update utility"
Push-Location .\utils\changelog-update
.\build.ps1
Pop-Location
Write-Host "[INFO] Copying changelog-update.exe to .githooks\"
Copy-Item .\utils\changelog-update\changelog-update.exe .githooks\

Write-Host "[INFO] Registering .githooks/ as the git hooks directory..."
git config core.hooksPath .githooks
Write-Host "[OK] Git hooks enabled (commit-msg -> auto-update CHANGELOG.md)"

Write-Host "Locking presence of env initialization file from git changes..."
git update-index --skip-worktree _env-not-yet-initialized.md

Write-Host "Moving _env-not-yet-initialized.md to .local-trash"
Write-Host " (this is to prevent any future unintended commits)"
if (-not (Test-Path ".local-trash")) { mkdir ".local-trash" | Out-Null }


if (Test-Path "_env-not-yet-initialized.md") {
    try {
        if (Test-Path ".local-trash/_env-not-yet-initialized.md") {
            Move-Item .local-trash/_env-not-yet-initialized.md .local-trash/_env-not-yet-initialized-old.md  -ErrorAction Stop
        }
    }
    catch {
        Write-Warning  "  [INFO] Please delete yourself local trash or rename files in it ..."
        Write-Warning  "  [WARN] Potential loss of data if we contnue so we stop ..."
        Write-Error    " [ERROR] Failed to move _env-not-yet-initialized.md to .local-trash"
        # re-throw
        throw $_
        # This should not be needed and should be dead-code but just to be safe
        exit 1
    }
    # now move the item
    Move-Item  _env-not-yet-initialized.md .local-trash/
}

# initialize Android Project Folder(s)
Write-Host "  **************************************"
Write-Host "  [INFO] Considering to Set up Android project ... "
Write-Host "  **************************************"

if (-not (Get-Command "java" -ErrorAction SilentlyContinue)) {
    Write-Host ".  [INFO] IF you plan to build android version please install "
    Write-Host "            Java and call this script again; it is required for Android development."
    Write-Host ".           or read how to install a tauri android project manually."
    Write-Host ".           normally executing 'npm run tauri android init' will do."
    Write-Host ".  [INFO] Skipping Android project initialization."
}
else {
    if (Test-Path "src-tauri/gen/android") {
        Write-Host ".  [INFO] Android project already initialized. Skipping init."
    }
    else {
        Write-Host ".  ***************************************"
        Write-Host ".  [INFO] Setup the android project files  ..."
        Write-Host ".    for now all is generated so we prefer"
        Write-Host ".    to not keep it in version control    "
        Write-Host ".    THIS IS FAST: it does not build      "
        Write-Host ".    Just initializes a few folders so we do it at init"
        Write-Host ".    even if the build is strictly desktop"
        Write-Host ".  ***************************************"
        npm run tauri android init
    }
}

Write-Host "==========================================================================="
Write-Host "[SUCCESS] Environment setup complete."

if (Test-Path ".\scripts\print-intro.txt") {
    Get-Content ".\scripts\print-intro.txt"
}
elseif (Test-Path ".\print-intro.txt") {
    Get-Content ".\print-intro.txt"
}
else {
    Write-Host "=================================================="
    Write-Host " Please read file print-intro.txt"
    Write-Host "=================================================="
}
