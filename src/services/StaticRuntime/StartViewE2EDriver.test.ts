// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

// Tests of the E2E driver itself (test tooling for the start_view scenario,
// REQ-LTTCE-WIN-00003); it never ships.

import { describe, it, expect, vi } from 'vitest';
import {
    runStartViewE2EDriver, StartViewE2EDeps, StartViewE2ETiming,
    START_VIEW_E2E_MARKER, START_VIEW_E2E_REPORT,
} from './StartViewE2EDriver';

const FAST: StartViewE2ETiming = { pollMs: 1, changeTimeoutMs: 5, settleMs: 3 };

/** Fake surroundings: `views` is what data-view-mode reads, one entry per read (the last repeats). */
const makeDeps = (marker: unknown, views: (string | null)[]) => {
    let reads = 0;
    const written: Record<string, string> = {};
    const deps: StartViewE2EDeps = {
        isDir: vi.fn(async () => marker),
        writeText: vi.fn(async (p: string, c: string) => { written[p] = c; }),
        viewMode: vi.fn(() => views[Math.min(reads++, views.length - 1)]),
        sleep: async () => {},
    };
    return { deps, written };
};

describe('runStartViewE2EDriver', () => {
    it('does nothing without the scenario marker (tauri dev, other scenarios)', async () => {
        const { deps } = makeDeps(false, ['preview']);
        await runStartViewE2EDriver(deps, FAST);
        expect(deps.isDir).toHaveBeenCalledWith(START_VIEW_E2E_MARKER);
        expect(deps.viewMode).not.toHaveBeenCalled();
        expect(deps.writeText).not.toHaveBeenCalled();
    });

    it('treats only a literal true as the marker', async () => {
        const { deps } = makeDeps('yes', ['preview']);
        await runStartViewE2EDriver(deps, FAST);
        expect(deps.writeText).not.toHaveBeenCalled();
    });

    it('waits for the view to leave Edit and reports where it settled', async () => {
        const { deps, written } = makeDeps(true, [null, 'edit', 'edit', 'dual-top']);
        await runStartViewE2EDriver(deps, FAST);
        expect(written[START_VIEW_E2E_REPORT]).toBe('dual-top');
    });

    it('reports a second, later change — the settled view, not the first one', async () => {
        const { deps, written } = makeDeps(true, ['preview', 'edit']);
        await runStartViewE2EDriver(deps, FAST);
        expect(written[START_VIEW_E2E_REPORT]).toBe('edit');
    });

    it('reports edit when the view never leaves it', async () => {
        const { deps, written } = makeDeps(true, ['edit']);
        await runStartViewE2EDriver(deps, FAST);
        expect(written[START_VIEW_E2E_REPORT]).toBe('edit');
    });

    it('reports an error when the App is not mounted', async () => {
        const { deps, written } = makeDeps(true, [null]);
        await runStartViewE2EDriver(deps, FAST);
        expect(written[START_VIEW_E2E_REPORT]).toMatch(/^ERROR/);
    });

    it('never throws', async () => {
        const { deps } = makeDeps(true, ['preview']);
        deps.writeText = vi.fn(async () => { throw new Error('disk full'); });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(runStartViewE2EDriver(deps, FAST)).resolves.toBeUndefined();
        err.mockRestore();
    });
});
