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
//**************************************************************
// DailyNoteE2EDriver
//**************************************************************
/**
 * Frontend half of the `daily_note_*` scenarios in
 * `src-tauri/examples/e2e_harness.rs` (STST for Chapter DLN): clicks the real
 * 🗒 toolbar button in the real WebView when the harness says so, and reports
 * the window title afterwards. The harness checks the note on disk.
 *
 * Imported only by `StaticRuntime.dev.ts`. Release bundles resolve
 * `@services/StaticRuntime` to `StaticRuntime.prod.ts` (vite.config.ts), so
 * this module never ships.
 *
 * Protocol — names are relative to the app's working directory (the repo
 * root under the harness). Documented pairing with `e2e_harness.rs`, which
 * cannot import these constants:
 *
 * | Name                              | Direction     | Meaning                                  |
 * | --------------------------------- | ------------- | ---------------------------------------- |
 * | `e2e_daily_note/`                 | harness → app | scenario active; checked once at startup |
 * | `e2e_daily_note_click_<n>/`       | harness → app | click the button now (n = 1, 2)          |
 * | `e2e_daily_note_click_<n>_done.txt` | app → harness | clicked; content = window title after    |
 *
 * Signals are directories so the app can poll them with the side-effect-free
 * `is_dir` command; reading a file would register it with the file tracker.
 */
import { invoke } from "@tauri-apps/api/core";

export const DAILY_NOTE_E2E_MARKER = 'e2e_daily_note';
export const dailyNoteE2EClickSignal = (n: number) => `e2e_daily_note_click_${n}`;
export const dailyNoteE2EDoneFile = (n: number) => `e2e_daily_note_click_${n}_done.txt`;

/** What the driver needs from its surroundings; replaced by fakes in tests. */
export interface DailyNoteE2EDeps {
    isDir: (path: string) => Promise<unknown>;
    writeText: (path: string, content: string) => Promise<void>;
    /** Click the 🗒 button; `false` when it is not in the DOM. */
    clickButton: () => boolean;
    title: () => string;
    sleep: (ms: number) => Promise<void>;
}

export interface DailyNoteE2ETiming {
    pollMs: number;
    /** How long to wait for each harness click signal. */
    signalTimeoutMs: number;
    /** How long one click may take to change the window title. */
    settleMs: number;
    /** Clicks allowed for the first open (settings may still be loading). */
    firstClickAttempts: number;
}

export const DAILY_NOTE_E2E_TIMING: DailyNoteE2ETiming = {
    pollMs: 250,
    signalTimeoutMs: 30_000,
    settleMs: 2_000,
    firstClickAttempts: 5,
};

const defaultDeps: DailyNoteE2EDeps = {
    isDir: (path) => invoke('is_dir', { path }),
    writeText: async (path, content) => { await invoke('write_text_file', { path, content }); },
    clickButton: () => {
        const button = document.querySelector<HTMLButtonElement>('[data-testid="daily-note-button"]');
        if (!button) return false;
        button.click();
        return true;
    },
    title: () => document.title,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};


//**************************************************************
// waitUntil
//**************************************************************
/** Poll `condition` every `pollMs` until it holds or `timeoutMs` has passed. */
const waitUntil = async (
    condition: () => Promise<boolean> | boolean,
    timeoutMs: number,
    pollMs: number,
    sleep: (ms: number) => Promise<void>,
): Promise<boolean> => {
    const polls = Math.max(1, Math.ceil(timeoutMs / pollMs));
    for (let i = 0; i < polls; i++) {
        if (await condition()) return true;
        await sleep(pollMs);
    }
    return condition();
};
// waitUntil END ***********************************************


//**************************************************************
// runDailyNoteE2EDriver
//**************************************************************
/**
 * Does nothing unless the harness created `e2e_daily_note/` before launch —
 * so `tauri dev` and every other scenario pay one `is_dir` call and no more.
 *
 * Click 1 is repeated (up to `firstClickAttempts`) until the window title
 * changes: if the vault settings have not finished loading, the handler
 * returns early by design and the click is lost to timing, not to a defect.
 * The done file records the attempt count so a regression to "the first
 * click is ignored" stays visible in the harness log. Click 2 is exactly one
 * click; the title must not change, so the driver just lets it settle.
 * Never throws — a failure is reported through the done file or the log.
 */
export const runDailyNoteE2EDriver = async (
    deps: DailyNoteE2EDeps = defaultDeps,
    timing: DailyNoteE2ETiming = DAILY_NOTE_E2E_TIMING,
): Promise<void> => {
    const isSignal = async (path: string) => (await deps.isDir(path)) === true;
    try {
        if (!(await isSignal(DAILY_NOTE_E2E_MARKER))) return;
        console.log("[TEST] daily note scenario active");

        for (const n of [1, 2]) {
            const signalled = await waitUntil(
                () => isSignal(dailyNoteE2EClickSignal(n)),
                timing.signalTimeoutMs, timing.pollMs, deps.sleep);
            if (!signalled) {
                console.error(`[TEST] daily note: no click ${n} signal from the harness`);
                return;
            }

            const before = deps.title();
            const attempts = n === 1 ? timing.firstClickAttempts : 1;
            let used = 0;
            let changed = false;
            while (used < attempts && !changed) {
                if (!deps.clickButton()) {
                    await deps.writeText(dailyNoteE2EDoneFile(n), 'ERROR: daily-note button not found');
                    return;
                }
                used++;
                changed = await waitUntil(
                    () => deps.title() !== before, timing.settleMs, timing.pollMs, deps.sleep);
            }
            await deps.writeText(dailyNoteE2EDoneFile(n), `clicks=${used}\n${deps.title()}`);
        }
    } catch (e) {
        console.error("[TEST] daily note driver failed:", e);
    }
};
// runDailyNoteE2EDriver END ***********************************
