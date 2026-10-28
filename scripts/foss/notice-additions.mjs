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
/**
 * A path inside a package as the scan writes it: relative, forward slashes,
 * no "." or ".." segment, no drive ("C:"), no backslash -- checked the same on
 * every OS, so a form only Windows treats as a path cannot pass on Linux.
 */
const PACKAGE_PATH_RE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\/:]+(?:\/[^\\/:]+)*$/;
/** Ranges of one file at most this many lines apart are quoted as one span. */
export const MAX_MERGE_GAP = 10;
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
            if (!PACKAGE_PATH_RE.test(rel)) fail(`${where}: file path ${JSON.stringify(f?.path)} must stay inside the package`);
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
 * The ranges to quote from one file, sorted: ranges at most MAX_MERGE_GAP
 * lines apart (or overlapping) become one span -- a licence block a scanner
 * reports in pieces reads as one -- while ranges further apart stay apart,
 * so no stretch of unrelated code lands in the notices.
 * @param {[number, number][]} ranges
 * @returns {[number, number][]}
 */
export function quoteRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const spans = [];
    for (const [start, end] of sorted) {
        const last = spans[spans.length - 1];
        if (last && start - last[1] - 1 <= MAX_MERGE_GAP) last[1] = Math.max(last[1], end);
        else spans.push([start, end]);
    }
    return spans;
}
// quoteRanges END *********************************************


//**************************************************************
// attachAdditions
//**************************************************************
/**
 * Gives each inventory entry the additions for its component, checked
 * against the installed files: `entry.additions` = [{ topic, licences,
 * copyrights, quotes: [{ text, files }], unquoted, fileCount }], sorted by
 * topic. `unquoted` names a file none of whose ranges could be quoted, and
 * "file:start-end" for the ranges of a partly quoted one. Every entry gets
 * the field, [] when nothing applies.
 *
 * Problems (fail the gate and the notices): an installed file missing,
 * outside the package (a link leading out) or with another SHA-1, an added
 * licence the policy does not admit, an added licence with neither a
 * standard text nor a quoted excerpt. Unused: additions for a component
 * version that is not shipped (the package was updated; scan it again) --
 * a warning, a failure on a release (`foss.mjs check --block`).
 * @param {object[]} entries evaluated inventory from `collect`
 * @param {object|null} data from loadAdditions
 * @param {object} policy
 * @param {Record<string,string>} standardTexts id -> text (foss/licenses)
 * @param {(dir: string, rel: string) => Buffer|null} [readFile] null when missing or outside dir
 * @returns {{problems: string[], unused: string[]}}
 */
export function attachAdditions(entries, data, policy, standardTexts, readFile = readInside) {
    const problems = [];
    const unused = [];
    for (const e of entries) e.additions = [];
    if (!data) return { problems, unused };
    const byKey = new Map(entries.map((e) => [`${e.component.ecosystem}:${e.component.name}@${e.component.version}`, e]));
    for (const a of data.additions) {
        const label = `${a.topic} (${a.package.ecosystem}:${a.package.name}@${a.package.version})`;
        const entry = byKey.get(`${a.package.ecosystem}:${a.package.name}@${a.package.version}`);
        if (!entry) {
            unused.push(`unused notice addition ${label}: that version is not shipped, so its notices are not in the notices; scan the new version with Legattice and update ${ADDITIONS_FILE}`);
            continue;
        }
        const quotes = new Map(); // text -> Set(path)
        const unquoted = [];
        for (const f of a.files) {
            const bytes = entry.component.dir ? readFile(entry.component.dir, f.path) : null;
            if (!bytes) {
                problems.push(`notice addition ${label}: ${f.path} is not a file inside the installed package`);
                continue;
            }
            const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
            if (sha1 !== f.sha1) {
                problems.push(`notice addition ${label}: ${f.path} differs from the file the decision was made on (SHA-1 ${sha1}, expected ${f.sha1})`);
                continue;
            }
            const text = decodeText(bytes);
            const spans = quoteRanges(f.lines);
            const bodies = text === null ? spans.map(() => null) : spans.map((r) => quoteLines(text, r));
            if (bodies.every((b) => b === null)) unquoted.push(f.path);
            else bodies.forEach((b, i) => { if (b === null) unquoted.push(`${f.path}:${spans[i][0]}-${spans[i][1]}`); });
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
    return { problems, unused };
}
// attachAdditions END *****************************************


//**************************************************************
// readInside
//**************************************************************
/**
 * The bytes of `rel` inside `dir`, or null when it is missing, not a regular
 * file, or resolves outside `dir` -- a symbolic link inside a package must
 * not make the notices quote a file from elsewhere on the machine.
 * @param {string} dir package directory
 * @param {string} rel path inside it (validated by validateAdditions)
 * @returns {Buffer|null}
 */
export function readInside(dir, rel) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file) || !fs.existsSync(dir)) return null;
    const real = fs.realpathSync(file);
    const base = fs.realpathSync(dir);
    const inside = path.relative(base, real);
    if (inside === '' || inside.split(path.sep)[0] === '..' || path.isAbsolute(inside)) return null;
    return fs.statSync(real).isFile() ? fs.readFileSync(real) : null;
}
// readInside END **********************************************
