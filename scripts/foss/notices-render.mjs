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
// platformLabel
//**************************************************************
/** "all" when a component ships on every target, else the labels in target order. */
export function platformLabel(labels, targets) {
    if (targets.every((t) => labels.includes(t.label))) return 'all';
    return targets.filter((t) => labels.includes(t.label)).map((t) => t.label).join(', ');
}
// platformLabel END *******************************************


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
 * @returns {string} Markdown, LF line ends, trailing newline
 */
export function renderNotices({ entries, standardTexts, targets }) {
    const sorted = [...entries].sort((a, b) =>
        a.component.name.localeCompare(b.component.name, 'en') ||
        a.component.version.localeCompare(b.component.version, 'en') ||
        a.component.ecosystem.localeCompare(b.component.ecosystem, 'en'));

    const texts = new Map(); // key -> {body, ids: Set, users: string[]}
    const addText = (body, id, user) => {
        const key = textKey(body);
        if (!texts.has(key)) texts.set(key, { body, ids: new Set(), users: [] });
        texts.get(key).ids.add(id);
        texts.get(key).users.push(user);
        return key;
    };

    const counts = { cargo: 0, npm: 0, other: 0 };
    const sections = [];
    const rows = [];
    for (const { component: c, evaluation: ev, selection: sel, platforms, obligation } of sorted) {
        counts[c.ecosystem in counts ? c.ecosystem : 'other']++;
        const title = `${c.name} ${c.version}`;
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
            let key;
            let note;
            if (t.source === 'package') {
                key = addText(t.text, t.id, title);
                note = `as shipped in the package file ${escapeInline(t.file)}`;
            } else if (t.source === 'template') {
                key = addText(standardBody(t.id, standardTexts, true), t.id, title);
                note = 'standard text; the package ships no licence file, so the copyright above is taken from its metadata';
            } else {
                key = addText(standardBody(t.id, standardTexts, false), t.id, title);
                note = 'standard text';
            }
            lines.push(`- Licence text (${escapeInline(t.id)}): [${key}](#${key}), ${note}`);
        }
        if (obligation) lines.push(`- Obligation: ${escapeInline(obligation)}`);
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
        `Components: ${total} (${counts.cargo} Rust crates, ${counts.npm} npm packages, ${counts.other} other).`,
        '',
        'Platforms: ' + targets.map((t) => `${t.label} = ${t.triple}`).join('; ') + '.',
        '',
        'Use: "linked" means the component is part of the shipped program; "build-time" means it only runs while Lattice is built and is listed for completeness.',
        '',
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
        '## Licence texts',
        '',
        'Each distinct licence text appears once. The components above link to the text that applies to them.',
    ];
    const keys = [...texts.keys()].sort();
    for (const key of keys) {
        const t = texts.get(key);
        out.push('', `### ${key}`, '', `Licence: ${[...t.ids].sort().join(', ')}. Used by: ${t.users.map(escapeInline).join(', ')}.`, '', fenced(t.body));
    }
    return out.join('\n') + '\n';
}
// renderNotices END *******************************************
