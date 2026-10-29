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
/// IMPL-LTTCE-FOS-00009 — REQ-LTTCE-FOS-00009. The release build decides two
/// things once, in its setup job, and every later job follows them:
/// - the kind: a release (tag vX.Y.Z), a candidate (tag vX.Y.Z-suffix: built
///   and checked like a release, never published) or an ordinary build;
/// - whether the shipped dependencies changed since the scan that the
///   committed foss/notice-additions.json was made from: then the deep scan
///   runs before the build legs, which ship its fresh notices; else it runs
///   beside them, and the fresh notice additions must equal the committed ones.
/// And, for the parallel path, whether two notice-additions files agree.
///
/// Pure apart from what the callers pass in (file texts, git output).

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
// cargoLockVersions
//**************************************************************
/**
 * The registry and git crates of a Cargo.lock as "name -> versions". Path
 * crates (no `source`) are Lattice's own code -- among them lattice itself,
 * whose version changes with every release -- and are left out.
 * @param {string} text Cargo.lock
 * @returns {Map<string, string>} "cargo:name" -> sorted versions joined by ","
 */
export function cargoLockVersions(text) {
    const versions = new Map();
    for (const block of String(text).split(/^\[\[package\]\]\s*$/m).slice(1)) {
        const field = (name) => block.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
        const name = field('name');
        const version = field('version');
        if (!name || !version || !field('source')) continue;
        const key = `cargo:${name}`;
        versions.set(key, [...(versions.get(key)?.split(',') ?? []), version].sort().join(','));
    }
    return versions;
}
// cargoLockVersions END ***************************************


//**************************************************************
// npmLockVersions
//**************************************************************
/**
 * The installed packages of a package-lock.json (lockfile v2/v3) as
 * "lock key -> version". The root entry (Lattice itself) and links to
 * local folders are left out.
 * @param {object} lock parsed package-lock.json
 * @returns {Map<string, string>} "npm:node_modules/..." -> version
 */
export function npmLockVersions(lock) {
    const versions = new Map();
    for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
        if (key === '' || entry?.link === true || typeof entry?.version !== 'string') continue;
        versions.set(`npm:${key}`, entry.version);
    }
    return versions;
}
// npmLockVersions END *****************************************


//**************************************************************
// dependencyChanges
//**************************************************************
/**
 * What differs between two version maps, each list sorted.
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {{added: string[], removed: string[], changed: string[]}}
 *   added "key@version", removed "key@version", changed "key old -> new"
 */
export function dependencyChanges(before, after) {
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, version] of after) {
        if (!before.has(key)) added.push(`${key}@${version}`);
        else if (before.get(key) !== version) changed.push(`${key} ${before.get(key)} -> ${version}`);
    }
    for (const [key, version] of before) {
        if (!after.has(key)) removed.push(`${key}@${version}`);
    }
    return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
// dependencyChanges END ***************************************


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
