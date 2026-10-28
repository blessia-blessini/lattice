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
///   node scripts/foss/foss.mjs check [--block]  licence gate, all targets (REQ-LTTCE-FOS-00004); --block
///                                               (a release) also fails on notice additions for
///                                               versions no longer shipped (REQ-LTTCE-FOS-00008)
///   node scripts/foss/foss.mjs notices          write THIRD-PARTY-NOTICES.md (REQ-LTTCE-FOS-00002)
///                                               and the export notices (REQ-LTTCE-FOS-00005)
///   node scripts/foss/foss.mjs notices --check  fail if either committed file is stale
///   node scripts/foss/foss.mjs sbom --out-dir D one CycloneDX SBOM per target
///   node scripts/foss/foss.mjs appimage --appimage F --root R --target linux-x64|linux-arm64 --out-dir D
///                                               check a built AppImage F, unpacked at R, on its
///                                               Linux build machine; writes its SBOM (REQ-LTTCE-FOS-00006)
///   node scripts/foss/foss.mjs audit [--block]  npm audit + cargo audit against the shipped components
///                                               (REQ-LTTCE-FOS-00007); reports only, unless --block
///
/// Option for check, notices and sbom: --targets <triple,...> limits the Rust
/// graph to those targets (the default is every published target).
///
/// check, notices, sbom and audit need the crate sources (`cargo fetch --locked`)
/// and the installed npm packages (`npm ci --ignore-scripts`); audit also needs
/// cargo-audit on PATH and network access; appimage needs dpkg and the packages
/// the AppImage was built from. No npm dependencies of its own.
///
/// Exit codes: 0 ok, 1 policy failure, stale notices or (with --block) a vulnerable
/// shipped component, 2 usage or environment error (with --block: a tool that
/// could not audit).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inventoryFromMetadata, runCargoMetadata, TARGETS } from './cargo-inventory.mjs';
import {
    APPIMAGE_LIST_FILE, APPIMAGE_TARGETS, bundlerParts, evaluateAppImageList, inventoryAppImage, loadAppImageFiles, loadAppImageList,
    readRuntimeCommit, renderAppImageSection,
} from './appimage.mjs';
import {
    annotation, evaluateFindings, findingLabel, loadAdvisoryExceptions, parseCargoAudit, parseNpmAudit, renderAuditSummary,
    runCargoAudit, runNpmAudit,
} from './audit.mjs';
import { buildSbom } from './cyclonedx.mjs';
import { EXPORT_NOTICES_FILE, loadEmbedded, renderExportNotices, selectEmbedded } from './export-notices.mjs';
import { fallbackCopyright, findExhibitB, listLicenceFiles, selectTexts, shippedLicenceIds } from './licence-texts.mjs';
import { ADDITIONS_FILE, attachAdditions, loadAdditions } from './notice-additions.mjs';
import { enrichFromManifest, inventoryFromLockfile } from './npm-inventory.mjs';
import { escapeInline, renderNotices } from './notices-render.mjs';
import { evaluateComponent, licenceTypeMap, loadPolicy, obligationNote, unusedPolicyEntries } from './policy.mjs';
import { leafKey } from './spdx-expr.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';
export const PRODUCT_LICENSE = 'AGPL-3.0-or-later';
const EXTRA_COMPONENTS_FILE = 'foss/extra-components.json';
/** An inventory without notice additions (tests that build one by hand). */
const NO_ADDITIONS = Object.freeze({ source: null, problems: [], unused: [] });
const REGENERATE_HINT = `run "npm run foss:notices" and commit ${NOTICES_FILE} and ${EXPORT_NOTICES_FILE}`;
/** What `notices` needs before it can regenerate: the sources it reads, without running any package scripts. */
const REGENERATE_STEPS = Object.freeze([
    'npm ci --ignore-scripts',
    'cargo fetch --locked --manifest-path src-tauri/Cargo.toml',
    'npm run foss:notices',
]);


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
 * @returns {Promise<{policy: object, entries: object[], appImage: object[], additions: {source: object|null, problems: string[], unused: string[]}}>}
 *   each entry also carries `additions` (notice-additions.mjs, REQ-LTTCE-FOS-00008)
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

    for (const x of readJson(root, EXTRA_COMPONENTS_FILE).components ?? []) {
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

        const obligations = evaluation.chosen.map((l) => obligationNote(l, policy, component.linkage)).filter(Boolean);
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
    const appImage = fs.existsSync(path.join(root, APPIMAGE_LIST_FILE))
        ? evaluateAppImageList(loadAppImageList(root), policy, today)
        : [];
    const additionsData = loadAdditions(root);
    const { problems, unused } = attachAdditions(entries, additionsData, policy, loadStandardTexts(root));
    // The export topics name additions: one that is missing fails the gate
    // here, cleanly, instead of only when the export notices are written.
    try {
        selectEmbedded(entries, loadEmbedded(root), root);
    } catch (e) {
        problems.push(e.message);
    }
    return { policy, entries, appImage, additions: { source: additionsData?.source ?? null, problems, unused } };
}
// collect END *************************************************


//**************************************************************
// commandCheck
//**************************************************************
/**
 * The licence gate. Prints every failing component with its reasons.
 * Notice additions for versions no longer shipped are warnings -- in the job
 * summary and as annotations on GitHub Actions -- and with `block` (a
 * release) failures: the notices would lack what the ledger decided.
 * @param {object} inventory from `collect`
 * @param {{log: Function, warn: Function, error: Function}} [log]
 * @param {{block?: boolean, env?: Record<string, string|undefined>}} [options]
 * @returns {number} exit code
 */
export function commandCheck({ policy, entries, appImage = [], additions = NO_ADDITIONS }, log = console, { block = false, env = process.env } = {}) {
    const failures = entries.filter((e) => !e.evaluation.pass);
    const byEco = (eco) => entries.filter((e) => e.component.ecosystem === eco).length;
    log.log(`foss check: ${entries.length} components (${byEco('cargo')} cargo, ${byEco('npm')} npm, ${byEco('other')} other)`);
    const components = [...entries.map((e) => e.component), ...appImage.map((a) => ({ ecosystem: 'debian', name: a.item.package, version: '*' }))];
    for (const warning of unusedPolicyEntries(policy, components)) {
        log.warn(`  [WARN] unused policy entry ${warning}`);
    }
    if (!block) {
        for (const line of additions.unused) {
            log.warn(`  [WARN] ${line}`);
            if (env.GITHUB_ACTIONS === 'true') log.log(annotation('warning', 'Notice addition not applied', line));
        }
        if (additions.unused.length) {
            writeStepSummary(['### Notice additions not applied', '', ...additions.unused.map((l) => `- ${escapeInline(l)}`), '',
                'A release (`foss.mjs check --block`) fails on these.'], env, log);
        }
    }
    const failed = failures.map((f) => {
        const c = f.component;
        return `${c.ecosystem}:${c.name}@${c.version} (${c.linkage}): ${f.evaluation.problems.join('; ')}`;
    });
    // REQ-LTTCE-FOS-00008: a decision made on other file content, or one that
    // adds a licence the policy does not admit, fails like a component would.
    failed.push(...additions.problems, ...(block ? additions.unused : []));
    for (const line of failed) log.error(`  [FAIL] ${line}`);
    // REQ-LTTCE-FOS-00006: the reviewed AppImage packages are held to the policy
    // on every run, so a policy change that rejects one fails here, not on a Linux leg.
    log.log(`foss check: ${appImage.length} Linux AppImage system packages (${APPIMAGE_LIST_FILE})`);
    for (const a of appImage.filter((x) => !x.evaluation.pass)) {
        const line = `debian:${a.item.package} (shared-library): ${a.evaluation.problems.join('; ')}`;
        log.error(`  [FAIL] ${line}`);
        failed.push(line);
    }
    if (failed.length) {
        log.error(`foss check: ${failed.length} component(s) violate foss/policy.json`);
        writeStepSummary([
            '### Licence gate failed',
            '',
            `${failed.length} component(s) do not fit AGPL-3.0-or-later and the commercial licence:`,
            '',
            ...failed.map((line) => `- \`${line.replace(/`/g, "'")}\``),
            '',
            'Review each licence; then record the outcome in `foss/policy.json` (a clarification with evidence, or a dated exception), or drop the dependency.',
        ], process.env, log);
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
export function commandNotices({ policy, entries, appImage = [], additions = NO_ADDITIONS }, { root, targets, check }, log = console) {
    if (additions.problems.length) {
        for (const p of additions.problems) log.error(`  [FAIL] ${p}`);
        log.error(`foss notices: ${ADDITIONS_FILE} does not match the installed packages; update it from a Legattice scan of this tree`);
        return 1;
    }
    const standardTexts = loadStandardTexts(root);
    const extraSections = appImage.length ? renderAppImageSection(appImage) : [];
    const outputs = [
        [NOTICES_FILE, renderNotices({ entries, standardTexts, targets, licenceTypes: licenceTypeMap(policy), extraSections, additionsSource: additions.source })],
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
    const stale = [];
    for (const [rel, text] of outputs) {
        const file = path.join(root, rel);
        const committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
        if (committed !== text) {
            log.error(`foss notices: ${rel} is ${committed === null ? 'missing' : 'out of date'}; ${REGENERATE_HINT}`);
            stale.push(rel);
        } else {
            log.log(`foss notices: ${rel} is up to date`);
        }
    }
    if (!stale.length) return 0;
    // A dependency update (Dependabot's included) changes what must be noticed;
    // the run page says how to bring the generated files up to date.
    writeStepSummary([
        '### Third-party notices are out of date',
        '',
        `Stale: ${stale.map((rel) => `\`${rel}\``).join(', ')}. A dependency change alters what Lattice must ship as notices. On this branch run:`,
        '',
        '```sh',
        ...REGENERATE_STEPS,
        '```',
        '',
        `and commit \`${NOTICES_FILE}\` and \`${EXPORT_NOTICES_FILE}\`.`,
    ], process.env, log);
    return 1;
}
// commandNotices END ******************************************


//**************************************************************
// writeStepSummary
//**************************************************************
/**
 * Appends Markdown to the GitHub Actions job summary, so a failing gate says
 * on the run page what to do. Does nothing outside Actions (no
 * GITHUB_STEP_SUMMARY). The summary only explains: failing to write it is a
 * warning and never changes the outcome of the check that called it.
 * @param {string[]} lines Markdown
 * @param {Record<string, string|undefined>} [env]
 * @param {{warn: Function}} [log]
 */
export function writeStepSummary(lines, env = process.env, log = console) {
    if (!env.GITHUB_STEP_SUMMARY) return;
    try {
        fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
    } catch (e) {
        log.warn(`  [WARN] cannot write the job summary: ${e.message}`);
    }
}
// writeStepSummary END ****************************************


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
// commandAppImage
//**************************************************************
/**
 * REQ-LTTCE-FOS-00006 — checks a built AppImage on the Linux machine that
 * built it against foss/appimage-packages.json and the AppImage parts of
 * foss/extra-components.json, and writes lattice-<label>-appimage.cdx.json
 * (the exact package versions) into outDir.
 * @param {object} options
 * @param {string} options.root repository root
 * @param {string} options.appImage the AppImage file (its runtime is checked)
 * @param {string} options.appRoot the same AppImage, unpacked (squashfs-root)
 * @param {string} options.label target label (linux-x64 | linux-arm64)
 * @param {string} options.outDir
 * @param {string} options.today YYYY-MM-DD
 * @param {object} [options.probes] {owners, versions} injectable for tests
 * @returns {number} exit code
 */
export function commandAppImage({ root, appImage, appRoot, label, outDir, today, probes = {} }, log = console) {
    const policy = loadPolicy(path.join(root, 'foss', 'policy.json'));
    const list = loadAppImageList(root);
    const globs = loadAppImageFiles(root);
    const bundler = bundlerParts(readJson(root, EXTRA_COMPONENTS_FILE).components);
    const runtimeCommit = readRuntimeCommit(appImage);
    const { problems, warnings, entries } = inventoryAppImage({ root: appRoot, label, list, globs, bundler, runtimeCommit, policy, today, ...probes });
    const files = entries.reduce((n, e) => n + e.component.files.length, 0);
    log.log(`foss appimage: ${entries.length} packages, ${files} of their files in the ${label} AppImage; runtime type2-runtime ${runtimeCommit ?? 'unknown'}`);
    for (const w of warnings) log.warn(`  [WARN] ${w}`);
    for (const p of problems) log.error(`  [FAIL] ${p}`);

    const pkg = readJson(root, 'package.json');
    const target = TARGETS.find((t) => t.label === label);
    const bom = buildSbom({ product: { name: 'lattice', version: pkg.version, license: PRODUCT_LICENSE }, target, entries });
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `lattice-${label}-appimage.cdx.json`);
    fs.writeFileSync(file, JSON.stringify(bom, null, 2) + '\n');
    log.log(`foss appimage: wrote ${path.basename(file)}`);

    if (problems.length) {
        log.error(`foss appimage: ${problems.length} problem(s); fix ${APPIMAGE_LIST_FILE} or the build`);
        return 1;
    }
    return 0;
}
// commandAppImage END *****************************************


//**************************************************************
// commandAudit
//**************************************************************
/**
 * REQ-LTTCE-FOS-00007 — `npm audit` and `cargo audit` against the shipped
 * components of the inventory and foss/advisory-exceptions.json. Without
 * `block` it only reports (job summary, and annotations on GitHub Actions);
 * with `block` (a release) a vulnerable shipped component without a valid
 * exception fails, and so does a tool that could not audit.
 * @param {{entries: object[]}} inventory from `collect`, every target
 * @param {object} options
 * @param {string} options.root repository root
 * @param {boolean} options.block release mode
 * @param {string} options.today YYYY-MM-DD
 * @param {Record<string, string|undefined>} [options.env]
 * @param {{npm: Function, cargo: Function}} [options.runners] injectable for tests
 * @returns {Promise<number>} exit code
 */
export async function commandAudit({ entries }, { root, block, today, env = process.env, runners = { npm: runNpmAudit, cargo: runCargoAudit } }, log = console) {
    const exceptions = loadAdvisoryExceptions(root);
    const lock = readJson(root, 'package-lock.json');
    const findings = [];
    const errors = [];
    const sources = [
        async () => parseNpmAudit(await runners.npm(root), lock),
        async () => parseCargoAudit(await runners.cargo(root)),
    ];
    for (const source of sources) {
        try {
            findings.push(...await source());
        } catch (e) {
            errors.push(e.message);
        }
    }
    const { findings: evaluated, unused } = evaluateFindings({ findings, shipped: entries.map((e) => e.component), exceptions, today });
    const of = (status) => evaluated.filter((f) => f.status === status);
    const blocking = of('blocking');
    log.log(`foss audit: ${blocking.length} blocking, ${of('excepted').length} excepted, ${of('development').length} development only, `
        + `${of('informational').length} informational${block ? '' : ' (report only, no --block)'}`);

    // A finding that would block a release is an error on a release and a
    // warning anywhere else; on Actions it is also annotated, so a green pull
    // request check still shows it.
    const [level, tag, write] = block ? ['error', 'FAIL', log.error] : ['warning', 'WARN', log.warn];
    const actions = env.GITHUB_ACTIONS === 'true';
    for (const f of blocking) {
        write(`  [${tag}] ${findingLabel(f)}${f.note ? ` — ${f.note}` : ''}`);
        if (actions) log.log(annotation(level, 'Vulnerable shipped component', findingLabel(f)));
    }
    for (const e of errors) {
        write(`  [${tag}] not audited: ${e}`);
        if (actions) log.log(annotation(level, 'Vulnerability audit incomplete', e));
    }
    for (const f of evaluated.filter((x) => x.status !== 'blocking')) log.log(`  [${f.status.toUpperCase()}] ${findingLabel(f)}`);
    for (const e of unused) log.warn(`  [WARN] unused advisory exception ${e.ecosystem}:${e.package} ${e.advisory}`);

    const summary = renderAuditSummary({ findings: evaluated, unused, errors, block });
    if (summary.length) writeStepSummary(summary, env, log);
    if (!block) return 0;
    if (blocking.length) {
        log.error(`foss audit: ${blocking.length} vulnerable shipped component(s); a release is blocked`);
        return 1;
    }
    return errors.length ? 2 : 0;
}
// commandAudit END ********************************************


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
    if (!['check', 'notices', 'sbom', 'appimage', 'audit'].includes(command)) {
        throw new Error(`unknown command "${command ?? ''}" (check [--block] | notices [--check] | sbom --out-dir <dir> | appimage --appimage <file> --root <dir> --target <label> --out-dir <dir> | audit [--block])`);
    }
    const opts = { command, check: false, block: false, outDir: null, appImage: null, appRoot: null, label: null, targets: [...TARGETS] };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--check' && command === 'notices') opts.check = true;
        else if (a === '--block' && (command === 'audit' || command === 'check')) opts.block = true;
        else if (a === '--out-dir' && (command === 'sbom' || command === 'appimage') && rest[i + 1]) opts.outDir = rest[++i];
        else if (a === '--appimage' && command === 'appimage' && rest[i + 1]) opts.appImage = rest[++i];
        else if (a === '--root' && command === 'appimage' && rest[i + 1]) opts.appRoot = rest[++i];
        else if (a === '--target' && command === 'appimage' && rest[i + 1]) opts.label = rest[++i];
        else if (a === '--targets' && rest[i + 1]) {
            const wanted = rest[++i].split(',');
            const unknown = wanted.filter((w) => !TARGETS.some((t) => t.triple === w));
            if (unknown.length) throw new Error(`unknown target(s): ${unknown.join(', ')}`);
            opts.targets = TARGETS.filter((t) => wanted.includes(t.triple));
        } else throw new Error(`unexpected argument "${a}"`);
    }
    if (command === 'sbom' && !opts.outDir) throw new Error('sbom needs --out-dir <dir>');
    if (command === 'appimage') {
        if (!opts.appImage || !opts.appRoot || !opts.outDir || !opts.label) throw new Error('appimage needs --appimage <file> --root <dir> --target <label> --out-dir <dir>');
        if (!Object.hasOwn(APPIMAGE_TARGETS, opts.label)) throw new Error(`no AppImage for target "${opts.label}" (known: ${Object.keys(APPIMAGE_TARGETS).join(', ')})`);
    }
    // Partial notices would drop components shipped on other targets; a partial
    // audit would call a component shipped elsewhere "development only".
    if ((command === 'notices' || command === 'audit') && opts.targets.length !== TARGETS.length) throw new Error(`${command} always covers every target; drop --targets`);
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
    // The AppImage check needs no cargo/npm inventory: it runs on a Linux build
    // leg after the bundle exists, against the reviewed list alone.
    if (opts.command === 'appimage') {
        try {
            return commandAppImage({ root, appImage: path.resolve(opts.appImage), appRoot: path.resolve(opts.appRoot), label: opts.label, outDir: path.resolve(opts.outDir), today });
        } catch (e) {
            console.error(`foss appimage: ${e.message}`);
            return 2;
        }
    }
    let inventory;
    try {
        inventory = await collect({ root, targets: opts.targets, today });
    } catch (e) {
        console.error(`foss: cannot build the inventory: ${e.message}`);
        return 2;
    }
    if (opts.command === 'check') return commandCheck(inventory, console, { block: opts.block });
    try {
        if (opts.command === 'notices') return commandNotices(inventory, { root, targets: opts.targets, check: opts.check });
        if (opts.command === 'audit') return await commandAudit(inventory, { root, block: opts.block, today });
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
