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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TARGETS } from './cargo-inventory.mjs';
import { buildSbom, purlFor } from './cyclonedx.mjs';
import { EXPORT_NOTICES_FILE } from './export-notices.mjs';
import { collect, commandAudit, commandCheck, commandNotices, commandSbom, NOTICES_FILE, parseArgs, writeStepSummary } from './foss.mjs';
import { escapeInline, fenced, platformLabel, renderNotices, renderTypeSummary, textKey } from './notices-render.mjs';

const REAL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TODAY = '2026-10-20';
const WIN = TARGETS.filter((t) => t.label === 'win-x64');
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const MIT = (holder) => fs.readFileSync(path.join(REAL_ROOT, 'foss', 'licenses', 'MIT.txt'), 'utf8').replace('<year> <copyright holders>', holder);

// Hermetic job summary: on CI these tests run inside the foss-compliance job
// (step 144), where GITHUB_STEP_SUMMARY is that job's real summary. A fixture's
// failing gate or stale notices must never land there — they did, as a "Licence
// gate failed: democrate GPL-3.0-only" on a green run. Tests of the summary
// point it at a temp file themselves.
beforeEach(() => vi.stubEnv('GITHUB_STEP_SUMMARY', ''));
afterEach(() => vi.unstubAllEnvs());

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
    write('foss/export-embedded.json', JSON.stringify({ components: [{ lockKey: 'node_modules/leftpad', material: 'padding' }] }));
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

    it('reports only by default and blocks with --block (audit)', () => {
        expect(parseArgs(['audit'])).toMatchObject({ command: 'audit', block: false });
        expect(parseArgs(['audit', '--block'])).toMatchObject({ command: 'audit', block: true });
    });

    it.each([
        [[], /unknown command/],
        [['notices', '--out-dir', 'x'], /unexpected/],
        [['sbom'], /out-dir/],
        [['check', '--targets', 'riscv64gc-unknown-linux-gnu'], /unknown target/],
        [['notices', '--targets', 'x86_64-pc-windows-msvc'], /every target/],
        [['audit', '--targets', 'x86_64-pc-windows-msvc'], /audit always covers every target/],
        [['check', '--block'], /unexpected/],
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

    it('writes the export notices beside them, and checks them for drift too', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        expect(commandNotices(inv, { root, targets: WIN, check: false }, quiet)).toBe(0);
        const exportFile = path.join(root, EXPORT_NOTICES_FILE);
        const text = fs.readFileSync(exportFile, 'utf8');
        expect(text).toMatch(/^- leftpad 1\.2\.0 \(padding\): ISC$/m);
        expect(text).toMatch(/Copyright 2015 Pad Author/);
        expect(text).not.toMatch(/democrate/); // only what the export embeds
        fs.writeFileSync(exportFile, text.replace('padding', 'something else'));
        const errors = [];
        expect(commandNotices(inv, { root, targets: WIN, check: true }, { ...quiet, error: (m) => errors.push(m) })).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(EXPORT_NOTICES_FILE);
    });

    it('fails when an embedded package is not shipped', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        fs.writeFileSync(path.join(root, 'foss', 'export-embedded.json'), JSON.stringify({ components: [{ lockKey: 'node_modules/vitest', material: 'x' }] }));
        expect(() => commandNotices(inv, { root, targets: WIN, check: true }, quiet)).toThrow(/node_modules\/vitest.*not a shipped npm package/);
    });

    describe('on GitHub Actions, the job summary (REQ-LTTCE-FOS-00002, FU-8)', () => {
        let summary;
        beforeEach(() => {
            summary = path.join(root, 'step-summary.md');
            vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
        });
        afterEach(() => vi.unstubAllEnvs());
        const read = () => (fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '');

        it('says how to regenerate stale notices — the Dependabot case', async () => {
            const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
            expect(commandNotices(inv, { root, targets: WIN, check: false }, quiet)).toBe(0);
            expect(commandNotices(inv, { root, targets: WIN, check: true }, quiet)).toBe(0);
            expect(read()).toBe('');
            fs.appendFileSync(path.join(root, NOTICES_FILE), 'drift\n');
            expect(commandNotices(inv, { root, targets: WIN, check: true }, quiet)).toBe(1);
            const md = read();
            expect(md).toMatch(/^### Third-party notices are out of date$/m);
            expect(md).toContain(`Stale: \`${NOTICES_FILE}\`.`);
            expect(md).toMatch(/^npm ci --ignore-scripts$/m);
            expect(md).toMatch(/^npm run foss:notices$/m);
            expect(md).toContain(`commit \`${NOTICES_FILE}\` and \`${EXPORT_NOTICES_FILE}\``);
        });

        it('lists the components that fail the licence gate', async () => {
            const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root, { crateLicense: 'GPL-3.0-only' }) });
            expect(commandCheck(inv, quiet)).toBe(1);
            expect(read()).toMatch(/^### Licence gate failed$/m);
            expect(read()).toMatch(/^- `cargo:democrate@0\.1\.0 \(linked\): .*denied.*`$/m);
        });

        it('stays silent when the gate passes', async () => {
            const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
            expect(commandCheck(inv, quiet)).toBe(0);
            expect(read()).toBe('');
        });
    });

    it('writes no job summary outside GitHub Actions', () => {
        const file = path.join(root, 'nowhere.md');
        writeStepSummary(['# x'], {});
        expect(fs.existsSync(file)).toBe(false);
        writeStepSummary(['# x'], { GITHUB_STEP_SUMMARY: file });
        expect(fs.readFileSync(file, 'utf8')).toBe('# x\n\n');
    });

    it('warns and carries on when the job summary cannot be written', () => {
        // Review FU-8 cycle 1: a directory as summary path makes the append throw.
        const warn = vi.fn();
        expect(() => writeStepSummary(['# x'], { GITHUB_STEP_SUMMARY: root }, { warn })).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot write the job summary'));
    });

    it('writes one SBOM per target', async () => {
        const inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        const out = path.join(root, 'sbom');
        expect(commandSbom(inv, { root, targets: WIN, outDir: out }, quiet)).toBe(0);
        const bom = JSON.parse(fs.readFileSync(path.join(out, 'lattice-win-x64.cdx.json'), 'utf8'));
        expect(bom.metadata.component).toMatchObject({ name: 'lattice', version: '9.9.9' });
        expect(bom.components.map((c) => c.purl ?? c.name)).toEqual(expect.arrayContaining(['pkg:cargo/democrate@0.1.0', 'pkg:npm/leftpad@1.2.0']));
    });

    describe('the vulnerability audit (REQ-LTTCE-FOS-00007)', () => {
        // leftpad and democrate ship; vitest is a development package.
        const npmReport = {
            auditReportVersion: 2,
            vulnerabilities: {
                leftpad: { via: [{ source: 1, name: 'leftpad', title: 'Pads too far', url: 'https://github.com/advisories/GHSA-2222-3333-4444', severity: 'high' }], nodes: ['node_modules/leftpad'] },
                vitest: { via: [{ source: 2, name: 'vitest', title: 'Mock injection', url: 'https://github.com/advisories/GHSA-qxg6-89mg-rqv8', severity: 'moderate' }], nodes: ['node_modules/vitest'] },
            },
        };
        const cargoReport = {
            vulnerabilities: { list: [{ advisory: { id: 'RUSTSEC-2026-0001', title: 'Overflow', aliases: ['CVE-2026-1234'] }, package: { name: 'democrate', version: '0.1.0' } }] },
            warnings: { unmaintained: [{ kind: 'unmaintained', advisory: { id: 'RUSTSEC-2024-0436', title: 'no longer maintained' }, package: { name: 'paste', version: '1.0.15' } }] },
        };
        const runners = { npm: async () => npmReport, cargo: async () => cargoReport };
        const exceptions = (list) => fs.writeFileSync(path.join(root, 'foss', 'advisory-exceptions.json'), JSON.stringify({ exceptions: list }));
        const capture = () => {
            const lines = { log: [], warn: [], error: [] };
            return { lines, log: { log: (m) => lines.log.push(m), warn: (m) => lines.warn.push(m), error: (m) => lines.error.push(m) } };
        };
        let inv;
        beforeEach(async () => {
            inv = await collect({ root, targets: WIN, today: TODAY, cargoMetadata: makeRepo(root) });
        });

        it('only reports outside a release: warnings, annotations and the job summary', async () => {
            const summary = path.join(root, 'step-summary.md');
            const { lines, log } = capture();
            const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
            expect(await commandAudit(inv, { root, block: false, today: TODAY, env, runners }, log)).toBe(0);
            expect(lines.warn).toEqual(expect.arrayContaining([
                '  [WARN] npm:leftpad@1.2.0 GHSA-2222-3333-4444 (high) Pads too far',
                '  [WARN] cargo:democrate@0.1.0 RUSTSEC-2026-0001 Overflow',
            ]));
            expect(lines.error).toEqual([]);
            expect(lines.log).toContain('::warning title=Vulnerable shipped component::npm:leftpad@1.2.0 GHSA-2222-3333-4444 (high) Pads too far');
            expect(lines.log).toContain('  [DEVELOPMENT] npm:vitest@4.0.0 GHSA-qxg6-89mg-rqv8 (moderate) Mock injection');
            expect(lines.log).toContain('  [INFORMATIONAL] cargo:paste@1.0.15 RUSTSEC-2024-0436 no longer maintained');
            const md = fs.readFileSync(summary, 'utf8');
            expect(md).toMatch(/^### Vulnerability audit$/m);
            expect(md).toMatch(/^\| blocking \| npm:leftpad@1\.2\.0 \|/m);
            expect(md).toMatch(/^\| development \| npm:vitest@4\.0\.0 \|/m);
        });

        it('annotates nothing outside GitHub Actions', async () => {
            const { lines, log } = capture();
            expect(await commandAudit(inv, { root, block: false, today: TODAY, env: {}, runners }, log)).toBe(0);
            expect(lines.log.some((l) => l.startsWith('::'))).toBe(false);
        });

        it('blocks a release on a vulnerable shipped component', async () => {
            const { lines, log } = capture();
            expect(await commandAudit(inv, { root, block: true, today: TODAY, env: { GITHUB_ACTIONS: 'true' }, runners }, log)).toBe(1);
            expect(lines.error).toContain('  [FAIL] npm:leftpad@1.2.0 GHSA-2222-3333-4444 (high) Pads too far');
            expect(lines.error.at(-1)).toMatch(/2 vulnerable shipped component\(s\); a release is blocked/);
            expect(lines.log).toContain('::error title=Vulnerable shipped component::cargo:democrate@0.1.0 RUSTSEC-2026-0001 Overflow');
        });

        it('lets a release through with a valid exception for each, and not once one expired', async () => {
            const leftpad = { ecosystem: 'npm', package: 'leftpad', advisory: 'GHSA-2222-3333-4444', reason: 'padding never user-controlled', expires: '2026-12-31' };
            const democrate = { ecosystem: 'cargo', package: 'democrate', advisory: 'CVE-2026-1234', reason: 'function not called', expires: TODAY };
            exceptions([leftpad, democrate]);
            expect(await commandAudit(inv, { root, block: true, today: TODAY, env: {}, runners }, quiet)).toBe(0);
            expect(await commandAudit(inv, { root, block: true, today: '2027-01-01', env: {}, runners }, quiet)).toBe(1);
        });

        it('blocks a release it could not audit, and only warns elsewhere', async () => {
            const offline = { npm: async () => npmReport, cargo: async () => { throw new Error('cargo audit failed: error: no such command: `audit`'); } };
            exceptions([{ ecosystem: 'npm', package: 'leftpad', advisory: 'GHSA-2222-3333-4444', reason: 'r', expires: '2099-01-01' }]);
            const { lines, log } = capture();
            expect(await commandAudit(inv, { root, block: false, today: TODAY, env: {}, runners: offline }, log)).toBe(0);
            expect(lines.warn).toContain('  [WARN] not audited: cargo audit failed: error: no such command: `audit`');
            expect(await commandAudit(inv, { root, block: true, today: TODAY, env: {}, runners: offline }, quiet)).toBe(2);
        });

        it('warns about an exception that matches nothing', async () => {
            exceptions([{ ecosystem: 'cargo', package: 'gone', advisory: 'RUSTSEC-2020-0001', reason: 'r', expires: '2099-01-01' }]);
            const { lines, log } = capture();
            await commandAudit(inv, { root, block: false, today: TODAY, env: {}, runners }, log);
            expect(lines.warn).toContain('  [WARN] unused advisory exception cargo:gone RUSTSEC-2020-0001');
        });

        it('refuses a malformed exceptions file', async () => {
            exceptions([{ ecosystem: 'npm', package: 'leftpad', advisory: 'GHSA-2222-3333-4444', reason: 'no expiry' }]);
            await expect(commandAudit(inv, { root, block: false, today: TODAY, env: {}, runners }, quiet)).rejects.toThrow(/needs ecosystem/);
        });
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

    it('summarises licences by type, copyleft first, naming copyleft components', () => {
        const uses = [
            { key: 'MIT', title: 'a 1.0.0', linked: true },
            { key: 'MIT', title: 'b 1.0.0', linked: false },
            { key: 'MPL-2.0', title: 'c 1.0.0', linked: true },
            { key: 'Apache-2.0 WITH LLVM-exception', title: 'd 1.0.0', linked: true },
            { key: 'WTFPL', title: 'e 1.0.0', linked: true },
        ];
        const types = { MIT: 'permissive', 'Apache-2.0': 'permissive', 'MPL-2.0': 'weak-copyleft' };
        const md = renderTypeSummary(uses, types).join('\n');
        const rows = md.split('\n').filter((l) => /^\| [^-L]/.test(l));
        expect(rows).toEqual([
            '| MPL-2.0 | weak copyleft | 1 | 1 |',
            '| MIT | permissive | 2 | 1 |',
            '| Apache-2.0 WITH LLVM-exception | permissive | 1 | 1 |',
            '| WTFPL | unclassified | 1 | 1 |',
        ]);
        expect(md).toMatch(/^Strong copyleft: none\.$/m);
        expect(md).toMatch(/^Weak copyleft, MPL-2\.0: c 1\.0\.0\.$/m);
    });

    it('names strong-copyleft components, and survives a missing or unknown type map', () => {
        const uses = [{ key: 'GPL-3.0-only', title: 'g 1.0.0', linked: true }, { key: 'MIT', title: 'a 1.0.0', linked: true }];
        const md = renderTypeSummary(uses, { 'GPL-3.0-only': 'strong-copyleft', MIT: 'perm' }).join('\n');
        expect(md).toMatch(/^Strong copyleft, GPL-3\.0-only: g 1\.0\.0\.$/m);
        expect(md).toMatch(/^\| MIT \| unclassified \| 1 \| 1 \|$/m);
        expect(renderTypeSummary(uses).join('\n')).toMatch(/^\| GPL-3\.0-only \| unclassified/m);
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
