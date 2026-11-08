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
# apt-repo.sh --debs DIR --out DIR --key-id KEY [--url URL]
#
# IMPL-LTTCE-APT-00001 — REQ-LTTCE-APT-00001. Builds the signed APT repository
# of the release site from the Lattice .deb files in DIR:
#
#   OUT/lattice-md.gpg, .asc          the public key (binary, text)
#   OUT/lattice-md-keyring.deb        the keyring package, under a fixed name
#                                     for the first download
#   OUT/pool/main/l/<package>/*.deb   lattice (amd64, arm64) + the keyring package
#   OUT/dists/stable/...              Packages per architecture, Release,
#                                     Release.gpg, InRelease
#
# OUT/pool and OUT/dists are rebuilt from scratch: the repository holds only the
# packages given now. The keyring package (key + source entry) takes its version
# from the key's newest signature, so it changes exactly when the key does —
# a renewed or replaced key reaches users with `apt upgrade`.
#
# KEY must be in gpg's keyring with its secret part; GPG_PASSPHRASE, if set,
# unlocks it. Needs dpkg-deb, dpkg-scanpackages, apt-ftparchive, gpg, gpgv.
################################################################################
set -euo pipefail

readonly SUITE=stable
readonly COMPONENT=main
readonly ARCHS='amd64 arm64'
readonly KEY_FILE=lattice-md.gpg
readonly KEYRING_PKG=lattice-md-keyring
readonly SOURCES_FILE=/etc/apt/sources.list.d/lattice-md.sources
readonly KEYRING_PATH=/usr/share/keyrings/lattice-md.gpg

die() { echo "apt-repo: $*" >&2; exit 1; }


#**************************************************************
# gpg_sign
#**************************************************************
# gpg in batch mode; the passphrase, when given, goes in on fd 3, never on the command line.
gpg_sign() {
    if [ -n "${GPG_PASSPHRASE:-}" ]; then
        gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --local-user "$KEY" "$@" 3<<<"$GPG_PASSPHRASE"
    else
        gpg --batch --yes --local-user "$KEY" "$@"
    fi
}
# gpg_sign END ************************************************


#**************************************************************
# build_keyring_package
#**************************************************************
# Writes the keyring package into pool and under its fixed name.
build_keyring_package() {
    local epoch version uid tmp pool
    epoch=$(gpg --batch --with-colons --list-sigs "$KEY" | awk -F: '$1 == "sig" && $6 > m { m = $6 } END { print m + 0 }')
    [ "$epoch" -gt 0 ] || die "no signature date on key $KEY"
    version=$(date -u -d "@$epoch" +%Y.%m.%d.%H%M%S)
    uid=$(gpg --batch --with-colons --list-keys "$KEY" | awk -F: '$1 == "uid" { print $10; exit }')
    [ -n "$uid" ] || die "key $KEY has no user id"

    tmp=$(mktemp -d)
    chmod 0755 "$tmp"
    install -d -m 0755 "$tmp/DEBIAN" "$tmp$(dirname "$KEYRING_PATH")" "$tmp$(dirname "$SOURCES_FILE")"
    install -m 0644 "$OUT/$KEY_FILE" "$tmp$KEYRING_PATH"
    printf 'Types: deb\nURIs: %s\nSuites: %s\nComponents: %s\nSigned-By: %s\n' \
        "$URL" "$SUITE" "$COMPONENT" "$KEYRING_PATH" > "$tmp$SOURCES_FILE"
    chmod 0644 "$tmp$SOURCES_FILE"
    printf '%s\n' "$SOURCES_FILE" > "$tmp/DEBIAN/conffiles"
    cat > "$tmp/DEBIAN/control" <<EOF
Package: $KEYRING_PKG
Version: $version
Architecture: all
Maintainer: $uid
Section: misc
Priority: optional
Homepage: https://lattice-md.app
Description: signing key and source entry of the Lattice APT repository
 Lets apt install and update Lattice (package lattice, also lattice-md) from
 $URL and check every download against the key.
 A new key or a new expiry date arrives as an update of this package.
EOF
    find "$tmp" -exec touch -h -d "@$epoch" {} +
    pool="$OUT/pool/$COMPONENT/l/$KEYRING_PKG"
    mkdir -p "$pool"
    SOURCE_DATE_EPOCH=$epoch dpkg-deb --root-owner-group -Zxz --build "$tmp" "$pool/${KEYRING_PKG}_${version}_all.deb" >/dev/null
    cp "$pool/${KEYRING_PKG}_${version}_all.deb" "$OUT/$KEYRING_PKG.deb"
    rm -rf "$tmp"
}
# build_keyring_package END ***********************************


#**************************************************************
# write_index
#**************************************************************
# Packages per architecture, then the signed Release.
write_index() {
    local arch dir
    for arch in $ARCHS; do
        dir="dists/$SUITE/$COMPONENT/binary-$arch"
        mkdir -p "$OUT/$dir"
        (cd "$OUT" && dpkg-scanpackages --arch "$arch" --multiversion pool /dev/null 2>/dev/null) > "$OUT/$dir/Packages"
        gzip -9nkf "$OUT/$dir/Packages"
    done
    (cd "$OUT/dists/$SUITE" && apt-ftparchive \
        -o APT::FTPArchive::Release::Origin=Lattice \
        -o APT::FTPArchive::Release::Label=Lattice \
        -o APT::FTPArchive::Release::Suite="$SUITE" \
        -o APT::FTPArchive::Release::Codename="$SUITE" \
        -o APT::FTPArchive::Release::Architectures="$ARCHS" \
        -o APT::FTPArchive::Release::Components="$COMPONENT" \
        -o APT::FTPArchive::Release::Description='Lattice, the Markdown editor' \
        release .) > "$OUT/Release.tmp"
    mv "$OUT/Release.tmp" "$OUT/dists/$SUITE/Release"
    gpg_sign --clearsign --output "$OUT/dists/$SUITE/InRelease" "$OUT/dists/$SUITE/Release"
    gpg_sign --armor --detach-sign --output "$OUT/dists/$SUITE/Release.gpg" "$OUT/dists/$SUITE/Release"
    # Self-check against the published key, the way apt will check it.
    gpgv --keyring "$OUT/$KEY_FILE" "$OUT/dists/$SUITE/InRelease" 2>/dev/null || die "InRelease does not verify against $KEY_FILE"
    gpgv --keyring "$OUT/$KEY_FILE" "$OUT/dists/$SUITE/Release.gpg" "$OUT/dists/$SUITE/Release" 2>/dev/null || die "Release.gpg does not verify"
}
# write_index END *********************************************


DEBS='' OUT='' KEY='' URL='https://lattice-md.app/apt'
while [ $# -gt 0 ]; do
    case "$1" in
        --debs) DEBS=${2:-}; shift 2 ;;
        --out) OUT=${2:-}; shift 2 ;;
        --key-id) KEY=${2:-}; shift 2 ;;
        --url) URL=${2:-}; shift 2 ;;
        *) die "unknown argument '$1' (usage: apt-repo.sh --debs DIR --out DIR --key-id KEY [--url URL])" ;;
    esac
done
[ -d "$DEBS" ] || die "--debs: '$DEBS' is not a directory"
[ -n "$OUT" ] || die "--out is required"
[ -n "$KEY" ] || die "--key-id is required"
for tool in dpkg-deb dpkg-scanpackages apt-ftparchive gpg gpgv; do
    command -v "$tool" >/dev/null || die "$tool not found (Ubuntu packages dpkg-dev, apt-utils, gnupg, gpgv)"
done
gpg --batch --list-secret-keys "$KEY" >/dev/null 2>&1 || die "no secret key '$KEY' in gpg's keyring"

shopt -s nullglob
debs=( "$DEBS"/lattice_*.deb )
[ "${#debs[@]}" -gt 0 ] || die "no lattice_*.deb in '$DEBS'"
for deb in "${debs[@]}"; do
    arch=$(dpkg-deb -f "$deb" Architecture)
    case " $ARCHS " in *" $arch "*) ;; *) die "$deb: architecture '$arch' is not one of: $ARCHS" ;; esac
    [ "$(dpkg-deb -f "$deb" Package)" = lattice ] || die "$deb: package is not 'lattice'"
done

# Built beside DEST and moved in only when complete and verified, so a failure
# (e.g. a wrong passphrase) never leaves a half-built or unsigned repository.
mkdir -p "$OUT"
DEST=$(cd "$OUT" && pwd)
OUT=$(mktemp -d "$DEST/.apt-repo.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
mkdir -p "$OUT/pool/$COMPONENT/l/lattice"
cp "${debs[@]}" "$OUT/pool/$COMPONENT/l/lattice/"
gpg --batch --export "$KEY" > "$OUT/$KEY_FILE"
gpg --batch --armor --export "$KEY" > "$OUT/${KEY_FILE%.gpg}.asc"
[ -s "$OUT/$KEY_FILE" ] || die "could not export the public key of $KEY"
build_keyring_package
write_index
rm -rf "$DEST/pool" "$DEST/dists"
mv "$OUT/pool" "$OUT/dists" "$DEST/"
mv -f "$OUT/$KEY_FILE" "$OUT/${KEY_FILE%.gpg}.asc" "$OUT/$KEYRING_PKG.deb" "$DEST/"
echo "apt-repo: $DEST — ${#debs[@]} lattice package(s) + $KEYRING_PKG, signed by $KEY"
