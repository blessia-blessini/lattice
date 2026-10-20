#!/usr/bin/env bash
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
################################################################################
# assert-bundled.sh <package>...
#
# STST for REQ-LTTCE-FOS-00001: every package a user downloads carries LICENSE
# and THIRD-PARTY-NOTICES.md, byte-identical to the repository's copies.
# Looks INSIDE the package, unpacked the way the platform does it:
#
#   *-setup.exe  NSIS: silent install (/S /D=<temp>) -- CI runners only, it
#                registers an uninstall entry for the current user
#   *.msix       zip: Expand-Archive
#   *.deb        dpkg-deb -x
#   *.AppImage   --appimage-extract (needs no FUSE)
#   *.dmg        hdiutil attach, read-only
#
# Arguments that are not files (an unmatched glob) are skipped; finding no
# package at all is an error. Exit 0 when every package passes, else 1.
################################################################################
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REQUIRED=(LICENSE THIRD-PARTY-NOTICES.md)
failed=0
checked=0

#*******************************************************************************
# check_tree <package label> <unpacked dir>
#*******************************************************************************
# Some file of each required name under <dir> must equal the repository copy;
# packages may carry other files called LICENSE (third-party libraries).
check_tree() {
    local label="$1" dir="$2" name candidate match
    for name in "${REQUIRED[@]}"; do
        match=""
        while IFS= read -r -d '' candidate; do
            if cmp -s "$candidate" "$ROOT/$name"; then match="$candidate"; break; fi
        done < <(find "$dir" -type f -name "$name" -print0)
        if [ -n "$match" ]; then
            echo "  ok    $label: ${match#"$dir"/}"
        else
            echo "::error::$label: no $name identical to the repository copy"
            failed=1
        fi
    done
} # check_tree END *************************************************************

#*******************************************************************************
# winpath <path>  -- a Windows path for PowerShell (Git Bash on Windows only)
#*******************************************************************************
winpath() { cygpath -w "$1"; }
# winpath END ******************************************************************

for pkg in "$@"; do
    [ -f "$pkg" ] || continue
    label="$(basename "$pkg")"
    tmp="$(mktemp -d)"
    echo "Checking $label"
    case "$pkg" in
        *-setup.exe)
            powershell -NoProfile -Command "Start-Process -Wait -FilePath '$(winpath "$pkg")' -ArgumentList '/S','/D=$(winpath "$tmp")\\inst'"
            ;;
        *.msix)
            cp "$pkg" "$tmp/package.zip"
            powershell -NoProfile -Command "Expand-Archive -LiteralPath '$(winpath "$tmp/package.zip")' -DestinationPath '$(winpath "$tmp")\\x'"
            ;;
        *.deb)
            dpkg-deb -x "$pkg" "$tmp/x"
            ;;
        *.AppImage)
            chmod +x "$pkg"
            abs="$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")"
            (cd "$tmp" && "$abs" --appimage-extract >/dev/null)
            ;;
        *.dmg)
            hdiutil attach -nobrowse -readonly -mountpoint "$tmp/mnt" "$pkg" >/dev/null
            check_tree "$label" "$tmp/mnt"
            hdiutil detach "$tmp/mnt" >/dev/null
            checked=$((checked + 1))
            continue
            ;;
        *)
            echo "::error::$label: unknown package type"
            failed=1
            continue
            ;;
    esac
    check_tree "$label" "$tmp"
    checked=$((checked + 1))
done

if [ "$checked" -eq 0 ]; then
    echo "::error::no package found to check (arguments: $*)"
    exit 1
fi
echo "assert-bundled: $checked package(s) checked"
exit "$failed"
