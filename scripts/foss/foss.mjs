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

/// FOSS compliance line — command line (foss.mjs)
///
/// IMPL-LTTCE-FOS-00004 (gate) and IMPL-LTTCE-FOS-00002 (notices, SBOM).
///
///   node scripts/foss/foss.mjs check            licence gate, all targets (REQ-LTTCE-FOS-00004)
///   node scripts/foss/foss.mjs notices          write THIRD-PARTY-NOTICES.md (REQ-LTTCE-FOS-00002)
///                                               and the export notices (REQ-LTTCE-FOS-00005)
///   node scripts/foss/foss.mjs notices --check  fail if either committed file is stale
///   node scripts/foss/foss.mjs sbom --out-dir D one CycloneDX SBOM per target
///
/// Option for all commands: --targets <triple,...> limits the Rust graph to
/// those targets (the default is every published target).
///
/// Needs the crate sources (`cargo fetch --locked`) and the installed npm
/// packages (`npm ci --ignore-scripts`). No npm dependencies of its own.
///
/// Exit codes: 0 ok, 1 policy failure or stale notices, 2 usage or environment error.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inventoryFromMetadata, runCargoMetadata, TARGETS } from './cargo-inventory.mjs';
import { buildSbom } from './cyclonedx.mjs';
import { EXPORT_NOTICES_FILE, loadEmbedded, renderExportNotices, selectEmbedded } from './export-notices.mjs';
import { fallbackCopyright, findExhibitB, listLicenceFiles, selectTexts, shippedLicenceIds } from './licence-texts.mjs';
import { enrichFromManifest, inventoryFromLockfile } from './npm-inventory.mjs';
import { renderNotices } from './notices-render.mjs';
import { evaluateComponent, licenceTypeMap, loadPolicy, unusedPolicyEntries } from './policy.mjs';
import { leafKey } from './spdx-expr.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';
export const PRODUCT_LICENSE = 'AGPL-3.0-or-later';
const REGENERATE_HINT = `run "npm run foss:notices" and commit ${NOTICES_FILE} and ${EXPORT_NOTICES_FILE}`;


//**************************************************************
// readJson
//**************************************************************
/** Reads a JSON file relative to the repository root. */
function readJson(root, rel) {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}
// readJson END ************************************************


//**************************************************************
// loadStandardTexts
//**************************************************************
/** foss/licenses/<id>.txt as an id -> normalised text map. */
export function loadStandardTexts(root) {
    const dir = path.join(root, 'foss', 'licenses');
    const texts = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
        texts[file.slice(0, -4)] = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim();
    }
    return texts;
}
// loadStandardTexts END ***************************************


//**************************************************************
// mergeComponent
//**************************************************************
/**
 * Adds a component seen on one target to the union over all targets.
 * "linked" on any target wins over "build-time".
 */
function mergeComponent(merged, component, label) {
    const key = `${component.ecosystem}:${component.name}@${component.version}`;
    const existing = merged.get(key);
    if (!existing) {
        merged.set(key, { component: { ...component }, platforms: new Set([label]) });
        return;
    }
    existing.platforms.add(label);
    if (component.linkage === 'linked') existing.component.linkage = 'linked';
}
// mergeComponent END ******************************************


//**************************************************************
// collect
//**************************************************************
/**
 * Builds the evaluated inventory over the given targets.
 * @param {object} options
 * @param {string} options.root repository root
 * @param {{triple: string, label: string}[]} options.targets
 * @param {string} options.today YYYY-MM-DD
 * @param {(manifest: string, triple: string) => Promise<object>} [options.cargoMetadata] injectable for tests
 * @returns {Promise<{policy: object, entries: object[]}>}
 */
export async function collect({ root, targets, today, cargoMetadata = runCargoMetadata }) {
    const policy = loadPolicy(path.join(root, 'foss', 'policy.json'));
    const merged = new Map();
    const labels = targets.map((t) => t.label);

    const manifest = path.join(root, 'src-tauri', 'Cargo.toml');
    const metas = await Promise.all(targets.map((t) => cargoMetadata(manifest, t.triple)));
    metas.forEach((meta, i) => {
        for (const c of inventoryFromMetadata(meta)) mergeComponent(merged, c, targets[i].label);
    });

    const npm = inventoryFromLockfile(readJson(root, 'package-lock.json'), readJson(root, 'package.json'), root);
    for (const c of npm) {
        enrichFromManifest(c);
        for (const label of labels) mergeComponent(merged, c, label);
    }

    for (const x of readJson(root, 'foss/extra-components.json').components ?? []) {
        const component = { ecosystem: 'other', licenseFile: null, authors: [], homepage: null, dir: null, ...x };
        const on = x.platforms === 'all' ? labels : labels.filter((l) => (x.platforms ?? []).includes(l));
        for (const label of on) mergeComponent(merged, component, label);
    }

    const entries = [];
    for (const { component, platforms } of merged.values()) {
        const files = listLicenceFiles(component.dir);
        const evaluation = evaluateComponent(component, policy, today, shippedLicenceIds(files));
        const selection = selectTexts(evaluation.chosen.map(leafKey), files);
        if (Array.isArray(component.copyrights) && component.copyrights.length) selection.copyrights = component.copyrights;
        if (!selection.copyrights.length) selection.copyrights = [fallbackCopyright(component)];

        const obligations = evaluation.chosen.map((l) => policy.obligation[l.id]).filter(Boolean);
        if (evaluation.chosen.some((l) => l.id === 'MPL-2.0') && component.dir) {
            const hits = findExhibitB(component.dir);
            if (hits.length) {
                evaluation.pass = false;
                evaluation.problems.push(`MPL-2.0 Exhibit B ("Incompatible With Secondary Licenses") in ${hits.slice(0, 3).join(', ')}: cannot be combined with AGPL code`);
            }
        }
        entries.push({
            component,
            evaluation,
            selection,
            platforms: labels.filter((l) => platforms.has(l)),
            obligation: obligations.length ? [...new Set(obligations)].join(' ') : null,
        });
    }
    return { policy, entries };
}
// collect END *************************************************


//**************************************************************
// commandCheck
//**************************************************************
/**
 * The licence gate. Prints every failing component with its reasons.
 * @returns {number} exit code
 */
export function commandCheck({ policy, entries }, log = console) {
    const failures = entries.filter((e) => !e.evaluation.pass);
    const byEco = (eco) => entries.filter((e) => e.component.ecosystem === eco).length;
    log.log(`foss check: ${entries.length} components (${byEco('cargo')} cargo, ${byEco('npm')} npm, ${byEco('other')} other)`);
    for (const warning of unusedPolicyEntries(policy, entries.map((e) => e.component))) {
        log.warn(`  [WARN] unused policy entry ${warning}`);
    }
    for (const f of failures) {
        const c = f.component;
        log.error(`  [FAIL] ${c.ecosystem}:${c.name}@${c.version} (${c.linkage}): ${f.evaluation.problems.join('; ')}`);
    }
    if (failures.length) {
        log.error(`foss check: ${failures.length} component(s) violate foss/policy.json`);
        return 1;
    }
    log.log('foss check: all components fit AGPL-3.0-or-later and the commercial licence');
    return 0;
}
// commandCheck END ********************************************


//**************************************************************
// commandNotices
//**************************************************************
/**
 * Writes THIRD-PARTY-NOTICES.md and the export notices, or with `check`
 * compares both to the committed copies.
 * @returns {number} exit code
 */
export function commandNotices({ policy, entries }, { root, targets, check }, log = console) {
    const standardTexts = loadStandardTexts(root);
    const outputs = [
        [NOTICES_FILE, renderNotices({ entries, standardTexts, targets, licenceTypes: licenceTypeMap(policy) })],
        [EXPORT_NOTICES_FILE, renderExportNotices(selectEmbedded(entries, loadEmbedded(root), root), standardTexts)],
    ];
    if (!check) {
        for (const [rel, text] of outputs) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), text);
            log.log(`foss notices: wrote ${rel} (${Buffer.byteLength(text)} bytes)`);
        }
        return 0;
    }
    let stale = 0;
    for (const [rel, text] of outputs) {
        const file = path.join(root, rel);
        const committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
        if (committed !== text) {
            log.error(`foss notices: ${rel} is ${committed === null ? 'missing' : 'out of date'}; ${REGENERATE_HINT}`);
            stale++;
        } else {
            log.log(`foss notices: ${rel} is up to date`);
        }
    }
    return stale ? 1 : 0;
}
// commandNotices END ******************************************


//**************************************************************
// commandSbom
//**************************************************************
/**
 * Writes lattice-<label>.cdx.json per target into outDir.
 * @returns {number} exit code
 */
export function commandSbom({ entries }, { root, targets, outDir }, log = console) {
    const pkg = readJson(root, 'package.json');
    fs.mkdirSync(outDir, { recursive: true });
    for (const target of targets) {
        const onTarget = entries.filter((e) => e.platforms.includes(target.label));
        const bom = buildSbom({ product: { name: 'lattice', version: pkg.version, license: PRODUCT_LICENSE }, target, entries: onTarget });
        const file = path.join(outDir, `lattice-${target.label}.cdx.json`);
        fs.writeFileSync(file, JSON.stringify(bom, null, 2) + '\n');
        log.log(`foss sbom: ${path.basename(file)} (${onTarget.length} components)`);
    }
    return 0;
}
// commandSbom END *********************************************


//**************************************************************
// parseArgs
//**************************************************************
/**
 * @param {string[]} argv arguments after the script name
 * @returns {{command: string, check: boolean, outDir: string|null, targets: object[]}}
 * @throws {Error} on unknown commands, options or targets
 */
export function parseArgs(argv) {
    const [command, ...rest] = argv;
    if (!['check', 'notices', 'sbom'].includes(command)) throw new Error(`unknown command "${command ?? ''}" (check | notices [--check] | sbom --out-dir <dir>)`);
    const opts = { command, check: false, outDir: null, targets: [...TARGETS] };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--check' && command === 'notices') opts.check = true;
        else if (a === '--out-dir' && command === 'sbom' && rest[i + 1]) opts.outDir = rest[++i];
        else if (a === '--targets' && rest[i + 1]) {
            const wanted = rest[++i].split(',');
            const unknown = wanted.filter((w) => !TARGETS.some((t) => t.triple === w));
            if (unknown.length) throw new Error(`unknown target(s): ${unknown.join(', ')}`);
            opts.targets = TARGETS.filter((t) => wanted.includes(t.triple));
        } else throw new Error(`unexpected argument "${a}"`);
    }
    if (command === 'sbom' && !opts.outDir) throw new Error('sbom needs --out-dir <dir>');
    // Partial notices would drop components shipped on other targets.
    if (command === 'notices' && opts.targets.length !== TARGETS.length) throw new Error('notices always covers every target; drop --targets');
    return opts;
}
// parseArgs END ***********************************************


//**************************************************************
// main
//**************************************************************
/** Runs one command; returns the exit code. */
export async function main(argv, { root = ROOT, today = new Date().toISOString().slice(0, 10) } = {}) {
    let opts;
    try {
        opts = parseArgs(argv);
    } catch (e) {
        console.error(`foss: ${e.message}`);
        return 2;
    }
    let inventory;
    try {
        inventory = await collect({ root, targets: opts.targets, today });
    } catch (e) {
        console.error(`foss: cannot build the inventory: ${e.message}`);
        return 2;
    }
    if (opts.command === 'check') return commandCheck(inventory);
    try {
        if (opts.command === 'notices') return commandNotices(inventory, { root, targets: opts.targets, check: opts.check });
        return commandSbom(inventory, { root, targets: opts.targets, outDir: path.resolve(opts.outDir) });
    } catch (e) {
        console.error(`foss ${opts.command}: ${e.message}`);
        return 2;
    }
}
// main END ****************************************************


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
}
