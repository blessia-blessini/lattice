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
/// - the kind: a tag of exactly vX.Y.Z is a release (published only if the
///   release gate passes); any other tag is a candidate (built and checked like
///   a release, never published); a manual run on a branch is a build;
/// - the licence check (licenceCheckPlan): Legattice for every tag and for a
///   build whose form ticked USE_LEGATTICE, else the lightweight check;
///   Legattice deep (earlier results ignored) when ForceDeepScan is ticked;
///   a wrong LEGATTICE_URL, or an empty one while Legattice is used, stops it.
/// After the builds, the release gate (gateReasons) says what blocks the
/// publication; and whether two notice-additions files agree.
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
 * What the repository variable LEGATTICE_URL says: where Legattice is.
 * Not set (empty) = nowhere (scan false): enough for the lightweight check,
 * an error once Legattice is to be used (licenceCheckPlan). The supported URL
 * (case, a trailing "/" or ".git" ignored) = scan true. Anything else is a
 * mistake, reported rather than silently building without the scan.
 * @param {string|undefined|null} url the variable's value
 * @returns {{scan: boolean, error: string|null}}
 */
export function deepScanSetting(url) {
    const text = String(url ?? '').trim();
    if (!text) return { scan: false, error: null };
    const normal = (u) => u.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
    if (normal(text) === normal(LEGATTICE_URL)) return { scan: true, error: null };
    return { scan: false, error: `LEGATTICE_URL is "${text}"; the build can only call ${LEGATTICE_URL} -- Legattice cannot be found at LEGATTICE_URL; set it to that` };
}
// deepScanSetting END *****************************************


//**************************************************************
// licenceCheckPlan
//**************************************************************
/**
 * Which licence check a build runs (REQ-LTTCE-FOS-00009). The form's boxes
 * arrive as text: "true", "false", or empty on a push (no form); only
 * "true" ticks a box.
 * @param {object} input
 * @param {'release'|'candidate'|'build'} input.kind see releaseKind
 * @param {string|undefined|null} input.url the repository variable LEGATTICE_URL
 * @param {string|undefined|null} input.useLegattice the form's USE_LEGATTICE
 * @param {string|undefined|null} input.forceDeepScan the form's ForceDeepScan
 * @returns {{useLegattice: boolean, deep: boolean, tagOverride: boolean, forceIgnored: boolean, error: string|null}}
 *   tagOverride: a tag switched Legattice on although the box was not ticked;
 *   forceIgnored: ForceDeepScan ticked without Legattice; error: stop the build
 */
export function licenceCheckPlan({ kind, url, useLegattice, forceDeepScan }) {
    const ticked = (value) => String(value ?? '').trim() === 'true';
    const use = kind !== 'build' || ticked(useLegattice);
    const plan = {
        useLegattice: use,
        deep: use && ticked(forceDeepScan),
        tagOverride: kind !== 'build' && !ticked(useLegattice),
        forceIgnored: !use && ticked(forceDeepScan),
        error: null,
    };
    const setting = deepScanSetting(url);
    if (setting.error) return { ...plan, error: setting.error };
    if (use && !setting.scan) {
        return { ...plan, error: `Legattice is to be used, but LEGATTICE_URL is empty -- set the repository variable to ${LEGATTICE_URL}` };
    }
    return plan;
}
// licenceCheckPlan END ****************************************


//**************************************************************
// gateReasons
//**************************************************************
/**
 * What blocks the publication of a build (REQ-LTTCE-FOS-00009), from the
 * results of its jobs ("success", "failure", "cancelled", "skipped", or
 * empty). Each reason comes with what to correct. Only a release is
 * blocked by them; for a candidate or a build they are only reported.
 * @param {object} state
 * @param {'release'|'candidate'|'build'} state.kind
 * @param {boolean} state.useLegattice
 * @param {Record<'build'|'msix'|'light'|'scan'|'notices', string|undefined>} state.results
 *   build-and-test, package-msix-bundle, foss-compliance (lightweight),
 *   foss-scan, foss-compliance-release
 * @param {string|undefined} state.changed foss-compliance-release's output "changed"
 * @returns {{what: string, fix: string}[]} empty: nothing blocks
 */
export function gateReasons({ kind, useLegattice, results, changed }) {
    const result = (job) => results?.[job] || 'not run';
    const reasons = [];
    if (result('build') !== 'success') {
        reasons.push({ what: `the build legs did not succeed (${result('build')})`, fix: 'see the failed build-and-test jobs' });
    }
    if (kind !== 'build' && result('msix') !== 'success') {
        reasons.push({ what: `the MSIX bundle did not succeed (${result('msix')})`, fix: 'see the package-msix-bundle job' });
    }
    if (!useLegattice) {
        if (result('light') !== 'success') {
            reasons.push({ what: `the lightweight licence check did not succeed (${result('light')})`, fix: 'see the foss-compliance job' });
        }
    } else if (result('scan') !== 'success') {
        reasons.push({
            what: `the Legattice scan did not succeed (${result('scan')}): topics without a decision, or a scan failure`,
            fix: 'decide the topics in the Legattice ledger, then "Re-run failed jobs" here; or see the foss-scan jobs for the failure',
        });
    } else if (result('notices') !== 'success') {
        reasons.push({
            what: `the licence check of the scan's notices did not succeed (${result('notices')})`,
            fix: 'see the foss-compliance-release job (licence policy, vulnerability audit, notices)',
        });
    } else if (String(changed ?? '').trim() === 'true') {
        reasons.push({
            what: 'the notices made from the scan differ from the committed ones',
            fix: kind === 'release'
                ? 'merge the pull request that brings them to dev (job notices-to-dev), then build again from a new tag'
                : 'commit the scan\'s notices to dev (artifact release-notices), as a release would by pull request',
        });
    }
    return reasons;
}
// gateReasons END *********************************************


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
