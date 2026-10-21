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

// UTST/ITST for REQ-LTTCE-FOS-00006 — the Linux AppImage system libraries:
// the reviewed list, its notices section, dpkg output parsing and owner
// resolution, and the check of an unpacked AppImage. Hermetic: a synthetic
// squashfs-root in a temp dir; dpkg is injected.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    APPIMAGE_LIST_FILE, evaluateAppImageList, followFileLinks, inventoryAppImage, listCopyrightFolders,
    listShippedLibraries, loadAppImageList, parseDpkgSearch, referencedLicenceTexts, renderAppImageSection, resolveOwners,
    runDpkgTool, validateAppImageList,
} from './appimage.mjs';
import { commandAppImage } from './foss.mjs';
import { loadPolicy } from './policy.mjs';

const REAL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TODAY = '2026-10-21';
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const COPYRIGHT_A = 'Files: *\nLicense: LGPL-2.1+\n On Debian systems, the complete text can be found in /usr/share/common-licenses/LGPL-2.1.\n';
const COPYRIGHT_B = 'Files: *\nLicense: Expat\n';
const policy = () => loadPolicy(path.join(REAL_ROOT, 'foss', 'policy.json'));


//**************************************************************
// makeAppRoot (fixture builder)
//**************************************************************
/**
 * An unpacked AppImage with two packages: liba1 (two libraries, one in a
 * module folder; its copyright file points to common-licenses/LGPL-2.1) and
 * libb2, plus Lattice's own binary.
 */
function makeAppRoot(root, { extraDoc = null, extraLib = null, licenceTexts = true } = {}) {
    const write = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    };
    write('usr/share/doc/liba1/copyright', COPYRIGHT_A);
    write('usr/share/doc/libb2/copyright', COPYRIGHT_B);
    write('usr/lib/liba.so.1', 'elf');
    write('usr/lib/gio/modules/libamod.so', 'elf');
    write('usr/lib/libb.so.2.0.1', 'elf');
    write('usr/lib/README.txt', 'not a library');
    write('usr/bin/lattice', 'elf');
    if (licenceTexts) write('usr/share/common-licenses/LGPL-2.1', 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1\n');
    if (extraDoc) write(`usr/share/doc/${extraDoc}/copyright`, 'Files: *\nLicense: GPL-2+\n');
    if (extraLib) write(`usr/lib/${extraLib}`, 'elf');
}
// makeAppRoot END *********************************************


const LIST = () => validateAppImageList({
    packages: [
        { package: 'liba1', source: 'a', license: 'LGPL-2.1-or-later', copyrightSha256: sha(COPYRIGHT_A) },
        { package: 'libb2', source: 'b', license: 'MIT', copyrightSha256: sha(COPYRIGHT_B) },
        { package: 'libx64only', source: 'x', license: 'MIT', copyrightSha256: 'a'.repeat(64), platforms: ['linux-x64'] },
    ],
});
const OWNERS = { 'liba.so.1': ['liba1'], 'libamod.so': ['liba1'], 'libb.so.2.0.1': ['libb2'] };
const owners = (map = OWNERS) => (names) => new Map(names.filter((n) => map[n]).map((n) => [n, new Set(map[n])]));
const versions = (pkgs) => new Map(pkgs.map((p) => [p, { version: '1.0-1ubuntu1', source: `src-${p}`, sourceVersion: '1.0-1ubuntu1' }]));


describe('validateAppImageList', () => {
    it('sorts by package and defaults platforms to every AppImage target', () => {
        const list = validateAppImageList({ packages: [
            { package: 'libz1', source: 'z', license: 'MIT', copyrightSha256: 'b'.repeat(64) },
            { package: 'liba1', source: 'a', license: 'MIT', copyrightSha256: 'a'.repeat(64), platforms: ['linux-arm64'] },
        ] });
        expect(list.map((p) => [p.package, p.platforms])).toEqual([['liba1', ['linux-arm64']], ['libz1', ['linux-x64', 'linux-arm64']]]);
    });

    it.each([
        [{}],
        [{ packages: [] }],
        [{ packages: [{ package: 'Bad Name', source: 's', license: 'MIT', copyrightSha256: 'a'.repeat(64) }] }],
        [{ packages: [{ package: 'liba1', source: '', license: 'MIT', copyrightSha256: 'a'.repeat(64) }] }],
        [{ packages: [{ package: 'liba1', source: 's', license: 'MIT', copyrightSha256: 'abc' }] }],
        [{ packages: [{ package: 'liba1', source: 's', license: 'MIT', copyrightSha256: 'a'.repeat(64), platforms: ['win-x64'] }] }],
        [{ packages: [{ package: 'liba1', source: 's', license: 'MIT', copyrightSha256: 'a'.repeat(64), platforms: [] }] }],
    ])('rejects %j', (value) => {
        expect(() => validateAppImageList(value)).toThrow(APPIMAGE_LIST_FILE);
    });

    it('rejects a package listed twice', () => {
        const p = { package: 'liba1', source: 's', license: 'MIT', copyrightSha256: 'a'.repeat(64) };
        expect(() => validateAppImageList({ packages: [p, { ...p }] })).toThrow(/listed twice/);
    });
});

describe('foss/appimage-packages.json on the real tree', () => {
    const list = loadAppImageList(REAL_ROOT);

    it('fits the policy as shared libraries, every package', () => {
        const failing = evaluateAppImageList(list, policy(), TODAY).filter((e) => !e.evaluation.pass);
        expect(failing.map((e) => `${e.item.package}: ${e.evaluation.problems.join('; ')}`)).toEqual([]);
    });

    it('does not list the TIFF path that brought GPL-2.0-or-later libjbig in', () => {
        const names = list.map((p) => p.package);
        for (const gone of ['libjbig0', 'libtiff6', 'liblerc4', 'libdeflate0']) expect(names).not.toContain(gone);
    });

    it('lists the packages that own only GIO modules or the SVG loader (CI run 39650213160 found them unlisted)', () => {
        const names = list.map((p) => p.package);
        for (const pkg of ['dconf-gsettings-backend', 'glib-networking', 'librsvg2-common']) expect(names).toContain(pkg);
    });
});

describe('runDpkgTool', () => {
    const failing = (props) => () => { throw Object.assign(new Error('failed'), props); };

    it('returns stdout of a successful run', () => {
        expect(runDpkgTool('dpkg-query', ['-W'], () => 'a\t1\n')).toBe('a\t1\n');
    });

    it('keeps what was found when exit status 1 only means one name was unknown', () => {
        expect(runDpkgTool('dpkg-query', ['-W', 'a', 'gone'], failing({ status: 1, stdout: 'a\t1\n' }))).toBe('a\t1\n');
    });

    it('throws when the tool is missing or fails otherwise', () => {
        expect(() => runDpkgTool('dpkg-query', [], failing({ code: 'ENOENT' }))).toThrow('failed');
        expect(() => runDpkgTool('dpkg-query', [], failing({ status: 2, stdout: '' }))).toThrow('failed');
    });
});

describe('referencedLicenceTexts', () => {
    it('finds each common-licenses text once, without a sentence-ending dot', () => {
        const text = [
            'License: LGPL-2.1+',
            ' can be found in /usr/share/common-licenses/LGPL-2.1.',
            'License: GPL-2+',
            ' see `/usr/share/common-licenses/GPL-2\' and /usr/share/common-licenses/LGPL-2.1,',
            ' or /usr/share/common-licenses/GPL for the latest version.',
        ].join('\n');
        expect(referencedLicenceTexts(text)).toEqual(['GPL', 'GPL-2', 'LGPL-2.1']);
    });

    it('returns nothing for a file with the licence text inline', () => {
        expect(referencedLicenceTexts('License: Expat\n Permission is hereby granted, free of charge, …\n')).toEqual([]);
    });
});

describe('renderAppImageSection', () => {
    const lines = renderAppImageSection(evaluateAppImageList(LIST(), policy(), TODAY)).join('\n');

    it('carries the written offer with the contact and the Ubuntu source archive', () => {
        expect(lines).toMatch(/^## Linux AppImage system libraries$/m);
        expect(lines).toMatch(/\*\*Written offer\.\*\*.*at least three years.*blessia AT blessini\.com/);
        expect(lines).toContain('https://launchpad.net/ubuntu/+source/');
    });

    it('keeps every placeholder in a code span, where Markdown cannot take it for an HTML tag', () => {
        expect(lines).toContain('`https://launchpad.net/ubuntu/+source/<source package>/<version>`');
        const outsideCode = lines.replace(/`[^`]*`/g, '');
        expect(outsideCode).not.toMatch(/<[A-Za-z/][^>]*>/);
    });

    it('says where the copyright files and the licence texts they point to are', () => {
        expect(lines).toContain('`usr/share/doc/<package>/copyright`');
        expect(lines).toContain('`usr/share/common-licenses/`');
    });

    it('lists one row per package, with "all" or the platforms it ships on', () => {
        expect(lines).toMatch(/^\| liba1 \| a \| LGPL-2\.1-or-later \| all \|  \|$/m);
        expect(lines).toMatch(/^\| libx64only \| x \| MIT \| linux-x64 \|  \|$/m);
    });
});

describe('parseDpkgSearch', () => {
    it('reads owners, drops the architecture suffix, keeps only lib paths and skips diversions', () => {
        const text = [
            'libglib2.0-0t64:amd64: /usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0',
            'libglib2.0-dev:amd64, libglib2.0-dev-bin: /usr/lib/x86_64-linux-gnu/libgobject-2.0.so',
            'diversion by foo from: /usr/lib/x86_64-linux-gnu/libz.so.1',
            'libfoo-doc: /usr/share/doc/libfoo/libfoo.so.txt',
            'libblkid1:amd64: /lib/x86_64-linux-gnu/libblkid.so.1',
            '',
        ].join('\n');
        expect(parseDpkgSearch(text)).toEqual([
            { file: '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0', packages: ['libglib2.0-0t64'] },
            { file: '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so', packages: ['libglib2.0-dev', 'libglib2.0-dev-bin'] },
            { file: '/lib/x86_64-linux-gnu/libblkid.so.1', packages: ['libblkid1'] },
        ]);
    });
});

describe('resolveOwners', () => {
    // dpkg as a table: file -> owners; the -dev package owns the symlink.
    const DB = {
        '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so': ['libglib2.0-dev'],
        '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0.8000.0': ['libglib2.0-0t64'],
        '/usr/lib/x86_64-linux-gnu/libz.so.1': ['zlib1g'],
    };
    const LINKS = { '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so': '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0.8000.0' };
    const search = (patterns) => Object.entries(DB)
        .filter(([file]) => patterns.some((p) => (p.startsWith('*/') ? file.endsWith(p.slice(1)) : file === p)))
        .map(([file, packages]) => ({ file, packages }));

    it('credits the package that owns the real file, not the -dev package that owns the symlink', () => {
        const out = resolveOwners(['libgobject-2.0.so'], search, (f) => LINKS[f] ?? f);
        expect([...out.get('libgobject-2.0.so')]).toEqual(['libglib2.0-0t64']);
    });

    it('keeps the owner of a file that is no symlink, and finds nothing for an unknown name', () => {
        const out = resolveOwners(['libz.so.1', 'libnone.so'], search, (f) => f);
        expect([...out.get('libz.so.1')]).toEqual(['zlib1g']);
        expect(out.has('libnone.so')).toBe(false);
    });

    it('does not match a longer name that merely ends the same way', () => {
        expect(resolveOwners(['z.so.1'], search, (f) => f).size).toBe(0);
    });
});

describe.skipIf(process.platform === 'win32')('followFileLinks (symlinks need a POSIX file system)', () => {
    let dir;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-'));
        fs.writeFileSync(path.join(dir, 'libx.so.1.2'), 'elf');
        fs.symlinkSync('libx.so.1.2', path.join(dir, 'libx.so.1'));
        fs.symlinkSync('libx.so.1', path.join(dir, 'libx.so'));
        fs.mkdirSync(path.join(dir, 'real'));
        fs.writeFileSync(path.join(dir, 'real', 'liby.so'), 'elf');
        fs.symlinkSync('real', path.join(dir, 'linkdir'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('follows a chain of file links to the real file', () => {
        expect(followFileLinks(path.join(dir, 'libx.so'))).toBe(path.join(dir, 'libx.so.1.2'));
    });

    it('leaves a directory link in the path alone (merged /usr)', () => {
        expect(followFileLinks(path.join(dir, 'linkdir', 'liby.so'))).toBe(path.join(dir, 'linkdir', 'liby.so'));
    });

    it('returns null for a missing file or a dangling link', () => {
        fs.symlinkSync('nowhere', path.join(dir, 'dangling.so'));
        expect(followFileLinks(path.join(dir, 'missing.so'))).toBeNull();
        expect(followFileLinks(path.join(dir, 'dangling.so'))).toBeNull();
    });
});

describe('an unpacked AppImage', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-root-'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    const run = (label = 'linux-x64', ownerMap = OWNERS, list = LIST()) =>
        inventoryAppImage({ root, label, list, policy: policy(), today: TODAY, owners: owners(ownerMap), versions });

    it('lists the shared libraries under usr/lib and the copyright folders with their hashes', () => {
        makeAppRoot(root);
        expect(listShippedLibraries(root)).toEqual(['usr/lib/gio/modules/libamod.so', 'usr/lib/liba.so.1', 'usr/lib/libb.so.2.0.1']);
        expect(listCopyrightFolders(root)).toEqual(new Map([['liba1', sha(COPYRIGHT_A)], ['libb2', sha(COPYRIGHT_B)]]));
    });

    it('passes when every package is reviewed and every library is owned; warns about a listed package that is absent', () => {
        makeAppRoot(root);
        const r = run();
        expect(r.problems).toEqual([]);
        expect(r.warnings).toEqual(['libx64only: listed but not in this AppImage']);
        expect(r.entries.map((e) => [e.component.name, e.component.version, e.component.arch, e.component.libraries])).toEqual([
            ['liba1', '1.0-1ubuntu1', 'amd64', ['usr/lib/gio/modules/libamod.so', 'usr/lib/liba.so.1']],
            ['libb2', '1.0-1ubuntu1', 'amd64', ['usr/lib/libb.so.2.0.1']],
        ]);
        expect(r.entries[0].component.homepage).toBe('https://launchpad.net/ubuntu/+source/src-liba1/1.0-1ubuntu1');
    });

    it('does not warn on arm64 about a package listed for x64 only', () => {
        makeAppRoot(root);
        expect(run('linux-arm64').warnings).toEqual([]);
    });

    it('fails for a package nobody reviewed — the libjbig case', () => {
        makeAppRoot(root, { extraDoc: 'libjbig0' });
        expect(run().problems).toEqual([expect.stringMatching(/^libjbig0: not in foss\/appimage-packages\.json \(copyright sha256 [0-9a-f]{64}\)/)]);
    });

    it('fails when a reviewed copyright file changed', () => {
        makeAppRoot(root);
        fs.writeFileSync(path.join(root, 'usr/share/doc/libb2/copyright'), 'Files: *\nLicense: GPL-2+\n');
        expect(run().problems).toEqual([expect.stringMatching(/^libb2: copyright file changed/)]);
    });

    it('fails for a carried package the build machine\'s dpkg-query does not know, instead of guessing a version', () => {
        makeAppRoot(root);
        const partial = (pkgs) => new Map([...versions(pkgs)].filter(([p]) => p !== 'libb2'));
        const r = inventoryAppImage({ root, label: 'linux-x64', list: LIST(), policy: policy(), today: TODAY, owners: owners(), versions: partial });
        expect(r.problems).toEqual(['libb2: dpkg-query does not know this package on the build machine, so its version cannot be recorded']);
        expect(r.entries.map((e) => e.component.name)).toEqual(['liba1']);
    });

    it('fails when a copyright file points to a common-licenses text the AppImage does not carry', () => {
        makeAppRoot(root, { licenceTexts: false });
        expect(run().problems).toEqual(['liba1: its copyright file refers to /usr/share/common-licenses/LGPL-2.1, which the AppImage does not carry']);
    });

    it('fails for a package carried on a platform it is not listed for', () => {
        makeAppRoot(root);
        const list = validateAppImageList({ packages: [
            { package: 'liba1', source: 'a', license: 'LGPL-2.1-or-later', copyrightSha256: sha(COPYRIGHT_A), platforms: ['linux-x64'] },
            { package: 'libb2', source: 'b', license: 'MIT', copyrightSha256: sha(COPYRIGHT_B) },
        ] });
        expect(run('linux-arm64', OWNERS, list).problems).toEqual(['liba1: listed for linux-x64 only, but the linux-arm64 AppImage carries it']);
    });

    it('fails for a listed licence the policy denies', () => {
        makeAppRoot(root);
        const list = validateAppImageList({ packages: [
            { package: 'liba1', source: 'a', license: 'GPL-2.0-or-later', copyrightSha256: sha(COPYRIGHT_A) },
            { package: 'libb2', source: 'b', license: 'MIT', copyrightSha256: sha(COPYRIGHT_B) },
        ] });
        expect(run('linux-x64', OWNERS, list).problems).toEqual([expect.stringMatching(/^liba1: licence "GPL-2\.0-or-later" is denied/)]);
    });

    it('fails for a library no package owns, and for one whose owner brought no copyright folder', () => {
        makeAppRoot(root, { extraLib: 'libghost.so.3' });
        expect(run().problems).toEqual(['usr/lib/libghost.so.3: no installed package owns this library']);
        expect(run('linux-x64', { ...OWNERS, 'libghost.so.3': ['libghost3'] }).problems)
            .toEqual(['usr/lib/libghost.so.3: owned by libghost3, which has no copyright folder in the AppImage']);
    });

    it('rejects a target that ships no AppImage', () => {
        makeAppRoot(root);
        expect(() => run('win-x64')).toThrow(/no AppImage for target "win-x64"/);
    });
});

describe('commandAppImage', () => {
    let repo;
    let app;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-repo-'));
        app = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-app-'));
        fs.cpSync(path.join(REAL_ROOT, 'foss'), path.join(repo, 'foss'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'lattice', version: '9.9.9' }));
        fs.writeFileSync(path.join(repo, APPIMAGE_LIST_FILE), JSON.stringify({ packages: LIST().map(({ platforms, ...p }) => (p.package === 'libx64only' ? { ...p, platforms } : p)) }));
        makeAppRoot(app);
    });
    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(app, { recursive: true, force: true });
    });
    const probes = (ownerMap = OWNERS) => ({ owners: owners(ownerMap), versions });

    it('writes the AppImage SBOM with deb purls and exits 0', () => {
        const out = path.join(repo, 'out');
        expect(commandAppImage({ root: repo, appRoot: app, label: 'linux-arm64', outDir: out, today: TODAY, probes: probes() }, quiet)).toBe(0);
        const bom = JSON.parse(fs.readFileSync(path.join(out, 'lattice-linux-arm64-appimage.cdx.json'), 'utf8'));
        expect(bom.metadata.component).toMatchObject({ name: 'lattice', version: '9.9.9' });
        expect(bom.components.map((c) => [c.purl, c.scope])).toEqual([
            ['pkg:deb/ubuntu/liba1@1.0-1ubuntu1?arch=arm64', 'required'],
            ['pkg:deb/ubuntu/libb2@1.0-1ubuntu1?arch=arm64', 'required'],
        ]);
        expect(bom.components[0].licenses).toEqual([{ expression: 'LGPL-2.1-or-later' }]);
    });

    it('exits 1 and still writes the SBOM when the AppImage fails the check', () => {
        const out = path.join(repo, 'out');
        const errors = [];
        expect(commandAppImage({ root: repo, appRoot: app, label: 'linux-x64', outDir: out, today: TODAY, probes: probes({}) }, { ...quiet, error: (m) => errors.push(m) })).toBe(1);
        expect(errors.at(-1)).toMatch(/3 problem\(s\)/);
        expect(fs.existsSync(path.join(out, 'lattice-linux-x64-appimage.cdx.json'))).toBe(true);
    });
});
