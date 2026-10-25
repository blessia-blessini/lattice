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

// UTST for REQ-LTTCE-FOS-00007 — audit.mjs: both report formats, the
// exceptions file, the status of each finding, and the job summary.
// Report excerpts follow the real output of npm 11 and cargo-audit 0.22.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
    ADVISORY_ID_RE, annotation, evaluateFindings, findingLabel, parseCargoAudit, parseNpmAudit, renderAuditSummary, runJsonTool,
    validateAdvisoryExceptions,
} from './audit.mjs';

const REAL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TODAY = '2026-10-25';

//**************************************************************
// report fixtures
//**************************************************************
const advisory = (name, ghsa, extra = {}) => ({
    source: 1242767, name, dependency: name, title: `${name} advisory`, url: `https://github.com/advisories/${ghsa}`,
    severity: 'moderate', range: '<9', ...extra,
});

/** npm audit: katex shipped twice (hoisted + nested), vitest only through a dependency. */
const NPM_REPORT = {
    auditReportVersion: 2,
    vulnerabilities: {
        katex: { name: 'katex', severity: 'moderate', via: [advisory('katex', 'GHSA-238p-pmpm-9mq7')], nodes: ['node_modules/katex', 'node_modules/rehype-katex/node_modules/katex'] },
        vitest: { name: 'vitest', severity: 'moderate', via: ['@vitest/mocker'], nodes: ['node_modules/vitest'] },
        '@vitest/mocker': { name: '@vitest/mocker', severity: 'moderate', via: [advisory('@vitest/mocker', 'GHSA-qxg6-89mg-rqv8'), advisory('@vitest/mocker', 'GHSA-xp26-3454-mjgp')], nodes: ['node_modules/@vitest/mocker'] },
    },
    metadata: { vulnerabilities: { moderate: 3, total: 3 } },
};
const LOCK = {
    lockfileVersion: 3,
    packages: {
        '': {},
        'node_modules/katex': { version: '0.18.1' },
        'node_modules/rehype-katex/node_modules/katex': { version: '0.16.47' },
        'node_modules/vitest': { version: '4.1.11', dev: true },
        'node_modules/@vitest/mocker': { version: '4.1.11', dev: true },
    },
};

const rustsec = (id, title, extra = {}) => ({ id, package: 'x', title, aliases: [], informational: null, ...extra });
/** cargo audit: one vulnerability, one unsound, one yanked (no advisory). */
const CARGO_REPORT = {
    database: { 'advisory-count': 1352 },
    vulnerabilities: {
        found: true, count: 1,
        list: [{ advisory: rustsec('RUSTSEC-2026-0001', 'Out-of-bounds read', { aliases: ['GHSA-2222-3333-4444', 'CVE-2026-1234'] }), package: { name: 'democrate', version: '0.1.0' } }],
    },
    warnings: {
        unsound: [{ kind: 'unsound', advisory: rustsec('RUSTSEC-2024-0429', 'Unsoundness in VariantStrIter', { informational: 'unsound' }), package: { name: 'glib', version: '0.18.5' } }],
        yanked: [{ kind: 'yanked', advisory: null, package: { name: 'oldcrate', version: '1.0.0' } }],
    },
};
// report fixtures END *****************************************


describe('parseNpmAudit', () => {
    it('reports one finding per installed copy and advisory, with the copy version from the lockfile', () => {
        const found = parseNpmAudit(NPM_REPORT, LOCK);
        expect(found.map((f) => `${f.name}@${f.version} ${f.advisory}`).sort()).toEqual([
            '@vitest/mocker@4.1.11 GHSA-qxg6-89mg-rqv8',
            '@vitest/mocker@4.1.11 GHSA-xp26-3454-mjgp',
            'katex@0.16.47 GHSA-238p-pmpm-9mq7',
            'katex@0.18.1 GHSA-238p-pmpm-9mq7',
        ]);
        expect(found.every((f) => f.ecosystem === 'npm' && f.kind === 'vulnerability' && f.severity === 'moderate')).toBe(true);
    });

    it('skips an entry vulnerable only through a dependency', () => {
        expect(parseNpmAudit(NPM_REPORT, LOCK).some((f) => f.name === 'vitest')).toBe(false);
    });

    it('keeps an advisory without a GHSA url under its npm source id, and an unknown copy without a version', () => {
        const report = { auditReportVersion: 2, vulnerabilities: { a: { via: [{ source: 77, name: 'a', title: 't' }], nodes: ['node_modules/a'] } } };
        expect(parseNpmAudit(report, { packages: {} })).toEqual([expect.objectContaining({ advisory: 'npm-77', version: null, url: null })]);
    });

    it('ignores an advisory object that names another package', () => {
        const report = { auditReportVersion: 2, vulnerabilities: { a: { via: [advisory('b', 'GHSA-2222-3333-4444')], nodes: ['node_modules/a'] } } };
        expect(parseNpmAudit(report, LOCK)).toEqual([]);
    });

    it.each([
        [{ error: { code: 'ENOAUDIT', summary: 'audit endpoint returned an error' } }, /audit endpoint returned an error/],
        [{ auditReportVersion: 1, advisories: {} }, /unknown report format/],
        [null, /unknown report format/],
    ])('rejects %j', (report, message) => {
        expect(() => parseNpmAudit(report, LOCK)).toThrow(message);
    });
});

describe('parseCargoAudit', () => {
    it('reports vulnerabilities, and warnings as informational kinds', () => {
        const found = parseCargoAudit(CARGO_REPORT);
        expect(found.map((f) => [f.name, f.kind, f.advisory])).toEqual([
            ['democrate', 'vulnerability', 'RUSTSEC-2026-0001'],
            ['glib', 'unsound', 'RUSTSEC-2024-0429'],
            ['oldcrate', 'yanked', null],
        ]);
        expect(found[0]).toMatchObject({ ecosystem: 'cargo', version: '0.1.0', aliases: ['GHSA-2222-3333-4444', 'CVE-2026-1234'], url: 'https://rustsec.org/advisories/RUSTSEC-2026-0001.html' });
        expect(found[2]).toMatchObject({ title: 'version yanked from crates.io', url: null });
    });

    it('accepts a clean report', () => {
        expect(parseCargoAudit({ vulnerabilities: { found: false, count: 0, list: [] }, warnings: {} })).toEqual([]);
    });

    it.each([[{}], [{ vulnerabilities: { list: [] } }], [null]])('rejects %j', (report) => {
        expect(() => parseCargoAudit(report)).toThrow(/unknown report format/);
    });

    it('skips a warnings entry that is not a list (review cycle 1, F3)', () => {
        const report = { ...CARGO_REPORT, warnings: { ...CARGO_REPORT.warnings, count: 2, note: 'x', none: null } };
        expect(parseCargoAudit(report).map((f) => f.name)).toEqual(['democrate', 'glib', 'oldcrate']);
    });
});

describe('runJsonTool', () => {
    it('accepts a JSON report from a tool that exits 1 because it found something', async () => {
        const exec = async () => { throw Object.assign(new Error('exit 1'), { stdout: '{"ok":1}', stderr: '' }); };
        await expect(runJsonTool('npm audit', 'npm', [], {}, exec)).resolves.toEqual({ ok: 1 });
    });

    it('fails with the error line of stderr when the tool cannot run, else its last line', async () => {
        // The real cargo output when cargo-audit is not installed.
        const missing = async () => { throw Object.assign(new Error('spawn'), { stdout: '', stderr: 'error: no such command: `audit`\n\n\thelp: find a package to install `audit` with `cargo search cargo-audit`\n' }); };
        await expect(runJsonTool('cargo audit', 'cargo', ['audit'], {}, missing)).rejects.toThrow('cargo audit failed: error: no such command: `audit`');
        const other = async () => { throw Object.assign(new Error('spawn'), { stdout: '', stderr: 'Fetching advisory database\nnetwork unreachable\n' }); };
        await expect(runJsonTool('cargo audit', 'cargo', ['audit'], {}, other)).rejects.toThrow('cargo audit failed: network unreachable');
    });

    it('fails on output that is not JSON', async () => {
        await expect(runJsonTool('npm audit', 'npm', [], {}, async () => ({ stdout: 'oops' }))).rejects.toThrow('npm audit printed no JSON report');
    });
});

describe('validateAdvisoryExceptions', () => {
    const ok = { ecosystem: 'npm', package: 'katex', advisory: 'GHSA-238p-pmpm-9mq7', reason: 'not reachable', expires: '2027-01-01' };

    it('loads the committed file', () => {
        const data = JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'foss', 'advisory-exceptions.json'), 'utf8'));
        expect(Array.isArray(validateAdvisoryExceptions(data))).toBe(true);
    });

    it('accepts GHSA, RUSTSEC and CVE ids', () => {
        for (const id of ['GHSA-238p-pmpm-9mq7', 'RUSTSEC-2024-0429', 'CVE-2026-12345']) expect(ADVISORY_ID_RE.test(id)).toBe(true);
        expect(validateAdvisoryExceptions({ exceptions: [ok] })).toEqual([ok]);
    });

    it.each([
        [{ ...ok, ecosystem: 'pip' }],
        [{ ...ok, package: '' }],
        [{ ...ok, advisory: 'GHSA-238P-PMPM-9MQ7' }],
        [{ ...ok, advisory: 'RUSTSEC-24-1' }],
        [{ ...ok, reason: '  ' }],
        [{ ...ok, expires: '2027-1-1' }],
        [{ ...ok, expires: undefined }],
    ])('rejects %j', (entry) => {
        expect(() => validateAdvisoryExceptions({ exceptions: [entry] })).toThrow(/needs ecosystem/);
    });

    it('rejects a file without a list', () => {
        expect(() => validateAdvisoryExceptions({})).toThrow(/must be a list/);
    });

    it('names an npm advisory by its GHSA id only; cargo by any id (review cycle 1, F1)', () => {
        // npm audit reports no aliases, so a CVE or RUSTSEC id for npm could never match.
        for (const advisory of ['CVE-2026-12345', 'RUSTSEC-2024-0429']) {
            expect(() => validateAdvisoryExceptions({ exceptions: [{ ...ok, advisory }] })).toThrow(/npm advisory must be named by its GHSA id/);
        }
        const cargo = { ...ok, ecosystem: 'cargo', package: 'democrate', advisory: 'CVE-2026-12345' };
        expect(validateAdvisoryExceptions({ exceptions: [cargo] })).toEqual([cargo]);
    });
});

describe('evaluateFindings', () => {
    const shipped = [
        { ecosystem: 'npm', name: 'katex', version: '0.18.1' },
        { ecosystem: 'npm', name: 'katex', version: '0.16.47' },
        { ecosystem: 'cargo', name: 'democrate', version: '0.1.0' },
        { ecosystem: 'cargo', name: 'glib', version: '0.18.5' },
    ];
    const findings = [...parseNpmAudit(NPM_REPORT, LOCK), ...parseCargoAudit(CARGO_REPORT)];
    const statusOf = (result) => Object.fromEntries(result.findings.map((f) => [`${f.name}@${f.version} ${f.advisory}`, f.status]));

    it('blocks shipped vulnerabilities, not development tools or RustSec warnings', () => {
        const result = evaluateFindings({ findings, shipped, exceptions: [], today: TODAY });
        expect(statusOf(result)).toEqual({
            'katex@0.18.1 GHSA-238p-pmpm-9mq7': 'blocking',
            'katex@0.16.47 GHSA-238p-pmpm-9mq7': 'blocking',
            'democrate@0.1.0 RUSTSEC-2026-0001': 'blocking',
            '@vitest/mocker@4.1.11 GHSA-qxg6-89mg-rqv8': 'development',
            '@vitest/mocker@4.1.11 GHSA-xp26-3454-mjgp': 'development',
            'glib@0.18.5 RUSTSEC-2024-0429': 'informational',
            'oldcrate@1.0.0 null': 'informational',
        });
        // Sorted: blocking first, informational last.
        expect(result.findings.map((f) => f.status)).toEqual(['blocking', 'blocking', 'blocking', 'development', 'development', 'informational', 'informational']);
    });

    it('excepts a shipped vulnerability until its exception expires, matched by id or alias', () => {
        const exceptions = [
            { ecosystem: 'npm', package: 'katex', advisory: 'GHSA-238p-pmpm-9mq7', reason: 'trust is off', expires: TODAY },
            { ecosystem: 'cargo', package: 'democrate', advisory: 'CVE-2026-1234', reason: 'not called', expires: '2026-10-24' },
        ];
        const result = evaluateFindings({ findings, shipped, exceptions, today: TODAY });
        const katex = result.findings.filter((f) => f.name === 'katex');
        expect(katex.map((f) => f.status)).toEqual(['excepted', 'excepted']);
        expect(katex[0].note).toBe(`excepted until ${TODAY}: trust is off`);
        const democrate = result.findings.find((f) => f.name === 'democrate');
        expect(democrate).toMatchObject({ status: 'blocking', note: 'exception expired on 2026-10-24' });
        expect(result.unused).toEqual([]);
    });

    it('needs ecosystem and package to match, not only the advisory', () => {
        const exceptions = [{ ecosystem: 'cargo', package: 'katex', advisory: 'GHSA-238p-pmpm-9mq7', reason: 'r', expires: '2099-01-01' }];
        const result = evaluateFindings({ findings, shipped, exceptions, today: TODAY });
        expect(result.findings.filter((f) => f.name === 'katex').every((f) => f.status === 'blocking')).toBe(true);
        expect(result.unused).toEqual(exceptions);
    });

    it('reports an exception for a development package as unused (review cycle 1, F5)', () => {
        const exceptions = [{ ecosystem: 'npm', package: '@vitest/mocker', advisory: 'GHSA-qxg6-89mg-rqv8', reason: 'test only', expires: '2099-01-01' }];
        const result = evaluateFindings({ findings, shipped, exceptions, today: TODAY });
        expect(result.findings.find((f) => f.advisory === 'GHSA-qxg6-89mg-rqv8').status).toBe('development');
        expect(result.unused).toEqual(exceptions);
    });

    it('treats a copy without a version as shipped when any version of it ships', () => {
        const f = { ecosystem: 'npm', name: 'katex', version: null, kind: 'vulnerability', advisory: 'GHSA-2222-3333-4444', aliases: [], title: 't' };
        expect(evaluateFindings({ findings: [f], shipped, exceptions: [], today: TODAY }).findings[0].status).toBe('blocking');
        expect(evaluateFindings({ findings: [{ ...f, name: 'other' }], shipped, exceptions: [], today: TODAY }).findings[0].status).toBe('development');
    });
});

describe('summary and annotations', () => {
    const shipped = [{ ecosystem: 'npm', name: 'katex', version: '0.18.1' }];
    const evaluated = evaluateFindings({ findings: parseNpmAudit(NPM_REPORT, LOCK), shipped, exceptions: [], today: TODAY });

    it('labels a finding on one line', () => {
        expect(findingLabel(evaluated.findings[0])).toBe('npm:katex@0.18.1 GHSA-238p-pmpm-9mq7 (moderate) katex advisory');
    });

    it('says a release is blocked only in release mode', () => {
        const report = renderAuditSummary({ ...evaluated, errors: [], block: true }).join('\n');
        expect(report).toMatch(/^### Vulnerability audit — release blocked/);
        expect(report).toMatch(/\| blocking \| npm:katex@0\.18\.1 \| \[GHSA-238p-pmpm-9mq7\]\(https:\/\/github\.com\/advisories\/GHSA-238p-pmpm-9mq7\) \| moderate \|/);
        expect(report).toMatch(/advisory-exceptions\.json/);
        const pr = renderAuditSummary({ ...evaluated, errors: [], block: false }).join('\n');
        expect(pr).toMatch(/^### Vulnerability audit\n/);
        expect(pr).toMatch(/only reports/);
    });

    it('lists tools that could not audit and unused exceptions, and is empty when there is nothing', () => {
        const unused = [{ ecosystem: 'cargo', package: 'gone', advisory: 'RUSTSEC-2020-0001' }];
        const report = renderAuditSummary({ findings: [], unused, errors: ['cargo audit failed: offline'], block: true }).join('\n');
        expect(report).toMatch(/release blocked/);
        expect(report).toMatch(/\*\*Not audited:\*\* cargo audit failed: offline/);
        expect(report).toMatch(/Unused exception: cargo:gone RUSTSEC-2020-0001/);
        expect(renderAuditSummary({ findings: [], unused: [], errors: [], block: true })).toEqual([]);
    });

    it('escapes table cells', () => {
        const f = { ...evaluated.findings[0], title: 'a | b `c`' };
        expect(renderAuditSummary({ findings: [f], unused: [], errors: [], block: false }).join('\n')).toMatch(/a \\\| b \\`c\\`/);
    });

    it('keeps each table row and list item on one line (review cycle 1, F2)', () => {
        const f = { ...evaluated.findings[0], title: 'first\r\n  second\nthird', note: 'excepted until 2099-01-01: line one\nline two' };
        const lines = renderAuditSummary({ findings: [f], unused: [], errors: ['npm audit failed:\nnetwork'], block: false });
        expect(lines).toContain('- **Not audited:** npm audit failed: network');
        const row = lines.find((l) => l.startsWith('| blocking |'));
        expect(row).toMatch(/\| first second third — excepted until 2099-01-01: line one line two \|$/);
        expect(lines.some((l) => /^(second|third|line two)/.test(l))).toBe(false);
    });

    it('escapes workflow-command data and properties', () => {
        expect(annotation('warning', 'A: b, c', '50% done\r\nnext')).toBe('::warning title=A%3A b%2C c::50%25 done%0D%0Anext');
    });
});
