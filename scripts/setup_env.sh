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
set -e

echo "=========================================="
echo " Lattice Environment Setup (Unix)"
echo "=========================================="

echo " *** save original working folder"
pushd .

OS="$(uname -s)"

if [ $(id -u) -ne 0 ]; then 
    SUDO="sudo"
else 
    SUDO=""
fi

# 1. System Dependencies
if [ "$OS" = "Linux" ]; then
    echo "[INFO] Detected Linux ..."
    
    # Check if "$*" (all args) contains string "--wsl-force-run"
    if grep -qi "microsoft" /proc/version; then
        echo "[INFO] Detected WSL."
        if [[ "$*" != *"--wsl-force-run"* ]]; then
            echo "ALTHOUGH THIS SCRIPT _MAY_ WORK PROPERLY IN WSL,"
            echo "WE _DO NOT RECOMMEND IT_. IF YOU WANT TO USE IT ANYWAY,"
            echo "YOU MUST START THE SCRIPT WITH \`--wsl-force-run\`"
            echo " *** return to original folder" && popd 
            exit 1
        else
            echo "[WARN] Force-running in WSL as requested."
        fi
    else
        echo "[INFO] Detected A Linux distribution not in WSL."
    fi

    # Update and Install Dependencies
    # (Using the list from the plan/reference)
    echo "[INFO] Updating apt and installing libraries..."
    $SUDO apt-get update
    $SUDO apt-get install -y \
       libwebkit2gtk-4.1-dev \
       build-essential \
       curl \
       wget \
       file \
       libssl-dev \
       libgtk-3-dev \
       libayatana-appindicator3-dev \
       librsvg2-dev \
       xvfb       


# Explicitly match Windows Bash environments
elif [[ "$OS" == MINGW* ]] || [[ "$OS" == MSYS* ]] || [[ "$OS" == CYGWIN* ]]; then

    if [[ "$*" != *"--wsl-force-run"* ]]; then
        echo "[INFO] Detected Windows Bash ($OS)."
        echo "ALTHOUGH THIS SCRIPT _MAY_ WORK PROPERLY IN WSL,"
        echo "WE _DO NOT RECOMMEND IT_. IF YOU WANT TO USE IT ANYWAY,"
        echo "YOU MUST START THE SCRIPT WITH \`--wsl-force-run\`"
        echo "ON WINDOWS PLEASE USE THE POWERSHELL(.ps1) VERSION OF THIS SETUP"
        echo " *** return to original folder" && popd 
        exit 1
    else
        echo "[INFO] Force-running in $OS as requested."
    fi

elif [ "$OS" = "Darwin" ]; then
    echo "[INFO] Detected MacOS."
   
else
    echo "ON WINDOWS PLEASE USE THE POWERSHELL(.ps1) VERSION OF THIS SETUP"
    echo "there is such in the same folder as this sh script".
    ls -l ./scripts/*.ps1 || true
    ls -l ./*.ps1 || true
    echo " ------ FAILED ----------".
    popd 
    return 1
fi

if ! command -v cargo &> /dev/null; then
    echo "****************************************************" 
    echo "[INFO] Rust not found. attempting installation"
    echo "**curl download and directly execute****************" 
    $SUDO curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    echo "****************************************************" 
    echo "Home is $HOME" 
    echo "Executing: $SUDO source $HOME/.cargo/env"
    # sourcing the profile to update the PATH and vars because it must work on all posix in the world


    if [ -n "$SUDO" ]; then
        # run a login shell as the target user so the installer env is applied
        $SUDO bash -lc "source \"$HOME/.cargo/env\"" || true
    else
        # POSIX-compatible sourcing
        . "$HOME/.cargo/env" || true
    fi
    export PATH="$HOME/.cargo/bin:$PATH"
    echo "****************************************************" 
fi

# 2. Check/Install Node.js
NODE_major=$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')
if ! ( command -v node &> /dev/null ) || [ "${NODE_major:-0}" -lt 24 ]; then
    echo "[INFO] Node.js not found. attempting installation"
    # For CI/Automation, one might want to install. For now, warn.
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash -s -- -y

    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm

    # sourcing the profile to update the PATH and vars becaus it must work on all posix in the world
    if   [ -f  "$HOME/.bashrc"       ]; then
        source "$HOME/.bashrc"
    elif [ -f  "$HOME/.bash_profile" ]; then
        source "$HOME/.bash_profile"
    elif [ -f  "$HOME/.zshrc"        ]; then
        source "$HOME/.zshrc"
    fi
    echo "**** Installing nvm lts "
    nvm install --lts
else
    echo "[OK] Node.js is present: $(node --version)"
fi

# 3. Check/Install Rust
if ! command -v cargo &> /dev/null; then
    echo "[INFO] Rust still not installed ..."
    echo " *** return to original folder" && popd 
    exit 1
fi


# 4. Install Frontend Dependencies
echo "**************************************"
echo "[INFO] Installing NPM dependencies ..."
echo "**************************************"
npm ci

echo "*** END of NPM ***********************"


# 5. Install Icons
echo "**** ICONS *****************************"
echo "[INFO] Setting up icons"
npx tauri icon ./public/lattice.svg
echo "*** END of ICON setup *****************"


# 6. Install (build) Buildno-gen UTILITY
echo "**************************************"
echo "[INFO] Building buildno-gen utility ..."
echo "*   using utils/buildno-gen/build.sh  "
echo "*   it will leave the executable in the"
echo "*     root of the utility and we must "
echo "*     pick it up from there "
echo "* SORRY for COMPLEXITY but this ensures"
echo "        the utility is also open source"                                    
echo "**************************************"
pushd ./utils/buildno-gen # store the folder
sh build.sh
popd 
echo "[INFO] Copying buildno-gen to root of env"
cp ./utils/buildno-gen/buildno-gen . 
chmod +x buildno-gen # make it executable -- just in case

echo "   *** return to original folder" && popd # return to previous folder


# 7. Build changelog-update utility (git hook helper — pure std Rust, no extra deps)
echo "**************************************"
echo "[INFO] Building changelog-update utility ..."
echo "*   using utils/changelog-update/build.sh"
echo "**************************************"
pushd ./utils/changelog-update
sh build.sh
popd

echo "[INFO] Installing cargo-llvm-cov"
cargo install cargo-llvm-cov

echo "[INFO] Copying changelog-update to .githooks/"
cp ./utils/changelog-update/changelog-update .githooks/
chmod +x .githooks/changelog-update

echo "[INFO] Registering .githooks/ as the git hooks directory..."
git config core.hooksPath .githooks
chmod +x .githooks/post-commit
echo "[OK] Git hooks enabled (post-commit → auto-update CHANGELOG.md)"

echo "[INFO] Locking presence of env initialization file from git changes..."
git update-index --skip-worktree _env-not-yet-initialized.md

mkdir -p .local-trash
if [ -f "_env-not-yet-initialized.md" ]; then
   echo "[INFO] and now moving it out of the way to prevent any future build poke-yokes stop..." 
   mv _env-not-yet-initialized.md .local-trash/
fi


# 6. Initialize Android Project Folder(s)
echo "  **************************************"
echo "  [INFO] Considering to Set up Android project ... "
echo "  **************************************"
if ! command -v java >/dev/null 2>&1; then
  if [ "$OS" = "Linux" ]; then
    echo ".  [INFO] IF you plan to build android version please install "
    echo "            Java and call this script again required for Android development."
    echo ".           or read how to install a tauri android project manually."
    echo ".           normally executing 'npm run tauri android init' will do."
    echo ".  [INFO] Skipping Android project initialization."
  fi
elif [ "$OS" = "Linux" ]; then
    echo ".  ***************************************"
    echo ".  [INFO] Setup the android project files  ..."
    echo ".    for now all is generated so we prefer"
    echo ".    to not keep it in version control    "
    echo ".    THIS IS FAST: it does not build      "
    echo ".    Just initializes a few folders so we do it at init"
    echo ".    even if the build is strictly desktop"
    echo ".    from the UNIX systems only Linux is supported"
    echo ".    MacOS is not supported for android builds"
    echo ".  ***************************************"

    if [ -d "src-tauri/gen/android" ]; then
        echo ".  [INFO] Android project already initialized. Skipping init."
    else
        npm run tauri android init
    fi  
fi

echo ""
echo "[SUCCESS] Environment setup complete."

if [ -f "./scripts/print-intro.txt" ]; then
   cat ./scripts/print-intro.txt
elif [ -f "./print-intro.txt" ]; then
   cat ../print-intro.txt
else
   echo "=================================================="
   echo "Please read file print-intro.txt"
   echo "=================================================="
fi
echo ""
