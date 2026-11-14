// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

// UTST for CSTR-LTTCE-BLD-00001 — the release guard (vite-release-guard.ts).

import { describe, it, expect, vi } from 'vitest';
import { findTestCode, releaseGuard, type ChunkLike } from './vite-release-guard';

const SRC = '/repo/src/services/StaticRuntime/';

describe('findTestCode', () => {
    it('passes a clean bundle', () => {
        const chunks: ChunkLike[] = [{
            fileName: 'assets/index.js',
            moduleIds: ['/repo/src/main.tsx', `${SRC}StaticRuntime.prod.ts`, '/repo/src/App.tsx'],
            code: 'const a = "Copy image"; // e2e mentioned in prose, E2E too',
        }];
        expect(findTestCode(chunks)).toEqual([]);
    });

    it('finds the dev runtime and every E2E driver, with POSIX or Windows paths', () => {
        const found = findTestCode([{
            fileName: 'assets/index.js',
            moduleIds: [
                `${SRC}StaticRuntime.dev.ts`,
                `${SRC}CopyDiagramE2EDriver.ts`,
                'C:\\repo\\src\\services\\StaticRuntime\\DailyNoteE2EDriver.ts',
            ],
        }]);
        expect(found).toHaveLength(3);
        expect(found[0]).toContain('StaticRuntime.dev.ts');
    });

    it('ignores the drivers\' unit tests and look-alike names elsewhere', () => {
        expect(findTestCode([{
            fileName: 'assets/index.js',
            moduleIds: [`${SRC}CopyDiagramE2EDriver.test.ts`, '/repo/src/lib/StaticRuntime.dev.ts'],
        }])).toEqual([]);
    });

    it('finds an E2E protocol name copied into product code', () => {
        const found = findTestCode([{ fileName: 'assets/x.js', code: 'invoke("write_text_file",{path:"e2e_startup_ok.txt"})' }]);
        expect(found).toEqual(['assets/x.js: contains the E2E protocol name "e2e_startup_ok"']);
    });

    it('does not take a longer identifier for a protocol name', () => {
        expect(findTestCode([{ fileName: 'a.js', code: 'const isNode_e2e_x = 1; const pre2e_y = 2;' }])).toEqual([]);
    });
});

describe('releaseGuard', () => {
    /** Run the plugin's generateBundle on `bundle`; returns the error it raised, if any. */
    const run = (bundle: Record<string, unknown>): string | null => {
        const plugin = releaseGuard();
        let error: string | null = null;
        const ctx = { error: vi.fn((msg: string) => { error = msg; throw new Error(msg); }) };
        try {
            (plugin.generateBundle as unknown as (this: unknown, o: unknown, b: unknown) => void)
                .call(ctx, {}, bundle);
        } catch { /* the error was recorded */ }
        return error;
    };

    it('applies to builds only', () => {
        expect(releaseGuard().apply).toBe('build');
    });

    it('lets a clean bundle through, assets included', () => {
        expect(run({
            'index.js': { type: 'chunk', fileName: 'index.js', moduleIds: ['/repo/src/App.tsx'], code: 'ok' },
            'font.woff2': { type: 'asset', fileName: 'font.woff2', source: 'e2e_binary_noise' },
        })).toBeNull();
    });

    it('fails the build and names what it found', () => {
        const error = run({
            'index.js': { type: 'chunk', fileName: 'index.js', moduleIds: [`${SRC}StaticRuntime.dev.ts`], code: '' },
        });
        expect(error).toMatch(/E2E test code in a production build \(CSTR-LTTCE-BLD-00001\)/);
        expect(error).toContain('index.js: bundles test module');
    });
});
