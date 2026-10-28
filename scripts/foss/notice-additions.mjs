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

/// Notice additions from the Legattice ledger (notice-additions.mjs)
///
/// IMPL-LTTCE-FOS-00008 — REQ-LTTCE-FOS-00008. A deep scan of the package
/// sources (Legattice, ScanCode) finds code inside a package under a licence
/// the package does not declare: a header from another project, fonts under
/// their own licence. A person decides each finding in the Legattice ledger;
/// the decisions that add a licence are exported as notice-additions.json
/// (format: legattice docs/notices.md) and committed here as
/// foss/notice-additions.json.
///
/// This module checks each addition against the installed package — the file
/// must have the SHA-1 the decision was made on — and quotes the lines found,
/// so THIRD-PARTY-NOTICES.md can carry them. Reading files is the only I/O,
/// and it is injectable.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizeText } from './licence-texts.mjs';
import { classifyLeaf } from './policy.mjs';

export const ADDITIONS_FILE = 'foss/notice-additions.json';
export const ADDITIONS_FORMAT = 1;
/** A quoted excerpt longer than this, or with a longer line, is not quoted (minified code, a source map). */
export const MAX_QUOTE_LINES = 200;
export const MAX_QUOTE_LINE_LENGTH = 400;

const TOPIC_RE = /^LT-[0-9a-f]{10}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const isText = (v) => typeof v === 'string' && v.trim() !== '';


//**************************************************************
// validateAdditions
//**************************************************************
/**
 * Checks the shape of notice-additions.json.
 * @param {unknown} data parsed JSON
 * @returns {object} data, unchanged
 * @throws {Error} naming the first malformed part
 */
export function validateAdditions(data) {
    const fail = (what) => { throw new Error(`${ADDITIONS_FILE}: ${what}`); };
    if (data?.format !== ADDITIONS_FORMAT) fail(`"format" must be ${ADDITIONS_FORMAT}`);
    if (!Array.isArray(data.additions)) fail('"additions" must be a list');
    const seen = new Set();
    for (const a of data.additions) {
        const where = `addition ${JSON.stringify(a?.topic ?? null)}`;
        if (!TOPIC_RE.test(a?.topic ?? '')) fail(`${where}: "topic" must be a ledger topic id (LT- and 10 hex digits)`);
        if (seen.has(a.topic)) fail(`${where}: listed twice`);
        seen.add(a.topic);
        const p = a.package;
        if (!isText(p?.ecosystem) || !isText(p?.name) || !isText(p?.version)) fail(`${where}: "package" needs ecosystem, name and version`);
        if (!Array.isArray(a.licences) || !a.licences.length || !a.licences.every(isText)) fail(`${where}: "licences" must be a non-empty list of SPDX ids`);
        if (!Array.isArray(a.files) || !a.files.length) fail(`${where}: "files" must be a non-empty list`);
        for (const f of a.files) {
            const rel = String(f?.path ?? '');
            if (!isText(rel) || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) fail(`${where}: file path ${JSON.stringify(f?.path)} must stay inside the package`);
            if (!SHA1_RE.test(f.sha1 ?? '')) fail(`${where}: file "${rel}" needs its SHA-1`);
            const ranges = Array.isArray(f.lines) && f.lines.length
                && f.lines.every((r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && r[0] >= 1 && Number.isInteger(r[1]) && r[1] >= r[0]);
            if (!ranges) fail(`${where}: file "${rel}" needs "lines", a list of [start, end] with 1 <= start <= end`);
        }
        if (!Array.isArray(a.copyrights) || !a.copyrights.every(isText)) fail(`${where}: "copyrights" must be a list of statements`);
    }
    return data;
}
// validateAdditions END ***************************************


//**************************************************************
// loadAdditions
//**************************************************************
/**
 * Reads and checks foss/notice-additions.json; null when there is none.
 * @param {string} root repository root
 * @returns {object|null}
 */
export function loadAdditions(root) {
    const file = path.join(root, ADDITIONS_FILE);
    if (!fs.existsSync(file)) return null;
    return validateAdditions(JSON.parse(fs.readFileSync(file, 'utf8')));
}
// loadAdditions END *******************************************


/**
 * Windows-1252 bytes 0x80-0x9F (the rest is Latin-1). Node's TextDecoder
 * treats "windows-1252" as Latin-1 and turns these into control characters,
 * so curly quotes and dashes are mapped here. Undefined bytes stay as U+FFFD.
 */
const CP1252_HIGH = '€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ';


//**************************************************************
// decodeText
//**************************************************************
/**
 * The text of a file, or null for a binary one (a NUL byte). UTF-8 when it
 * is valid UTF-8, else Windows-1252: older licence files and headers use it.
 * @param {Buffer} bytes
 * @returns {string|null}
 */
export function decodeText(bytes) {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b))).join('');
    }
}
// decodeText END **********************************************


//**************************************************************
// quoteLines
//**************************************************************
/**
 * Lines `start`..`end` (1-based) of a text, normalised; null when they are
 * not there or too long to quote (MAX_QUOTE_LINES, MAX_QUOTE_LINE_LENGTH).
 * @param {string} text
 * @param {[number, number]} range
 * @returns {string|null}
 */
export function quoteLines(text, [start, end]) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (end > lines.length || end - start + 1 > MAX_QUOTE_LINES) return null;
    const picked = lines.slice(start - 1, end);
    if (picked.some((l) => l.length > MAX_QUOTE_LINE_LENGTH)) return null;
    const body = normalizeText(picked.join('\n'));
    return body === '' ? null : body;
}
// quoteLines END **********************************************


//**************************************************************
// quoteRanges
//**************************************************************
/**
 * The ranges to quote from one file: one span from the first to the last
 * line found when it fits MAX_QUOTE_LINES — a licence block a scanner
 * reports in pieces reads as one — else each range on its own.
 * @param {[number, number][]} ranges
 * @returns {[number, number][]}
 */
export function quoteRanges(ranges) {
    const start = Math.min(...ranges.map((r) => r[0]));
    const end = Math.max(...ranges.map((r) => r[1]));
    return end - start + 1 <= MAX_QUOTE_LINES ? [[start, end]] : ranges;
}
// quoteRanges END *********************************************


//**************************************************************
// attachAdditions
//**************************************************************
/**
 * Gives each inventory entry the additions for its component, checked
 * against the installed files: `entry.additions` = [{ topic, licences,
 * copyrights, quotes: [{ text, files }], unquoted: [path], fileCount }],
 * sorted by topic. Every entry gets the field, [] when nothing applies.
 *
 * Problems (fail the gate and the notices): an installed file missing or
 * with another SHA-1, an added licence the policy does not admit, an added
 * licence with neither a standard text nor a quoted excerpt. Warnings: an
 * addition for a component version that is not shipped (the package was
 * updated; scan it again).
 * @param {object[]} entries evaluated inventory from `collect`
 * @param {object|null} data from loadAdditions
 * @param {object} policy
 * @param {Record<string,string>} standardTexts id -> text (foss/licenses)
 * @param {(file: string) => Buffer|null} [readFile] null when missing
 * @returns {{problems: string[], warnings: string[]}}
 */
export function attachAdditions(entries, data, policy, standardTexts, readFile = readIfExists) {
    const problems = [];
    const warnings = [];
    for (const e of entries) e.additions = [];
    if (!data) return { problems, warnings };
    const byKey = new Map(entries.map((e) => [`${e.component.ecosystem}:${e.component.name}@${e.component.version}`, e]));
    for (const a of data.additions) {
        const label = `${a.topic} (${a.package.ecosystem}:${a.package.name}@${a.package.version})`;
        const entry = byKey.get(`${a.package.ecosystem}:${a.package.name}@${a.package.version}`);
        if (!entry) {
            warnings.push(`unused notice addition ${label}: that version is not shipped; scan the new version with Legattice and update ${ADDITIONS_FILE}`);
            continue;
        }
        const quotes = new Map(); // text -> Set(path)
        const unquoted = [];
        for (const f of a.files) {
            const bytes = entry.component.dir ? readFile(path.join(entry.component.dir, f.path)) : null;
            if (!bytes) {
                problems.push(`notice addition ${label}: ${f.path} is not in the installed package`);
                continue;
            }
            const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
            if (sha1 !== f.sha1) {
                problems.push(`notice addition ${label}: ${f.path} differs from the file the decision was made on (SHA-1 ${sha1}, expected ${f.sha1})`);
                continue;
            }
            const text = decodeText(bytes);
            const bodies = text === null ? [] : quoteRanges(f.lines).map((r) => quoteLines(text, r));
            if (!bodies.length || bodies.some((b) => b === null)) unquoted.push(f.path);
            for (const body of bodies.filter(Boolean)) {
                if (!quotes.has(body)) quotes.set(body, new Set());
                quotes.get(body).add(f.path);
            }
        }
        for (const id of a.licences) {
            const verdict = classifyLeaf({ id, exception: null }, policy, entry.component.linkage);
            if (verdict !== 'allowed' && verdict !== 'obligation') problems.push(`notice addition ${label}: ${id} is ${verdict} in foss/policy.json`);
            if (!standardTexts[id] && !quotes.size) problems.push(`notice addition ${label}: no text for ${id}: no excerpt could be quoted; add foss/licenses/${id}.txt`);
        }
        entry.additions.push({
            topic: a.topic,
            licences: [...a.licences],
            copyrights: [...a.copyrights],
            quotes: [...quotes].map(([text, files]) => ({ text, files: [...files].sort() })),
            unquoted: unquoted.sort(),
            fileCount: a.files.length,
        });
    }
    for (const e of entries) e.additions.sort((x, y) => x.topic.localeCompare(y.topic, 'en'));
    return { problems, warnings };
}
// attachAdditions END *****************************************


/** The bytes of a file, or null when it does not exist. */
function readIfExists(file) {
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
