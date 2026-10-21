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
#
# IMPL-LTTCE-FOS-00006 — keeps gdk-pixbuf image loaders out of the AppImage
# whose libraries Lattice may not ship (REQ-LTTCE-FOS-00006).
#
# Tauri builds the AppImage with linuxdeploy-plugin-gtk, which copies the build
# machine's whole gdk-pixbuf loader folder and every library those loaders
# need; it has no option to leave one out. The TIFF loader needs libtiff, and
# Ubuntu's libtiff needs libjbig — jbigkit, GPL-2.0-or-later, which would put a
# GPL library into every AppImage and conflict with Lattice's commercial
# licence. Lattice never asks GTK to decode TIFF (WebKit decodes the images a
# document shows), so the loader is removed from the build machine before the
# bundle is made and the loader cache is rebuilt without it.
#
# This changes the machine's own GTK installation, so it runs only where that
# machine is thrown away afterwards: on CI (CI=true), or with --yes.
#
# Usage: appimage-exclude-loaders.sh [--yes]
# Exit codes: 0 done (or nothing to do), 1 refused or failed.
set -euo pipefail

# Loaders to exclude, by the name gdk-pixbuf gives their module.
EXCLUDED_LOADERS=(tiff)

if [ "${CI:-}" != "true" ] && [ "${1:-}" != "--yes" ]; then
    echo "appimage-exclude-loaders: refusing to change this machine's GTK installation outside CI;" >&2
    echo "  run with --yes on a throwaway build machine." >&2
    exit 1
fi

moduledir="$(pkg-config --variable=gdk_pixbuf_moduledir gdk-pixbuf-2.0)"
query="$(pkg-config --variable=gdk_pixbuf_query_loaders gdk-pixbuf-2.0)"
if [ -z "$moduledir" ] || [ ! -d "$moduledir" ] || [ -z "$query" ] || [ ! -x "$query" ]; then
    echo "appimage-exclude-loaders: gdk-pixbuf loader folder or gdk-pixbuf-query-loaders not found (moduledir='$moduledir', query='$query')" >&2
    exit 1
fi

SUDO=""
if [ "$(id -u)" != "0" ]; then SUDO="sudo"; fi

for name in "${EXCLUDED_LOADERS[@]}"; do
    module="$moduledir/libpixbufloader-$name.so"
    if [ -e "$module" ]; then
        $SUDO rm -f "$module"
        echo "appimage-exclude-loaders: removed $module"
    else
        echo "appimage-exclude-loaders: $module not present"
    fi
done

$SUDO "$query" --update-cache
for name in "${EXCLUDED_LOADERS[@]}"; do
    if "$query" | grep -q "libpixbufloader-$name\.so"; then
        echo "appimage-exclude-loaders: the $name loader is still registered after the cache update" >&2
        exit 1
    fi
done
echo "appimage-exclude-loaders: loader cache rebuilt without: ${EXCLUDED_LOADERS[*]}"
