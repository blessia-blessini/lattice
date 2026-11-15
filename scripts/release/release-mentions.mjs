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

/// No GitHub mentions in release notes (release-mentions.mjs)
///
/// CSTR-LTTCE-BLD-00002. GitHub reads `@name` in a release text as a mention:
/// it notifies the account of that name and lists it among the release's
/// contributors. Lattice's release notes are commit titles from CHANGELOG.md,
/// where `@main` is a branch and `@page` a CSS rule — never a person. So every
/// bare `@name` is put in backticks before publishing; code is never a mention,
/// and the text reads the same.
///
/// Left alone: text already in code (inline backticks or a fenced block), an
/// e-mail address (`a@b.org` — a letter or digit before the `@`), and a URL
/// path (`/@user`).
///
/// CLI (step 900.5 of buildAndTest.yml):
///     node scripts/release/release-mentions.mjs <file.md>
/// rewrites the file in place and lists what it quoted.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** A bare mention: `@` + a GitHub name, not preceded by a name character, `/`, `.` or `` ` ``. */
const MENTION = /(^|[^A-Za-z0-9_./`-])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?![A-Za-z0-9_-])/g;

/** An inline code span (single backticks), kept as is. */
const CODE_SPAN = /(`[^`\n]*`)/;

/** A line that opens or closes a fenced code block. */
const FENCE = /^\s*(```|~~~)/;


//******************************************************************************
// quoteMentions
//******************************************************************************
/**
 * `markdown` with every bare `@name` outside code put in backticks, and the
 * names quoted, in order (repeats included).
 * @param {string} markdown
 * @returns {{ text: string, quoted: string[] }}
 */
export function quoteMentions(markdown) {
    const quoted = [];
    let inFence = false;
    const lines = markdown.split('\n').map((line) => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;
        return line
            .split(CODE_SPAN)
            .map((part, i) => (i % 2 === 1 ? part : part.replace(MENTION, (_, before, name) => {
                quoted.push(`@${name}`);
                return `${before}\`@${name}\``;
            })))
            .join('');
    });
    return { text: lines.join('\n'), quoted };
}
// quoteMentions END ***********************************************************


//******************************************************************************
// main
//******************************************************************************
/** Rewrite the file named on the command line; exit code 2 on a usage error. */
function main(argv) {
    const file = argv[2];
    if (!file) {
        console.error('usage: node scripts/release/release-mentions.mjs <file.md>');
        return 2;
    }
    const { text, quoted } = quoteMentions(readFileSync(file, 'utf8'));
    writeFileSync(file, text);
    console.log(quoted.length
        ? `release-mentions: put in code so GitHub does not mention them: ${quoted.join(', ')}`
        : 'release-mentions: no @mentions');
    return 0;
}
// main END ********************************************************************

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exitCode = main(process.argv);
}
