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
import { additionsDifference, releaseKind } from './release-plan.mjs';

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const addition = (topic, extra = {}) => ({ topic, package: { ecosystem: 'npm', name: 'katex', version: '1' }, licences: ['OFL-1.1'], files: [{ path: 'a', sha1: '0'.repeat(40), lines: [[1, 1]] }], copyrights: [], ...extra });


describe('releaseKind', () => {
    it.each([
        ['refs/tags/v0.3.52', 'release'],
        ['refs/tags/v10.0.0', 'release'],
        ['refs/tags/v0.3.52-rc1', 'candidate'],
        ['refs/tags/v0.3.52-rc.2', 'candidate'],
        ['refs/tags/v0.3.52-test-a', 'candidate'],
        ['refs/tags/v0.3.52-', 'build'],
        ['refs/tags/v0.3.52rc1', 'build'],
        ['refs/tags/v0.3', 'build'],
        ['refs/tags/x0.3.52', 'build'],
        ['refs/heads/v0.3.52', 'build'],
        ['refs/heads/dev', 'build'],
        ['', 'build'],
        [undefined, 'build'],
    ])('%j is a %s', (ref, kind) => {
        expect(releaseKind(ref)).toBe(kind);
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
        ['refs/tags/v0.3.52', 'release', /publish; a pull request brings changed notices back to dev/],
        ['refs/tags/v0.3.52-rc1', 'candidate', /deep scan first[\s\S]*never published/],
        ['refs/heads/dev', 'build', /no deep scan/],
    ])('%s: output kind %s and a summary of the plan', (ref, kind, plan) => {
        const summary = path.join(root, 'summary.md');
        expect(commandReleasePlan({ ref, env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary } }, quiet)).toBe(0);
        expect(outputs()).toEqual({ kind });
        expect(fs.readFileSync(summary, 'utf8')).toMatch(plan);
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
