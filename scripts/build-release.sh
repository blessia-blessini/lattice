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

# Pre-build checks and setup
export DEFAULT_BUILD_NO="LocalRelease"
export SCRIPT_NAME="build-release.sh"
source ./scripts/_pre-build.sh

# Helper function to build and package for a specific macOS target architecture
build_and_package_target() {
    TARGET_TRIPLE=$1
    ARCH_NAME=$2
    
    echo "=========================================================="
    echo " Building and packaging for target: $TARGET_TRIPLE ($ARCH_NAME)"
    echo "=========================================================="
    
    # Run Cargo / Tauri Build for this specific target.
    # NOTE: "dmg" MUST remain in tauri.conf.json bundle.targets.
    #   Without it, Tauri does NOT assemble the .app bundle at
    #   target/<arch>/release/bundle/macos/ — only the binary is built.
    #   The manual hdiutil step below depends on that .app existing.
    #   Requires: brew install create-dmg  (used by Tauri's bundle_dmg.sh)
    npm run tauri build -- --target $TARGET_TRIPLE

    APP_PATH="src-tauri/target/${TARGET_TRIPLE}/release/bundle/macos/lattice.app"
    if [ ! -d "$APP_PATH" ]; then
        echo "Error: Tauri build failed — .app bundle not found at $APP_PATH"
        exit 1
    fi
    echo "Build OK: .app bundle found at $APP_PATH"
    
    if [ "$(uname)" == "Darwin" ]; then
        echo "Creating clean DMG manually for $ARCH_NAME..."
        
        VERSION=$(node -p "require('./package.json').version")
        DMG_DIR="src-tauri/target/release/bundle/dmg"
        DMG_TEMP_DIR="$DMG_DIR/tmp_${ARCH_NAME}"
        DMG_NAME="lattice_${VERSION}_${ARCH_NAME}.dmg"
        
        # Clean up any old manual files
        rm -rf "$DMG_TEMP_DIR"
        rm -f "$DMG_DIR/$DMG_NAME"
        # Also remove any DMG stub Tauri itself may have created for this target
        rm -f "$DMG_DIR"/*.dmg
        
        # Create temp packaging directory
        mkdir -p "$DMG_TEMP_DIR"
        
        # Copy compiled target app bundle
        cp -R "src-tauri/target/${TARGET_TRIPLE}/release/bundle/macos/lattice.app" "$DMG_TEMP_DIR/"
        
        # Create link to Applications
        ln -s /Applications "$DMG_TEMP_DIR/Applications"
        
        # Build the DMG with retries to handle transient macOS security/Spotlight file locks
        echo "Creating DMG disk image..."
        SUCCESS=0
        for i in {1..5}; do
            if hdiutil create -volname "lattice" -srcfolder "$DMG_TEMP_DIR" -ov -format UDZO "$DMG_DIR/$DMG_NAME"; then
                SUCCESS=1
                break
            else
                echo "Warning: hdiutil create failed (attempt $i/5) due to potential file locks. Retrying in 2 seconds..."
                sleep 2
            fi
        done
        
        # Clean up temp packaging directory
        rm -rf "$DMG_TEMP_DIR"
        
        if [ $SUCCESS -eq 1 ]; then
            echo "Disk image done: $DMG_DIR/$DMG_NAME"
        else
            echo "Error: Failed to create DMG disk image for $ARCH_NAME after multiple attempts."
            exit 1
        fi
    fi
}

if [ "$(uname)" == "Darwin" ]; then
    # Ensure targets are installed via rustup
    echo "Ensuring cross-compilation targets are installed..."
    rustup target add x86_64-apple-darwin aarch64-apple-darwin
    
    # Clean up old DMGs from prior builds
    rm -f src-tauri/target/release/bundle/dmg/*.dmg
    
    # Build both target architectures separately
    build_and_package_target "x86_64-apple-darwin" "x64"
    build_and_package_target "aarch64-apple-darwin" "aarch64"
else
    # Non-macOS release build
    npm run tauri build
fi
