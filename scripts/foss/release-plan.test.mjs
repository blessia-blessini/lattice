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

/// Tests of release-plan.mjs and the commands built on it (REQ-LTTCE-FOS-00009).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandCompareAdditions, commandReleaseGate, commandReleasePlan, parseArgs } from './foss.mjs';
import { additionsDifference, deepScanSetting, gateReasons, LEGATTICE_URL, licenceCheckPlan, releaseKind } from './release-plan.mjs';

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const addition = (topic, extra = {}) => ({ topic, package: { ecosystem: 'npm', name: 'katex', version: '1' }, licences: ['OFL-1.1'], files: [{ path: 'a', sha1: '0'.repeat(40), lines: [[1, 1]] }], copyrights: [], ...extra });


describe('releaseKind', () => {
    // The rule: a tag of exactly vX.Y.Z publishes; every other tag rehearses; no tag builds.
    it.each([
        ['refs/tags/v0.3.52', 'release'],
        ['refs/tags/v10.0.0', 'release'],
        ['refs/tags/v0.3.52-rc1', 'candidate'],
        ['refs/tags/v0.3.52a', 'candidate'],
        ['refs/tags/v0.3.52b', 'candidate'],
        ['refs/tags/v0.3.52-', 'candidate'],
        ['refs/tags/v0.3', 'candidate'],
        ['refs/tags/x0.3.52', 'candidate'],
        ['refs/tags/v0.3.52 ', 'candidate'],
        ['refs/heads/v0.3.52', 'build'],
        ['refs/heads/dev', 'build'],
        ['', 'build'],
        [undefined, 'build'],
    ])('%j is a %s', (ref, kind) => {
        expect(releaseKind(ref)).toBe(kind);
    });
});


describe('deepScanSetting', () => {
    it.each([
        [undefined, { scan: false, error: null }],
        ['', { scan: false, error: null }],
        ['   ', { scan: false, error: null }],
        [LEGATTICE_URL, { scan: true, error: null }],
        [`${LEGATTICE_URL}/`, { scan: true, error: null }],
        [`${LEGATTICE_URL}.git`, { scan: true, error: null }],
        [` ${LEGATTICE_URL.toUpperCase()} `, { scan: true, error: null }],
    ])('%j -> %j', (url, expected) => {
        expect(deepScanSetting(url)).toEqual(expected);
    });

    it.each(['https://github.com/someone-else/legattice', 'blessia-blessini/legattice', 'https://github.com/blessia-blessini/legatice'])(
        'refuses %j, naming the one it can call', (url) => {
            const s = deepScanSetting(url);
            expect(s.scan).toBe(false);
            expect(s.error).toContain(LEGATTICE_URL);
            expect(s.error).toMatch(/Legattice cannot be found at LEGATTICE_URL/);
        });
});


describe('licenceCheckPlan', () => {
    const plan = (kind, url, useLegattice, forceDeepScan) => licenceCheckPlan({ kind, url, useLegattice, forceDeepScan });

    it('makes every tag use Legattice, and says so when the box was not ticked', () => {
        for (const kind of ['release', 'candidate']) {
            expect(plan(kind, LEGATTICE_URL, undefined, undefined)).toEqual({ useLegattice: true, deep: false, tagOverride: true, forceIgnored: false, error: null });
            expect(plan(kind, LEGATTICE_URL, 'true', 'true')).toEqual({ useLegattice: true, deep: true, tagOverride: false, forceIgnored: false, error: null });
        }
    });

    it('leaves a branch build to the boxes; only "true" ticks one', () => {
        expect(plan('build', LEGATTICE_URL, 'true', '')).toMatchObject({ useLegattice: true, deep: false, tagOverride: false });
        expect(plan('build', LEGATTICE_URL, ' true ', 'true')).toMatchObject({ useLegattice: true, deep: true });
        for (const off of ['false', '', 'TRUE', '1', null, undefined]) expect(plan('build', LEGATTICE_URL, off, '').useLegattice).toBe(false);
        expect(plan('build', LEGATTICE_URL, 'false', 'true')).toMatchObject({ useLegattice: false, deep: false, forceIgnored: true });
    });

    it('needs LEGATTICE_URL only when Legattice is used, and refuses a wrong one always', () => {
        expect(plan('build', '', 'false', '').error).toBeNull();
        expect(plan('build', '', 'true', '').error).toMatch(/Legattice is to be used, but LEGATTICE_URL is empty/);
        expect(plan('release', undefined, '', '').error).toMatch(/LEGATTICE_URL is empty/);
        expect(plan('build', 'https://example.org/x', 'false', '').error).toMatch(/Legattice cannot be found at LEGATTICE_URL/);
    });
});


describe('gateReasons', () => {
    const ok = { build: 'success', msix: 'success', light: 'skipped', scan: 'success', notices: 'success' };
    const reasons = (kind, useLegattice, results, changed = 'false') => gateReasons({ kind, useLegattice, results: { ...ok, ...results }, changed });

    it('finds nothing when every job of the path succeeded and the notices are the same', () => {
        expect(reasons('release', true, {})).toEqual([]);
        expect(reasons('build', false, { msix: 'skipped', light: 'success', scan: 'skipped', notices: 'skipped' })).toEqual([]);
    });

    it('names each reason with what to correct', () => {
        expect(reasons('release', true, { build: 'failure' }).map((r) => r.what)).toEqual(['the build legs did not succeed (failure)']);
        expect(reasons('release', true, { msix: 'skipped' })[0].what).toMatch(/MSIX bundle did not succeed \(skipped\)/);
        const scan = reasons('release', true, { scan: 'failure', notices: 'skipped' });
        expect(scan).toHaveLength(1);
        expect(scan[0].what).toMatch(/Legattice scan did not succeed \(failure\): topics without a decision, or a scan failure/);
        expect(scan[0].fix).toMatch(/decide the topics in the Legattice ledger, then "Re-run failed jobs"/);
        expect(reasons('release', true, { notices: 'failure' })[0].fix).toMatch(/foss-compliance-release/);
        const changed = reasons('release', true, {}, 'true');
        expect(changed.map((r) => r.what)).toEqual(['the notices made from the scan differ from the committed ones']);
        expect(changed[0].fix).toMatch(/merge the pull request .*then build again from a new tag/);
        expect(reasons('build', false, { msix: 'skipped', light: 'failure' })[0].what).toMatch(/lightweight licence check did not succeed/);
    });

    it('ignores the MSIX bundle on a branch build, and a missing result counts as not run', () => {
        expect(reasons('build', true, { msix: 'skipped' })).toEqual([]);
        expect(gateReasons({ kind: 'release', useLegattice: true, results: {}, changed: '' }).map((r) => r.what)).toEqual([
            'the build legs did not succeed (not run)', 'the MSIX bundle did not succeed (not run)',
            'the Legattice scan did not succeed (not run): topics without a decision, or a scan failure',
        ]);
    });
});


describe('additionsDifference', () => {
    it('ignores the source, and names topics that are new, gone or changed', () => {
        const committed = { source: { date: '2026-10-28' }, additions: [addition('LT-0000000001'), addition('LT-0000000002')] };
        expect(additionsDifference(committed, { source: { date: '2026-11-01' }, additions: committed.additions }).equal).toBe(true);
        const fresh = { additions: [addition('LT-0000000001', { copyrights: ['Copyright X'] }), addition('LT-0000000003')] };
        expect(additionsDifference(committed, fresh)).toEqual({ equal: false, added: ['LT-0000000003'], removed: ['LT-0000000002'], changed: ['LT-0000000001'] });
    });
});


describe('release-plan and compare-additions commands', () => {
    let root;
    let out;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-plan-'));
        out = path.join(root, 'github-output');
        fs.mkdirSync(path.join(root, 'foss'));
        fs.writeFileSync(path.join(root, 'foss', 'notice-additions.json'),
            JSON.stringify({ format: 1, source: { product: { repository: 'o/p', ref: 'v0.3.50' } }, additions: [addition('LT-0000000001')] }));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const outputs = () => Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));

    // REQ-LTTCE-FOS-00009, tables 1 and 2: [ref, LEGATTICE_URL, USE_LEGATTICE, ForceDeepScan] ->
    // [kind, use_legattice, deep, the licence check in the summary, bold tag note?]
    it.each([
        ['refs/heads/dev', LEGATTICE_URL, 'false', 'false', 'build', 'false', 'false', /\*\*lightweight \(no Legattice\)\*\*/, false],
        ['refs/heads/dev', '', '', '', 'build', 'false', 'false', /\*\*lightweight/, false],
        ['refs/heads/dev', LEGATTICE_URL, 'true', 'false', 'build', 'true', 'false', /\*\*Legattice, optimal: earlier scan results used\*\*/, false],
        ['refs/heads/dev', LEGATTICE_URL, 'true', 'true', 'build', 'true', 'true', /\*\*Legattice, deep: everything scanned again\*\*/, false],
        ['refs/heads/dev', LEGATTICE_URL, 'TRUE', 'false', 'build', 'false', 'false', /\*\*lightweight/, false],
        ['refs/tags/v0.3.52', LEGATTICE_URL, '', '', 'release', 'true', 'false', /published only if the release gate passes[\s\S]*Legattice, optimal/, true],
        ['refs/tags/v0.3.52', LEGATTICE_URL, 'false', 'true', 'release', 'true', 'true', /Legattice, deep/, true],
        ['refs/tags/v0.3.52', LEGATTICE_URL, 'true', 'false', 'release', 'true', 'false', /Legattice, optimal/, false],
        ['refs/tags/v0.3.52a', LEGATTICE_URL, '', '', 'candidate', 'true', 'false', /never published[\s\S]*Legattice, optimal/, true],
        ['refs/tags/v0.3.52-rc1', LEGATTICE_URL, 'true', 'true', 'candidate', 'true', 'true', /Legattice, deep/, false],
    ])('%s, LEGATTICE_URL %j, USE_LEGATTICE %j, ForceDeepScan %j: %s, use_legattice %s, deep %s',
        (ref, url, use, force, kind, useLegattice, deep, check, note) => {
            const summary = path.join(root, 'summary.md');
            const env = { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, LEGATTICE_URL: url, USE_LEGATTICE: use, FORCE_DEEP_SCAN: force };
            expect(commandReleasePlan({ ref, env }, quiet)).toBe(0);
            expect(outputs()).toEqual({ kind, use_legattice: useLegattice, deep });
            const text = fs.readFileSync(summary, 'utf8');
            expect(text).toMatch(check);
            expect(/\*\*Legattice is used because this is a tag build \([^)]*\); USE_LEGATTICE was not ticked\.\*\*/.test(text)).toBe(note);
        });

    it('ignores ForceDeepScan without USE_LEGATTICE on a branch, with a warning', () => {
        const summary = path.join(root, 'summary.md');
        const lines = [];
        const env = { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, LEGATTICE_URL: LEGATTICE_URL, USE_LEGATTICE: 'false', FORCE_DEEP_SCAN: 'true' };
        expect(commandReleasePlan({ ref: 'refs/heads/dev', env }, { ...quiet, log: (m) => lines.push(m) })).toBe(0);
        expect(outputs()).toEqual({ kind: 'build', use_legattice: 'false', deep: 'false' });
        expect(lines.some((l) => l.startsWith('::warning title=ForceDeepScan ignored::'))).toBe(true);
        expect(fs.readFileSync(summary, 'utf8')).toMatch(/ForceDeepScan was ticked but is ignored/);
    });

    it.each([
        ['a tag', 'refs/tags/v0.3.52', ''],
        ['a candidate tag', 'refs/tags/v0.3.52a', 'false'],
        ['a branch with USE_LEGATTICE', 'refs/heads/dev', 'true'],
    ])('stops with exit 2 and no outputs when Legattice is to be used (%s) but LEGATTICE_URL is empty', (_label, ref, use) => {
        const summary = path.join(root, 'summary.md');
        const errors = [];
        expect(commandReleasePlan({ ref, env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, LEGATTICE_URL: '', USE_LEGATTICE: use } },
            { ...quiet, error: (m) => errors.push(m) })).toBe(2);
        expect(fs.existsSync(out)).toBe(false);
        expect(errors.join('\n')).toMatch(/Legattice is to be used, but LEGATTICE_URL is empty/);
        expect(fs.readFileSync(summary, 'utf8')).toMatch(/\*\*Stopped\*\*/);
    });

    it('stops with exit 2 and no outputs when LEGATTICE_URL names another repository', () => {
        const summary = path.join(root, 'summary.md');
        const errors = [];
        expect(commandReleasePlan({ ref: 'refs/tags/v0.3.52', env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, LEGATTICE_URL: 'https://example.org/x' } },
            { ...quiet, error: (m) => errors.push(m) })).toBe(2);
        expect(fs.existsSync(out)).toBe(false);
        expect(errors.join('\n')).toMatch(/LEGATTICE_URL is "https:\/\/example.org\/x"/);
        expect(fs.readFileSync(summary, 'utf8')).toMatch(/\*\*Stopped\*\*/);
    });

    it('compare-additions: changed=false on the same additions (source ignored), changed=true and the topics on others', () => {
        const fresh = path.join(root, 'fresh.json');
        fs.writeFileSync(fresh, JSON.stringify({ format: 1, source: { date: 'later' }, additions: [addition('LT-0000000001')] }));
        expect(commandCompareAdditions({ root, fresh, env: { GITHUB_OUTPUT: out } }, quiet)).toBe(0);
        expect(outputs()).toEqual({ changed: 'false' });
        fs.rmSync(out);
        fs.writeFileSync(fresh, JSON.stringify({ format: 1, source: {}, additions: [addition('LT-0000000001'), addition('LT-0000000002')] }));
        const summary = path.join(root, 'summary.md');
        const logged = [];
        expect(commandCompareAdditions({ root, fresh, env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary } }, { ...quiet, log: (m) => logged.push(m) })).toBe(0);
        expect(outputs()).toEqual({ changed: 'true' });
        expect(logged.join('\n')).toMatch(/new: LT-0000000002/);
        expect(fs.readFileSync(summary, 'utf8')).toMatch(/### Notice additions changed[\s\S]*LT-0000000002/);
    });

    it('compare-additions with no committed file: every fresh addition is new', () => {
        fs.rmSync(path.join(root, 'foss', 'notice-additions.json'));
        const fresh = path.join(root, 'fresh.json');
        fs.writeFileSync(fresh, JSON.stringify({ format: 1, source: {}, additions: [addition('LT-0000000001')] }));
        commandCompareAdditions({ root, fresh, env: { GITHUB_OUTPUT: out } }, quiet);
        expect(outputs()).toEqual({ changed: 'true' });
    });

    it('parses the new commands and refuses them without their option', () => {
        expect(parseArgs(['release-plan', '--ref', 'refs/tags/v1.2.3'])).toMatchObject({ command: 'release-plan', ref: 'refs/tags/v1.2.3' });
        expect(parseArgs(['release-plan', '--ref', ''])).toMatchObject({ ref: '' });
        expect(parseArgs(['compare-additions', '--fresh', 'f.json'])).toMatchObject({ fresh: 'f.json' });
        expect(() => parseArgs(['release-plan'])).toThrow(/needs --ref/);
        expect(() => parseArgs(['release-plan', '--ref', 'x', '--since', 'v1'])).toThrow(/unexpected/);
        expect(() => parseArgs(['compare-additions'])).toThrow(/needs --fresh/);
        expect(() => parseArgs(['check', '--ref', 'x'])).toThrow(/unexpected/);
        expect(parseArgs(['release-gate'])).toMatchObject({ command: 'release-gate' });
        expect(() => parseArgs(['release-gate', '--ref', 'x'])).toThrow(/unexpected/);
    });

    describe('release-gate', () => {
        const passed = { USE_LEGATTICE: 'true', BUILD_RESULT: 'success', MSIX_RESULT: 'success', LIGHT_RESULT: 'skipped',
            SCAN_RESULT: 'success', NOTICES_RESULT: 'success', NOTICES_CHANGED: 'false' };
        const gate = (env) => {
            const summary = path.join(root, 'gate.md');
            const logged = [];
            const code = commandReleaseGate({ env: { GITHUB_STEP_SUMMARY: summary, ...env } }, { ...quiet, log: (m) => logged.push(m) });
            return { code, logged, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
        };

        it('lets a release publish when nothing blocks it', () => {
            const r = gate({ KIND: 'release', ...passed });
            expect(r.code).toBe(0);
            expect(r.summary).toMatch(/### Release gate[\s\S]*Nothing blocks the publication\./);
        });

        it('blocks a release (exit 1) and says what to correct, as errors', () => {
            const r = gate({ KIND: 'release', ...passed, SCAN_RESULT: 'failure', NOTICES_RESULT: 'skipped' });
            expect(r.code).toBe(1);
            expect(r.summary).toMatch(/\*\*Publication blocked\.\*\* The build itself is complete[\s\S]*- the Legattice scan did not succeed/);
            expect(r.logged.some((l) => l.startsWith('::error title=Publication blocked::the Legattice scan did not succeed'))).toBe(true);
        });

        it('only reports for a candidate or a build (exit 0, warnings)', () => {
            for (const kind of ['candidate', 'build']) {
                const r = gate({ KIND: kind, ...passed, NOTICES_CHANGED: 'true' });
                expect(r.code).toBe(0);
                expect(r.summary).toMatch(new RegExp(`Reported only \\(a ${kind} is never published\\)[\\s\\S]*notices made from the scan differ`));
                expect(r.logged.some((l) => l.startsWith('::warning title=Release gate::'))).toBe(true);
            }
        });

        it('refuses an unknown KIND', () => {
            expect(() => gate({ ...passed, KIND: 'nightly' })).toThrow(/KIND must be one of release, candidate, build/);
        });
    });
});
