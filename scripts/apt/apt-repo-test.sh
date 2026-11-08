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
# apt-repo-test.sh DEB_DIR
#
# STST of REQ-LTTCE-APT-00001: builds the repository with apt-repo.sh from the
# freshly built .deb(s) in DEB_DIR, signed by a throwaway key, and lets the real
# apt-get use it through the source entry the keyring package ships. No root,
# and nothing of the machine's own apt setup or gpg keyring is touched.
#
# Checks: the index verifies; `lattice` and `lattice-md-keyring` download with
# matching hashes; `lattice-md` names `lattice` (Provides); the keyring package
# is byte-identical when built again from the same key; a tampered index and a
# tampered package are refused.
################################################################################
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEBS=$(cd "${1:?usage: apt-repo-test.sh DEB_DIR}" && pwd)
WORK=$(mktemp -d)
export GNUPGHOME="$WORK/gnupg"
cleanup() { gpgconf --kill gpg-agent 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -m 0700 "$GNUPGHOME"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok - $*"; }


#**************************************************************
# apt_in
#**************************************************************
# apt-get / apt-cache confined to state dir $1, using only the source entry
# from the keyring package of repository $2 (URI and key path pointed at it).
apt_in() {
    local st=$1 repo=$2 tool=$3; shift 3
    mkdir -p "$st"/{lists/partial,cache/archives/partial,sources,kr}
    dpkg-deb -x "$repo/lattice-md-keyring.deb" "$st/kr"
    sed -e "s|^URIs: .*|URIs: file://$repo|" \
        -e "s|^Signed-By: .*|Signed-By: $st/kr/usr/share/keyrings/lattice-md.gpg|" \
        "$st/kr/etc/apt/sources.list.d/lattice-md.sources" > "$st/sources/lattice-md.sources"
    "$tool" -q -o Dir::Etc::SourceList=/dev/null -o Dir::Etc::SourceParts="$st/sources" \
        -o Dir::State::Lists="$st/lists" -o Dir::Cache="$st/cache" -o Debug::NoLocking=1 \
        -o APT::Sandbox::User="$(id -un)" "$@"
}
# apt_in END **************************************************


gpg --batch --passphrase '' --quick-generate-key 'Lattice CI throwaway <ci@invalid.example>' ed25519 sign 1d 2>/dev/null
KEY=$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')
REPO="$WORK/repo"
bash "$HERE/apt-repo.sh" --debs "$DEBS" --out "$REPO" --key-id "$KEY"
ARCH=$(dpkg-deb -f "$(ls "$DEBS"/lattice_*.deb | head -1)" Architecture)
VERSION=$(dpkg-deb -f "$(ls "$DEBS"/lattice_*.deb | head -1)" Version)

# 1. The real apt accepts the signed index.
ST="$WORK/state-ok"
apt_in "$ST" "$REPO" apt-get -o APT::Architecture="$ARCH" update >"$WORK/update.log" 2>&1 \
    || { cat "$WORK/update.log"; fail "apt-get update refused the repository"; }
grep -qE '^(W|E):' "$WORK/update.log" && { cat "$WORK/update.log"; fail "apt-get update warned"; }
pass "apt-get update accepts the signed index ($ARCH)"

# 2. Both packages download through the hash chain, unchanged.
(cd "$WORK" && apt_in "$ST" "$REPO" apt-get -o APT::Architecture="$ARCH" download lattice lattice-md-keyring >/dev/null)
cmp -s "$WORK/lattice_${VERSION}_${ARCH}.deb" "$DEBS/lattice_${VERSION}_${ARCH}.deb" || fail "downloaded lattice differs from the build"
cmp -s "$WORK"/lattice-md-keyring_*_all.deb "$REPO/lattice-md-keyring.deb" || fail "downloaded keyring package differs"
pass "lattice $VERSION and lattice-md-keyring download with matching hashes"

# 3. `apt install lattice-md` finds lattice.
apt_in "$ST" "$REPO" apt-cache -o APT::Architecture="$ARCH" showpkg lattice-md | sed -n '/^Reverse Provides:/,$p' | grep -q "^lattice $VERSION" \
    || fail "lattice-md is not provided by lattice $VERSION"
pass "lattice-md is provided by lattice $VERSION"

# 4. The keyring package is reproducible: same key, same bytes, same version.
bash "$HERE/apt-repo.sh" --debs "$DEBS" --out "$WORK/repo2" --key-id "$KEY" >/dev/null
cmp -s "$REPO/lattice-md-keyring.deb" "$WORK/repo2/lattice-md-keyring.deb" || fail "keyring package differs between two builds"
pass "keyring package is byte-identical when rebuilt"

# 5. A tampered index is refused.
cp -a "$REPO" "$WORK/bad-index"
sed -i '0,/^ [0-9a-f]\{64\} /s//&X/' "$WORK/bad-index/dists/stable/InRelease"
rm "$WORK/bad-index/dists/stable/Release.gpg"
ST="$WORK/state-bad-index"
apt_in "$ST" "$WORK/bad-index" apt-get -o APT::Architecture="$ARCH" update >/dev/null 2>&1 || true
if (cd "$WORK" && apt_in "$ST" "$WORK/bad-index" apt-get -o APT::Architecture="$ARCH" download lattice >/dev/null 2>&1); then
    fail "a tampered InRelease was accepted"
fi
pass "a tampered index is refused"

# 6. A tampered package is refused.
cp -a "$REPO" "$WORK/bad-deb"
printf 'X' >> "$WORK/bad-deb/pool/main/l/lattice/lattice_${VERSION}_${ARCH}.deb"
ST="$WORK/state-bad-deb"
mkdir -p "$WORK/dl"
apt_in "$ST" "$WORK/bad-deb" apt-get -o APT::Architecture="$ARCH" update >/dev/null 2>&1
if (cd "$WORK/dl" && apt_in "$ST" "$WORK/bad-deb" apt-get -o APT::Architecture="$ARCH" download lattice >/dev/null 2>&1); then
    fail "a tampered package was accepted"
fi
pass "a tampered package is refused"

# 7. A failed signing (wrong passphrase) leaves the existing repository as it was.
gpg --batch --pinentry-mode loopback --passphrase 'right' --quick-generate-key 'Lattice CI throwaway 2 <ci2@invalid.example>' ed25519 sign 1d 2>/dev/null
KEY2=$(gpg --batch --with-colons --list-secret-keys 'ci2@invalid.example' | awk -F: '$1 == "fpr" { print $10; exit }')
gpgconf --kill gpg-agent
before=$(cd "$REPO" && find . -type f -exec sha256sum {} + | sort)
if GPG_PASSPHRASE=wrong bash "$HERE/apt-repo.sh" --debs "$DEBS" --out "$REPO" --key-id "$KEY2" >/dev/null 2>&1; then
    fail "signing with a wrong passphrase succeeded"
fi
[ "$(cd "$REPO" && find . -type f -exec sha256sum {} + | sort)" = "$before" ] || fail "a failed run changed the repository"
pass "a failed signing leaves the repository unchanged"

echo "apt-repo-test: all checks passed"
