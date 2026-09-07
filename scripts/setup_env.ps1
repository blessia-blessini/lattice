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

Write-Host " INSTALL SIGNING winappcli"
Write-Host "=========================================="
winget install microsoft.winappcli --source winget

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

# 2a. LLVM tools for code coverage
Write-Host " ==>> INSTALLING LLVM tools"
cargo install cargo-llvm-cov

# 3. Install NPM Dependencies
Write-Host "[INFO] Installing NPM dependencies..."
npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Error "[ERROR] npm ci failed."
    exit $LASTEXITCODE
}

npx tauri icon ./public/lattice.svg

# These are needed only for Windows / MS Store
npx tauri icon ./public/lattice.svg -p 300 -p 1080


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
# Remove Zone.Identifier stream that Windows attaches to copied/built files
# Without this, Windows prompts "unknown publisher" on every fresh build
Unblock-File .\.githooks\changelog-update.exe

Write-Host ""
Write-Host "=========================================================="
Write-Host "  OPTIONAL FEATURE: Auto-update CHANGELOG.md on commit"
Write-Host "=========================================================="
Write-Host ""
Write-Host "  Windows is about to ask you to confirm execution of:"
Write-Host "    .githooks\changelog-update.exe"
Write-Host ""
Write-Host "  This is a small Rust utility built locally from source"
Write-Host "  (utils/changelog-update/) just now. It is NOT downloaded"
Write-Host "  from the internet."
Write-Host ""
Write-Host "  Its only purpose: insert your commit title into"
Write-Host "  CHANGELOG.md automatically on each git commit."
Write-Host ""
Write-Host "  >> ALLOW:  CHANGELOG.md auto-updates on every commit."
Write-Host "  >> REJECT: No problem -- commits work normally."
Write-Host "             Collect history any time with: git log --oneline"
Write-Host ""
Write-Host "  Answering now so you are not surprised during a later commit."
Write-Host "=========================================================="
Write-Host ""

# wait so that user can see the warning
#
$seconds = 5
$consoleCanWait = $false
for ($i = $seconds; $i -gt 0; $i--) {
    Write-Host "`r *** PLEASE READ THE ABOVE INTRO `r *** Continuing in $i seconds... (press any key to proceed now) " -NoNewline -ForegroundColor Yellow
    try {
        if ([Console]::KeyAvailable) {
            $null = [Console]::ReadKey($true)
            break
        }
        $consoleCanWait = $true
    }
    catch {
         Write-Host "[INFO] THIS CONSOLE CANNOT BE KEYBOARD WAITED"
    }
    finally {
       Start-Sleep -Seconds 1
    }
}


# Invoke the binary now (no args = usage print + exit 0, no files touched).
# This is the moment Windows will show the security confirmation if needed.
# Capturing the result lets us report back clearly.
try {
    Start-Process -FilePath ".\.githooks\changelog-update.exe" -Wait -PassThru -ErrorAction Stop
    Write-Host "[OK] changelog-update.exe is trusted. CHANGELOG.md will auto-update on commits."

    # uncomment the line to test the catch code and then comment it back
    # throw "testing catch code"
}
catch {
    Write-Host "[WARN] changelog-update.exe could not be confirmed ($_)." -ForegroundColor Yellow
    Write-Host "       CHANGELOG.md will NOT be auto-updated. Commits are unaffected." -ForegroundColor Yellow
    Write-Host "       Re-run this setup at any time to enable auto-update." -ForegroundColor Yellow
    Write-Host ""
    $seconds = 10
    for ($i = $seconds; $i -gt 0; $i--) {
        Write-Host "`r  Continuing in $i seconds... (press any key to proceed now) " -NoNewline -ForegroundColor Yellow
        if ($consoleCanWait -and [Console]::KeyAvailable) {
            $null = [Console]::ReadKey($true)
            break
        }
        Start-Sleep -Seconds 1
    }
    Write-Host ""
}
Write-Host ""

Write-Host "[INFO] Registering .githooks/ as the git hooks directory..."
git config core.hooksPath .githooks
Write-Host "[OK] Git hooks enabled (post-commit -> auto-update CHANGELOG.md)"

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
