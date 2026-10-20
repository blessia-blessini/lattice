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

// UTST for REQ-LTTCE-FOS-00002 — the notices must list every shipped
// component: the Rust graph per target (linked vs build-time) and the npm
// production closure, never dev-only packages.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inventoryFromMetadata, TARGETS } from './cargo-inventory.mjs';
import { enrichFromManifest, inventoryFromLockfile, normalizeNpmLicense, resolvePackage } from './npm-inventory.mjs';

//**************************************************************
// metadata (fixture builder)
//**************************************************************
/** Synthetic `cargo metadata` output; edges are [from, to, kind]. */
function metadata(pkgs, edges) {
    const id = (n) => (n === 'app' ? 'path+file:///app#app@0.1.0' : `registry+x#${n}@1.0.0`);
    return {
        packages: pkgs.map(([name, extra = {}]) => ({
            id: id(name),
            name,
            version: name === 'app' ? '0.1.0' : '1.0.0',
            source: name === 'app' ? null : 'registry+x',
            license: 'MIT',
            authors: [],
            manifest_path: `/reg/${name}/Cargo.toml`,
            targets: [{ kind: extra.procMacro ? ['proc-macro'] : ['lib'] }],
        })),
        resolve: {
            root: id('app'),
            nodes: pkgs.map(([name]) => ({
                id: id(name),
                deps: edges.filter(([from]) => from === name).map(([, to, kind]) => ({ pkg: id(to), dep_kinds: [{ kind, target: null }] })),
            })),
        },
    };
}
// metadata END ************************************************


describe('inventoryFromMetadata', () => {
    const meta = metadata(
        [['app'], ['serde'], ['serde_derive', { procMacro: true }], ['syn'], ['cc'], ['tempfile'], ['itoa']],
        [
            ['app', 'serde', null],
            ['serde', 'serde_derive', null],
            ['serde_derive', 'syn', null],
            ['app', 'cc', 'build'],
            ['app', 'tempfile', 'dev'],
            ['serde', 'itoa', null],
        ],
    );
    const byName = Object.fromEntries(inventoryFromMetadata(meta).map((c) => [c.name, c]));

    it('marks normal dependencies as linked', () => {
        expect(byName.serde.linkage).toBe('linked');
        expect(byName.itoa.linkage).toBe('linked');
    });

    it('marks proc-macros and what they use as build-time', () => {
        expect(byName.serde_derive.linkage).toBe('build-time');
        expect(byName.syn.linkage).toBe('build-time');
    });

    it('marks build-dependencies as build-time', () => {
        expect(byName.cc.linkage).toBe('build-time');
    });

    it('leaves out dev-dependencies and the app itself', () => {
        expect(byName.tempfile).toBeUndefined();
        expect(byName.app).toBeUndefined();
    });

    it('records the package directory for licence files', () => {
        expect(byName.serde.dir).toBe(path.dirname('/reg/serde/Cargo.toml'));
    });

    it('rejects metadata produced with --no-deps', () => {
        expect(() => inventoryFromMetadata({ packages: [], resolve: null })).toThrow(/no-deps/);
    });

    it('covers every published target exactly once', () => {
        expect(new Set(TARGETS.map((t) => t.triple)).size).toBe(8);
        expect(new Set(TARGETS.map((t) => t.label)).size).toBe(8);
    });
});

describe('npm inventory', () => {
    const lock = {
        lockfileVersion: 3,
        packages: {
            '': { name: 'app' },
            'node_modules/a': { version: '1.0.0', license: 'MIT', dependencies: { b: '^1' } },
            'node_modules/b': { version: '1.0.0', license: 'ISC' },
            'node_modules/a/node_modules/c': { version: '2.0.0', license: 'MIT' },
            'node_modules/c': { version: '1.0.0', license: 'MIT', dev: true },
            'node_modules/d': { version: '1.0.0', license: { type: 'BSD-3-Clause' }, peerDependencies: { e: '*', f: '*' }, peerDependenciesMeta: { f: { optional: true } } },
            'node_modules/e': { version: '1.0.0', license: 'MIT' },
            'node_modules/vitest': { version: '4.0.0', license: 'MIT', dev: true },
        },
    };
    lock.packages['node_modules/a'].dependencies.c = '^2';

    it('resolves nested before hoisted, like Node', () => {
        expect(resolvePackage(lock.packages, 'node_modules/a', 'c')).toBe('node_modules/a/node_modules/c');
        expect(resolvePackage(lock.packages, 'node_modules/a', 'b')).toBe('node_modules/b');
        expect(resolvePackage(lock.packages, '', 'missing')).toBeNull();
    });

    it('collects the production closure only', () => {
        const comps = inventoryFromLockfile(lock, { dependencies: { a: '^1', d: '^1' }, devDependencies: { vitest: '^4' } }, '/root');
        expect(comps.map((c) => `${c.name}@${c.version}`)).toEqual(['a@1.0.0', 'b@1.0.0', 'c@2.0.0', 'd@1.0.0', 'e@1.0.0']);
        expect(comps.find((c) => c.name === 'd').license).toBe('BSD-3-Clause');
    });

    it('fails on a required dependency missing from the lockfile', () => {
        expect(() => inventoryFromLockfile(lock, { dependencies: { zzz: '1' } }, '/root')).toThrow(/zzz/);
    });

    it('rejects lockfile version 1', () => {
        expect(() => inventoryFromLockfile({ lockfileVersion: 1, dependencies: {} }, {}, '/root')).toThrow(/lockfileVersion/);
    });

    it.each([
        ['MIT', 'MIT'],
        [{ type: 'ISC' }, 'ISC'],
        [[{ type: 'MIT' }, { type: 'Apache-2.0' }], '(MIT) OR (Apache-2.0)'],
        [undefined, null],
        ['', null],
    ])('normalises the npm license value %j', (input, expected) => {
        expect(normalizeNpmLicense(input)).toBe(expected);
    });

    describe('enrichFromManifest', () => {
        let dir;
        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-npm-'));
        });
        afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('reads authors and a browsable repository URL', () => {
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                author: 'Jane Doe <jane@example.org> (https://example.org)',
                contributors: [{ name: 'Max Muster' }, 'Jane Doe'],
                repository: { type: 'git', url: 'git+https://github.com/example/pkg.git' },
            }));
            const c = enrichFromManifest({ name: 'pkg', version: '1.0.0', dir });
            expect(c.authors).toEqual(['Jane Doe', 'Max Muster']);
            expect(c.repository).toBe('https://github.com/example/pkg');
        });

        it('expands the GitHub shorthand', () => {
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ repository: 'example/pkg' }));
            expect(enrichFromManifest({ name: 'pkg', version: '1.0.0', dir }).repository).toBe('https://github.com/example/pkg');
        });

        it('asks for npm ci when the package is not installed', () => {
            expect(() => enrichFromManifest({ name: 'pkg', version: '1.0.0', dir: path.join(dir, 'absent') })).toThrow(/npm ci/);
        });
    });
});
