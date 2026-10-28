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

/// Tests of notice-additions.mjs (REQ-LTTCE-FOS-00008).

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    attachAdditions, decodeText, MAX_MERGE_GAP, MAX_QUOTE_LINE_LENGTH, MAX_QUOTE_LINES, quoteLines, quoteRanges, readInside, validateAdditions,
} from './notice-additions.mjs';
import { renderAddition, renderNotices, additionsIntro } from './notices-render.mjs';
import { TARGETS } from './cargo-inventory.mjs';

const sha1 = (text) => crypto.createHash('sha1').update(Buffer.from(text)).digest('hex');
const HEADER = '; Copyright (c) 2005 x264 project\n;\n; Permission to use, copy, modify, and/or distribute this software\n; for any purpose with or without fee is hereby granted.\nsection .text\n';
const POLICY = { allowed: ['ISC', 'MIT', 'OFL-1.1'], denied: ['GPL-2.0-only'], obligation: {}, allowedExceptions: [] };
const STANDARD = { ISC: 'ISC standard text', MIT: 'MIT standard text' };

/** One well-formed addition; `over` replaces fields. */
const addition = (over = {}) => ({
    topic: 'LT-0123456789',
    package: { id: 'Crate::demo:1.0.0', ecosystem: 'cargo', name: 'demo', version: '1.0.0' },
    licences: ['ISC'],
    decision: { outcome: 'accept-as', licence: 'ISC', rationale: 'R', decidedBy: 'A. Reviewer', date: '2026-10-28' },
    files: [{ path: 'src/x86inc.asm', sha1: sha1(HEADER), lines: [[3, 4]] }],
    copyrights: ['Copyright (c) 2005 x264 project'],
    ...over,
});
const data = (...additions) => ({ format: 1, source: { product: { repository: 'owner/product', ref: 'v1' }, date: '2026-10-28', legattice: null, run: null }, additions });
/** An inventory entry for crate demo 1.0.0 installed in /reg/demo. */
const entry = (version = '1.0.0') => ({ component: { ecosystem: 'cargo', name: 'demo', version, linkage: 'linked', dir: path.join('/reg', 'demo') } });
/** readFile over a map of package-relative paths. */
const files = (map) => (dir, rel) => (Object.hasOwn(map, rel) ? Buffer.from(map[rel]) : null);


describe('validateAdditions', () => {
    it('accepts a well-formed file, with dots inside names', () => {
        expect(() => validateAdditions(data(addition()))).not.toThrow();
        const dotted = addition({ files: [{ path: '.github/a..b/x.rs', sha1: sha1(''), lines: [[1, 1]] }] });
        expect(() => validateAdditions(data(dotted))).not.toThrow();
    });

    it.each([
        ['a wrong format', { ...data(addition()), format: 2 }, /"format"/],
        ['no list', { format: 1 }, /"additions" must be a list/],
        ['a bad topic id', data(addition({ topic: 'LT-xyz' })), /"topic"/],
        ['a topic twice', data(addition(), addition()), /listed twice/],
        ['a package without version', data(addition({ package: { ecosystem: 'cargo', name: 'demo' } })), /"package"/],
        ['no licences', data(addition({ licences: [] })), /"licences"/],
        ['no files', data(addition({ files: [] })), /"files"/],
        ['a path leaving the package', data(addition({ files: [{ path: '../evil', sha1: sha1(''), lines: [[1, 1]] }] })), /stay inside the package/],
        ['an absolute path', data(addition({ files: [{ path: '/etc/passwd', sha1: sha1(''), lines: [[1, 1]] }] })), /stay inside the package/],
        ...['a/../b', './a', 'a/./b', 'x/..', 'C:foo', 'C:/x', 'a\\b', '\\\\server\\share', 'a//b', 'a/'].map((p) =>
            [`the path ${JSON.stringify(p)}`, data(addition({ files: [{ path: p, sha1: sha1(''), lines: [[1, 1]] }] })), /stay inside the package/]),
        ['a file without SHA-1', data(addition({ files: [{ path: 'a', sha1: null, lines: [[1, 1]] }] })), /needs its SHA-1/],
        ['an inverted range', data(addition({ files: [{ path: 'a', sha1: sha1(''), lines: [[5, 2]] }] })), /"lines"/],
        ['line 0', data(addition({ files: [{ path: 'a', sha1: sha1(''), lines: [[0, 2]] }] })), /"lines"/],
        ['copyrights not a list', data(addition({ copyrights: 'x' })), /"copyrights"/],
    ])('refuses %s', (_, bad, message) => {
        expect(() => validateAdditions(bad)).toThrow(message);
    });
});


describe('decodeText', () => {
    it('reads UTF-8, refuses binary, and maps Windows-1252 quotes instead of control characters', () => {
        expect(decodeText(Buffer.from('Grüße'))).toBe('Grüße');
        expect(decodeText(Buffer.from([0x41, 0x00, 0x42]))).toBeNull();
        expect(decodeText(Buffer.from([0x93, 0x41, 0x94, 0x20, 0x96, 0xe9]))).toBe('“A” –é');
    });
});


describe('quoteLines and quoteRanges', () => {
    const text = 'one\r\ntwo  \nthree\nfour\n';

    it('quotes lines start..end, normalised', () => {
        expect(quoteLines(text, [2, 3])).toBe('two\nthree');
    });

    it('refuses ranges past the end, too many lines, too long a line, or blank lines only', () => {
        expect(quoteLines(text, [4, 9])).toBeNull();
        const many = Array.from({ length: MAX_QUOTE_LINES + 1 }, () => 'x').join('\n');
        expect(quoteLines(many, [1, MAX_QUOTE_LINES + 1])).toBeNull();
        expect(quoteLines('x'.repeat(MAX_QUOTE_LINE_LENGTH + 1), [1, 1])).toBeNull();
        expect(quoteLines('a\n\n\nb', [2, 3])).toBeNull();
    });

    it('merges ranges of one file that are close together, keeps ranges further apart separate', () => {
        expect(quoteRanges([[27, 27], [23, 23], [60, 60], [68, 72]])).toEqual([[23, 27], [60, 72]]);
        expect(quoteRanges([[5, 10], [10 + MAX_MERGE_GAP + 1, 30]])).toEqual([[5, 30]]);
        expect(quoteRanges([[5, 10], [10 + MAX_MERGE_GAP + 2, 30]])).toEqual([[5, 10], [10 + MAX_MERGE_GAP + 2, 30]]);
        expect(quoteRanges([[5, 10], [185, 190]])).toEqual([[5, 10], [185, 190]]);
        expect(quoteRanges([[1, 40], [3, 8]])).toEqual([[1, 40]]);
    });
});


describe('attachAdditions', () => {
    it('attaches a checked addition with its quoted excerpt; components without one get []', () => {
        const entries = [entry(), { component: { ecosystem: 'npm', name: 'other', version: '1', linkage: 'linked', dir: '/x' } }];
        const { problems, unused } = attachAdditions(entries, data(addition()), POLICY, STANDARD, files({ 'src/x86inc.asm': HEADER }));
        expect(problems).toEqual([]);
        expect(unused).toEqual([]);
        expect(entries[0].additions).toEqual([{
            topic: 'LT-0123456789', licences: ['ISC'], copyrights: ['Copyright (c) 2005 x264 project'],
            quotes: [{ text: '; Permission to use, copy, modify, and/or distribute this software\n; for any purpose with or without fee is hereby granted.', files: ['src/x86inc.asm'] }],
            unquoted: [], fileCount: 1,
        }]);
        expect(entries[1].additions).toEqual([]);
    });

    it('fails on a file that differs from the one decided on, or is missing', () => {
        const changed = attachAdditions([entry()], data(addition()), POLICY, STANDARD, files({ 'src/x86inc.asm': HEADER + 'changed' }));
        expect(changed.problems.join('\n')).toMatch(/src\/x86inc\.asm differs from the file the decision was made on/);
        const missing = attachAdditions([entry()], data(addition()), POLICY, STANDARD, files({}));
        expect(missing.problems.join('\n')).toMatch(/is not a file inside the installed package/);
    });

    it('fails on an added licence the policy does not admit', () => {
        const { problems } = attachAdditions([entry()], data(addition({ licences: ['GPL-2.0-only'] })), POLICY, { 'GPL-2.0-only': 'GPL' }, files({ 'src/x86inc.asm': HEADER }));
        expect(problems.join('\n')).toMatch(/GPL-2\.0-only is denied in foss\/policy\.json/);
    });

    it('fails on an added licence with neither a standard text nor a quotable excerpt (a font file)', () => {
        const font = Buffer.from([0, 1, 0, 0]).toString('latin1');
        const a = addition({ licences: ['OFL-1.1'], files: [{ path: 'fonts/a.ttf', sha1: crypto.createHash('sha1').update(Buffer.from(font, 'latin1')).digest('hex'), lines: [[1, 1]] }] });
        const readFont = (dir, rel) => (rel === 'fonts/a.ttf' ? Buffer.from(font, 'latin1') : null);
        const entries = [entry()];
        const { problems } = attachAdditions(entries, data(a), POLICY, STANDARD, readFont);
        expect(problems.join('\n')).toMatch(/no text for OFL-1\.1.*add foss\/licenses\/OFL-1\.1\.txt/);
        expect(entries[0].additions[0].unquoted).toEqual(['fonts/a.ttf']);
        expect(attachAdditions([entry()], data(a), POLICY, { 'OFL-1.1': 'OFL text' }, readFont).problems).toEqual([]);
    });

    it('names only the ranges that could not be quoted when a file is partly quoted', () => {
        const long = `${HEADER}${'\n'.repeat(20)}${'x'.repeat(MAX_QUOTE_LINE_LENGTH + 1)}\n`;
        const a = addition({ files: [{ path: 'src/x86inc.asm', sha1: sha1(long), lines: [[3, 4], [26, 26]] }] });
        const entries = [entry()];
        expect(attachAdditions(entries, data(a), POLICY, STANDARD, files({ 'src/x86inc.asm': long })).problems).toEqual([]);
        expect(entries[0].additions[0].quotes.map((q) => q.files)).toEqual([['src/x86inc.asm']]);
        expect(entries[0].additions[0].unquoted).toEqual(['src/x86inc.asm:26-26']);
    });

    it('reports an addition for a version that is not shipped as unused, not as a problem', () => {
        const { problems, unused } = attachAdditions([entry('1.1.0')], data(addition()), POLICY, STANDARD, files({}));
        expect(problems).toEqual([]);
        expect(unused.join('\n')).toMatch(/unused notice addition LT-0123456789 \(cargo:demo@1\.0\.0\).*scan the new version/);
    });

    it('does nothing without a file', () => {
        const entries = [entry()];
        expect(attachAdditions(entries, null, POLICY, STANDARD)).toEqual({ problems: [], unused: [] });
        expect(entries[0].additions).toEqual([]);
    });
});


describe('rendering additions', () => {
    const a = { topic: 'LT-0123456789', licences: ['ISC'], copyrights: ['Copyright (c) 2005 x264 project'], quotes: [{ text: 'quoted', files: ['a', 'b', 'c', 'd'] }], unquoted: ['x.map'], fileCount: 5 };

    it('lists licences, copyright lines, the standard text and each excerpt under the component', () => {
        const added = [];
        const lines = renderAddition(a, 'demo 1.0.0', STANDARD, (body, id) => { added.push([body, id]); return `text-${added.length}`; });
        expect(lines).toEqual([
            '- Also in its code: ISC, in 5 files (ledger decision LT-0123456789)',
            '  - Copyright (c) 2005 x264 project',
            '  - Licence text (ISC): [text-1](#text-1), standard text',
            '  - As found in a, b, c and 1 more: [text-2](#text-2)',
            '  - Not quoted (binary, minified or too long): x.map',
        ]);
        expect(added.map(([, ids]) => ids)).toEqual([['ISC'], ['ISC (as found in the code)']]);
    });

    it('names the scan in the introduction and counts added licences in the type summary', () => {
        const source = { product: { repository: 'owner/product', ref: 'v1' }, date: '2026-10-28', run: 'https://example.org/run/1' };
        expect(additionsIntro(source)).toMatch(/\(a scan of owner\/product at v1, 2026-10-28, https:\/\/example\.org\/run\/1\)/);
        const notices = renderNotices({
            entries: [{
                component: { ecosystem: 'cargo', name: 'demo', version: '1.0.0', linkage: 'linked' },
                evaluation: { expression: 'MIT', chosen: [{ id: 'MIT', exception: null }] },
                selection: { copyrights: ['Copyright Demo'], texts: [{ id: 'MIT', source: 'standard' }], notices: [] },
                platforms: TARGETS.map((t) => t.label), obligation: null, additions: [a],
            }],
            standardTexts: STANDARD, targets: TARGETS, licenceTypes: { MIT: 'permissive', ISC: 'permissive' }, additionsSource: source,
        });
        expect(notices).toMatch(/Some components contain code from other projects/);
        expect(notices).toMatch(/\| ISC \| permissive \| 1 \| 1 \|/);
        expect(notices).toMatch(/Licence: ISC \(as found in the code\)\. Used by: demo 1\.0\.0\.\n\n```text\nquoted\n```/);
    });
});


describe('readInside', () => {
    it('reads a file inside the package, refuses one a link leads out to, and a folder', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-additions-'));
        try {
            const pkg = path.join(base, 'pkg');
            fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
            fs.writeFileSync(path.join(pkg, 'src', 'a.rs'), 'inside');
            fs.writeFileSync(path.join(base, 'secret.txt'), 'outside');
            expect(readInside(pkg, 'src/a.rs').toString()).toBe('inside');
            expect(readInside(pkg, 'src/missing.rs')).toBeNull();
            expect(readInside(pkg, 'src')).toBeNull();
            let linked = true;
            try {
                fs.symlinkSync(path.join(base, 'secret.txt'), path.join(pkg, 'src', 'link.rs'));
            } catch {
                linked = false; // Windows without the symlink privilege: nothing to test
            }
            if (linked) expect(readInside(pkg, 'src/link.rs')).toBeNull();
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });
});


describe('notices with several additions (review cycle 1)', () => {
    const quoted = (topic, licences, text) => ({ topic, licences, copyrights: [], quotes: [{ text, files: ['src/`odd`.S'] }], unquoted: [], fileCount: 1 });
    const notices = () => renderNotices({
        entries: [{
            component: { ecosystem: 'cargo', name: 'demo', version: '1.0.0', linkage: 'linked' },
            evaluation: { expression: 'MIT', chosen: [{ id: 'MIT', exception: null }] },
            selection: { copyrights: ['Copyright Demo'], texts: [{ id: 'MIT', source: 'standard' }], notices: [] },
            platforms: TARGETS.map((t) => t.label), obligation: null,
            additions: [quoted('LT-0000000001', ['ISC'], 'same header'), quoted('LT-0000000002', ['ISC', 'MIT'], 'same header')],
        }],
        standardTexts: STANDARD, targets: TARGETS, licenceTypes: { MIT: 'permissive', ISC: 'permissive' },
    });

    it('lists each licence id of an excerpt once, and each user once', () => {
        expect(notices()).toMatch(/Licence: ISC \(as found in the code\), MIT \(as found in the code\)\. Used by: demo 1\.0\.0\.\n/);
        expect(notices()).toMatch(/Licence: ISC\. Used by: demo 1\.0\.0\.\n/);
    });

    it('counts a component once per licence in the type summary, however many additions carry it', () => {
        expect(notices()).toMatch(/\| ISC \| permissive \| 1 \| 1 \|/);
        expect(notices()).toMatch(/\| MIT \| permissive \| 1 \| 1 \|/);
    });

    it('escapes file paths, which may hold a backtick', () => {
        expect(notices()).toContain('As found in src/\\`odd\\`.S:');
    });
});
