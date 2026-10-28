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
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    attachAdditions, decodeText, MAX_QUOTE_LINE_LENGTH, MAX_QUOTE_LINES, quoteLines, quoteRanges, validateAdditions,
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
/** readFile over a map of package-relative paths in /reg/demo. */
const files = (map) => (file) => {
    const rel = path.relative(path.join('/reg', 'demo'), file).split(path.sep).join('/');
    return Object.hasOwn(map, rel) ? Buffer.from(map[rel]) : null;
};


describe('validateAdditions', () => {
    it('accepts a well-formed file', () => {
        expect(() => validateAdditions(data(addition()))).not.toThrow();
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

    it('merges the ranges of one file into one span when it fits, else keeps them apart', () => {
        expect(quoteRanges([[23, 23], [27, 27], [68, 72]])).toEqual([[23, 72]]);
        expect(quoteRanges([[1, 2], [MAX_QUOTE_LINES + 10, MAX_QUOTE_LINES + 11]])).toEqual([[1, 2], [MAX_QUOTE_LINES + 10, MAX_QUOTE_LINES + 11]]);
    });
});


describe('attachAdditions', () => {
    it('attaches a checked addition with its quoted excerpt; components without one get []', () => {
        const entries = [entry(), { component: { ecosystem: 'npm', name: 'other', version: '1', linkage: 'linked', dir: '/x' } }];
        const { problems, warnings } = attachAdditions(entries, data(addition()), POLICY, STANDARD, files({ 'src/x86inc.asm': HEADER }));
        expect(problems).toEqual([]);
        expect(warnings).toEqual([]);
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
        expect(missing.problems.join('\n')).toMatch(/is not in the installed package/);
    });

    it('fails on an added licence the policy does not admit', () => {
        const { problems } = attachAdditions([entry()], data(addition({ licences: ['GPL-2.0-only'] })), POLICY, { 'GPL-2.0-only': 'GPL' }, files({ 'src/x86inc.asm': HEADER }));
        expect(problems.join('\n')).toMatch(/GPL-2\.0-only is denied in foss\/policy\.json/);
    });

    it('fails on an added licence with neither a standard text nor a quotable excerpt (a font file)', () => {
        const font = Buffer.from([0, 1, 0, 0]).toString('latin1');
        const a = addition({ licences: ['OFL-1.1'], files: [{ path: 'fonts/a.ttf', sha1: crypto.createHash('sha1').update(Buffer.from(font, 'latin1')).digest('hex'), lines: [[1, 1]] }] });
        const readFont = (file) => (file.endsWith('a.ttf') ? Buffer.from(font, 'latin1') : null);
        const entries = [entry()];
        const { problems } = attachAdditions(entries, data(a), POLICY, STANDARD, readFont);
        expect(problems.join('\n')).toMatch(/no text for OFL-1\.1.*add foss\/licenses\/OFL-1\.1\.txt/);
        expect(entries[0].additions[0].unquoted).toEqual(['fonts/a.ttf']);
        expect(attachAdditions([entry()], data(a), POLICY, { 'OFL-1.1': 'OFL text' }, readFont).problems).toEqual([]);
    });

    it('warns about an addition for a version that is not shipped, and does not fail', () => {
        const { problems, warnings } = attachAdditions([entry('1.1.0')], data(addition()), POLICY, STANDARD, files({}));
        expect(problems).toEqual([]);
        expect(warnings.join('\n')).toMatch(/unused notice addition LT-0123456789 \(cargo:demo@1\.0\.0\).*scan the new version/);
    });

    it('does nothing without a file', () => {
        const entries = [entry()];
        expect(attachAdditions(entries, null, POLICY, STANDARD)).toEqual({ problems: [], warnings: [] });
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
            '  - As found in `a`, `b`, `c` and 1 more: [text-2](#text-2)',
            '  - Not quoted (binary, minified or too long): `x.map`',
        ]);
        expect(added.map(([, id]) => id)).toEqual(['ISC', 'ISC (as found in the code)']);
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
