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
import { additionsDifference, cargoLockVersions, dependencyChanges, npmLockVersions, releaseKind } from './release-plan.mjs';

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
/** A Cargo.lock: [name, version, source?] per package. */
const cargoLock = (pkgs) => ['version = 4', ...pkgs.map(([name, version, source]) =>
    `\n[[package]]\nname = "${name}"\nversion = "${version}"${source ? `\nsource = "${source}"` : ''}\ndependencies = []`)].join('\n');
const REG = 'registry+https://github.com/rust-lang/crates.io-index';
/** A package-lock.json v3 with Lattice at `own` and the given packages. */
const npmLock = (own, pkgs) => ({ lockfileVersion: 3, packages: { '': { name: 'lattice', version: own }, ...pkgs } });
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


describe('lock versions and their changes', () => {
    it('reads registry and git crates, leaving out path crates such as lattice itself', () => {
        const v = cargoLockVersions(cargoLock([['lattice', '0.3.52'], ['serde', '1.0.1', REG], ['dup', '1.0.0', REG], ['dup', '0.9.0', REG], ['g', '0.1.0', 'git+https://x/g#abc']]));
        expect([...v]).toEqual([['cargo:serde', '1.0.1'], ['cargo:dup', '0.9.0,1.0.0'], ['cargo:g', '0.1.0']]);
    });

    it('reads npm packages, leaving out the root and links', () => {
        const v = npmLockVersions(npmLock('0.3.52', { 'node_modules/katex': { version: '0.18.10' }, 'node_modules/local': { link: true, resolved: 'pkg' }, 'node_modules/x/node_modules/y': { version: '2.0.0' } }));
        expect([...v]).toEqual([['npm:node_modules/katex', '0.18.10'], ['npm:node_modules/x/node_modules/y', '2.0.0']]);
    });

    it('ignores a change of Lattice\'s own version, sees every other change', () => {
        const before = cargoLockVersions(cargoLock([['lattice', '0.3.51'], ['a', '1.0.0', REG], ['gone', '1.0.0', REG]]));
        const after = cargoLockVersions(cargoLock([['lattice', '0.3.52'], ['a', '1.1.0', REG], ['new', '2.0.0', REG]]));
        expect(dependencyChanges(before, before)).toEqual({ added: [], removed: [], changed: [] });
        expect(dependencyChanges(before, after)).toEqual({ added: ['cargo:new@2.0.0'], removed: ['cargo:gone@1.0.0'], changed: ['cargo:a 1.0.0 -> 1.1.0'] });
        const npmBefore = npmLockVersions(npmLock('0.3.51', { 'node_modules/k': { version: '1' } }));
        const npmAfter = npmLockVersions(npmLock('0.3.52', { 'node_modules/k': { version: '1' } }));
        expect(dependencyChanges(npmBefore, npmAfter)).toEqual({ added: [], removed: [], changed: [] });
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
        fs.mkdirSync(path.join(root, 'src-tauri'));
        fs.mkdirSync(path.join(root, 'foss'));
        fs.writeFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), cargoLock([['lattice', '0.3.52'], ['a', '1.0.0', REG]]));
        fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(npmLock('0.3.52', { 'node_modules/k': { version: '1' } })));
        fs.writeFileSync(path.join(root, 'foss', 'notice-additions.json'),
            JSON.stringify({ format: 1, source: { product: { repository: 'o/p', ref: 'v0.3.50' } }, additions: [addition('LT-0000000001')] }));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** git show over a map of "ref:file" -> text; anything else throws like git does. */
    const show = (files) => (dir, ref, file) => {
        if (!Object.hasOwn(files, `${ref}:${file}`)) throw new Error(`fatal: invalid object name '${ref}'.`);
        return files[`${ref}:${file}`];
    };
    const outputs = () => Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
    const same = {
        'v0.3.50:src-tauri/Cargo.lock': cargoLock([['lattice', '0.3.50'], ['a', '1.0.0', REG]]),
        'v0.3.50:package-lock.json': JSON.stringify(npmLock('0.3.50', { 'node_modules/k': { version: '1' } })),
    };

    it('a release tag with the dependencies of the scanned ref: kind release, not changed', () => {
        expect(commandReleasePlan({ root, ref: 'refs/tags/v0.3.52', env: { GITHUB_OUTPUT: out }, show: show(same) }, quiet)).toBe(0);
        expect(outputs()).toEqual({ kind: 'release', deps_changed: 'false' });
    });

    it('a candidate with a changed crate: changed, and the job summary names it', () => {
        const summary = path.join(root, 'summary.md');
        const bumped = { ...same, 'v0.3.50:src-tauri/Cargo.lock': cargoLock([['lattice', '0.3.50'], ['a', '0.9.0', REG]]) };
        commandReleasePlan({ root, ref: 'refs/tags/v0.3.52-rc1', env: { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary }, show: show(bumped) }, quiet);
        expect(outputs()).toEqual({ kind: 'candidate', deps_changed: 'true' });
        const text = fs.readFileSync(summary, 'utf8');
        expect(text).toContain('Path: deep scan **before** the build legs');
        expect(text).toContain('- changed cargo:a 0.9.0 -\\> 1.0.0');
    });

    it('counts as changed what it cannot compare: an unknown ref, no scanned ref, an unreadable lock file', () => {
        commandReleasePlan({ root, ref: 'refs/tags/v0.3.52', env: { GITHUB_OUTPUT: out }, show: show({}) }, quiet);
        expect(outputs().deps_changed).toBe('true');
        fs.rmSync(out);
        fs.writeFileSync(path.join(root, 'foss', 'notice-additions.json'), JSON.stringify({ format: 1, source: {}, additions: [] }));
        commandReleasePlan({ root, ref: 'refs/tags/v0.3.52', env: { GITHUB_OUTPUT: out }, show: show(same) }, quiet);
        expect(outputs().deps_changed).toBe('true');
        fs.rmSync(out);
        commandReleasePlan({ root, ref: 'refs/tags/v0.3.52', since: 'v0.3.50', env: { GITHUB_OUTPUT: out }, show: show({ ...same, 'v0.3.50:package-lock.json': '{ broken' }) }, quiet);
        expect(outputs().deps_changed).toBe('true');
    });

    it('a branch build: kind build, no comparison at all', () => {
        let asked = false;
        commandReleasePlan({ root, ref: 'refs/heads/dev', env: { GITHUB_OUTPUT: out }, show: () => { asked = true; return ''; } }, quiet);
        expect(outputs()).toEqual({ kind: 'build', deps_changed: 'false' });
        expect(asked).toBe(false);
    });

    it('compare-additions passes on the same additions and fails, saying what to do, on others', () => {
        const fresh = path.join(root, 'fresh.json');
        fs.writeFileSync(fresh, JSON.stringify({ format: 1, source: { date: 'later' }, additions: [addition('LT-0000000001')] }));
        expect(commandCompareAdditions({ root, fresh, env: {} }, quiet)).toBe(0);
        fs.writeFileSync(fresh, JSON.stringify({ format: 1, source: {}, additions: [addition('LT-0000000001'), addition('LT-0000000002')] }));
        const summary = path.join(root, 'summary.md');
        const errors = [];
        expect(commandCompareAdditions({ root, fresh, env: { GITHUB_STEP_SUMMARY: summary } }, { ...quiet, error: (m) => errors.push(m) })).toBe(1);
        expect(errors.join('\n')).toMatch(/new: LT-0000000002/);
        expect(fs.readFileSync(summary, 'utf8')).toMatch(/### Notice additions changed[\s\S]*tag again/);
    });

    it('parses the new commands and refuses them without their option', () => {
        expect(parseArgs(['release-plan', '--ref', 'refs/tags/v1.2.3', '--since', 'v1.2.2'])).toMatchObject({ command: 'release-plan', ref: 'refs/tags/v1.2.3', since: 'v1.2.2' });
        expect(parseArgs(['release-plan', '--ref', ''])).toMatchObject({ ref: '' });
        expect(parseArgs(['compare-additions', '--fresh', 'f.json'])).toMatchObject({ fresh: 'f.json' });
        expect(() => parseArgs(['release-plan'])).toThrow(/needs --ref/);
        expect(() => parseArgs(['compare-additions'])).toThrow(/needs --fresh/);
        expect(() => parseArgs(['check', '--ref', 'x'])).toThrow(/unexpected/);
    });
});
