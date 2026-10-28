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

/// THIRD-PARTY-NOTICES.md renderer (notices-render.mjs)
///
/// Pure: entries in, Markdown out. No clock, no paths, no randomness, so the
/// same inputs give the same bytes on every OS and `notices --check` can
/// compare the committed file byte for byte (REQ-LTTCE-FOS-00002).
///
/// Every distinct licence text appears once under "Licence texts", keyed by
/// a hash of its content (`text-xxxxxxxx`); components point at it. The key
/// is content-derived so adding a component does not renumber the others.

import crypto from 'crypto';
import { stripTemplateCopyright } from './licence-texts.mjs';
import { COPYLEFT_TYPES, LICENCE_TYPES } from './policy.mjs';

const ECOSYSTEM_LABEL = Object.freeze({ cargo: 'Rust crate', npm: 'npm package', other: 'other component' });


//**************************************************************
// escapeInline
//**************************************************************
/**
 * Escapes Markdown control characters in inline text and table cells.
 * `_` is left alone: GFM does not emphasise inside words, and crate names
 * such as windows_x86_64_msvc stay readable in the raw file.
 */
export function escapeInline(text) {
    return String(text).replace(/([\\`*[\]<>|])/g, '\\$1');
}
// escapeInline END ********************************************


//**************************************************************
// fenced
//**************************************************************
/** A ```text block whose fence is longer than any backtick run inside. */
export function fenced(body) {
    const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((r) => r.length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}text\n${body}\n${fence}`;
}
// fenced END **************************************************


//**************************************************************
// textKey
//**************************************************************
/** Content-derived anchor of a licence text. */
export function textKey(body) {
    return 'text-' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 8);
}
// textKey END *************************************************


//**************************************************************
// standardBody
//**************************************************************
/**
 * The standard text for `id` or `id WITH exception`, from foss/licenses.
 * @throws {Error} when the policy allows a licence nobody added a text for
 */
function standardBody(key, standardTexts, asTemplate) {
    const [id, exception] = key.split(' WITH ');
    const base = standardTexts[id];
    if (!base) throw new Error(`no standard text for "${id}": add foss/licenses/${id}.txt`);
    let body = asTemplate ? stripTemplateCopyright(base) : base;
    if (exception) {
        if (!standardTexts[exception]) throw new Error(`no text for exception "${exception}": add foss/licenses/${exception}.txt`);
        body += `\n\n---- ${exception} ----\n\n${standardTexts[exception]}`;
    }
    return body;
}
// standardBody END ********************************************


//**************************************************************
// licenceBody
//**************************************************************
/**
 * The text to reproduce for one entry of a `selectTexts` result: the
 * package's own file, the standard text, or the standard text as a per-copy
 * template with its placeholder copyright line removed.
 * @param {{id: string, source: string, text?: string}} t one of `selection.texts`
 * @param {Record<string,string>} standardTexts id -> text (foss/licenses)
 * @returns {string}
 */
export function licenceBody(t, standardTexts) {
    if (t.source === 'package') return t.text;
    return standardBody(t.id, standardTexts, t.source === 'template');
}
// licenceBody END *********************************************


//**************************************************************
// platformLabel
//**************************************************************
/** "all" when a component ships on every target, else the labels in target order. */
export function platformLabel(labels, targets) {
    if (targets.every((t) => labels.includes(t.label))) return 'all';
    return targets.filter((t) => labels.includes(t.label)).map((t) => t.label).join(', ');
}
// platformLabel END *******************************************


/** Wording of each licence type in the "Licences by type" summary. */
const TYPE_LABEL = Object.freeze({
    'strong-copyleft': 'strong copyleft',
    'weak-copyleft': 'weak copyleft',
    permissive: 'permissive',
    'public-domain': 'public-domain dedication',
    unclassified: 'unclassified',
});
/** [type, label] in summary order: the policy's types (copyleft first), then unclassified. */
const TYPE_ORDER = Object.freeze([...LICENCE_TYPES, 'unclassified'].map((t) => [t, TYPE_LABEL[t] ?? t]));


//**************************************************************
// renderTypeSummary
//**************************************************************
/**
 * The "Licences by type" section: one row per licence in use with its type,
 * component count and how many of those are linked into the program, then
 * the components under each copyleft type by name.
 * @param {{key: string, title: string, linked: boolean}[]} uses one per licence a component is used under
 * @param {Record<string,string>} licenceTypes id -> type (policy "types")
 * @returns {string[]} Markdown lines
 */
export function renderTypeSummary(uses, licenceTypes = {}) {
    // A type the summary does not know is shown as "unclassified" rather than
    // indexing outside TYPE_ORDER (validatePolicy rejects such types anyway).
    const typeOf = (key) => {
        const type = licenceTypes[key.split(' WITH ')[0]];
        return TYPE_ORDER.some(([t]) => t === type) ? type : 'unclassified';
    };
    const byKey = new Map();
    for (const u of uses) {
        if (!byKey.has(u.key)) byKey.set(u.key, { total: 0, linked: 0, titles: [] });
        const k = byKey.get(u.key);
        k.total++;
        if (u.linked) k.linked++;
        k.titles.push(u.title);
    }
    const rank = (key) => TYPE_ORDER.findIndex(([t]) => t === typeOf(key));
    const keys = [...byKey.keys()].sort((a, b) =>
        rank(a) - rank(b) || byKey.get(b).total - byKey.get(a).total || a.localeCompare(b, 'en'));

    const lines = [
        '## Licences by type',
        '',
        '| Licence | Type | Components | Linked into the program |',
        '| --- | --- | ---: | ---: |',
        ...keys.map((key) => {
            const k = byKey.get(key);
            const label = TYPE_ORDER[rank(key)][1];
            return `| ${escapeInline(key)} | ${label} | ${k.total} | ${k.linked} |`;
        }),
        '',
    ];
    for (const [type, label] of TYPE_ORDER.filter(([t]) => COPYLEFT_TYPES.includes(t))) {
        const ofType = keys.filter((key) => typeOf(key) === type);
        const head = label.charAt(0).toUpperCase() + label.slice(1);
        if (!ofType.length) {
            lines.push(`${head}: none.`, '');
            continue;
        }
        for (const key of ofType) {
            lines.push(`${head}, ${escapeInline(key)}: ${byKey.get(key).titles.map(escapeInline).join(', ')}.`, '');
        }
    }
    return lines;
}
// renderTypeSummary END ***************************************


/** Files named in one line: the first few, then how many more. */
const SHOWN_FILES = 3;


//**************************************************************
// fileList
//**************************************************************
/** Paths in one line, escaped like any other inline text (a path may hold a backtick). */
function fileList(files) {
    const shown = files.slice(0, SHOWN_FILES).map(escapeInline).join(', ');
    return files.length > SHOWN_FILES ? `${shown} and ${files.length - SHOWN_FILES} more` : shown;
}
// fileList END ************************************************


//**************************************************************
// additionsIntro
//**************************************************************
/** The introduction's sentence on foss/notice-additions.json and where it came from. */
export function additionsIntro(source) {
    const scanned = [source.product?.repository, source.product?.ref].filter(Boolean).join(' at ');
    const from = [scanned && `a scan of ${scanned}`, source.date, source.run].filter(Boolean).join(', ');
    return 'Some components contain code from other projects under licences of their own, found by a scan of the package sources and recorded in foss/notice-additions.json'
        + `${from ? ` (${escapeInline(from)})` : ''}; they are listed under each component as "Also in its code".`;
}
// additionsIntro END ******************************************


//**************************************************************
// renderAddition
//**************************************************************
/**
 * The lines of one notice addition under its component: the licences, the
 * copyright lines found with them, a standard text per licence where
 * foss/licenses has one, and each distinct excerpt quoted from the files.
 * @param {object} a one of `entry.additions`
 * @param {string} title component title, for "Used by"
 * @param {Record<string,string>} standardTexts
 * @param {(body: string, ids: string[], user: string) => string} addText registers a text under its licence ids, returns its key
 * @returns {string[]} Markdown lines
 */
export function renderAddition(a, title, standardTexts, addText) {
    const files = a.fileCount === 1 ? '1 file' : `${a.fileCount} files`;
    const lines = [`- Also in its code: ${escapeInline(a.licences.join(' AND '))}, in ${files} (ledger decision ${a.topic})`];
    for (const line of a.copyrights) lines.push(`  - ${escapeInline(line)}`);
    for (const id of a.licences) {
        if (!standardTexts[id]) continue;
        const key = addText(standardTexts[id], [id], title);
        lines.push(`  - Licence text (${escapeInline(id)}): [${key}](#${key}), standard text`);
    }
    for (const q of a.quotes) {
        const key = addText(q.text, a.licences.map((id) => `${id} (as found in the code)`), title);
        lines.push(`  - As found in ${fileList(q.files)}: [${key}](#${key})`);
    }
    if (a.unquoted.length) lines.push(`  - Not quoted (binary, minified or too long): ${fileList(a.unquoted)}`);
    return lines;
}
// renderAddition END ******************************************


//**************************************************************
// renderNotices
//**************************************************************
/**
 * Renders the L&C document.
 *
 * @param {object} input
 * @param {object[]} input.entries one per component:
 *   { component, evaluation, selection, platforms: string[], obligation: string|null }
 *   component  {ecosystem, name, version, license, repository, homepage, linkage}
 *   evaluation {expression, chosen: [{id, exception}]}
 *   selection  from selectTexts, with `copyrights` already non-empty
 * @param {Record<string,string>} input.standardTexts id -> text (foss/licenses)
 * @param {{triple: string, label: string}[]} input.targets
 * @param {Record<string,string>} [input.licenceTypes] id -> type, for "Licences by type"
 * @param {string[]} [input.extraSections] Markdown lines placed after the
 *   components and before the licence texts (the AppImage section)
 * @param {object|null} [input.additionsSource] `source` of foss/notice-additions.json,
 *   named in the introduction when present; each entry's `additions`
 *   (notice-additions.mjs) are rendered under its component (REQ-LTTCE-FOS-00008)
 * @returns {string} Markdown, LF line ends, trailing newline
 */
export function renderNotices({ entries, standardTexts, targets, licenceTypes = {}, extraSections = [], additionsSource = null }) {
    const sorted = [...entries].sort((a, b) =>
        a.component.name.localeCompare(b.component.name, 'en') ||
        a.component.version.localeCompare(b.component.version, 'en') ||
        a.component.ecosystem.localeCompare(b.component.ecosystem, 'en'));

    const texts = new Map(); // key -> {body, ids: Set, users: Set}
    const addText = (body, ids, user) => {
        const key = textKey(body);
        if (!texts.has(key)) texts.set(key, { body, ids: new Set(), users: new Set() });
        for (const id of ids) texts.get(key).ids.add(id);
        texts.get(key).users.add(user);
        return key;
    };

    const counts = { cargo: 0, npm: 0, other: 0 };
    const sections = [];
    const rows = [];
    const uses = []; // one per licence a component is used under, for the type summary
    for (const entry of sorted) {
        const { component: c, evaluation: ev, selection: sel, platforms, obligation } = entry;
        counts[c.ecosystem in counts ? c.ecosystem : 'other']++;
        const title = `${c.name} ${c.version}`;
        // A licence counts once per component, whether declared or added by the ledger.
        const usedKeys = [...new Set([
            ...ev.chosen.map((l) => (l.exception ? `${l.id} WITH ${l.exception}` : l.id)),
            ...(entry.additions ?? []).flatMap((a) => a.licences),
        ])];
        for (const key of usedKeys) uses.push({ key, title, linked: c.linkage === 'linked' });
        const used = ev.chosen.map((l) => (l.exception ? `${l.id} WITH ${l.exception}` : l.id)).join(' AND ');
        const where = platformLabel(platforms, targets);
        rows.push(`| ${escapeInline(c.name)} | ${escapeInline(c.version)} | ${ECOSYSTEM_LABEL[c.ecosystem] ?? ECOSYSTEM_LABEL.other} | ${escapeInline(ev.expression)} | ${escapeInline(used)} | ${c.linkage} | ${where} |`);

        const lines = [`### ${escapeInline(title)}`, ''];
        lines.push(`- Kind: ${ECOSYSTEM_LABEL[c.ecosystem] ?? ECOSYSTEM_LABEL.other}, ${c.linkage}, platforms: ${where}`);
        lines.push(ev.expression === used
            ? `- Licence: ${escapeInline(used)}`
            : `- Licence: ${escapeInline(used)} (declared: ${escapeInline(ev.expression)})`);
        const source = c.repository ?? c.homepage;
        if (source) lines.push(`- Source: ${escapeInline(source)}`);
        lines.push('- Copyright:');
        for (const line of sel.copyrights) lines.push(`  - ${escapeInline(line)}`);
        for (const t of sel.texts) {
            const key = addText(licenceBody(t, standardTexts), [t.id], title);
            const note = t.source === 'package'
                ? `as shipped in the package file ${escapeInline(t.file)}`
                : t.source === 'template'
                    ? 'standard text; the package ships no licence file, so the copyright above is taken from its metadata'
                    : 'standard text';
            lines.push(`- Licence text (${escapeInline(t.id)}): [${key}](#${key}), ${note}`);
        }
        if (obligation) lines.push(`- Obligation: ${escapeInline(obligation)}`);
        for (const a of entry.additions ?? []) {
            lines.push(...renderAddition(a, title, standardTexts, addText));
        }
        for (const n of sel.notices) {
            lines.push('', `NOTICE file \`${n.name}\`:`, '', fenced(n.text));
        }
        sections.push(lines.join('\n'));
    }

    const total = counts.cargo + counts.npm + counts.other;
    const out = [
        '# Third-Party Notices',
        '',
        'Lattice is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version (AGPL-3.0-or-later); see the file LICENSE. Its copyright holder also offers Lattice under a separate commercial licence.',
        '',
        'Lattice includes the third-party components listed below. Each is used under the licence shown, and its copyright notices and licence text are reproduced here as that licence requires.',
        '',
        'This file is generated by `npm run foss:notices` (scripts/foss/foss.mjs) from Cargo.lock, package-lock.json and foss/extra-components.json. Do not edit it by hand.',
        '',
        ...(additionsSource ? [additionsIntro(additionsSource), ''] : []),
        `Components: ${total} (${counts.cargo} Rust crates, ${counts.npm} npm packages, ${counts.other} other).`,
        '',
        'Platforms: ' + targets.map((t) => `${t.label} = ${t.triple}`).join('; ') + '.',
        '',
        'Use: "linked" means the component is part of the shipped program; "build-time" means it only runs while Lattice is built and is listed for completeness; "separate-program" means a program of its own inside the Linux AppImage (its runtime, AppRun) that Lattice\'s code does not link with.',
        '',
        'The Linux AppImage additionally carries system libraries from the Ubuntu release it is built on (such as GTK, WebKitGTK and GLib, many of them under the LGPL, each a separate file loaded at run time). They are listed, with the written offer for their source code, in the section "Linux AppImage system libraries" below; their copyright files are inside the AppImage under `usr/share/doc/`, the licence texts those refer to under `usr/share/common-licenses/`.',
        '',
        ...renderTypeSummary(uses, licenceTypes),
        '## Summary',
        '',
        '| Component | Version | Kind | Declared licence | Licence used | Use | Platforms |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows,
        '',
        '## Components',
        '',
        sections.join('\n\n'),
        '',
        ...extraSections,
        '## Licence texts',
        '',
        'Each distinct licence text appears once. The components above link to the text that applies to them.',
    ];
    const keys = [...texts.keys()].sort();
    for (const key of keys) {
        const t = texts.get(key);
        out.push('', `### ${key}`, '', `Licence: ${[...t.ids].sort().map(escapeInline).join(', ')}. Used by: ${[...t.users].map(escapeInline).join(', ')}.`, '', fenced(t.body));
    }
    return out.join('\n') + '\n';
}
// renderNotices END *******************************************
