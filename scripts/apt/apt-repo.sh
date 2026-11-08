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
# apt-repo.sh --debs DIR --out DIR --key-id KEY [--previous-key OLD] [--url URL]
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
# a renewed key reaches users with `apt upgrade`.
#
# To replace the key in one release, give the new key as --key-id and the old one
# as --previous-key: the index is signed by both and the keyring package carries
# both, so clients that still trust only the old key accept the update.
#
# KEY (and OLD) must be in gpg's keyring with the secret part; GPG_PASSPHRASE, if
# set, unlocks them, so both need the same passphrase.
# Needs dpkg, dpkg-deb, dpkg-scanpackages, apt-ftparchive, gpg, gpgv.
################################################################################
set -euo pipefail
export LC_ALL=C

readonly SUITE=stable
readonly COMPONENT=main
readonly ARCHS='amd64 arm64'
readonly KEY_FILE=lattice-md.gpg
readonly KEYRING_PKG=lattice-md-keyring
readonly SOURCES_FILE=/etc/apt/sources.list.d/lattice-md.sources
readonly KEYRING_PATH=/usr/share/keyrings/lattice-md.gpg

#**************************************************************
# die
#**************************************************************
die() { echo "apt-repo: $*" >&2; exit 1; }
# die END *****************************************************


#**************************************************************
# gpg_sign
#**************************************************************
# gpg in batch mode, one signature per key; the passphrase, when given, goes in
# on fd 3, never on the command line.
gpg_sign() {
    local key signers=()
    for key in "${KEYS[@]}"; do signers+=( --local-user "$key" ); done
    if [ -n "${GPG_PASSPHRASE:-}" ]; then
        gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 "${signers[@]}" "$@" 3<<<"$GPG_PASSPHRASE"
    else
        gpg --batch --yes "${signers[@]}" "$@"
    fi
}
# gpg_sign END ************************************************


#**************************************************************
# build_keyring_package
#**************************************************************
# Writes the keyring package into pool and under its fixed name.
build_keyring_package() {
    local epoch version uid tmp pool
    epoch=$(gpg --batch --with-colons --list-sigs "${KEYS[@]}" | awk -F: '$1 == "sig" && $6 > m { m = $6 } END { print m + 0 }')
    [ "$epoch" -gt 0 ] || die "no signature date on key $KEY"
    version=$(date -u -d "@$epoch" +%Y.%m.%d.%H%M%S)
    uid=$(gpg --batch --with-colons --list-keys "$KEY" | awk -F: '$1 == "uid" { print $10; exit }')
    [ -n "$uid" ] || die "key $KEY has no user id"

    tmp="$OUT/keyring-root"
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
}
# build_keyring_package END ***********************************


#**************************************************************
# require_higher_keyring_version
#**************************************************************
# apt installs only a higher version, so changed content under the same or a
# lower version would never reach users. Compares with the package already
# published in DEST, by content: another dpkg or xz may compress differently.
# Only the installed files count: a change to the control text alone changes
# nothing on a user's machine and must not stop a release.
require_higher_keyring_version() {
    local old="$DEST/$KEYRING_PKG.deb" new="$OUT/$KEYRING_PKG.deb" old_v new_v
    [ -f "$old" ] || return 0
    mkdir "$OUT/keyring-old" "$OUT/keyring-new"
    dpkg-deb -x "$old" "$OUT/keyring-old"
    dpkg-deb -x "$new" "$OUT/keyring-new"
    diff -r "$OUT/keyring-old" "$OUT/keyring-new" >/dev/null && return 0
    old_v=$(dpkg-deb -f "$old" Version)
    new_v=$(dpkg-deb -f "$new" Version)
    dpkg --compare-versions "$new_v" gt "$old_v" \
        || die "keyring package changed but needs a higher version than $old_v (got $new_v): renew the --key-id key (gpg --quick-set-expire) so that its newest signature is newer than any before"
}
# require_higher_keyring_version END **************************


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


DEBS='' OUT='' KEY='' PREVIOUS_KEY='' URL='https://lattice-md.app/apt'
while [ $# -gt 0 ]; do
    case "$1" in --debs|--out|--key-id|--previous-key|--url) [ $# -ge 2 ] || die "$1 needs a value" ;; esac
    case "$1" in
        --debs) DEBS=${2:-}; shift 2 ;;
        --out) OUT=${2:-}; shift 2 ;;
        --key-id) KEY=${2:-}; shift 2 ;;
        --previous-key) PREVIOUS_KEY=${2:-}; shift 2 ;;
        --url) URL=${2:-}; shift 2 ;;
        *) die "unknown argument '$1' (usage: apt-repo.sh --debs DIR --out DIR --key-id KEY [--previous-key OLD] [--url URL])" ;;
    esac
done
[ -d "$DEBS" ] || die "--debs: '$DEBS' is not a directory"
[ -n "$OUT" ] || die "--out is required"
[ -n "$KEY" ] || die "--key-id is required"
[ -n "$URL" ] || die "--url must not be empty"
[ "$PREVIOUS_KEY" != "$KEY" ] || die "--previous-key must differ from --key-id"
KEYS=( "$KEY" )
[ -z "$PREVIOUS_KEY" ] || KEYS+=( "$PREVIOUS_KEY" )
for tool in dpkg dpkg-deb dpkg-scanpackages apt-ftparchive gpg gpgv; do
    command -v "$tool" >/dev/null || die "$tool not found (Ubuntu packages dpkg-dev, apt-utils, gnupg, gpgv)"
done
for key in "${KEYS[@]}"; do
    gpg --batch --list-secret-keys "$key" >/dev/null 2>&1 || die "no secret key '$key' in gpg's keyring"
done

shopt -s nullglob
debs=( "$DEBS"/lattice_*.deb )
[ "${#debs[@]}" -gt 0 ] || die "no lattice_*.deb in '$DEBS'"
for deb in "${debs[@]}"; do
    arch=$(dpkg-deb -f "$deb" Architecture)
    case " $ARCHS " in *" $arch "*) ;; *) die "$deb: architecture '$arch' is not one of: $ARCHS" ;; esac
    [ "$(dpkg-deb -f "$deb" Package)" = lattice ] || die "$deb: package is not 'lattice'"
done

# Built in a hidden folder inside DEST (same file system, so the final mv is a
# rename) and moved in only when complete and verified, so a failure
# (e.g. a wrong passphrase) never leaves a half-built or unsigned repository.
mkdir -p "$OUT"
DEST=$(cd "$OUT" && pwd)
OUT=$(mktemp -d "$DEST/.apt-repo.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
mkdir -p "$OUT/pool/$COMPONENT/l/lattice"
cp "${debs[@]}" "$OUT/pool/$COMPONENT/l/lattice/"
gpg --batch --export "${KEYS[@]}" > "$OUT/$KEY_FILE"
gpg --batch --armor --export "${KEYS[@]}" > "$OUT/${KEY_FILE%.gpg}.asc"
[ -s "$OUT/$KEY_FILE" ] || die "could not export the public key of $KEY"
build_keyring_package
require_higher_keyring_version
write_index
rm -rf "$DEST/pool" "$DEST/dists"
mv "$OUT/pool" "$OUT/dists" "$DEST/"
mv -f "$OUT/$KEY_FILE" "$OUT/${KEY_FILE%.gpg}.asc" "$OUT/$KEYRING_PKG.deb" "$DEST/"
echo "apt-repo: $DEST — ${#debs[@]} lattice package(s) + $KEYRING_PKG, signed by ${KEYS[*]}"
