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

/// Licence texts of a component (licence-texts.mjs)
///
/// Finds which text to reproduce for each licence Lattice uses a component
/// under (REQ-LTTCE-FOS-00002):
///
///   per-copy licences (MIT, BSD, ISC, Zlib, Unicode ...) carry the copyright
///     holder inside the text, so the component's OWN licence file is used.
///     A component that ships none gets the standard text from foss/licenses/
///     with its copyright line taken from package metadata, and is marked so.
///   standard licences (Apache-2.0, MPL-2.0, CC0, Unlicense, BSL) are
///     reproduced once from foss/licenses/; Apache NOTICE files are always
///     reproduced verbatim (Apache-2.0 section 4(d)).

import fs from 'fs';
import path from 'path';

/** Licences whose text names the copyright holder: reproduce each copy. */
export const PER_COPY = new Set(['MIT', 'MIT-0', '0BSD', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'Unicode-3.0', 'Unicode-DFS-2016']);

const LICENCE_FILE_RE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._ ].*)?$/i;
const NOTICE_FILE_RE = /^notice([-._ ].*)?$/i;
const MAX_LICENCE_FILE_BYTES = 256 * 1024;
// Comment markers may sit between the words of a wrapped source header.
const EXHIBIT_B_RE = /Incompatible[\s/#*]+With[\s/#*]+Secondary[\s/#*]+Licen[cs]es/i;
// "(c)" as a list label in licence prose. Case-sensitive on purpose.
const PROSE_LIST_ITEM_RE = /^\([cC]\)\s+(You|under|the|a|an|any|if|to|that|when|where|such|for|in|with|from|by|each|all|no|this|its|it)\b/;
// Section headings of the full MPL-2.0 body. A source header may copy the
// Exhibit B heading verbatim, but never the licence's numbered sections.
const MPL_BODY_MARKERS = [
    /\b1\.\s+Definitions\b/i,
    /\b2\.\s+License\s+Grants\s+and\s+Conditions\b/i,
    /\b3\.\s+Responsibilities\b/i,
    /Exhibit\s+A\W+Source\s+Code\s+Form\s+License\s+Notice/i,
];


//**************************************************************
// normalizeText
//**************************************************************
/**
 * LF line ends, no trailing spaces, no BOM, no leading/trailing blank lines —
 * so identical licences de-duplicate and the output is the same on every OS.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
    return text
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/^\n+|\n+$/g, '');
}
// normalizeText END *******************************************


//**************************************************************
// listLicenceFiles
//**************************************************************
/**
 * The licence, copyright and notice files at the top of a package directory.
 * @param {string} dir package directory
 * @returns {{name: string, text: string}[]} sorted by name
 */
export function listLicenceFiles(dir) {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && LICENCE_FILE_RE.test(e.name))
        .filter((e) => fs.statSync(path.join(dir, e.name)).size <= MAX_LICENCE_FILE_BYTES)
        .map((e) => ({ name: e.name, text: normalizeText(fs.readFileSync(path.join(dir, e.name), 'utf8')) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
// listLicenceFiles END ****************************************


//**************************************************************
// detectLicences
//**************************************************************
/**
 * Recognises the common licences in a text by phrases that licence contains.
 * A file may hold several (chrono's LICENSE.txt is MIT followed by Apache).
 * Each variant is identified by a phrase it HAS, never only by a phrase it
 * lacks: the MIT variant "(including the next paragraph) shall be included"
 * must not read as MIT-0. Unknown texts give []; callers fall back, never guess.
 * @param {string} text
 * @returns {string[]} SPDX ids, in a fixed order
 */
export function detectLicences(text) {
    const t = text.replace(/\s+/g, ' ');
    const ids = [];
    if (/Permission is hereby granted, free of charge/i.test(t)) {
        if (/subject to the following conditions/i.test(t)) ids.push('MIT');
        else if (/to permit persons to whom the Software is furnished to do so\. THE SOFTWARE IS PROVIDED/i.test(t)) ids.push('MIT-0');
    }
    if (/Redistribution and use in source and binary forms/i.test(t)) {
        // The non-endorsement clause is what BSD-3 adds to BSD-2, in every
        // wording ("Neither the name ... may be used", "The name X may not be
        // used"); the advertising clause is what BSD-4 adds on top.
        if (/All advertising materials mentioning/i.test(t)) ids.push('BSD-4-Clause');
        else ids.push(/to endorse or promote products/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause');
    }
    if (/Permission to use, copy, modify, and\/?or distribute this software for any purpose/i.test(t)) {
        if (/above copyright notice and this permission notice appear in all copies/i.test(t)) ids.push('ISC');
        else if (/for any purpose with or without fee is hereby granted\. THE SOFTWARE IS PROVIDED/i.test(t)) ids.push('0BSD');
    }
    if (/This software is provided ['‘]as-is['’], without any express or implied/i.test(t)) ids.push('Zlib');
    if (/UNICODE LICENSE V3/i.test(t)) ids.push('Unicode-3.0');
    if (/UNICODE, INC\. LICENSE AGREEMENT/i.test(t)) ids.push('Unicode-DFS-2016');
    if (/Apache License,? Version 2\.0/i.test(t) && /TERMS AND CONDITIONS FOR USE/i.test(t)) ids.push('Apache-2.0');
    if (/Mozilla Public License,? (Version|v\.?) ?2\.0/i.test(t)) ids.push('MPL-2.0');
    if (/Boost Software License/i.test(t)) ids.push('BSL-1.0');
    if (/This is free and unencumbered software released into the public domain/i.test(t)) ids.push('Unlicense');
    if (/Creative Commons (Legal Code )?CC0|CC0 1\.0 Universal/i.test(t)) ids.push('CC0-1.0');
    return ids;
}
// detectLicences END ******************************************


//**************************************************************
// shippedLicenceIds
//**************************************************************
/** Every licence id some file of the package contains. */
export function shippedLicenceIds(files) {
    return new Set(files.flatMap((f) => detectLicences(f.text)));
}
// shippedLicenceIds END ***************************************


//**************************************************************
// extractCopyrights
//**************************************************************
/**
 * Copyright lines from licence texts, skipping template placeholders
 * ("Copyright [yyyy] [name of copyright owner]") and prose that merely
 * mentions copyright.
 * @param {string[]} texts
 * @returns {string[]} unique lines in first-seen order
 */
export function extractCopyrights(texts) {
    const lines = [];
    for (const text of texts) {
        for (const raw of text.split('\n')) {
            const line = raw.trim().replace(/\s+/g, ' ');
            // "Copyrights in the X project are retained by their contributors."
            if (/^copyrights in .+ retained by/i.test(line)) {
                lines.push(line);
                continue;
            }
            // Case-sensitive: a lower-case "copyright ..." line continues a
            // sentence of licence prose from the line above.
            if (!/^((Portions )?Copyright\b|COPYRIGHT\b|©)/.test(line)) {
                // "(c)" also labels list items in licence prose: Apache
                // "(c) You must retain ...", MPL "(c) under Patent Claims ...".
                // Those open with "You" or a lower-case function word; a holder
                // ("(c) 2001 X", "(C) zune-image developers", "(c) Google LLC",
                // also "(c)2024 X" without the space) does not. Without the
                // space only a year may follow: "(c)." / "(c):" / "(c)You" are
                // list items. Judged per line, so a combined file keeps its
                // holders.
                if (!/^\([cC]\)(\s+\S|\d)/.test(line) || PROSE_LIST_ITEM_RE.test(line)) continue;
            }
            if (line.length > 200 || /[<[{](yyyy|year|owner|name|copyright holder)/i.test(line)) continue;
            // Prose about copyright — but "Copyright holder: <name>" /
            // "Copyright owner: <name>" names one (the ":" exempts only those two).
            if (/^copyright (notice|law|license|and|of|to|in|for|statement|\(c\) <|holders?(?!\s*:)|owners?(?!\s*:))/i.test(line)) continue;
            if (!/[\p{L}\d]/u.test(line.replace(/^(copyright|\(c\)|©)/gi, ''))) continue;
            lines.push(line);
        }
    }
    return [...new Set(lines)];
}
// extractCopyrights END ***************************************


//**************************************************************
// authorName
//**************************************************************
/**
 * The name part of a package-metadata author ("Jane Doe <jane@example.org>"
 * → "Jane Doe"): the e-mail address never reaches the notices. Drops every
 * "<…>" block, then anything from a "<" left unclosed, then a stray ">" --
 * so no address and no angle bracket survives malformed or nested input
 * (an earlier one-pass fix removed only the brackets and kept the address).
 * @param {string} author
 * @returns {string}
 */
export function authorName(author) {
    return String(author)
        .replace(/<[^<>]*>/g, '')
        .replace(/<.*$/s, '')
        .replace(/>/g, '')
        .trim();
}
// authorName END **********************************************


//**************************************************************
// fallbackCopyright
//**************************************************************
/**
 * A copyright line built from package metadata, for packages whose files
 * name no holder. Says where it came from rather than inventing a year.
 * @param {{authors: string[], name: string}} component
 * @returns {string}
 */
export function fallbackCopyright(component) {
    const names = (component.authors ?? []).map(authorName).filter(Boolean);
    return names.length
        ? `Copyright (c) ${names.join(', ')} (authors as declared in the package metadata)`
        : `Copyright (c) the authors of ${component.name} (no holder named in the package)`;
}
// fallbackCopyright END ***************************************


//**************************************************************
// stripTemplateCopyright
//**************************************************************
/**
 * Removes every copyright line from a standard licence template. The SPDX
 * templates carry placeholders in several spellings ("<year> <owner>",
 * "YEAR by AUTHOR EMAIL") and, for ISC, the example holder ISC itself; the
 * component's real holders are listed in its own section instead.
 * @param {string} template
 * @returns {string}
 */
export function stripTemplateCopyright(template) {
    return normalizeText(template.split('\n').filter((l) => !/^\s*(copyright\b|©)/i.test(l)).join('\n'));
}
// stripTemplateCopyright END **********************************


//**************************************************************
// selectTexts
//**************************************************************
/**
 * Decides the texts to reproduce for a component.
 *
 * @param {string[]} chosenIds licence ids in use (from the policy evaluation)
 * @param {{name: string, text: string}[]} files from listLicenceFiles
 * @returns {{texts: {id: string, source: 'package'|'standard'|'template', file?: string, text?: string}[], notices: {name: string, text: string}[], copyrights: string[]}}
 *   source 'package' = the component's own file; 'standard' = foss/licenses
 *   text once in the appendix; 'template' = standard per-copy text, no file shipped.
 */
export function selectTexts(chosenIds, files) {
    const detected = files.map((f) => ({ ...f, ids: detectLicences(f.text) }));
    const notices = files.filter((f) => NOTICE_FILE_RE.test(f.name));
    const texts = [];
    const used = new Set();
    for (const id of [...new Set(chosenIds)]) {
        if (!PER_COPY.has(id)) {
            texts.push({ id, source: 'standard' });
            continue;
        }
        // Prefer a file holding only this licence over a combined one.
        const holding = detected.filter((f) => f.ids.includes(id) && !used.has(f.name));
        let own = holding.find((f) => f.ids.length === 1) ?? holding[0];
        // One unrecognised licence file and a single licence in use: a reworded
        // variant of that licence, so it is the component's own text.
        if (!own && chosenIds.length === 1) {
            const candidates = detected.filter((f) => !NOTICE_FILE_RE.test(f.name) && f.ids.length === 0);
            if (candidates.length === 1 && detected.every((f) => f.ids.length === 0 || f.ids.includes(id))) own = candidates[0];
        }
        if (own) {
            used.add(own.name);
            texts.push({ id, source: 'package', file: own.name, text: own.text });
        } else {
            texts.push({ id, source: 'template' });
        }
    }
    const copyrights = extractCopyrights([...texts.filter((t) => t.text).map((t) => t.text), ...files.map((f) => f.text)]);
    return { texts, notices, copyrights };
}
// selectTexts END *********************************************


//**************************************************************
// findExhibitB
//**************************************************************
/**
 * MPL-2.0 Exhibit B ("Incompatible With Secondary Licenses") forbids
 * combining the file with GPL-family code — which includes Lattice's AGPL.
 * Scans a package's text files for the notice.
 * @param {string} dir package directory
 * @param {number} maxFiles safety bound on the walk
 * @returns {string[]} package-relative paths carrying the notice
 */
export function findExhibitB(dir, maxFiles = 20000) {
    const hits = [];
    const stack = [dir];
    let count = 0;
    while (stack.length && count < maxFiles) {
        const current = stack.pop();
        for (const e of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, e.name);
            if (e.isDirectory()) {
                if (e.name !== 'node_modules' && e.name !== '.git' && e.name !== 'target') stack.push(full);
            } else if (e.isFile() && /\.(rs|js|mjs|cjs|ts|toml|md|txt|json)$/i.test(e.name)) {
                count++;
                if (fs.statSync(full).size > 4 * 1024 * 1024) continue;
                const text = fs.readFileSync(full, 'utf8');
                // The full MPL text quotes the Exhibit B sentence; a source
                // header carrying the notice also names the MPL and may copy
                // the Exhibit B heading. Only the licence body has its
                // numbered sections (3 of 4 markers: tolerant of reflowing).
                const isMplBody = MPL_BODY_MARKERS.filter((re) => re.test(text)).length >= 3;
                if (EXHIBIT_B_RE.test(text) && !isMplBody) {
                    hits.push(path.relative(dir, full).split(path.sep).join('/'));
                }
            }
        }
    }
    return hits.sort();
}
// findExhibitB END ********************************************
