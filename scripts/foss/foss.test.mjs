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

// UTST for REQ-LTTCE-FOS-00002 / 00004 — the CLI end to end over a
// synthetic repository: gate, notices (write + drift check) and SBOMs.
// Hermetic: a temp-dir repository and an injected `cargo metadata`.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TARGETS } from './cargo-inventory.mjs';
import { buildSbom, purlFor } from './cyclonedx.mjs';
import { collect, commandCheck, commandNotices, commandSbom, NOTICES_FILE, parseArgs } from './foss.mjs';
import { escapeInline, fenced, platformLabel, renderNotices, textKey } from './notices-render.mjs';

const REAL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TODAY = '2026-10-20';
const WIN = TARGETS.filter((t) => t.label === 'win-x64');
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const MIT = (holder) => fs.readFileSync(path.join(REAL_ROOT, 'foss', 'licenses', 'MIT.txt'), 'utf8').replace('<year> <copyright holders>', holder);

//**************************************************************
// makeRepo (fixture builder)
//**************************************************************
/**
 * A minimal repository: real policy and licence texts, one crate, one npm
 * package. Returns the root and a fake `cargo metadata` over it.
 */
function makeRepo(root, { crateLicense = 'MIT OR Apache-2.0' } = {}) {
    const write = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    };
    fs.cpSync(path.join(REAL_ROOT, 'foss'), path.join(root, 'foss'), { recursive: true });
    write('foss/policy.json', JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'foss', 'policy.json'), 'utf8')), clarifications: [] }));
    write('package.json', JSON.stringify({ name: 'lattice', version: '9.9.9', dependencies: { leftpad: '^1' }, devDependencies: { vitest: '*' } }));
    write('package-lock.json', JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': {},
            'node_modules/leftpad': { version: '1.2.0', license: 'ISC' },
            'node_modules/vitest': { version: '4.0.0', license: 'MIT', dev: true },
        },
    }));
    write('node_modules/leftpad/package.json', JSON.stringify({ author: 'Pad Author', repository: 'example/leftpad' }));
    write('node_modules/leftpad/LICENSE', 'Copyright 2015 Pad Author\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.');
    write('reg/democrate/LICENSE-MIT', MIT('2020 Crate Author'));
    const meta = {
        packages: [
            { id: 'app', name: 'lattice', version: '9.9.9', source: null, manifest_path: path.join(root, 'src-tauri', 'Cargo.toml'), targets: [{ kind: ['lib'] }] },
            { id: 'dc', name: 'democrate', version: '0.1.0', source: 'registry+x', license: crateLicense, authors: ['Crate Author'], repository: 'https://example.org/democrate', manifest_path: path.join(root, 'reg', 'democrate', 'Cargo.toml'), targets: [{ kind: ['lib'] }] },
        ],
        resolve: { root: 'app', nodes: [{ id: 'app', deps: [{ pkg: 'dc', dep_kinds: [{ kind: null }] }] }, { id: 'dc', deps: [] }] },
    };
    return async () => meta;
}
// makeRepo END ************************************************


describe('parseArgs', () => {
    it('defaults to every target', () => {
        expect(parseArgs(['check']).targets).toHaveLength(TARGETS.length);
    });

    it('limits targets for check and sbom', () => {
        expect(parseArgs(['sbom', '--out-dir', 'x', '--targets', 'x86_64-pc-windows-msvc']).targets).toEqual(WIN);
    });

    it.each([
        [[], /unknown command/],
        [['notices', '--out-dir', 'x'], /unexpected/],
        [['sbom'], /out-dir/],
        [['check', '--targets', 'riscv64gc-unknown-linux-gnu'], /unknown target/],
        [['notices', '--targets', 'x86_64-pc-windows-msvc'], /every target/],
    ])('rejects %j', (argv, message) => {
        expect(() => parseArgs(argv)).toThrow(message);
    });
});

describe('the CLI over a synthetic repository', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-cli-'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('passes the gate and lists crate, npm package and the Rust standard library', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        expect(inv.entries.map((e) => e.component.name).sort()).toEqual(['Rust standard library (std, core, alloc)', 'democrate', 'leftpad']);
        expect(commandCheck(inv, quiet)).toBe(0);
    });

    it('fails the gate for a GPL crate', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root, { crateLicense: 'GPL-3.0-only' }) });
        const errors = [];
        expect(commandCheck(inv, { ...quiet, error: (m) => errors.push(m) })).toBe(1);
        expect(errors.join('\n')).toMatch(/democrate@0\.1\.0.*denied/);
    });

    it('writes the notices, then detects drift', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        expect(commandNotices(inv, { root, targets: WIN, check: true }, quiet)).toBe(1); // missing
        expect(commandNotices(inv, { root, targets: WIN, check: false }, quiet)).toBe(0);
        const md = fs.readFileSync(path.join(root, NOTICES_FILE), 'utf8');
        expect(md).toMatch(/### democrate 0\.1\.0/);
        expect(md).toMatch(/Copyright \(c\) 2020 Crate Author/);
        expect(md).toMatch(/Copyright 2015 Pad Author/);
        expect(commandNotices(inv, { root, targets: WIN, check: true }, quiet)).toBe(0);
        // A CRLF checkout of the same content is not drift.
        fs.writeFileSync(path.join(root, NOTICES_FILE), md.replace(/\n/g, '\r\n'));
        expect(commandNotices(inv, { root, targets: WIN, check: true }, quiet)).toBe(0);
        fs.writeFileSync(path.join(root, NOTICES_FILE), md.replace('Crate Author', 'Someone Else'));
        const errors = [];
        expect(commandNotices(inv, { root, targets: WIN, check: true }, { ...quiet, error: (m) => errors.push(m) })).toBe(1);
        expect(errors[0]).toMatch(/npm run foss:notices/);
    });

    it('writes one SBOM per target', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        const out = path.join(root, 'sbom');
        expect(commandSbom(inv, { root, targets: WIN, outDir: out }, quiet)).toBe(0);
        const bom = JSON.parse(fs.readFileSync(path.join(out, 'lattice-win-x64.cdx.json'), 'utf8'));
        expect(bom.metadata.component).toMatchObject({ name: 'lattice', version: '9.9.9' });
        expect(bom.components.map((c) => c.purl ?? c.name)).toEqual(expect.arrayContaining(['pkg:cargo/democrate@0.1.0', 'pkg:npm/leftpad@1.2.0']));
    });
});

describe('renderNotices', () => {
    const entry = (name, text) => ({
        component: { ecosystem: 'cargo', name, version: '1.0.0', linkage: 'linked', repository: null, homepage: null },
        evaluation: { expression: 'MIT', chosen: [{ id: 'MIT', exception: null }] },
        selection: { texts: [{ id: 'MIT', source: 'package', file: 'LICENSE', text }], notices: [], copyrights: ['Copyright 2020 A'] },
        platforms: TARGETS.map((t) => t.label),
        obligation: null,
    });

    it('is deterministic and independent of input order', () => {
        const a = [entry('b', 'T1'), entry('a', 'T2')];
        const md = renderNotices({ entries: a, standardTexts: {}, targets: TARGETS });
        expect(renderNotices({ entries: [...a].reverse(), standardTexts: {}, targets: TARGETS })).toBe(md);
        expect(md.indexOf('### a 1.0.0')).toBeLessThan(md.indexOf('### b 1.0.0'));
        expect(md.endsWith('\n')).toBe(true);
    });

    it('prints each distinct licence text once', () => {
        const md = renderNotices({ entries: [entry('a', 'SAME'), entry('b', 'SAME')], standardTexts: {}, targets: TARGETS });
        expect(md.match(new RegExp(`^### ${textKey('SAME')}$`, 'gm'))).toHaveLength(1);
        expect(md).toMatch(/Used by: a 1\.0\.0, b 1\.0\.0\./);
    });

    it('refuses a licence without a standard text', () => {
        const e = entry('a', 'x');
        e.selection.texts = [{ id: 'BlueOak-1.0.0', source: 'standard' }];
        expect(() => renderNotices({ entries: [e], standardTexts: {}, targets: TARGETS })).toThrow(/BlueOak-1\.0\.0/);
    });

    it('escapes Markdown in names and fences texts containing backticks', () => {
        expect(escapeInline('a|b*c<d>')).toBe('a\\|b\\*c\\<d\\>');
        expect(fenced('x ```` y')).toMatch(/^`{5}text\n/);
    });

    it('labels a component on every target as "all"', () => {
        expect(platformLabel(TARGETS.map((t) => t.label), TARGETS)).toBe('all');
        expect(platformLabel(['ios', 'win-x64'], TARGETS)).toBe('win-x64, ios');
    });
});

describe('buildSbom', () => {
    it('builds purls for both ecosystems', () => {
        expect(purlFor({ ecosystem: 'npm', name: '@scope/pkg', version: '1.0.0' })).toBe('pkg:npm/%40scope/pkg@1.0.0');
        expect(purlFor({ ecosystem: 'cargo', name: 'serde', version: '1.0.0' })).toBe('pkg:cargo/serde@1.0.0');
        expect(purlFor({ ecosystem: 'other', name: 'x', version: '1' })).toBeNull();
    });

    it('is deterministic, with a valid content-derived serial number', () => {
        const input = {
            product: { name: 'lattice', version: '1.0.0', license: 'AGPL-3.0-or-later' },
            target: TARGETS[0],
            entries: [{ component: { ecosystem: 'cargo', name: 'serde', version: '1.0.0', linkage: 'build-time' }, evaluation: { expression: 'MIT', clarified: false } }],
        };
        const bom = buildSbom(input);
        expect(buildSbom(input)).toEqual(bom);
        expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(bom.components[0]).toMatchObject({ scope: 'excluded', licenses: [{ expression: 'MIT' }] });
    });
});
