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

// CSTR-LTTCE-BLD-00001 — no E2E test code in a production frontend bundle.
//
// The E2E drivers reach the app only through `StaticRuntime.dev.ts`, which
// `vite.config.ts` swaps for the empty `StaticRuntime.prod.ts` in production
// builds. That holds by construction; this guard makes it *checked*: every
// production build fails if a test module, or an E2E protocol name, is in the
// output anyway (a driver imported directly from product code, a protocol
// string copied into it, the alias broken).

import type { Plugin } from 'vite';

/** Modules that must never be bundled into a production build. */
export const RELEASE_FORBIDDEN_MODULE =
    /[\\/]src[\\/]services[\\/]StaticRuntime[\\/](StaticRuntime\.dev|[A-Za-z]+E2EDriver)\.ts$/;

/**
 * Names of the E2E file protocol (`e2e_startup_ok.txt`, `e2e_copy_diagram/`,
 * …). Product code has no reason to contain one; a test driver always does.
 */
export const RELEASE_FORBIDDEN_TEXT = /\be2e_[a-z][a-z_]*/;

/** The part of a Rollup output chunk the guard reads. */
export interface ChunkLike {
    fileName: string;
    moduleIds?: readonly string[];
    code?: string;
}


//******************************************************************************
// findTestCode
//******************************************************************************
/**
 * Every trace of E2E test code in the output `chunks`, one message each;
 * empty when the bundle is clean.
 */
export function findTestCode(chunks: readonly ChunkLike[]): string[] {
    const found: string[] = [];
    for (const chunk of chunks) {
        for (const id of chunk.moduleIds ?? []) {
            if (RELEASE_FORBIDDEN_MODULE.test(id)) found.push(`${chunk.fileName}: bundles test module ${id}`);
        }
        const text = chunk.code?.match(RELEASE_FORBIDDEN_TEXT);
        if (text) found.push(`${chunk.fileName}: contains the E2E protocol name "${text[0]}"`);
    }
    return found;
}
// findTestCode END ************************************************************


//******************************************************************************
// releaseGuard
//******************************************************************************
/**
 * Vite plugin failing the build when `findTestCode` finds anything. Added by
 * `vite.config.ts` to production builds only — not to the E2E build, whose
 * whole point is to contain the drivers.
 */
export function releaseGuard(): Plugin {
    return {
        name: 'lattice-release-guard',
        apply: 'build',
        generateBundle(_options, bundle) {
            const chunks = Object.values(bundle).filter((o): o is typeof o & ChunkLike => o.type === 'chunk');
            const found = findTestCode(chunks);
            if (found.length > 0) {
                this.error(`E2E test code in a production build (CSTR-LTTCE-BLD-00001):\n  ${found.join('\n  ')}`);
            }
        },
    };
}
// releaseGuard END ************************************************************
