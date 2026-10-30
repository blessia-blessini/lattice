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
import { commandCompareAdditions, commandReleasePlan, parseArgs } from './foss.mjs';
import { additionsDifference, deepScanSetting, LEGATTICE_URL, releaseKind } from './release-plan.mjs';

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
        'refuses %j, naming the one it can call and how to switch the scan off', (url) => {
            const s = deepScanSetting(url);
            expect(s.scan).toBe(false);
            expect(s.error).toContain(LEGATTICE_URL);
            expect(s.error).toMatch(/delete the variable/);
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

    it.each([
        ['refs/tags/v0.3.52', LEGATTICE_URL, 'release', 'true', /deep scan first[\s\S]*publish; a pull request brings changed notices back to dev/],
        ['refs/tags/v0.3.52a', LEGATTICE_URL, 'candidate', 'true', /deep scan first[\s\S]*never published/],
        ['refs/tags/v0.3.52', undefined, 'release', 'false', /LEGATTICE_URL not set: no deep scan[\s\S]*; publish\./],
        ['refs/tags/v0.3.52-rc1', '', 'candidate', 'false', /LEGATTICE_URL not set[\s\S]*never published/],
        ['refs/heads/dev', LEGATTICE_URL, 'build', 'false', /no deep scan; the build legs ship the committed notices\./],
    ])('%s with LEGATTICE_URL %j: kind %s, deep_scan %s', (ref, url, kind, deepScan, plan) => {
        const summary = path.join(root, 'summary.md');
        expect(commandReleasePlan({ ref, env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, LEGATTICE_URL: url } }, quiet)).toBe(0);
        expect(outputs()).toEqual({ kind, deep_scan: deepScan });
        expect(fs.readFileSync(summary, 'utf8')).toMatch(plan);
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
    });
});
