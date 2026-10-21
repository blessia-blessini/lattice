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

/// Linux AppImage system libraries (appimage.mjs)
///
/// IMPL-LTTCE-FOS-00006 — REQ-LTTCE-FOS-00006. The AppImage carries ~170
/// shared libraries from ~110 Ubuntu packages of the machine it was built on,
/// which neither Cargo.lock nor package-lock.json can see. They are reviewed
/// once, per package, in foss/appimage-packages.json: the licence of the
/// library the package ships, and the SHA-256 of its Debian copyright file —
/// so a changed file reopens the review. This module
/// - evaluates that list against the policy (licences of linkage
///   'shared-library', see `sharedLibrary` in foss/policy.json),
/// - renders its section of THIRD-PARTY-NOTICES.md with the written offer,
/// - and, on a Linux build machine, checks an unpacked AppImage against it:
///   every library must belong to a listed package (`dpkg -S`), every listed
///   copyright file must still hash the same, every licence text a copyright
///   file points to in /usr/share/common-licenses must be carried too, and
///   the exact versions go into a CycloneDX SBOM.

import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { evaluateComponent } from './policy.mjs';
import { escapeInline } from './notices-render.mjs';

export const APPIMAGE_LIST_FILE = 'foss/appimage-packages.json';
/** Target labels (cargo-inventory.mjs TARGETS) that ship an AppImage, with the Debian architecture. */
export const APPIMAGE_TARGETS = Object.freeze({ 'linux-x64': 'amd64', 'linux-arm64': 'arm64' });
const OFFER_CONTACT = 'blessia AT blessini.com';
const SOURCE_ARCHIVE = 'https://launchpad.net/ubuntu/+source/';
/** A shared library file name: libfoo.so, libfoo.so.1, libfoo.so.1.2.3. */
const SHARED_LIBRARY_RE = /\.so(\.\d+)*$/;
/** Where Debian keeps the licence texts its copyright files point to; the AppImage carries a copy at the same path. */
const COMMON_LICENSES = 'usr/share/common-licenses';
/** A pointer to one of those texts; a sentence may end right after the name ("…/LGPL-2.1."). */
const COMMON_LICENSE_REF_RE = /\/usr\/share\/common-licenses\/([A-Za-z0-9][A-Za-z0-9.+_-]*)/g;


//**************************************************************
// copyrightPath
//**************************************************************
/** The Debian copyright file of `pkg` inside an unpacked AppImage. */
const copyrightPath = (root, pkg) => path.join(root, 'usr', 'share', 'doc', pkg, 'copyright');
// copyrightPath END *******************************************


//**************************************************************
// loadAppImageList
//**************************************************************
/**
 * Reads and validates foss/appimage-packages.json.
 * @param {string} root repository root
 * @returns {{package: string, source: string, license: string, copyrightSha256: string, platforms: string[], note?: string}[]}
 *   platforms defaulted to every AppImage target
 * @throws {Error} naming the first malformed entry
 */
export function loadAppImageList(root) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, APPIMAGE_LIST_FILE), 'utf8'));
    return validateAppImageList(parsed);
}
// loadAppImageList END ****************************************


//**************************************************************
// validateAppImageList
//**************************************************************
/**
 * Checks the shape of a parsed list and fills `platforms`.
 * @param {object} parsed
 * @returns {object[]} the packages, sorted by name
 * @throws {Error}
 */
export function validateAppImageList(parsed) {
    const list = parsed?.packages;
    if (!Array.isArray(list) || !list.length) throw new Error(`${APPIMAGE_LIST_FILE}: "packages" must be a non-empty list`);
    const labels = Object.keys(APPIMAGE_TARGETS);
    const seen = new Set();
    for (const p of list) {
        const ok = typeof p?.package === 'string' && /^[a-z0-9][a-z0-9.+-]+$/.test(p.package)
            && typeof p.source === 'string' && p.source
            && typeof p.license === 'string' && p.license
            && typeof p.copyrightSha256 === 'string' && /^[0-9a-f]{64}$/.test(p.copyrightSha256)
            && (p.platforms === undefined || (Array.isArray(p.platforms) && p.platforms.length && p.platforms.every((l) => labels.includes(l))));
        if (!ok) throw new Error(`${APPIMAGE_LIST_FILE}: malformed entry ${JSON.stringify(p)} (needs package, source, license, copyrightSha256; platforms from ${labels.join(', ')})`);
        if (seen.has(p.package)) throw new Error(`${APPIMAGE_LIST_FILE}: "${p.package}" is listed twice`);
        seen.add(p.package);
        p.platforms ??= labels;
    }
    return [...list].sort((a, b) => a.package.localeCompare(b.package, 'en'));
}
// validateAppImageList END ************************************


//**************************************************************
// evaluateAppImageList
//**************************************************************
/**
 * Applies the policy to every listed package, as a library loaded at run
 * time ('shared-library'). Version "*": a Debian package is pinned by its
 * copyright file, not by version.
 * @param {object[]} list from loadAppImageList
 * @param {object} policy validated policy
 * @param {string} today YYYY-MM-DD
 * @returns {{item: object, evaluation: object}[]}
 */
export function evaluateAppImageList(list, policy, today) {
    return list.map((item) => ({
        item,
        evaluation: evaluateComponent(
            { ecosystem: 'debian', name: item.package, version: '*', license: item.license, linkage: 'shared-library', dir: null },
            policy, today,
        ),
    }));
}
// evaluateAppImageList END ************************************


//**************************************************************
// renderAppImageSection
//**************************************************************
/**
 * The "Linux AppImage system libraries" section of THIRD-PARTY-NOTICES.md:
 * what the AppImage carries, the written offer for the source code, and one
 * row per package. Pure; versions are not listed here because they change
 * with the build image — each release's AppImage SBOM carries them.
 * @param {{item: object, evaluation: object}[]} evaluated from evaluateAppImageList
 * @returns {string[]} Markdown lines
 */
export function renderAppImageSection(evaluated) {
    const lines = [
        '## Linux AppImage system libraries',
        '',
        'The Linux AppImage also carries the system libraries below, taken from the Ubuntu release it is built on. Each is a separate file that the dynamic linker loads at run time; you may replace it with a modified version. The Debian copyright file of each package is inside the AppImage under `usr/share/doc/<package>/copyright`, and the licence texts those files refer to under `usr/share/common-licenses/`. The exact package versions in an AppImage are listed in its SBOM, published next to the AppImage on the release page.',
        '',
        `**Written offer.** For every library below that is under the GNU LGPL, the GNU GPL or the MPL, Lattice's copyright holder offers, for at least three years after the release that contains it, to provide the complete corresponding source code of the version in that release, on request to \`${OFFER_CONTACT}\`, for no more than the cost of providing it. The same sources are available from Ubuntu: \`${SOURCE_ARCHIVE}<source package>/<version>\`.`,
        '',
        '| Package | Source package | Licence | Platforms | Note |',
        '| --- | --- | --- | --- | --- |',
    ];
    for (const { item } of evaluated) {
        const platforms = item.platforms.length === Object.keys(APPIMAGE_TARGETS).length ? 'all' : item.platforms.join(', ');
        lines.push(`| ${escapeInline(item.package)} | ${escapeInline(item.source)} | ${escapeInline(item.license)} | ${platforms} | ${escapeInline(item.note ?? '')} |`);
    }
    lines.push('');
    return lines;
}
// renderAppImageSection END ***********************************


//**************************************************************
// listShippedLibraries
//**************************************************************
/**
 * Every shared-library file under `<root>/usr/lib` (regular files only; the
 * symlinks beside them point at these), as paths relative to `root`.
 * @param {string} root unpacked AppImage (squashfs-root)
 * @returns {string[]} sorted
 */
export function listShippedLibraries(root) {
    const out = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && SHARED_LIBRARY_RE.test(e.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
        }
    };
    const lib = path.join(root, 'usr', 'lib');
    if (fs.existsSync(lib)) walk(lib);
    return out.sort();
}
// listShippedLibraries END ************************************


//**************************************************************
// listCopyrightFolders
//**************************************************************
/**
 * The packages the AppImage carries a Debian copyright file for, with that
 * file's SHA-256.
 * @param {string} root unpacked AppImage
 * @returns {Map<string, string>} package -> sha256
 */
export function listCopyrightFolders(root) {
    const doc = path.join(root, 'usr', 'share', 'doc');
    const out = new Map();
    if (!fs.existsSync(doc)) return out;
    for (const name of fs.readdirSync(doc).sort()) {
        const file = copyrightPath(root, name);
        if (fs.existsSync(file)) out.set(name, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    }
    return out;
}
// listCopyrightFolders END ************************************


//**************************************************************
// referencedLicenceTexts
//**************************************************************
/**
 * The names of the /usr/share/common-licenses texts a Debian copyright file
 * points to ("…can be found in /usr/share/common-licenses/LGPL-2.1.").
 * @param {string} text copyright file contents
 * @returns {string[]} sorted, unique
 */
export function referencedLicenceTexts(text) {
    const names = new Set();
    for (const m of text.matchAll(COMMON_LICENSE_REF_RE)) names.add(m[1].replace(/\.+$/, ''));
    return [...names].sort();
}
// referencedLicenceTexts END **********************************


//**************************************************************
// parseDpkgSearch
//**************************************************************
/**
 * Parses `dpkg -S` output ("pkg[:arch][, pkg2]: /path") into one record per
 * file, keeping only paths under a lib directory. Diversion lines
 * ("diversion by ...") are skipped; the ":arch" suffix is dropped.
 * @param {string} text
 * @returns {{file: string, packages: string[]}[]}
 */
export function parseDpkgSearch(text) {
    const out = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('diversion')) continue;
        const m = line.match(/^([^:\s][^:]*(?::[a-z0-9-]+)?(?:, [^:]+(?::[a-z0-9-]+)?)*): (\/\S+)$/);
        if (!m || !/\/lib(?:\/|64\/|32\/)/.test(m[2])) continue;
        out.push({ file: m[2], packages: m[1].split(', ').map((p) => p.replace(/:[a-z0-9-]+$/, '')) });
    }
    return out;
}
// parseDpkgSearch END *****************************************


//**************************************************************
// resolveOwners
//**************************************************************
/**
 * File name -> the packages that own the *real* file behind it.
 *
 * linuxdeploy copies a library by name and dereferences symlinks, so the
 * AppImage may hold a regular `libgobject-2.0.so` whose system counterpart is
 * a symlink owned by the -dev package. Every system path found for a name is
 * therefore resolved to its real file, and the owners of that file count.
 * @param {string[]} names library file names
 * @param {(patterns: string[]) => {file: string, packages: string[]}[]} search dpkg -S
 * @param {(file: string) => string|null} realpath null when the file is gone
 * @returns {Map<string, Set<string>>}
 */
export function resolveOwners(names, search, realpath) {
    const wanted = new Set(names);
    const found = search(names.map((n) => `*/${n}`)).filter((r) => wanted.has(path.posix.basename(r.file)));
    const real = new Map(found.map((r) => [r.file, realpath(r.file) ?? r.file]));
    const redirected = [...new Set([...real.values()].filter((p) => !found.some((r) => r.file === p)))];
    const records = [...found, ...(redirected.length ? search(redirected) : [])];
    const ownersOf = new Map(records.map((r) => [r.file, r.packages]));
    const out = new Map();
    for (const r of found) {
        const name = path.posix.basename(r.file);
        if (!out.has(name)) out.set(name, new Set());
        for (const p of ownersOf.get(real.get(r.file)) ?? []) out.get(name).add(p);
    }
    return out;
}
// resolveOwners END *******************************************


//**************************************************************
// dpkgSearch (build machine)
//**************************************************************
/**
 * Runs `dpkg -S` on the build machine. It exits 1 when one pattern matches
 * nothing but still prints the rest, so a non-zero exit is read, not thrown.
 * @param {string[]} patterns
 * @returns {{file: string, packages: string[]}[]}
 */
export function dpkgSearch(patterns) {
    if (!patterns.length) return [];
    return parseDpkgSearch(runDpkgTool('dpkg', ['-S', ...patterns]));
}
// dpkgSearch END **********************************************


//**************************************************************
// runDpkgTool (build machine)
//**************************************************************
/**
 * Runs dpkg or dpkg-query and returns its stdout. Both exit 1 when one of
 * several queried names is unknown, yet print what they found for the rest;
 * that output is kept and the caller decides what a missing name means.
 * Anything else (tool missing, killed) throws.
 * @param {string} tool
 * @param {string[]} args
 * @param {typeof execFileSync} [exec] injectable for tests
 * @returns {string}
 */
export function runDpkgTool(tool, args, exec = execFileSync) {
    try {
        return exec(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        if (e.status === 1 && typeof e.stdout === 'string') return e.stdout;
        throw e;
    }
}
// runDpkgTool END *********************************************


//**************************************************************
// dpkgOwners (build machine)
//**************************************************************
/**
 * `resolveOwners` against the build machine's dpkg and file system.
 * @param {string[]} names
 * @returns {Map<string, Set<string>>}
 */
export function dpkgOwners(names) {
    return names.length ? resolveOwners(names, dpkgSearch, followFileLinks) : new Map();
}
// dpkgOwners END **********************************************


//**************************************************************
// followFileLinks
//**************************************************************
/**
 * Follows symlinks of the file itself — not of its directories, because dpkg
 * records some files under /lib, which on a merged-/usr system is itself a
 * link to /usr/lib, and a full realpath would no longer match the record.
 * @param {string} file absolute path
 * @param {number} [hops] guard against link cycles
 * @returns {string|null} the final path, null if it does not exist
 */
export function followFileLinks(file, hops = 16) {
    let current = file;
    for (let i = 0; i < hops; i++) {
        let stat;
        try {
            stat = fs.lstatSync(current);
        } catch {
            return null;
        }
        if (!stat.isSymbolicLink()) return current;
        current = path.posix.resolve(path.posix.dirname(current), fs.readlinkSync(current));
    }
    return null;
}
// followFileLinks END *****************************************


//**************************************************************
// dpkgVersions (build machine)
//**************************************************************
/**
 * Installed version and source package of each package, from dpkg-query.
 * A package dpkg-query does not know is simply absent from the result.
 * @param {string[]} packages
 * @returns {Map<string, {version: string, source: string, sourceVersion: string}>}
 */
export function dpkgVersions(packages) {
    if (!packages.length) return new Map();
    const text = runDpkgTool('dpkg-query', ['-W', '-f', '${Package}\t${Version}\t${source:Package}\t${source:Version}\n', ...packages]);
    const out = new Map();
    for (const line of text.trim().split('\n')) {
        const [pkg, version, source, sourceVersion] = line.split('\t');
        if (pkg) out.set(pkg, { version, source, sourceVersion });
    }
    return out;
}
// dpkgVersions END ********************************************


//**************************************************************
// inventoryAppImage
//**************************************************************
/**
 * Checks an unpacked AppImage against the reviewed list.
 *
 * Problems (the gate fails): a copyright folder for a package the list does
 * not name, or names only for other platforms; a copyright file whose hash
 * differs from the reviewed one; a copyright file pointing to a licence text
 * in /usr/share/common-licenses that the AppImage does not carry; a listed
 * licence the policy rejects; a library no package owns; a library whose
 * owner has no copyright folder in the AppImage; a carried package the build
 * machine's dpkg-query does not know. Warnings: a package listed for this
 * platform but absent.
 *
 * @param {object} input
 * @param {string} input.root unpacked AppImage
 * @param {string} input.label target label (linux-x64 | linux-arm64)
 * @param {object[]} input.list from loadAppImageList
 * @param {object} input.policy validated policy
 * @param {string} input.today YYYY-MM-DD
 * @param {(names: string[]) => Map<string, Set<string>>} [input.owners] injectable for tests
 * @param {(pkgs: string[]) => Map<string, object>} [input.versions] injectable for tests
 * @returns {{problems: string[], warnings: string[], entries: object[]}} entries in
 *   `buildSbom` shape, one per package carried
 */
export function inventoryAppImage({ root, label, list, policy, today, owners = dpkgOwners, versions = dpkgVersions }) {
    if (!Object.hasOwn(APPIMAGE_TARGETS, label)) throw new Error(`no AppImage for target "${label}" (known: ${Object.keys(APPIMAGE_TARGETS).join(', ')})`);
    const problems = [];
    const warnings = [];
    const byName = new Map(list.map((p) => [p.package, p]));
    const evaluated = new Map(evaluateAppImageList(list, policy, today).map((e) => [e.item.package, e.evaluation]));

    const carried = listCopyrightFolders(root);
    for (const [pkg, sha] of carried) {
        const item = byName.get(pkg);
        if (!item) {
            problems.push(`${pkg}: not in ${APPIMAGE_LIST_FILE} (copyright sha256 ${sha}); review its licence and add it`);
            continue;
        }
        if (!item.platforms.includes(label)) problems.push(`${pkg}: listed for ${item.platforms.join(', ')} only, but the ${label} AppImage carries it`);
        if (item.copyrightSha256 !== sha) problems.push(`${pkg}: copyright file changed (sha256 ${sha}); re-check the licence and update ${APPIMAGE_LIST_FILE}`);
        for (const name of referencedLicenceTexts(fs.readFileSync(copyrightPath(root, pkg), 'utf8'))) {
            const text = path.join(root, COMMON_LICENSES, name);
            if (!fs.existsSync(text) || !fs.statSync(text).isFile()) problems.push(`${pkg}: its copyright file refers to /${COMMON_LICENSES}/${name}, which the AppImage does not carry`);
        }
        const ev = evaluated.get(pkg);
        if (!ev.pass) problems.push(`${pkg}: ${ev.problems.join('; ')}`);
    }
    for (const item of list) {
        if (item.platforms.includes(label) && !carried.has(item.package)) warnings.push(`${item.package}: listed but not in this AppImage`);
    }

    const libraries = listShippedLibraries(root);
    const names = [...new Set(libraries.map((l) => path.posix.basename(l)))];
    const owned = owners(names);
    const libsOf = new Map();
    for (const lib of libraries) {
        const pkgs = owned.get(path.posix.basename(lib));
        if (!pkgs || !pkgs.size) {
            problems.push(`${lib}: no installed package owns this library`);
            continue;
        }
        const withFolder = [...pkgs].filter((p) => carried.has(p));
        if (!withFolder.length) {
            problems.push(`${lib}: owned by ${[...pkgs].join(', ')}, which has no copyright folder in the AppImage`);
            continue;
        }
        for (const p of withFolder) {
            if (!libsOf.has(p)) libsOf.set(p, []);
            libsOf.get(p).push(lib);
        }
    }

    const installed = versions([...carried.keys()].filter((p) => byName.has(p)));
    const entries = [];
    for (const pkg of carried.keys()) {
        const item = byName.get(pkg);
        if (!item) continue;
        const v = installed.get(pkg);
        if (!v) {
            problems.push(`${pkg}: dpkg-query does not know this package on the build machine, so its version cannot be recorded`);
            continue;
        }
        entries.push({
            component: {
                ecosystem: 'debian', name: pkg, version: v.version, arch: APPIMAGE_TARGETS[label],
                linkage: 'shared-library', repository: null, homepage: `${SOURCE_ARCHIVE}${v.source}/${v.sourceVersion}`,
                libraries: libsOf.get(pkg) ?? [],
            },
            evaluation: evaluated.get(pkg),
        });
    }
    return { problems, warnings, entries };
}
// inventoryAppImage END ***************************************
