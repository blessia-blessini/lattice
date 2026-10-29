// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE
////////////////////////////////////////////////////////////////////////////////

/// What a build is, for the release FOSS gate (release-plan.mjs)
///
/// IMPL-LTTCE-FOS-00009 — REQ-LTTCE-FOS-00009. The build decides its kind once,
/// in its setup job, and every later job follows it: a release (tag vX.Y.Z), a
/// candidate (tag vX.Y.Z-suffix: built and checked like a release, never
/// published) or an ordinary build. Releases and candidates always ship the
/// notices of their own deep scan; after a release, whether those differ from
/// the committed ones decides if a pull request brings them back to dev.
///
/// Pure: no file system, no git.

/** A release tag: exactly vX.Y.Z. */
const RELEASE_TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
/** A candidate tag: vX.Y.Z and a suffix (-rc1, -rc.2, -test). */
const CANDIDATE_TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z][0-9A-Za-z.-]*$/;
const TAG_PREFIX = 'refs/tags/';
export const KINDS = Object.freeze(['release', 'candidate', 'build']);


//**************************************************************
// releaseKind
//**************************************************************
/**
 * The kind of a build from its git ref (GitHub's `github.ref`).
 * @param {string} ref e.g. "refs/tags/v0.3.52", "refs/heads/dev"
 * @returns {'release'|'candidate'|'build'}
 */
export function releaseKind(ref) {
    const text = String(ref ?? '');
    if (!text.startsWith(TAG_PREFIX)) return 'build';
    const tag = text.slice(TAG_PREFIX.length);
    if (RELEASE_TAG_RE.test(tag)) return 'release';
    if (CANDIDATE_TAG_RE.test(tag)) return 'candidate';
    return 'build';
}
// releaseKind END *********************************************


//**************************************************************
// additionsDifference
//**************************************************************
/**
 * Whether two notice-additions files say the same, ignoring `source` (which
 * scan, when): the topics only in one of them, and those that differ.
 * @param {{additions: object[]}} committed foss/notice-additions.json
 * @param {{additions: object[]}} fresh the scan's notice-additions.json
 * @returns {{equal: boolean, added: string[], removed: string[], changed: string[]}} topic ids
 */
export function additionsDifference(committed, fresh) {
    const byTopic = (data) => new Map((data?.additions ?? []).map((a) => [a.topic, JSON.stringify(a)]));
    const before = byTopic(committed);
    const after = byTopic(fresh);
    const added = [...after.keys()].filter((t) => !before.has(t)).sort();
    const removed = [...before.keys()].filter((t) => !after.has(t)).sort();
    const changed = [...after.keys()].filter((t) => before.has(t) && before.get(t) !== after.get(t)).sort();
    return { equal: !added.length && !removed.length && !changed.length, added, removed, changed };
}
// additionsDifference END *************************************
