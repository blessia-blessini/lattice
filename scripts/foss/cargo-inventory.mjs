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

/// Rust crate inventory (cargo-inventory.mjs)
///
/// The crates that ship in Lattice for one target triple, read from
/// `cargo metadata --filter-platform <triple>` so platform-specific crates
/// (windows-sys, objc2, webkit2gtk, ndk ...) are counted exactly where they ship.
///
/// Linkage:
///   linked     reached from the app through normal dependencies only — its
///              code is in the binary.
///   build-time reached only through a build-dependency or a proc-macro —
///              runs during the build, not shipped.
/// Dev-dependencies are not followed.

import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Every target Lattice publishes, with the short label used in the notices.
 * Must match the build matrix in .github/workflows/buildAndTest.yml.
 */
export const TARGETS = Object.freeze([
    { triple: 'x86_64-pc-windows-msvc', label: 'win-x64' },
    { triple: 'aarch64-pc-windows-msvc', label: 'win-arm64' },
    { triple: 'x86_64-unknown-linux-gnu', label: 'linux-x64' },
    { triple: 'aarch64-unknown-linux-gnu', label: 'linux-arm64' },
    { triple: 'x86_64-apple-darwin', label: 'macos-x64' },
    { triple: 'aarch64-apple-darwin', label: 'macos-arm64' },
    { triple: 'aarch64-linux-android', label: 'android' },
    { triple: 'aarch64-apple-ios', label: 'ios' },
]);


//**************************************************************
// runCargoMetadata
//**************************************************************
/**
 * Runs `cargo metadata` for one target. `--locked` makes a stale Cargo.lock an
 * error instead of silently resolving a different graph than the one built.
 * @param {string} manifestPath path to src-tauri/Cargo.toml
 * @param {string} triple target triple
 * @returns {Promise<object>} parsed metadata
 */
export async function runCargoMetadata(manifestPath, triple) {
    const { stdout } = await execFileAsync(
        'cargo',
        ['metadata', '--format-version', '1', '--locked', '--filter-platform', triple, '--manifest-path', manifestPath],
        { maxBuffer: 512 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
}
// runCargoMetadata END ****************************************


//**************************************************************
// inventoryFromMetadata
//**************************************************************
/**
 * Turns one target's metadata into third-party components.
 *
 * Packages without a `source` (the workspace itself and local path crates)
 * are Lattice's own code and are left out.
 * @param {object} meta parsed `cargo metadata` output
 * @returns {object[]} components sorted by name, then version
 */
export function inventoryFromMetadata(meta) {
    if (!meta?.resolve?.root || !Array.isArray(meta.packages) || !Array.isArray(meta.resolve.nodes)) {
        throw new Error('cargo metadata: missing packages/resolve.root (was --no-deps used?)');
    }
    const pkgById = new Map(meta.packages.map((p) => [p.id, p]));
    const nodeById = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const isProcMacro = (id) => (pkgById.get(id)?.targets ?? []).some((t) => t.kind.includes('proc-macro'));
    const edgeKinds = (dep) => new Set((dep.dep_kinds ?? [{ kind: null }]).map((k) => k.kind));

    // Pass 1: everything reachable without dev edges. Pass 2: the linked subset.
    const walk = (follow) => {
        const seen = new Set([meta.resolve.root]);
        const queue = [meta.resolve.root];
        while (queue.length) {
            const id = queue.shift();
            for (const dep of nodeById.get(id)?.deps ?? []) {
                if (!seen.has(dep.pkg) && follow(dep)) {
                    seen.add(dep.pkg);
                    queue.push(dep.pkg);
                }
            }
        }
        return seen;
    };
    const reachable = walk((dep) => {
        const kinds = edgeKinds(dep);
        return kinds.has(null) || kinds.has('build');
    });
    const linked = walk((dep) => edgeKinds(dep).has(null) && !isProcMacro(dep.pkg));

    const components = [];
    for (const id of reachable) {
        const p = pkgById.get(id);
        if (!p || !p.source) continue;
        components.push({
            ecosystem: 'cargo',
            name: p.name,
            version: p.version,
            license: p.license ?? null,
            licenseFile: p.license_file ?? null,
            authors: p.authors ?? [],
            repository: p.repository ?? null,
            homepage: p.homepage ?? null,
            dir: path.dirname(p.manifest_path),
            linkage: linked.has(id) ? 'linked' : 'build-time',
        });
    }
    return components.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
}
// inventoryFromMetadata END ***********************************
