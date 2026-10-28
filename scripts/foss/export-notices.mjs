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

/// Notices for exported documents (export-notices.mjs)
///
/// IMPL-LTTCE-FOS-00005 — REQ-LTTCE-FOS-00005. An HTML export copies
/// third-party material into the user's file (KaTeX's stylesheet and fonts,
/// github-markdown-css). Their licences ask every copy to carry the copyright
/// notice and licence text, so the export carries them too: this module
/// renders them, from the same evaluated inventory as THIRD-PARTY-NOTICES.md,
/// into a plain-text file the export puts at the top of its `<style>` element
/// as a CSS comment.
///
/// Pure apart from `loadEmbedded`: entries in, text out, LF line ends.

import fs from 'fs';
import path from 'path';
import { licenceBody } from './notices-render.mjs';

export const EMBEDDED_FILE = 'foss/export-embedded.json';
export const EXPORT_NOTICES_FILE = 'src/lib/export-notices.generated.txt';
const README_LICENSING = 'https://github.com/blessia-blessini/lattice#licensing';


//**************************************************************
// loadEmbedded
//**************************************************************
/**
 * Reads foss/export-embedded.json. A component may name, in "topics", the
 * ledger topics of foss/notice-additions.json that concern the material the
 * export copies (KaTeX's fonts are OFL-1.1, its code is not copied).
 * @param {string} root repository root
 * @returns {{lockKey: string, material: string, topics: string[]}[]}
 * @throws {Error} on a malformed file
 */
export function loadEmbedded(root) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, EMBEDDED_FILE), 'utf8'));
    const list = parsed?.components;
    if (!Array.isArray(list) || !list.length) throw new Error(`${EMBEDDED_FILE}: "components" must be a non-empty list`);
    for (const c of list) {
        if (typeof c?.lockKey !== 'string' || !c.lockKey.startsWith('node_modules/') || typeof c.material !== 'string' || !c.material) {
            throw new Error(`${EMBEDDED_FILE}: every component needs "lockKey" (node_modules/...) and "material"; got ${JSON.stringify(c)}`);
        }
        if (c.topics !== undefined && (!Array.isArray(c.topics) || !c.topics.every((t) => /^LT-[0-9a-f]{10}$/.test(t)))) {
            throw new Error(`${EMBEDDED_FILE}: "topics" of ${c.lockKey} must be a list of ledger topic ids (LT-...)`);
        }
    }
    return list.map((c) => ({ ...c, topics: c.topics ?? [] }));
}
// loadEmbedded END ********************************************


//**************************************************************
// selectEmbedded
//**************************************************************
/**
 * Finds the inventory entry of each embedded package, matched by its
 * installed directory (`<root>/<lockKey>`), in the order of the list.
 * @param {object[]} entries evaluated inventory from `collect`
 * @param {{lockKey: string, material: string, topics?: string[]}[]} embedded from loadEmbedded
 * @param {string} root repository root the npm `dir`s were built from
 * @returns {{entry: object, material: string, additions: object[]}[]}
 * @throws {Error} when a listed package is not a shipped npm component, or a
 *   listed topic has no notice addition for it (REQ-LTTCE-FOS-00008)
 */
export function selectEmbedded(entries, embedded, root) {
    return embedded.map(({ lockKey, material, topics = [] }) => {
        const dir = path.join(root, lockKey);
        const entry = entries.find((e) => e.component.ecosystem === 'npm' && e.component.dir === dir);
        if (!entry) throw new Error(`${EMBEDDED_FILE}: "${lockKey}" is not a shipped npm package (check package-lock.json)`);
        const additions = topics.map((topic) => {
            const found = (entry.additions ?? []).find((a) => a.topic === topic);
            if (!found) throw new Error(`${EMBEDDED_FILE}: topic ${topic} of "${lockKey}" has no notice addition for that package (check foss/notice-additions.json)`);
            return found;
        });
        return { entry, material, additions };
    });
}
// selectEmbedded END ******************************************


//**************************************************************
// renderExportNotices
//**************************************************************
/**
 * The notice text an exported document carries.
 *
 * Every licence text is printed once; components sharing an identical text
 * are named together above it.
 * @param {{entry: object, material: string}[]} selected from selectEmbedded
 * @param {Record<string,string>} standardTexts id -> text (foss/licenses)
 * @returns {string} LF line ends, trailing newline
 * @throws {Error} if the text contains "*" + "/" or "</style": either would end
 *   the CSS comment or the `<style>` element it is placed in
 */
export function renderExportNotices(selected, standardTexts) {
    const lines = [
        'Third-party notices',
        '',
        'This document was exported by Lattice, which copied material from the following third-party',
        'components into it. Each is used under the licence shown; its copyright notices and licence',
        'text follow.',
        '',
    ];
    // body -> {ids, users, kind}: "licence text", or "as found in the code" for an excerpt
    const texts = new Map();
    const addText = (body, ids, user, kind = 'licence text') => {
        const key = body.replace(/\r\n?/g, '\n').trim();
        if (!texts.has(key)) texts.set(key, { ids: new Set(), users: new Set(), kind });
        for (const id of ids) texts.get(key).ids.add(id);
        texts.get(key).users.add(user);
    };
    for (const { entry: { component: c, evaluation: ev, selection: sel }, material, additions = [] } of selected) {
        const used = ev.chosen.map((l) => (l.exception ? `${l.id} WITH ${l.exception}` : l.id)).join(' AND ');
        lines.push(`- ${c.name} ${c.version} (${material}): ${used}`);
        for (const line of sel.copyrights) lines.push(`  ${line}`);
        const source = c.repository ?? c.homepage;
        if (source) lines.push(`  Source: ${source}`);
        for (const t of sel.texts) addText(licenceBody(t, standardTexts), [t.id], c.name);
        // REQ-LTTCE-FOS-00008: material inside the package under a licence of its own.
        for (const a of additions) {
            lines.push(`  Also: ${a.licences.join(' AND ')}`);
            for (const line of a.copyrights) lines.push(`    ${line}`);
            for (const id of a.licences.filter((l) => standardTexts[l])) addText(standardTexts[id], [id], c.name);
            for (const q of a.quotes) addText(q.text, a.licences, c.name, 'as found in the code');
        }
    }
    lines.push(
        '',
        'Styles taken from Lattice itself are covered by the additional permission for exported',
        `documents in Lattice's licensing statement: ${README_LICENSING}`,
    );
    for (const [body, { ids, users, kind }] of texts) {
        lines.push('', `---- ${[...ids].join(', ')} ${kind} (${[...users].join(', ')}) ----`, '', body);
    }
    const text = lines.join('\n') + '\n';
    if (text.includes('*/') || /<\/style/i.test(text)) {
        throw new Error('export notices contain "*/" or "</style" and cannot be placed in a CSS comment');
    }
    return text;
}
// renderExportNotices END *************************************
