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

/// npm package inventory (npm-inventory.mjs)
///
/// The production closure of package.json `dependencies`, resolved over
/// package-lock.json the way Node resolves `require`: look in
/// `<from>/node_modules/<name>`, then walk up one nesting level at a time.
/// Dev dependencies never enter the closure. This is a superset of what Vite
/// bundles (tree-shaking may drop more), which errs on the side of listing.

import fs from 'fs';
import path from 'path';


//**************************************************************
// resolvePackage
//**************************************************************
/**
 * Finds the lockfile key a dependency `name` resolves to from package `from`.
 * @param {object} packages lockfile `packages` map
 * @param {string} from lockfile key of the requiring package ('' = root)
 * @param {string} name dependency name
 * @returns {string|null}
 */
export function resolvePackage(packages, from, name) {
    let base = from;
    for (;;) {
        const key = (base ? `${base}/` : '') + `node_modules/${name}`;
        if (packages[key]) return key;
        if (!base) return null;
        const i = base.lastIndexOf('/node_modules/');
        base = i < 0 ? '' : base.slice(0, i);
    }
}
// resolvePackage END ******************************************


//**************************************************************
// normalizeNpmLicense
//**************************************************************
/**
 * npm `license` values come as an SPDX string, or (legacy) as `{type}` or an
 * array of those. Returns an SPDX expression string, or null when absent.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeNpmLicense(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) {
        const ids = value.map(normalizeNpmLicense).filter(Boolean);
        return ids.length ? ids.map((id) => (ids.length > 1 ? `(${id})` : id)).join(' OR ') : null;
    }
    if (value && typeof value === 'object' && typeof value.type === 'string') return value.type.trim() || null;
    return null;
}
// normalizeNpmLicense END *************************************


//**************************************************************
// inventoryFromLockfile
//**************************************************************
/**
 * The production closure as components.
 * @param {object} lock parsed package-lock.json (lockfileVersion >= 2)
 * @param {object} pkgJson parsed package.json
 * @param {string} rootDir directory holding node_modules, for `dir`
 * @returns {object[]} components sorted by name, then version
 * @throws {Error} on an old lockfile or a dependency that cannot be resolved
 */
export function inventoryFromLockfile(lock, pkgJson, rootDir) {
    if (!lock?.packages || (lock.lockfileVersion ?? 0) < 2) {
        throw new Error('package-lock.json: lockfileVersion >= 2 with a "packages" map is required');
    }
    const packages = lock.packages;
    const seen = new Set();
    const queue = [];
    const need = (from, name, optional) => {
        const key = resolvePackage(packages, from, name);
        if (key) queue.push(key);
        else if (!optional) throw new Error(`package-lock.json: "${name}" (needed by "${from || 'package.json'}") is not in the lockfile`);
    };

    for (const name of Object.keys(pkgJson.dependencies ?? {})) need('', name, false);
    for (const name of Object.keys(pkgJson.optionalDependencies ?? {})) need('', name, true);

    while (queue.length) {
        let key = queue.shift();
        if (seen.has(key)) continue;
        const entry = packages[key];
        // A workspace or `file:` link points at the real location.
        if (entry.link && entry.resolved) key = entry.resolved;
        seen.add(key);
        const v = packages[key] ?? entry;
        for (const name of Object.keys(v.dependencies ?? {})) need(key, name, false);
        for (const name of Object.keys(v.optionalDependencies ?? {})) need(key, name, true);
        for (const name of Object.keys(v.peerDependencies ?? {})) {
            need(key, name, Boolean(v.peerDependenciesMeta?.[name]?.optional));
        }
    }

    const components = [...seen].map((key) => {
        const v = packages[key];
        return {
            ecosystem: 'npm',
            name: v.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
            version: v.version,
            license: normalizeNpmLicense(v.license),
            licenseFile: null,
            authors: [],
            repository: null,
            homepage: null,
            dir: path.join(rootDir, key),
            linkage: 'linked',
        };
    });
    return components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
// inventoryFromLockfile END ***********************************


//**************************************************************
// personName
//**************************************************************
/** "Jane <j@x.org> (https://x.org)" or {name} -> "Jane". */
function personName(person) {
    const raw = typeof person === 'string' ? person : person?.name;
    return typeof raw === 'string' ? raw.replace(/<[^>]*>|\([^)]*\)/g, '').trim() || null : null;
}
// personName END **********************************************


//**************************************************************
// repositoryUrl
//**************************************************************
/** npm `repository` as a browsable URL ("github:x/y", "git+https://..", {url}). */
function repositoryUrl(repo) {
    const raw = typeof repo === 'string' ? repo : repo?.url;
    if (typeof raw !== 'string' || !raw) return null;
    if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw}`;
    const short = raw.match(/^(github|gitlab|bitbucket):(.+)$/);
    if (short) return `https://${short[1]}.${short[1] === 'bitbucket' ? 'org' : 'com'}/${short[2]}`;
    return raw.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '');
}
// repositoryUrl END *******************************************


//**************************************************************
// enrichFromManifest
//**************************************************************
/**
 * Adds authors, repository and homepage from the installed package.json.
 * The lockfile does not carry them. A missing node_modules entry is an error:
 * the notices must be generated from the installed packages (`npm ci`).
 * @param {object} component npm component from inventoryFromLockfile
 * @returns {object} the same component, enriched
 */
export function enrichFromManifest(component) {
    const manifestPath = path.join(component.dir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`${component.name}@${component.version}: ${manifestPath} not found; run "npm ci" first`);
    }
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const people = [m.author, ...(Array.isArray(m.contributors) ? m.contributors : [])].map(personName).filter(Boolean);
    component.authors = [...new Set(people)];
    component.repository = repositoryUrl(m.repository);
    component.homepage = typeof m.homepage === 'string' ? m.homepage : null;
    return component;
}
// enrichFromManifest END **************************************
