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
# tampered package are refused; a failed signing changes nothing; signing with
# a passphrase works; a renewed key and a replaced key raise the keyring package's
# version and are accepted by clients that still hold the earlier keyring.
#
# Not tested here; only a full vX.Y.Z release can: signing with the real key
# (buildAndTest.yml step 903.7), the upload to lattice-md.app (step 905), and a
# real `sudo apt install` from the site (by hand, after the release).
################################################################################
set -euo pipefail
export LC_ALL=C

HERE=$(cd "$(dirname "$0")" && pwd)
DEBS=$(cd "${1:?usage: apt-repo-test.sh DEB_DIR}" && pwd)
WORK=$(mktemp -d)
export GNUPGHOME="$WORK/gnupg"


#**************************************************************
# cleanup
#**************************************************************
cleanup() { gpgconf --kill gpg-agent 2>/dev/null || true; rm -rf "$WORK"; }
# cleanup END *************************************************


trap cleanup EXIT
mkdir -m 0700 "$GNUPGHOME"


#**************************************************************
# fail
#**************************************************************
fail() { echo "FAIL: $*" >&2; exit 1; }
# fail END ****************************************************


#**************************************************************
# pass
#**************************************************************
pass() { echo "ok - $*"; }
# pass END ****************************************************


#**************************************************************
# apt_in
#**************************************************************
# apt-get / apt-cache confined to state dir $1, using only the source entry
# from the keyring package of repository $2 (URI and key path pointed at it).
# CLIENT_KEYRING, if set, is the keyring package the client already has instead.
apt_in() {
    local st=$1 repo=$2 tool=$3; shift 3
    mkdir -p "$st"/{lists/partial,cache/archives/partial,sources,kr}
    dpkg-deb -x "${CLIENT_KEYRING:-$repo/lattice-md-keyring.deb}" "$st/kr"
    sed -e "s|^URIs: .*|URIs: file://$repo|" \
        -e "s|^Signed-By: .*|Signed-By: $st/kr/usr/share/keyrings/lattice-md.gpg|" \
        "$st/kr/etc/apt/sources.list.d/lattice-md.sources" > "$st/sources/lattice-md.sources"
    "$tool" -q -o Dir::Etc::SourceList=/dev/null -o Dir::Etc::SourceParts="$st/sources" \
        -o Dir::State::Lists="$st/lists" -o Dir::State::status=/dev/null -o Dir::Cache="$st/cache" -o Debug::NoLocking=1 \
        -o APT::Sandbox::User="$(id -un)" "$@"
}
# apt_in END **************************************************


#**************************************************************
# apt_accepts
#**************************************************************
# apt-get update in state dir $1 against repository $2: no error, no warning.
apt_accepts() {
    apt_in "$1" "$2" apt-get -o APT::Architecture="$ARCH" update >"$WORK/update.log" 2>&1 \
        || { cat "$WORK/update.log"; fail "apt-get update refused the repository"; }
    if grep -qE '^(W|E):' "$WORK/update.log"; then cat "$WORK/update.log"; fail "apt-get update warned"; fi
}
# apt_accepts END *********************************************


#**************************************************************
# repo_hashes
#**************************************************************
repo_hashes() { (cd "$1" && find . -type f -exec sha256sum {} + | sort); }
# repo_hashes END *********************************************


#**************************************************************
# rotate_build
#**************************************************************
# Builds the repository of the key-change checks, with the right passphrase.
rotate_build() { GPG_PASSPHRASE=right bash "$HERE/apt-repo.sh" --debs "$DEBS" --out "$ROTATE" "$@" >/dev/null; }
# rotate_build END ********************************************


#**************************************************************
# keyring_version
#**************************************************************
keyring_version() { dpkg-deb -f "$ROTATE/lattice-md-keyring.deb" Version; }
# keyring_version END *****************************************


#**************************************************************
# renew
#**************************************************************
# Signature dates have a resolution of one second, and a renewal must be later.
renew() { sleep 2; gpg --batch --pinentry-mode loopback --passphrase right --quick-set-expire "$1" 2d; }
# renew END ***************************************************


gpg --batch --passphrase '' --quick-generate-key 'Lattice CI throwaway <ci@invalid.example>' ed25519 sign 1d 2>/dev/null
KEY=$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')
REPO="$WORK/repo"
bash "$HERE/apt-repo.sh" --debs "$DEBS" --out "$REPO" --key-id "$KEY"
ARCH=$(dpkg-deb -f "$(ls "$DEBS"/lattice_*.deb | head -1)" Architecture)
VERSION=$(dpkg-deb -f "$(ls "$DEBS"/lattice_*.deb | head -1)" Version)

# 1. The real apt accepts the signed index.
ST="$WORK/state-ok"
apt_accepts "$ST" "$REPO"
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

# 5. A tampered index is refused because of its signature: the changed line is
#    covered by no hash, so only the signature can reveal it.
cp -a "$REPO" "$WORK/bad-index"
sed -i 's/^Description: .*/Description: tampered/' "$WORK/bad-index/dists/stable/InRelease"
rm "$WORK/bad-index/dists/stable/Release.gpg"
ST="$WORK/state-bad-index"
if apt_in "$ST" "$WORK/bad-index" apt-get -o APT::Architecture="$ARCH" update >"$WORK/bad-index.log" 2>&1; then
    cat "$WORK/bad-index.log"; fail "a tampered InRelease was accepted"
fi
grep -qE 'BADSIG|signatures were invalid' "$WORK/bad-index.log" \
    || { cat "$WORK/bad-index.log"; fail "the index was refused, but not because of its signature"; }
pass "a tampered index is refused by its signature"

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
#    KEY2 is one signature date later, so the run gets past the version check to the signing.
sleep 2
gpg --batch --pinentry-mode loopback --passphrase 'right' --quick-generate-key 'Lattice CI throwaway 2 <ci2@invalid.example>' ed25519 sign 1d 2>/dev/null
KEY2=$(gpg --batch --with-colons --list-secret-keys 'ci2@invalid.example' | awk -F: '$1 == "fpr" { print $10; exit }')
gpgconf --kill gpg-agent
before=$(repo_hashes "$REPO")
if GPG_PASSPHRASE=wrong bash "$HERE/apt-repo.sh" --debs "$DEBS" --out "$REPO" --key-id "$KEY2" >/dev/null 2>&1; then
    fail "signing with a wrong passphrase succeeded"
fi
[ "$(repo_hashes "$REPO")" = "$before" ] || fail "a failed run changed the repository"
pass "a failed signing leaves the repository unchanged"

# 8. The path a release takes: a passphrase-protected key and the right passphrase.
ROTATE="$WORK/repo-rotate"
gpgconf --kill gpg-agent
rotate_build --key-id "$KEY2"
apt_accepts "$WORK/state-passphrase" "$ROTATE"
pass "signing with the right passphrase gives an index apt accepts"

# 9. A renewed key raises the keyring package's version.
version=$(keyring_version)
renew "$KEY2"
rotate_build --key-id "$KEY2"
dpkg --compare-versions "$(keyring_version)" gt "$version" || fail "renewing the key did not raise the version"
pass "a renewed key raises the keyring package version"

# 10. One release replaces the key: a client that has only the old key accepts the
#     index and gets the new keyring package, which carries both keys.
cp "$ROTATE/lattice-md-keyring.deb" "$WORK/old-client.deb"
version=$(keyring_version)
sleep 2
gpg --batch --pinentry-mode loopback --passphrase right --quick-generate-key 'Lattice CI throwaway 3 <ci3@invalid.example>' ed25519 sign 1d 2>/dev/null
KEY3=$(gpg --batch --with-colons --list-secret-keys 'ci3@invalid.example' | awk -F: '$1 == "fpr" { print $10; exit }')
gpgconf --kill gpg-agent
rotate_build --key-id "$KEY3" --previous-key "$KEY2"
dpkg --compare-versions "$(keyring_version)" gt "$version" || fail "replacing the key did not raise the version"
ST="$WORK/state-old-client"
CLIENT_KEYRING="$WORK/old-client.deb" apt_accepts "$ST" "$ROTATE"
mkdir "$WORK/dl-rotate"
(cd "$WORK/dl-rotate" && CLIENT_KEYRING="$WORK/old-client.deb" apt_in "$ST" "$ROTATE" apt-get -o APT::Architecture="$ARCH" download lattice-md-keyring >/dev/null)
cmp -s "$WORK"/dl-rotate/lattice-md-keyring_*_all.deb "$ROTATE/lattice-md-keyring.deb" || fail "the old client did not get the new keyring package"
dpkg-deb -x "$ROTATE/lattice-md-keyring.deb" "$WORK/both-keys"
[ "$(gpg --show-keys --with-colons "$WORK/both-keys/usr/share/keyrings/lattice-md.gpg" | grep -c '^pub:')" = 2 ] || fail "the new keyring package does not carry both keys"
pass "a client with only the old key accepts the replacement and gets both keys"

# 11. Dropping the old key changes the package, so it needs a higher version: refused
#     until the new key has a newer signature, then accepted by a client with both keys.
cp "$ROTATE/lattice-md-keyring.deb" "$WORK/both-client.deb"
version=$(keyring_version)
before=$(repo_hashes "$ROTATE")
if rotate_build --key-id "$KEY3" 2>"$WORK/guard.log"; then fail "a changed keyring package without a higher version was published"; fi
grep -q 'higher version' "$WORK/guard.log" || { cat "$WORK/guard.log"; fail "refused, but not because of the version"; }
[ "$(repo_hashes "$ROTATE")" = "$before" ] || fail "the refused run changed the repository"
renew "$KEY3"
rotate_build --key-id "$KEY3"
dpkg --compare-versions "$(keyring_version)" gt "$version" || fail "retiring the old key did not raise the version"
CLIENT_KEYRING="$WORK/both-client.deb" apt_accepts "$WORK/state-both-client" "$ROTATE"
pass "retiring the old key needs a higher version and reaches clients"

echo "apt-repo-test: all checks passed"
