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
    APPIMAGE_LIST_FILE, bundlerParts, checkRuntime, classifyShippedFile, evaluateAppImageList, followFileLinks, globToRegExp,
    inventoryAppImage, listCopyrightFolders, listShippedFiles, loadAppImageFiles, loadAppImageList, parseDpkgSearch,
    readRuntimeCommit, referencedLicenceTexts, renderAppImageSection, resolveOwners, runDpkgTool, validateAppImageFiles,
    validateAppImageList,
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
 * module folder, and a schema; its copyright file points to
 * common-licenses/LGPL-2.1) and libb2; plus Lattice's own binary, files the
 * build writes (AppRun, a module cache) and a bundler part (AppRun.wrapped).
 */
function makeAppRoot(root, { extraDoc = null, extraLib = null, extraFile = null, licenceTexts = true } = {}) {
    const write = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    };
    write('usr/share/doc/liba1/copyright', COPYRIGHT_A);
    write('usr/share/doc/libb2/copyright', COPYRIGHT_B);
    write('usr/lib/liba.so.1', 'elf');
    write('usr/lib/gio/modules/libamod.so', 'elf');
    write('usr/lib/libb.so.2.0.1', 'elf');
    write('usr/share/glib-2.0/schemas/org.example.gschema.xml', '<schemalist/>');
    write('usr/bin/lattice', 'elf');
    write('usr/lib/gio/modules/giomodule.cache', 'cache');
    write('AppRun', '#!/bin/sh');
    write('AppRun.wrapped', 'elf');
    if (licenceTexts) write('usr/share/common-licenses/LGPL-2.1', 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1\n');
    if (extraDoc) write(`usr/share/doc/${extraDoc}/copyright`, 'Files: *\nLicense: GPL-2+\n');
    if (extraLib) write(`usr/lib/${extraLib}`, 'elf');
    if (extraFile) write(extraFile, 'data');
}
// makeAppRoot END *********************************************


const LIST = () => validateAppImageList({
    packages: [
        { package: 'liba1', source: 'a', license: 'LGPL-2.1-or-later', copyrightSha256: sha(COPYRIGHT_A) },
        { package: 'libb2', source: 'b', license: 'MIT', copyrightSha256: sha(COPYRIGHT_B) },
        { package: 'libx64only', source: 'x', license: 'MIT', copyrightSha256: 'a'.repeat(64), platforms: ['linux-x64'] },
    ],
});
const OWNERS = {
    'usr/lib/liba.so.1': ['liba1'],
    'usr/lib/gio/modules/libamod.so': ['liba1'],
    'usr/lib/libb.so.2.0.1': ['libb2'],
    'usr/share/glib-2.0/schemas/org.example.gschema.xml': ['liba1'],
};
const owners = (map = OWNERS) => (files) => new Map(files.map((f) => [f, new Set(map[f] ?? [])]));
const GLOBS = () => validateAppImageFiles({ lattice: ['usr/bin/lattice'], generated: ['AppRun', 'usr/lib/**/*.cache'] });
const BUNDLER = () => ({ files: new Map([['AppRun.wrapped', 'AppImageKit AppRun']]), runtimeCommit: 'fedfad5' });


//**************************************************************
// writeRuntime (fixture builder)
//**************************************************************
/**
 * A file that starts like an AppImage: a 64-bit little-endian ELF header whose
 * section headers end at byte 192, the runtime's commit URL inside those 192
 * bytes (unless null), then "squashfs" with a decoy URL of another commit.
 */
function writeRuntime(file, commit) {
    const runtime = Buffer.alloc(192);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(runtime, 0);
    runtime.writeBigUInt64LE(64n, 0x28);
    runtime.writeUInt16LE(64, 0x3a);
    runtime.writeUInt16LE(2, 0x3c);
    if (commit) runtime.write(`https://github.com/AppImage/type2-runtime/commit/${commit}`, 80, 'latin1');
    const squashfs = Buffer.from('hsqs https://github.com/AppImage/type2-runtime/commit/0000000 ', 'latin1');
    fs.writeFileSync(file, Buffer.concat([runtime, squashfs]));
}
// writeRuntime END ********************************************
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
    const text = [
        'libglib2.0-0t64:amd64: /usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0',
        'libglib2.0-dev:amd64, libglib2.0-dev-bin: /usr/lib/x86_64-linux-gnu/libgobject-2.0.so',
        'diversion by foo from: /usr/lib/x86_64-linux-gnu/libz.so.1',
        'gsettings-desktop-schemas: /usr/share/glib-2.0/schemas/org.gnome.desktop.interface.gschema.xml',
        'libfoo1:i386: /usr/lib/i386-linux-gnu/libfoo.so.1',
        '',
    ].join('\n');

    it('reads owners of every path, drops the architecture suffix and skips diversions', () => {
        expect(parseDpkgSearch(text)).toEqual([
            { file: '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0', packages: ['libglib2.0-0t64'] },
            { file: '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so', packages: ['libglib2.0-dev', 'libglib2.0-dev-bin'] },
            { file: '/usr/share/glib-2.0/schemas/org.gnome.desktop.interface.gschema.xml', packages: ['gsettings-desktop-schemas'] },
            { file: '/usr/lib/i386-linux-gnu/libfoo.so.1', packages: ['libfoo1'] },
        ]);
    });

    it('with an architecture, drops packages of another one and keeps those without suffix', () => {
        expect(parseDpkgSearch(text, 'amd64').map((r) => r.file)).toEqual([
            '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0',
            '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so',
            '/usr/share/glib-2.0/schemas/org.gnome.desktop.interface.gschema.xml',
        ]);
    });
});

describe('resolveOwners', () => {
    // dpkg as a table: file -> owners; the -dev package owns the symlink.
    const DB = {
        '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so': ['libglib2.0-dev'],
        '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0.8000.0': ['libglib2.0-0t64'],
        '/usr/lib/x86_64-linux-gnu/libz.so.1': ['zlib1g'],
        '/usr/share/doc/zlib1g/libz.so.1': ['zlib1g-doc'],
        '/usr/share/glib-2.0/schemas/org.gtk.Settings.gschema.xml': ['libgtk-3-common'],
        '/usr/share/other/org.gtk.Settings.gschema.xml': ['decoy'],
    };
    const LINKS = { '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so': '/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0.8000.0' };
    const search = (patterns) => Object.entries(DB)
        .filter(([file]) => patterns.some((p) => (p.startsWith('*/') ? file.endsWith(p.slice(1)) : file === p)))
        .map(([file, packages]) => ({ file, packages }));
    const ownersOf = (files, realpath = (f) => f) => resolveOwners(files, search, realpath);

    it('credits the package that owns the real file, not the -dev package that owns the symlink', () => {
        const out = ownersOf(['usr/lib/libgobject-2.0.so'], (f) => LINKS[f] ?? f);
        expect([...out.get('usr/lib/libgobject-2.0.so')]).toEqual(['libglib2.0-0t64']);
    });

    it('finds a usr/lib file by name in library directories only, and reports an unknown one as unowned', () => {
        const out = ownersOf(['usr/lib/libz.so.1', 'usr/lib/libnone.so']);
        expect([...out.get('usr/lib/libz.so.1')]).toEqual(['zlib1g']);
        expect([...out.get('usr/lib/libnone.so')]).toEqual([]);
    });

    it('finds any other file at its exact system path', () => {
        const out = ownersOf(['usr/share/glib-2.0/schemas/org.gtk.Settings.gschema.xml', 'usr/share/glib-2.0/schemas/missing.xml']);
        expect([...out.get('usr/share/glib-2.0/schemas/org.gtk.Settings.gschema.xml')]).toEqual(['libgtk-3-common']);
        expect([...out.get('usr/share/glib-2.0/schemas/missing.xml')]).toEqual([]);
    });

    it('does not match a longer name that merely ends the same way', () => {
        expect([...ownersOf(['usr/lib/z.so.1']).get('usr/lib/z.so.1')]).toEqual([]);
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

describe('path globs', () => {
    it('matches * within a segment and ** across segments', () => {
        expect(globToRegExp('usr/share/icons/hicolor/*/apps/lattice.png').test('usr/share/icons/hicolor/32x32/apps/lattice.png')).toBe(true);
        expect(globToRegExp('usr/share/icons/hicolor/*/apps/lattice.png').test('usr/share/icons/hicolor/a/b/apps/lattice.png')).toBe(false);
        expect(globToRegExp('usr/lib/lattice/**').test('usr/lib/lattice/sub/THIRD-PARTY-NOTICES.md')).toBe(true);
        expect(globToRegExp('usr/lib/**/*.cache').test('usr/lib/gio/modules/giomodule.cache')).toBe(true);
        expect(globToRegExp('usr/lib/**/*.cache').test('usr/lib/x.cache')).toBe(true);
    });

    it('takes everything else literally', () => {
        expect(globToRegExp('AppRun').test('AppRun.wrapped')).toBe(false);
        expect(globToRegExp('a.b').test('axb')).toBe(false);
    });

    it('requires non-empty lists of relative globs', () => {
        expect(() => validateAppImageFiles({ lattice: [], generated: ['x'] })).toThrow(/"lattice" must be a non-empty list/);
        expect(() => validateAppImageFiles({ lattice: ['x'], generated: ['/abs'] })).toThrow(/"generated"/);
    });
});

describe('the reviewed file patterns on the real tree', () => {
    const globs = loadAppImageFiles(REAL_ROOT);
    const kind = (rel) => classifyShippedFile(rel, globs, new Map());

    it("take Lattice's files and the build's caches, as found in the v0.3.37 AppImage", () => {
        for (const rel of ['usr/bin/lattice', 'usr/lib/lattice/THIRD-PARTY-NOTICES.md', 'usr/share/applications/lattice.desktop', 'usr/share/icons/hicolor/256x256@2/apps/lattice.png']) {
            expect(kind(rel)).toBe('lattice');
        }
        for (const rel of ['AppRun', 'usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache', 'usr/lib/gtk-3.0/3.0.0/immodules.cache', 'usr/share/glib-2.0/schemas/gschemas.compiled']) {
            expect(kind(rel)).toBe('generated');
        }
    });

    it('leave a typelib, a schema, a WebKit helper and AppRun.wrapped to a package or the bundler list', () => {
        for (const rel of ['usr/lib/girepository-1.0/Gtk-3.0.typelib', 'usr/share/glib-2.0/schemas/org.gtk.Settings.FileChooser.gschema.xml', 'usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess', 'AppRun.wrapped']) {
            expect(kind(rel)).toBe('package');
        }
    });
});

describe('bundlerParts', () => {
    it('collects the paths of the bundler parts and the one reviewed runtime commit', () => {
        const parts = bundlerParts([
            { name: 'Rust standard library' },
            { name: 'runtime', appImage: { runtimeCommit: 'fedfad5' } },
            { name: 'AppRun', appImage: { files: ['AppRun.wrapped'] } },
        ]);
        expect(parts).toEqual({ files: new Map([['AppRun.wrapped', 'AppRun']]), runtimeCommit: 'fedfad5' });
    });

    it('requires exactly one runtime commit and well-formed entries', () => {
        expect(() => bundlerParts([{ name: 'a', appImage: { files: ['x'] } }])).toThrow(/exactly one .* \(found 0\)/);
        expect(() => bundlerParts([{ name: 'a', appImage: { runtimeCommit: 'fedfad5' } }, { name: 'b', appImage: { runtimeCommit: 'abcdef0' } }])).toThrow(/found 2/);
        expect(() => bundlerParts([{ name: 'a', appImage: { runtimeCommit: 'main' } }])).toThrow(/"a" has a malformed "appImage"/);
        expect(() => bundlerParts([{ name: 'a', appImage: { files: ['/AppRun'] } }])).toThrow(/malformed/);
    });

    it('reads the real foss/extra-components.json: AppRun, its hook and the runtime commit', () => {
        const parts = bundlerParts(JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'foss', 'extra-components.json'), 'utf8')).components);
        expect([...parts.files.keys()].sort()).toEqual(['AppRun.wrapped', 'apprun-hooks/linuxdeploy-plugin-gtk.sh']);
        expect(parts.runtimeCommit).toMatch(/^[0-9a-f]{7,40}$/);
    });
});

describe('readRuntimeCommit', () => {
    let dir;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-runtime-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('reads the commit inside the runtime and never the squashfs behind it', () => {
        writeRuntime(path.join(dir, 'a.AppImage'), 'fedfad5');
        expect(readRuntimeCommit(path.join(dir, 'a.AppImage'))).toBe('fedfad5');
        writeRuntime(path.join(dir, 'b.AppImage'), null);
        expect(readRuntimeCommit(path.join(dir, 'b.AppImage'))).toBeNull();
    });

    it('refuses a file that does not start with a 64-bit little-endian ELF', () => {
        fs.writeFileSync(path.join(dir, 'x'), 'not an elf file, but long enough to hold a header of sixty-four bytes......');
        expect(() => readRuntimeCommit(path.join(dir, 'x'))).toThrow(/64-bit little-endian ELF/);
    });
});

describe('checkRuntime', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-root-'));
        makeAppRoot(root);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('accepts the reviewed commit, also when one side gives the full hash', () => {
        expect(checkRuntime(root, BUNDLER(), 'fedfad5')).toEqual({ problems: [], warnings: [] });
        expect(checkRuntime(root, BUNDLER(), 'fedfad51acc2860b2916a1eef32ba4a500ff31ef').problems).toEqual([]);
    });

    it('fails for another commit or none, and warns about a bundler part that is absent', () => {
        expect(checkRuntime(root, BUNDLER(), '8f39b89').problems).toEqual([expect.stringMatching(/^the AppImage runtime is type2-runtime 8f39b89, reviewed is fedfad5: check src\/runtime\/Makefile/)]);
        expect(checkRuntime(root, BUNDLER(), null).problems).toEqual([expect.stringMatching(/names no type2-runtime commit/)]);
        fs.rmSync(path.join(root, 'AppRun.wrapped'));
        expect(checkRuntime(root, BUNDLER(), 'fedfad5').warnings).toEqual(['AppRun.wrapped (AppImageKit AppRun): named in foss/extra-components.json but not in this AppImage']);
    });
});

describe('an unpacked AppImage', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-root-'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    const inventory = (overrides = {}) => inventoryAppImage({
        root, label: 'linux-x64', list: LIST(), globs: GLOBS(), bundler: BUNDLER(), runtimeCommit: 'fedfad5',
        policy: policy(), today: TODAY, owners: owners(), versions, ...overrides,
    });
    const run = (label = 'linux-x64', ownerMap = OWNERS, list = LIST()) => inventory({ label, list, owners: owners(ownerMap) });

    it('lists every regular file and the copyright folders with their hashes', () => {
        makeAppRoot(root);
        expect(listShippedFiles(root)).toEqual([
            'AppRun', 'AppRun.wrapped', 'usr/bin/lattice', 'usr/lib/gio/modules/giomodule.cache', 'usr/lib/gio/modules/libamod.so',
            'usr/lib/liba.so.1', 'usr/lib/libb.so.2.0.1', 'usr/share/common-licenses/LGPL-2.1', 'usr/share/doc/liba1/copyright',
            'usr/share/doc/libb2/copyright', 'usr/share/glib-2.0/schemas/org.example.gschema.xml',
        ]);
        expect(listCopyrightFolders(root)).toEqual(new Map([['liba1', sha(COPYRIGHT_A)], ['libb2', sha(COPYRIGHT_B)]]));
    });

    it("sorts each file into licence, Lattice's own, generated, bundler part or package", () => {
        const kind = (rel) => classifyShippedFile(rel, GLOBS(), BUNDLER().files);
        const files = ['usr/share/doc/liba1/copyright', 'usr/share/common-licenses/LGPL-2.1', 'usr/bin/lattice', 'AppRun', 'usr/lib/gio/modules/giomodule.cache', 'AppRun.wrapped', 'usr/lib/liba.so.1', 'usr/share/doc/liba1/changelog.gz'];
        expect(files.map(kind)).toEqual(['licence', 'licence', 'lattice', 'generated', 'generated', 'bundler', 'package', 'package']);
    });

    it('passes when every file is accounted for; warns about a listed package that is absent', () => {
        makeAppRoot(root);
        const r = run();
        expect(r.problems).toEqual([]);
        expect(r.warnings).toEqual(['libx64only: listed but not in this AppImage']);
        expect(r.entries.map((e) => [e.component.name, e.component.version, e.component.arch, e.component.files])).toEqual([
            ['liba1', '1.0-1ubuntu1', 'amd64', ['usr/lib/gio/modules/libamod.so', 'usr/lib/liba.so.1', 'usr/share/glib-2.0/schemas/org.example.gschema.xml']],
            ['libb2', '1.0-1ubuntu1', 'amd64', ['usr/lib/libb.so.2.0.1']],
        ]);
        expect(r.entries[0].component.homepage).toBe('https://launchpad.net/ubuntu/+source/src-liba1/1.0-1ubuntu1');
    });

    it("asks the owner lookup for the AppImage's architecture", () => {
        makeAppRoot(root);
        const asked = [];
        inventory({ label: 'linux-arm64', owners: (files, arch) => { asked.push(arch); return owners()(files); } });
        expect(asked).toEqual(['arm64']);
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

    it("fails for a carried package the build machine's dpkg-query does not know, instead of guessing a version", () => {
        makeAppRoot(root);
        const partial = (pkgs) => new Map([...versions(pkgs)].filter(([p]) => p !== 'libb2'));
        const r = inventory({ versions: partial });
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

    it('fails for a file no package owns, and for one whose owner brought no copyright folder — the typelib case', () => {
        makeAppRoot(root, { extraLib: 'libghost.so.3', extraFile: 'usr/lib/girepository-1.0/Gtk-3.0.typelib' });
        expect(run('linux-x64', { ...OWNERS, 'usr/lib/girepository-1.0/Gtk-3.0.typelib': ['gir1.2-gtk-3.0'] }).problems).toEqual([
            'usr/lib/girepository-1.0/Gtk-3.0.typelib: owned by gir1.2-gtk-3.0, which has no copyright folder in the AppImage',
            "usr/lib/libghost.so.3: no installed package owns this file, and it is not Lattice's own, generated or a bundler part",
        ]);
    });

    it('fails for a runtime of another commit than the reviewed one', () => {
        makeAppRoot(root);
        expect(inventory({ runtimeCommit: '8f39b89' }).problems).toEqual([expect.stringMatching(/^the AppImage runtime is type2-runtime 8f39b89/)]);
    });

    it('rejects a target that ships no AppImage', () => {
        makeAppRoot(root);
        expect(() => run('win-x64')).toThrow(/no AppImage for target "win-x64"/);
    });
});

describe('commandAppImage', () => {
    let repo;
    let app;
    let image;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-repo-'));
        app = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-app-'));
        fs.cpSync(path.join(REAL_ROOT, 'foss'), path.join(repo, 'foss'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'lattice', version: '9.9.9' }));
        fs.writeFileSync(path.join(repo, APPIMAGE_LIST_FILE), JSON.stringify({
            lattice: ['usr/bin/lattice'],
            generated: ['AppRun', 'usr/lib/**/*.cache'],
            packages: LIST().map(({ platforms, ...p }) => (p.package === 'libx64only' ? { ...p, platforms } : p)),
        }));
        makeAppRoot(app);
        image = path.join(repo, 'lattice.AppImage');
        const reviewed = bundlerParts(JSON.parse(fs.readFileSync(path.join(repo, 'foss', 'extra-components.json'), 'utf8')).components).runtimeCommit;
        writeRuntime(image, reviewed);
    });
    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(app, { recursive: true, force: true });
    });
    const probes = (ownerMap = OWNERS) => ({ owners: owners(ownerMap), versions });
    const capture = () => {
        const seen = { warn: [], error: [] };
        return { seen, log: { ...quiet, warn: (m) => seen.warn.push(m), error: (m) => seen.error.push(m) } };
    };

    it('writes the AppImage SBOM with deb purls and exits 0, warning about the hook this AppImage lacks', () => {
        const out = path.join(repo, 'out');
        const { seen, log } = capture();
        expect(commandAppImage({ root: repo, appImage: image, appRoot: app, label: 'linux-arm64', outDir: out, today: TODAY, probes: probes() }, log)).toBe(0);
        expect(seen.warn).toEqual([expect.stringMatching(/apprun-hooks\/linuxdeploy-plugin-gtk\.sh .*not in this AppImage/)]);
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
        const { seen, log } = capture();
        expect(commandAppImage({ root: repo, appImage: image, appRoot: app, label: 'linux-x64', outDir: out, today: TODAY, probes: probes({}) }, log)).toBe(1);
        expect(seen.error.at(-1)).toMatch(/4 problem\(s\)/);
        expect(fs.existsSync(path.join(out, 'lattice-linux-x64-appimage.cdx.json'))).toBe(true);
    });

    it('fails when the AppImage runtime is another commit', () => {
        writeRuntime(image, '0123456');
        const { seen, log } = capture();
        expect(commandAppImage({ root: repo, appImage: image, appRoot: app, label: 'linux-x64', outDir: path.join(repo, 'out'), today: TODAY, probes: probes() }, log)).toBe(1);
        expect(seen.error).toContainEqual(expect.stringMatching(/type2-runtime 0123456, reviewed is/));
    });
});
