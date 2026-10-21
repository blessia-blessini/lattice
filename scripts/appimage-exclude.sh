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
# IMPL-LTTCE-FOS-00006 — keeps files out of the AppImage that Lattice may not,
# or need not, ship (REQ-LTTCE-FOS-00006).
#
# Tauri builds the AppImage with linuxdeploy-plugin-gtk, which copies whole
# folders of the build machine — the gdk-pixbuf loaders with every library they
# need, and the GObject-introspection typelibs — with no option to leave a file
# out. So the files are removed from the build machine before the bundle is made:
#
# - the TIFF image loader: it needs libtiff, and Ubuntu's libtiff needs libjbig —
#   jbigkit, GPL-2.0-or-later, which would put a GPL library into every AppImage
#   and conflict with Lattice's commercial licence. Lattice never asks GTK to
#   decode TIFF (WebKit decodes the images a document shows). The loader cache
#   is rebuilt without it.
# - every typelib: they serve language bindings (Python, JavaScript) through
#   GObject introspection, which Lattice, a Rust program, never uses — yet each
#   would need its package reviewed and its copyright file carried. The folder
#   stays, empty, because the plugin copies it unconditionally.
#
# This changes the machine's own installation, so it runs only where that
# machine is thrown away afterwards: on CI (CI=true), or with --yes.
#
# Usage: appimage-exclude.sh [--yes]
# Exit codes: 0 done (or nothing to do), 1 refused or failed.
set -euo pipefail

# Loaders to exclude, by the name gdk-pixbuf gives their module.
EXCLUDED_LOADERS=(tiff)

if [ "${CI:-}" != "true" ] && [ "${1:-}" != "--yes" ]; then
    echo "appimage-exclude: refusing to change this machine's GTK installation outside CI;" >&2
    echo "  run with --yes on a throwaway build machine." >&2
    exit 1
fi

moduledir="$(pkg-config --variable=gdk_pixbuf_moduledir gdk-pixbuf-2.0)"
query="$(pkg-config --variable=gdk_pixbuf_query_loaders gdk-pixbuf-2.0)"
if [ -z "$moduledir" ] || [ ! -d "$moduledir" ] || [ -z "$query" ] || [ ! -x "$query" ]; then
    echo "appimage-exclude: gdk-pixbuf loader folder or gdk-pixbuf-query-loaders not found (moduledir='$moduledir', query='$query')" >&2
    exit 1
fi

SUDO=""
if [ "$(id -u)" != "0" ]; then SUDO="sudo"; fi

for name in "${EXCLUDED_LOADERS[@]}"; do
    module="$moduledir/libpixbufloader-$name.so"
    if [ -e "$module" ]; then
        $SUDO rm -f "$module"
        echo "appimage-exclude: removed $module"
    else
        echo "appimage-exclude: $module not present"
    fi
done

$SUDO "$query" --update-cache
for name in "${EXCLUDED_LOADERS[@]}"; do
    if "$query" | grep -q "libpixbufloader-$name\.so"; then
        echo "appimage-exclude: the $name loader is still registered after the cache update" >&2
        exit 1
    fi
done
echo "appimage-exclude: loader cache rebuilt without: ${EXCLUDED_LOADERS[*]}"

# The typelib folder, by the variable linuxdeploy-plugin-gtk reads, with its
# fallback below GLib's libdir.
typelibdir="$(pkg-config --variable=typelibdir gobject-introspection-1.0 2>/dev/null || true)"
if [ -z "$typelibdir" ]; then
    typelibdir="$(pkg-config --variable=libdir gio-2.0)/girepository-1.0"
fi
if [ -d "$typelibdir" ]; then
    count="$(find "$typelibdir" -maxdepth 1 -name '*.typelib' | wc -l)"
    $SUDO find "$typelibdir" -maxdepth 1 -name '*.typelib' -delete
    if [ -n "$(find "$typelibdir" -maxdepth 1 -name '*.typelib' -print -quit)" ]; then
        echo "appimage-exclude: typelibs remain in $typelibdir" >&2
        exit 1
    fi
    echo "appimage-exclude: removed $count typelibs from $typelibdir"
else
    echo "appimage-exclude: no typelib folder ($typelibdir)"
fi
