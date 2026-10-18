// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE
import { describe, it, expect, vi } from 'vitest';
import {
    runDailyNoteE2EDriver,
    DailyNoteE2EDeps,
    DailyNoteE2ETiming,
    DAILY_NOTE_E2E_MARKER,
    dailyNoteE2EClickSignal,
    dailyNoteE2EDoneFile,
} from './DailyNoteE2EDriver';

const FAST: DailyNoteE2ETiming = { pollMs: 1, signalTimeoutMs: 10, settleMs: 3, firstClickAttempts: 3 };

/**
 * Fake surroundings: `dirs` are the signal directories present, `onClick`
 * decides what a click does to the window title.
 */
const makeDeps = (dirs: string[], onClick: (clicks: number) => string | undefined) => {
    let title = 'start.md - Lattice';
    let clicks = 0;
    const written: Record<string, string> = {};
    const deps: DailyNoteE2EDeps = {
        isDir: vi.fn(async (p: string) => dirs.includes(p)),
        writeText: vi.fn(async (p: string, c: string) => { written[p] = c; }),
        clickButton: vi.fn(() => {
            clicks++;
            const next = onClick(clicks);
            if (next !== undefined) title = next;
            return true;
        }),
        title: () => title,
        sleep: async () => {},
    };
    return { deps, written, clicks: () => clicks };
};

const ALL_SIGNALS = [DAILY_NOTE_E2E_MARKER, dailyNoteE2EClickSignal(1), dailyNoteE2EClickSignal(2)];

describe('runDailyNoteE2EDriver', () => {
    it('does nothing without the scenario marker (tauri dev, other scenarios)', async () => {
        const { deps } = makeDeps([], () => 'x');
        await runDailyNoteE2EDriver(deps, FAST);
        expect(deps.isDir).toHaveBeenCalledTimes(1);
        expect(deps.isDir).toHaveBeenCalledWith(DAILY_NOTE_E2E_MARKER);
        expect(deps.clickButton).not.toHaveBeenCalled();
        expect(deps.writeText).not.toHaveBeenCalled();
    });

    it('treats only a literal true as a signal', async () => {
        const { deps } = makeDeps([], () => 'x');
        deps.isDir = vi.fn(async () => 'yes');
        await runDailyNoteE2EDriver(deps, FAST);
        expect(deps.clickButton).not.toHaveBeenCalled();
    });

    it('clicks once per signal and reports the title after each click', async () => {
        const { deps, written, clicks } = makeDeps(ALL_SIGNALS, (n) =>
            n === 1 ? 'DLN-2026-10-18-Sun.md - Lattice' : undefined);
        await runDailyNoteE2EDriver(deps, FAST);
        expect(clicks()).toBe(2);
        expect(written[dailyNoteE2EDoneFile(1)]).toBe('clicks=1\nDLN-2026-10-18-Sun.md - Lattice');
        expect(written[dailyNoteE2EDoneFile(2)]).toBe('clicks=1\nDLN-2026-10-18-Sun.md - Lattice');
    });

    it('retries the first click while the title does not change, and records the count', async () => {
        // The first click is lost (settings still loading); the second opens the note.
        const { deps, written } = makeDeps(ALL_SIGNALS, (n) =>
            n === 2 ? 'DLN-2026-10-18-Sun.md - Lattice' : undefined);
        await runDailyNoteE2EDriver(deps, FAST);
        expect(written[dailyNoteE2EDoneFile(1)]).toBe('clicks=2\nDLN-2026-10-18-Sun.md - Lattice');
    });

    it('gives up after the allowed attempts and reports the unchanged title', async () => {
        const { deps, written } = makeDeps(ALL_SIGNALS, () => undefined);
        await runDailyNoteE2EDriver(deps, FAST);
        expect(written[dailyNoteE2EDoneFile(1)]).toBe('clicks=3\nstart.md - Lattice');
    });

    it('never clicks twice for the second signal, even if the title stays the same', async () => {
        const { deps, clicks } = makeDeps(ALL_SIGNALS, (n) => (n === 1 ? 'note.md' : undefined));
        await runDailyNoteE2EDriver(deps, FAST);
        expect(clicks()).toBe(2);
    });

    it('waits for the harness before clicking, and stops if a signal never comes', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { deps, written } = makeDeps(
            [DAILY_NOTE_E2E_MARKER, dailyNoteE2EClickSignal(1)], () => 'note.md');
        await runDailyNoteE2EDriver(deps, FAST);
        expect(deps.clickButton).toHaveBeenCalledTimes(1);
        expect(written[dailyNoteE2EDoneFile(1)]).toBeDefined();
        expect(written[dailyNoteE2EDoneFile(2)]).toBeUndefined();
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('no click 2 signal'));
        errSpy.mockRestore();
    });

    it('reports a missing button instead of hanging', async () => {
        const { deps, written } = makeDeps(ALL_SIGNALS, () => 'x');
        deps.clickButton = vi.fn(() => false);
        await runDailyNoteE2EDriver(deps, FAST);
        expect(written[dailyNoteE2EDoneFile(1)]).toBe('ERROR: daily-note button not found');
        expect(written[dailyNoteE2EDoneFile(2)]).toBeUndefined();
    });

    it('never throws when the backend rejects', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { deps } = makeDeps(ALL_SIGNALS, () => 'x');
        deps.isDir = vi.fn(async () => { throw new Error('ipc down'); });
        await expect(runDailyNoteE2EDriver(deps, FAST)).resolves.toBeUndefined();
        expect(errSpy).toHaveBeenCalledWith('[TEST] daily note driver failed:', expect.any(Error));
        errSpy.mockRestore();
    });
});

describe('runDailyNoteE2EDriver — default surroundings', () => {
    it('clicks the real toolbar button found by its test id', async () => {
        const button = document.createElement('button');
        button.dataset.testid = 'daily-note-button';
        const onClick = vi.fn(() => { document.title = 'note.md - Lattice'; });
        button.addEventListener('click', onClick);
        document.body.appendChild(button);
        document.title = 'start.md - Lattice';

        const core = await import('@tauri-apps/api/core');
        const original = vi.mocked(core.invoke).getMockImplementation();
        vi.mocked(core.invoke).mockImplementation(async (cmd: string) => cmd === 'is_dir');

        await runDailyNoteE2EDriver(undefined, FAST);

        expect(onClick).toHaveBeenCalledTimes(2);
        expect(core.invoke).toHaveBeenCalledWith('write_text_file', {
            path: dailyNoteE2EDoneFile(1),
            content: 'clicks=1\nnote.md - Lattice',
        });
        button.remove();
        vi.mocked(core.invoke).mockImplementation(original!);
    });
});
