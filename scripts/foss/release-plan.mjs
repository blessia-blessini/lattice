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
/// IMPL-LTTCE-FOS-00009 — REQ-LTTCE-FOS-00009. The build decides once, in its
/// setup job, and every later job follows it:
/// - the kind: a tag of exactly vX.Y.Z is a release (published); any other tag
///   is a candidate (built and checked like a release, never published); a
///   branch or manual run is an ordinary build;
/// - whether the deep scan (Legattice) takes part: only on a release or a
///   candidate, and only when the repository variable LEGATTICE_URL names the
///   supported Legattice. Without it a tag builds as before the deep scan
///   existed: committed notices, no scan, no pull request.
/// And, after a release, whether two notice-additions files agree.
///
/// Pure: no file system, no git.

/** A release tag: exactly vX.Y.Z. */
const RELEASE_TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const TAG_PREFIX = 'refs/tags/';
export const KINDS = Object.freeze(['release', 'candidate', 'build']);
/**
 * The one Legattice the build can call: GitHub resolves a called workflow
 * from a fixed `uses:` line, never from a variable, so LEGATTICE_URL can only
 * switch the scan on for this repository -- keep in sync with `foss-scan` in
 * .github/workflows/buildAndTest.yml.
 */
export const LEGATTICE_URL = 'https://github.com/blessia-blessini/legattice';


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
    return RELEASE_TAG_RE.test(text.slice(TAG_PREFIX.length)) ? 'release' : 'candidate';
}
// releaseKind END *********************************************


//**************************************************************
// deepScanSetting
//**************************************************************
/**
 * What the repository variable LEGATTICE_URL says about the deep scan.
 * Not set (empty) = no Legattice: the build runs without the scan. The
 * supported URL (case, a trailing "/" or ".git" ignored) = scan. Anything else
 * is a mistake, reported rather than silently building without the scan.
 * @param {string|undefined|null} url the variable's value
 * @returns {{scan: boolean, error: string|null}}
 */
export function deepScanSetting(url) {
    const text = String(url ?? '').trim();
    if (!text) return { scan: false, error: null };
    const normal = (u) => u.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
    if (normal(text) === normal(LEGATTICE_URL)) return { scan: true, error: null };
    return { scan: false, error: `LEGATTICE_URL is "${text}"; the build can only call ${LEGATTICE_URL} -- set it to that, or delete the variable to build without the deep scan` };
}
// deepScanSetting END *****************************************


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
