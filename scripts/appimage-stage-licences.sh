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
# IMPL-LTTCE-FOS-00006 — stages the licence files the AppImage needs but
# linuxdeploy does not copy (REQ-LTTCE-FOS-00006).
#
# linuxdeploy copies the Debian copyright file of each library it deploys as a
# dependency. linuxdeploy-plugin-gtk, however, copies whole folders — the
# gdk-pixbuf loaders, the GIO modules and the GSettings schemas — and the
# packages owning only files there (librsvg2-common, glib-networking,
# dconf-gsettings-backend, gsettings-desktop-schemas, libgtk-3-common, ...)
# arrive without their copyright file. And most Debian copyright files give
# the LGPL, GPL or MPL text only as a pointer to /usr/share/common-licenses,
# which no AppImage carries.
#
# This script copies, from the build machine, the copyright file of every
# package owning a file in those folders, and the whole of
# /usr/share/common-licenses (links dereferenced). It writes a Tauri config
# that maps both into the AppImage; the build passes it with
#   npm run tauri build -- --config <stage>/tauri.conf.json
# It changes nothing outside <stage>. foss.mjs appimage (CI step 391) then
# checks the result.
#
# Usage: appimage-stage-licences.sh [<stage dir>]
#        default: src-tauri/target/appimage-licences
# Exit codes: 0 staged, 1 failed.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
stage="${1:-$repo/src-tauri/target/appimage-licences}"
mkdir -p "$stage"
stage="$(cd "$stage" && pwd)"

# The folders linuxdeploy-plugin-gtk copies whole, by the same pkg-config
# variables the plugin reads. (Its typelib folder is emptied by
# appimage-exclude.sh.)
copied_dirs=(
    "$(pkg-config --variable=gdk_pixbuf_moduledir gdk-pixbuf-2.0)"
    "$(pkg-config --variable=giomoduledir gio-2.0)"
    "$(pkg-config --variable=schemasdir gio-2.0)"
)

rm -rf "$stage/doc" "$stage/common-licenses"
mkdir -p "$stage/doc" "$stage/common-licenses"

files=()
for dir in "${copied_dirs[@]}"; do
    if [ -z "$dir" ] || [ ! -d "$dir" ]; then
        echo "appimage-stage-licences: folder '$dir' not found" >&2
        exit 1
    fi
    for f in "$dir"/*; do
        [ -f "$f" ] && [ ! -L "$f" ] && files+=("$f")
    done
done
if [ "${#files[@]}" -eq 0 ]; then
    echo "appimage-stage-licences: no files found in ${copied_dirs[*]}" >&2
    exit 1
fi

# "pkg:arch[, pkg2:arch]: /path" -> one package name per line.
mapfile -t packages < <(dpkg -S "${files[@]}" | grep -v '^diversion by' \
    | sed 's/: \/.*$//; s/, /\n/g' | sed 's/:.*$//' | sort -u)
if [ "${#packages[@]}" -eq 0 ]; then
    echo "appimage-stage-licences: dpkg knows no owner of those files" >&2
    exit 1
fi

for pkg in "${packages[@]}"; do
    src="/usr/share/doc/$pkg/copyright"
    if [ ! -f "$src" ]; then
        echo "appimage-stage-licences: $pkg has no $src" >&2
        exit 1
    fi
    mkdir -p "$stage/doc/$pkg"
    cp -L "$src" "$stage/doc/$pkg/copyright"
done

cp -L /usr/share/common-licenses/* "$stage/common-licenses/"

cat > "$stage/tauri.conf.json" <<EOF
{
  "bundle": {
    "linux": {
      "appimage": {
        "files": {
          "/usr/share/doc": "$stage/doc",
          "/usr/share/common-licenses": "$stage/common-licenses"
        }
      }
    }
  }
}
EOF

echo "appimage-stage-licences: copyright files of ${packages[*]}"
echo "appimage-stage-licences: $(ls "$stage/common-licenses" | wc -l) licence texts; config $stage/tauri.conf.json"
