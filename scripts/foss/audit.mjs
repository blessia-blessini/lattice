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

/// Vulnerability audit (audit.mjs)
///
/// IMPL-LTTCE-FOS-00007 — REQ-LTTCE-FOS-00007. Reads the reports of
/// `npm audit --json` (GitHub advisory database) and `cargo audit --json`
/// (RustSec), and sorts every finding against the shipped inventory of
/// `foss.mjs` and the dated exceptions in foss/advisory-exceptions.json:
///
///   blocking       a vulnerability in a shipped component, no valid exception
///   excepted       the same, with an exception that has not expired
///   development    a vulnerability in a component no published target ships
///   informational  a RustSec warning: unmaintained, unsound, yanked, notice
///
/// Only "blocking" can fail a run, and only on a release (--block). Pure apart
/// from `loadAdvisoryExceptions` and the two runners.

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { escapeInline } from './notices-render.mjs';

const execFileAsync = promisify(execFile);

export const ADVISORY_EXCEPTIONS_FILE = 'foss/advisory-exceptions.json';
export const ADVISORY_ID_RE = /^(GHSA(-[23456789cfghjmpqrvwx]{4}){3}|RUSTSEC-\d{4}-\d{4}|CVE-\d{4}-\d{4,})$/;
const ECOSYSTEMS = Object.freeze(['npm', 'cargo']);
const STATUS_ORDER = Object.freeze(['blocking', 'excepted', 'development', 'informational']);


//**************************************************************
// runJsonTool
//**************************************************************
/**
 * Runs an audit tool and parses its JSON report. Both tools exit 1 when they
 * find a vulnerability, so a non-zero exit with a JSON report on stdout is a
 * result, not a failure.
 * @param {string} label tool name for messages, e.g. "npm audit"
 * @param {string} file program, or with `options.shell` the whole constant command line
 * @param {string[]} args fixed arguments — never user input
 * @param {object} options execFile options
 * @param {typeof execFileAsync} [exec] injectable for tests
 * @returns {Promise<object>}
 * @throws {Error} when the tool cannot run or prints no JSON
 */
export async function runJsonTool(label, file, args, options, exec = execFileAsync) {
    let stdout;
    try {
        ({ stdout } = await exec(file, args, { maxBuffer: 64 * 1024 * 1024, ...options }));
    } catch (e) {
        if (typeof e.stdout !== 'string' || !e.stdout.trim()) {
            // cargo puts a "help:" line after its "error:" line; the error says more.
            const lines = (e.stderr || e.message || '').toString().trim().split('\n').map((l) => l.trim());
            throw new Error(`${label} failed: ${lines.find((l) => /^error\b/i.test(l)) ?? lines.pop()}`);
        }
        stdout = e.stdout;
    }
    try {
        return JSON.parse(stdout);
    } catch {
        throw new Error(`${label} printed no JSON report`);
    }
}
// runJsonTool END *********************************************


//**************************************************************
// runNpmAudit / runCargoAudit
//**************************************************************
/**
 * The two runners. `npm audit` reads package-lock.json only, development
 * packages included — `evaluateFindings` decides what ships. npm goes through
 * a shell because on Windows it is a .cmd script; its command line is one
 * constant string (Node deprecates arguments next to `shell`, DEP0190).
 * `cargo audit` needs the cargo-audit binary on PATH and fetches the RustSec
 * database.
 * @param {string} root repository root
 * @param {typeof execFileAsync} [exec]
 */
export function runNpmAudit(root, exec) {
    return runJsonTool('npm audit', 'npm audit --json --package-lock-only', [], { cwd: root, shell: true }, exec);
}

export function runCargoAudit(root, exec) {
    return runJsonTool('cargo audit', 'cargo', ['audit', '--json', '--file', path.join('src-tauri', 'Cargo.lock')], { cwd: root }, exec);
}
// runNpmAudit / runCargoAudit END *****************************


//**************************************************************
// parseNpmAudit
//**************************************************************
/**
 * Findings of an `npm audit --json` report (auditReportVersion 2), one per
 * installed copy and advisory. An entry whose `via` holds only package names
 * is vulnerable through a dependency; that dependency is reported itself.
 * @param {object} report
 * @param {object} lock package-lock.json (versions of the installed copies)
 * @returns {object[]} findings
 * @throws {Error} on an error report or an unknown format
 */
export function parseNpmAudit(report, lock) {
    if (report?.error) throw new Error(`npm audit: ${report.error.summary || report.error.code || 'error'}`);
    if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
        throw new Error('npm audit: unknown report format (auditReportVersion 2 expected)');
    }
    const findings = new Map();
    for (const [name, entry] of Object.entries(report.vulnerabilities)) {
        const advisories = (entry.via ?? []).filter((v) => v && typeof v === 'object' && (v.name ?? name) === name);
        for (const node of entry.nodes ?? []) {
            const version = lock?.packages?.[node]?.version ?? null;
            for (const a of advisories) {
                const advisory = /\/(GHSA-[\w-]+)$/.exec(a.url ?? '')?.[1] ?? `npm-${a.source}`;
                findings.set(`${name}@${version}|${advisory}`, {
                    ecosystem: 'npm', name, version, kind: 'vulnerability', advisory, aliases: [],
                    title: a.title ?? '', severity: a.severity ?? null, url: a.url ?? null,
                });
            }
        }
    }
    return [...findings.values()];
}
// parseNpmAudit END *******************************************


//**************************************************************
// parseCargoAudit
//**************************************************************
/**
 * Findings of a `cargo audit --json` report: its vulnerabilities, and its
 * warnings (unmaintained, unsound, yanked, notice) as informational.
 * @param {object} report
 * @returns {object[]} findings
 * @throws {Error} on an unknown format
 */
export function parseCargoAudit(report) {
    if (!Array.isArray(report?.vulnerabilities?.list) || typeof report.warnings !== 'object' || report.warnings === null) {
        throw new Error('cargo audit: unknown report format (vulnerabilities.list and warnings expected)');
    }
    const finding = (item, kind) => {
        const a = item.advisory;
        return {
            ecosystem: 'cargo', name: item.package?.name, version: item.package?.version ?? null, kind,
            advisory: a?.id ?? null, aliases: a?.aliases ?? [],
            title: a?.title ?? (kind === 'yanked' ? 'version yanked from crates.io' : kind),
            severity: null, url: a?.id ? `https://rustsec.org/advisories/${a.id}.html` : null,
        };
    };
    const findings = report.vulnerabilities.list.map((v) => finding(v, 'vulnerability'));
    for (const [kind, list] of Object.entries(report.warnings)) {
        for (const w of list ?? []) findings.push(finding(w, w.kind ?? kind));
    }
    return findings;
}
// parseCargoAudit END *****************************************


//**************************************************************
// loadAdvisoryExceptions
//**************************************************************
/**
 * Reads and validates foss/advisory-exceptions.json.
 * @param {string} root repository root
 * @returns {object[]} the exceptions
 * @throws {Error} on a missing or malformed file
 */
export function loadAdvisoryExceptions(root) {
    return validateAdvisoryExceptions(JSON.parse(fs.readFileSync(path.join(root, ADVISORY_EXCEPTIONS_FILE), 'utf8')));
}
// loadAdvisoryExceptions END **********************************


//**************************************************************
// validateAdvisoryExceptions
//**************************************************************
/**
 * Every exception names one advisory (GHSA, RUSTSEC or CVE id) for one
 * package, why it is accepted, and when that must be looked at again.
 * @param {object} data parsed file
 * @returns {object[]}
 * @throws {Error} naming the first bad entry
 */
export function validateAdvisoryExceptions(data) {
    if (!Array.isArray(data?.exceptions)) throw new Error(`${ADVISORY_EXCEPTIONS_FILE}: "exceptions" must be a list`);
    for (const e of data.exceptions) {
        if (!ECOSYSTEMS.includes(e?.ecosystem) || typeof e.package !== 'string' || !e.package
            || !ADVISORY_ID_RE.test(e.advisory ?? '') || typeof e.reason !== 'string' || !e.reason.trim()
            || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? '')) {
            throw new Error(`${ADVISORY_EXCEPTIONS_FILE}: exception ${JSON.stringify(e)} needs ecosystem (npm | cargo), package, advisory (GHSA-…, RUSTSEC-…, CVE-…), reason, expires (YYYY-MM-DD)`);
        }
    }
    return data.exceptions;
}
// validateAdvisoryExceptions END ******************************


//**************************************************************
// evaluateFindings
//**************************************************************
/**
 * Gives every finding its status (see the module header) and lists the
 * exceptions that match no vulnerability any more.
 * @param {object} options
 * @param {object[]} options.findings from the parsers
 * @param {{ecosystem: string, name: string, version: string}[]} options.shipped components of the licence inventory
 * @param {object[]} options.exceptions validated advisory exceptions
 * @param {string} options.today YYYY-MM-DD
 * @returns {{findings: object[], unused: object[]}} findings sorted by status, then component
 */
export function evaluateFindings({ findings, shipped, exceptions, today }) {
    const keys = new Set(shipped.map((c) => `${c.ecosystem}:${c.name}@${c.version}`));
    const names = new Set(shipped.map((c) => `${c.ecosystem}:${c.name}`));
    // No version (an npm copy missing from the lockfile): assume it ships.
    const isShipped = (f) => (f.version === null ? names.has(`${f.ecosystem}:${f.name}`) : keys.has(`${f.ecosystem}:${f.name}@${f.version}`));
    const matches = (e, f) => e.ecosystem === f.ecosystem && e.package === f.name && (e.advisory === f.advisory || f.aliases.includes(e.advisory));
    const used = new Set();

    const out = findings.map((f) => {
        if (f.kind !== 'vulnerability') return { ...f, status: 'informational', note: null };
        const exception = exceptions.find((e) => matches(e, f)) ?? null;
        if (exception) used.add(exception);
        if (!isShipped(f)) return { ...f, status: 'development', note: null };
        if (exception && exception.expires >= today) return { ...f, status: 'excepted', note: `excepted until ${exception.expires}: ${exception.reason}` };
        return { ...f, status: 'blocking', note: exception ? `exception expired on ${exception.expires}` : null };
    });
    out.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        || `${a.ecosystem}:${a.name}`.localeCompare(`${b.ecosystem}:${b.name}`, 'en')
        || String(a.advisory).localeCompare(String(b.advisory), 'en'));
    return { findings: out, unused: exceptions.filter((e) => !used.has(e)) };
}
// evaluateFindings END ****************************************


//**************************************************************
// findingLabel
//**************************************************************
/** One line naming a finding: `npm:katex@0.16.47 GHSA-… (moderate) title`. */
export function findingLabel(f) {
    const severity = f.severity ? ` (${f.severity})` : '';
    return `${f.ecosystem}:${f.name}@${f.version ?? '?'} ${f.advisory ?? f.kind}${severity} ${f.title}`.trim();
}
// findingLabel END ********************************************


//**************************************************************
// annotation
//**************************************************************
/**
 * A GitHub Actions workflow command (`::warning title=…::…`), so a finding
 * shows on the run and the pull request even when the check stays green.
 * @param {'warning'|'error'} level
 * @param {string} title
 * @param {string} message
 * @returns {string}
 */
export function annotation(level, title, message) {
    const data = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const prop = (s) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
    return `::${level} title=${prop(title)}::${data(message)}`;
}
// annotation END **********************************************


//**************************************************************
// renderAuditSummary
//**************************************************************
/**
 * The job-summary Markdown of one audit.
 * @param {object} options
 * @param {object[]} options.findings evaluated
 * @param {object[]} options.unused exceptions matching nothing
 * @param {string[]} options.errors tools that could not report
 * @param {boolean} options.block release mode
 * @returns {string[]} lines; empty when there is nothing to report
 */
export function renderAuditSummary({ findings, unused, errors, block }) {
    if (!findings.length && !unused.length && !errors.length) return [];
    const count = (s) => findings.filter((f) => f.status === s).length;
    const blocking = count('blocking');
    const failed = block && (blocking > 0 || errors.length > 0);
    const lines = [
        `### Vulnerability audit${failed ? ' — release blocked' : ''}`,
        '',
        `${blocking} vulnerable shipped component(s) without exception, ${count('excepted')} excepted, `
            + `${count('development')} in development tools only, ${count('informational')} informational (unmaintained, unsound, yanked).`
            + (block ? '' : ' Outside a release this check only reports.'),
        '',
    ];
    for (const e of errors) lines.push(`- **Not audited:** ${escapeInline(e)}`);
    if (errors.length) lines.push('');
    if (findings.length) {
        lines.push('| Status | Component | Advisory | Severity | Title |', '|---|---|---|---|---|');
        for (const f of findings) {
            const advisory = f.advisory ? (f.url ? `[${f.advisory}](${f.url})` : f.advisory) : '–';
            const title = escapeInline(f.title) + (f.note ? ` — ${escapeInline(f.note)}` : '');
            lines.push(`| ${f.status} | ${escapeInline(`${f.ecosystem}:${f.name}@${f.version ?? '?'}`)} | ${advisory} | ${f.severity ?? '–'} | ${title} |`);
        }
        lines.push('');
    }
    for (const e of unused) lines.push(`- Unused exception: ${escapeInline(`${e.ecosystem}:${e.package} ${e.advisory}`)} — remove it from \`${ADVISORY_EXCEPTIONS_FILE}\`.`);
    if (unused.length) lines.push('');
    if (blocking) {
        lines.push(`A release is blocked while a shipped component has a known vulnerability: update it, or record a reasoned, dated exception in \`${ADVISORY_EXCEPTIONS_FILE}\`.`);
    }
    return lines;
}
// renderAuditSummary END **************************************
