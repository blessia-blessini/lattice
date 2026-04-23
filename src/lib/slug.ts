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

/**
 * Heading slug helpers — TS mirror of `src-tauri/src/toc.rs`.
 *
 * The Rust backend is the source of truth for TOC link targets
 * (`[Heading](#heading)`). For those links to actually jump in the rendered
 * preview, the rehype pipeline must assign matching `id` attributes to each
 * heading element. `react-markdown` does NOT do this on its own, and
 * `rehype-slug` uses `github-slugger` whose algorithm differs from ours on
 * non-ASCII input. So we maintain a small TS reimplementation here.
 *
 *   ⚠ KEEP IN LOCKSTEP WITH `src-tauri/src/toc.rs` (`slugify`,
 *   `disambiguate_slug`). If you change one, change the other and update
 *   both the Rust tests and `slug.test.ts`. The `Unicode café -> "unicode-caf"`
 *   case is intentional — it pins down the ASCII-only behavior so a future
 *   contributor can't silently switch to a Unicode-aware regex without
 *   noticing the link/anchor mismatch that would result.
 */

/**
 * GitHub-style anchor slug.
 *
 * Behavior (must match Rust `slugify`):
 *   - Lowercase
 *   - Keep `[a-z0-9_]`
 *   - Treat `-` and any whitespace char as a separator → single `-`,
 *     never two in a row, and never leading
 *   - Drop everything else (including non-ASCII letters)
 *   - Trim a trailing `-`
 */
export function slugify(text: string): string {
    let out = '';
    let prevHyphen = false;

    for (const ch of text) {
        // ASCII letters / digits — preserved (lowercased).
        if (/^[A-Za-z0-9]$/.test(ch)) {
            out += ch.toLowerCase();
            prevHyphen = false;
            continue;
        }
        if (ch === '_') {
            out += ch;
            prevHyphen = false;
            continue;
        }
        // Hyphen or any whitespace → single hyphen, no doubles, no leading.
        if ((ch === '-' || /\s/.test(ch)) && !prevHyphen && out.length > 0) {
            out += '-';
            prevHyphen = true;
            continue;
        }
        // everything else (including non-ASCII letters) is dropped
    }

    // Drop trailing hyphen (mirrors Rust `if out.ends_with('-') { out.pop(); }`).
    if (out.endsWith('-')) {
        out = out.slice(0, -1);
    }
    return out;
}

/**
 * Suffix duplicate slugs with `-1`, `-2`, ... in order of appearance.
 * Mirrors the Rust `disambiguate_slug` semantics: the FIRST occurrence
 * keeps the bare slug, subsequent ones get `-N` where N is the count of
 * prior occurrences.
 *
 * `seen` is mutated — pass a fresh `Map` per document.
 */
export function disambiguateSlug(base: string, seen: Map<string, number>): string {
    const count = seen.get(base) ?? 0;
    const slug = count === 0 ? base : `${base}-${count}`;
    seen.set(base, count + 1);
    return slug;
}
