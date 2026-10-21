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

// UTST for REQ-LTTCE-FOS-00004 — a component whose licence breaks the policy
// fails the gate; clarifications are tied to a file hash; exceptions expire.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyLeaf, evaluateComponent, licenceTypeMap, loadPolicy, obligationNote, unusedPolicyEntries, validatePolicy } from './policy.mjs';

const TODAY = '2026-10-20';
const base = () => validatePolicy({
    allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
    obligation: { 'MPL-2.0': 'keep MPL files MPL' },
    denied: ['GPL-3.0-only', 'AGPL-3.0-or-later'],
    allowedExceptions: ['LLVM-exception'],
    preference: ['MIT', 'BSD-3-Clause', 'Apache-2.0'],
    types: { permissive: ['MIT', 'Apache-2.0', 'BSD-3-Clause'], 'weak-copyleft': ['MPL-2.0'] },
});
const comp = (license, extra = {}) => ({ ecosystem: 'cargo', name: 'demo', version: '1.0.0', license, dir: null, ...extra });

describe('validatePolicy', () => {
    it('fills defaults for missing lists', () => {
        const p = validatePolicy({});
        expect(p.allowed).toEqual([]);
        expect(p.obligation).toEqual({});
    });

    it('rejects a clarification without evidence', () => {
        expect(() => validatePolicy({ clarifications: [{ ecosystem: 'npm', name: 'x', version: '1', license: 'MIT' }] })).toThrow(/evidence/);
    });

    it('rejects an exception without an expiry date', () => {
        expect(() => validatePolicy({ exceptions: [{ ecosystem: 'npm', name: 'x', version: '1', reason: 'r' }] })).toThrow(/expires/);
    });

    it('rejects an admitted licence without a type', () => {
        expect(() => validatePolicy({ allowed: ['MIT', 'ISC'], obligation: { 'MPL-2.0': 'x' }, types: { permissive: ['MIT'] } }))
            .toThrow(/no entry in "types" for ISC, MPL-2.0/);
    });

    it('rejects an unknown licence type and a non-array type entry', () => {
        // Review: a typo'd type crashed the renderer; a bare string passed validation.
        expect(() => validatePolicy({ types: { copyleft: ['GPL-3.0-only'] } })).toThrow(/unknown licence type "copyleft"/);
        expect(() => validatePolicy({ allowed: ['MIT'], types: { permissive: 'MIT' } })).toThrow(/must be an array/);
        expect(() => validatePolicy({ types: { permissive: null } })).toThrow(/must be an array/);
    });

    it('turns "types" into an id -> type lookup', () => {
        expect(licenceTypeMap(base())).toMatchObject({ MIT: 'permissive', 'MPL-2.0': 'weak-copyleft' });
    });

    it('loads the real policy file', () => {
        const p = loadPolicy(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'foss', 'policy.json'));
        expect(p.allowed).toContain('MIT');
        // Third-party GPL/AGPL would remove the commercial licence option.
        expect(p.denied).toEqual(expect.arrayContaining(['GPL-3.0-only', 'AGPL-3.0-or-later']));
    });
});

describe('classifyLeaf', () => {
    it('keeps the base category for an allowed exception', () => {
        expect(classifyLeaf({ id: 'Apache-2.0', exception: 'LLVM-exception' }, base())).toBe('allowed');
    });

    it('needs review for an unknown exception', () => {
        expect(classifyLeaf({ id: 'Apache-2.0', exception: 'Some-exception' }, base())).toBe('review');
    });

    it('cannot lift a denied licence with an exception', () => {
        expect(classifyLeaf({ id: 'GPL-3.0-only', exception: 'LLVM-exception' }, base())).toBe('denied');
    });
});

describe('evaluateComponent', () => {
    it('passes an allowed licence', () => {
        const r = evaluateComponent(comp('MIT OR Apache-2.0'), base(), TODAY);
        expect(r.pass).toBe(true);
        expect(r.chosen.map((l) => l.id)).toEqual(['MIT']);
    });

    it('passes MPL-2.0 as an obligation', () => {
        const r = evaluateComponent(comp('MPL-2.0'), base(), TODAY);
        expect(r).toMatchObject({ pass: true, category: 'obligation' });
    });

    it('fails a denied licence (negative test of the gate)', () => {
        const r = evaluateComponent(comp('GPL-3.0-only'), base(), TODAY);
        expect(r.pass).toBe(false);
        expect(r.problems[0]).toMatch(/denied/);
    });

    it('fails a missing licence', () => {
        const r = evaluateComponent(comp(null), base(), TODAY);
        expect(r).toMatchObject({ pass: false, category: 'denied' });
    });

    it('fails an unparsable licence', () => {
        expect(evaluateComponent(comp('MIT OR'), base(), TODAY).pass).toBe(false);
    });

    it('fails an unknown licence unless excepted, and again once the exception expires', () => {
        const p = base();
        expect(evaluateComponent(comp('LGPL-2.1-or-later'), p, TODAY).pass).toBe(false);
        p.exceptions.push({ ecosystem: 'cargo', name: 'demo', version: '1.0.0', reason: 'dynamic', expires: '2026-12-31' });
        expect(evaluateComponent(comp('LGPL-2.1-or-later'), p, TODAY).pass).toBe(true);
        const expired = evaluateComponent(comp('LGPL-2.1-or-later'), p, '2027-01-01');
        expect(expired.pass).toBe(false);
        expect(expired.problems[0]).toMatch(/expired/);
    });

    it('prefers an OR option whose text the package ships', () => {
        const r = evaluateComponent(comp('BSD-3-Clause OR MIT'), base(), TODAY, new Set(['BSD-3-Clause']));
        expect(r.chosen.map((l) => l.id)).toEqual(['BSD-3-Clause']);
    });

    describe('clarifications', () => {
        let dir;
        const TEXT = 'MIT licence text\n';
        const sha = crypto.createHash('sha256').update(TEXT).digest('hex');
        const clarified = () => {
            const p = base();
            p.clarifications.push({ ecosystem: 'npm', name: 'nolic', version: '2.1.0', license: 'MIT', evidence: { file: 'license', sha256: sha } });
            return p;
        };
        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-policy-'));
        });
        afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('replaces a missing licence when the evidence matches', () => {
            fs.writeFileSync(path.join(dir, 'license'), TEXT);
            const r = evaluateComponent({ ecosystem: 'npm', name: 'nolic', version: '2.1.0', license: null, dir }, clarified(), TODAY);
            expect(r).toMatchObject({ pass: true, clarified: true, expression: 'MIT' });
        });

        it('fails when the evidence file changed', () => {
            fs.writeFileSync(path.join(dir, 'license'), 'GPL now\n');
            const r = evaluateComponent({ ecosystem: 'npm', name: 'nolic', version: '2.1.0', license: null, dir }, clarified(), TODAY);
            expect(r.pass).toBe(false);
            expect(r.problems[0]).toMatch(/changed/);
        });

        it('fails when the evidence file is missing', () => {
            const r = evaluateComponent({ ecosystem: 'npm', name: 'nolic', version: '2.1.0', license: null, dir }, clarified(), TODAY);
            expect(r.pass).toBe(false);
            expect(r.problems[0]).toMatch(/missing/);
        });

        it('does not apply to another version', () => {
            const r = evaluateComponent({ ecosystem: 'npm', name: 'nolic', version: '2.2.0', license: null, dir }, clarified(), TODAY);
            expect(r.pass).toBe(false);
        });

        it('reports entries no component uses any more', () => {
            expect(unusedPolicyEntries(clarified(), [comp('MIT')])).toEqual(['clarifications: npm:nolic@2.1.0']);
        });
    });
});

describe('sharedLibrary — licences only for libraries loaded at run time (REQ-LTTCE-FOS-00006)', () => {
    const shared = () => validatePolicy({
        ...base(),
        denied: ['GPL-3.0-only', 'GPL-3.0-or-later', 'GPL-2.0-or-later', 'AGPL-3.0-or-later'],
        sharedLibrary: {
            allowed: ['GPL-3.0-or-later WITH GCC-exception-3.1'],
            obligation: { 'LGPL-2.1-or-later': 'replaceable; source offered' },
        },
        types: {
            permissive: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
            'weak-copyleft': ['MPL-2.0', 'LGPL-2.1-or-later'],
            'strong-copyleft': ['GPL-3.0-or-later'],
        },
    });
    const lib = (license) => ({ ecosystem: 'debian', name: 'libdemo1', version: '*', license, linkage: 'shared-library', dir: null });

    it('admits the LGPL for a shared library, with its obligation', () => {
        const r = evaluateComponent(lib('LGPL-2.1-or-later'), shared(), TODAY);
        expect(r).toMatchObject({ pass: true, category: 'obligation' });
        expect(obligationNote({ id: 'LGPL-2.1-or-later', exception: null }, shared(), 'shared-library')).toBe('replaceable; source offered');
    });

    it.each([['cargo', 'linked'], ['npm', 'linked'], ['cargo', 'build-time']])(
        'keeps the LGPL at review for a %s component (%s) — it would be linked into Lattice itself',
        (ecosystem, linkage) => {
            const r = evaluateComponent({ ...comp('LGPL-2.1-or-later'), ecosystem, linkage }, shared(), TODAY);
            expect(r).toMatchObject({ pass: false, category: 'review' });
            expect(obligationNote({ id: 'LGPL-2.1-or-later', exception: null }, shared(), linkage)).toBeNull();
        },
    );

    it('admits a whole "ID WITH exception" leaf for a shared library only, though the base licence is denied', () => {
        expect(evaluateComponent(lib('GPL-3.0-or-later WITH GCC-exception-3.1'), shared(), TODAY).pass).toBe(true);
        expect(evaluateComponent(comp('GPL-3.0-or-later WITH GCC-exception-3.1'), shared(), TODAY).category).toBe('denied');
    });

    it('still denies plain GPL for a shared library', () => {
        expect(evaluateComponent(lib('GPL-2.0-or-later'), shared(), TODAY)).toMatchObject({ pass: false, category: 'denied' });
    });

    it('requires a type for every sharedLibrary licence, by its base id', () => {
        expect(() => validatePolicy({ sharedLibrary: { allowed: ['X-1.0 WITH Y-exception'], obligation: {} } })).toThrow(/no entry in "types" for X-1\.0/);
        expect(() => validatePolicy({ sharedLibrary: { allowed: 'LGPL-2.1-or-later' } })).toThrow(/sharedLibrary/);
    });

    it('lets a version wildcard match any version, for Debian packages only', () => {
        const p = validatePolicy({ ...shared(), exceptions: [{ ecosystem: 'debian', name: 'libdemo1', version: '*', reason: 'r', expires: '2099-01-01' }] });
        expect(evaluateComponent({ ...lib('AFL-2.1'), version: '1.14.10-4ubuntu4' }, p, TODAY).pass).toBe(true);
        expect(() => validatePolicy({ exceptions: [{ ecosystem: 'npm', name: 'x', version: '*', reason: 'r', expires: '2099-01-01' }] })).toThrow(/no "\*" except for ecosystem debian/);
        expect(() => validatePolicy({ clarifications: [{ ecosystem: 'cargo', name: 'x', version: '*', license: 'MIT', evidence: { file: 'f', sha256: 'a' } }] })).toThrow(/no "\*"/);
    });
});

describe('separateProgram — licences only for programs Lattice does not link with (REQ-LTTCE-FOS-00006)', () => {
    const separate = () => validatePolicy({
        ...base(),
        sharedLibrary: { allowed: [], obligation: { 'LGPL-2.1-or-later': 'replaceable file' } },
        separateProgram: { allowed: [], obligation: { 'LGPL-2.1-only': 'separate program; source public' } },
        types: { permissive: ['MIT', 'Apache-2.0', 'BSD-3-Clause'], 'weak-copyleft': ['MPL-2.0', 'LGPL-2.1-only', 'LGPL-2.1-or-later'] },
    });
    const part = (license, linkage = 'separate-program') => ({ ecosystem: 'other', name: 'libfuse (in the runtime)', version: '3.15.0', license, linkage, dir: null });

    it('admits its own licences for a separate program, with its own obligation note', () => {
        expect(evaluateComponent(part('LGPL-2.1-only'), separate(), TODAY)).toMatchObject({ pass: true, category: 'obligation' });
        expect(obligationNote({ id: 'LGPL-2.1-only', exception: null }, separate(), 'separate-program')).toBe('separate program; source public');
    });

    it('keeps each linkage to its own section', () => {
        expect(evaluateComponent(part('LGPL-2.1-or-later'), separate(), TODAY)).toMatchObject({ pass: false, category: 'review' });
        expect(evaluateComponent(part('LGPL-2.1-only', 'shared-library'), separate(), TODAY)).toMatchObject({ pass: false, category: 'review' });
        expect(evaluateComponent(part('LGPL-2.1-only', 'linked'), separate(), TODAY)).toMatchObject({ pass: false, category: 'review' });
    });

    it('validates the section like sharedLibrary', () => {
        expect(() => validatePolicy({ separateProgram: { allowed: 'LGPL-2.1-only' } })).toThrow(/"separateProgram" needs/);
        expect(() => validatePolicy({ separateProgram: { allowed: [], obligation: { 'X-1.0': 'n' } } })).toThrow(/no entry in "types" for X-1\.0/);
    });
});

describe('foss/policy.json on the real tree — sharedLibrary and separateProgram scope', () => {
    const real = loadPolicy(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'foss', 'policy.json'));

    it('admits the runtime\'s LGPL-2.1-only libfuse as a separate program, and not for a crate', () => {
        const fuse = { ecosystem: 'other', name: 'libfuse', version: '3.15.0', license: 'LGPL-2.1-only', linkage: 'separate-program', dir: null };
        expect(evaluateComponent(fuse, real, TODAY).pass).toBe(true);
        expect(obligationNote({ id: 'LGPL-2.1-only', exception: null }, real, 'separate-program')).toMatch(/separate program/);
        expect(evaluateComponent({ ...fuse, ecosystem: 'cargo', linkage: 'linked' }, real, TODAY).pass).toBe(false);
    });

    it.each(['LGPL-2.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later', 'MPL-1.1'])(
        'does not admit %s for a crate or npm package', (id) => {
            expect(evaluateComponent({ ecosystem: 'cargo', name: 'c', version: '1', license: id, linkage: 'linked', dir: null }, real, TODAY).pass).toBe(false);
            expect(evaluateComponent({ ecosystem: 'npm', name: 'n', version: '1', license: id, linkage: 'linked', dir: null }, real, TODAY).pass).toBe(false);
        },
    );
});
