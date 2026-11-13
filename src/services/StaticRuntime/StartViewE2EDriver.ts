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
// StartViewE2EDriver
//**************************************************************
/**
 * Frontend half of the `start_view` scenario in
 * `src-tauri/examples/e2e_harness.rs` (STST for REQ-LTTCE-WIN-00003): reports
 * the view the real window started in, read from the `data-view-mode`
 * attribute the real App renders.
 *
 * Imported only by `StaticRuntime.dev.ts`. Release bundles resolve
 * `@services/StaticRuntime` to `StaticRuntime.prod.ts` (vite.config.ts), so
 * this module never ships.
 *
 * Protocol — names are relative to the app's working directory (the repo
 * root under the harness). Documented pairing with `e2e_harness.rs`, which
 * cannot import these constants:
 *
 * | Name                  | Direction     | Meaning                                   |
 * | --------------------- | ------------- | ----------------------------------------- |
 * | `e2e_start_view/`     | harness → app | scenario active; checked once at startup  |
 * | `e2e_start_view.txt`  | app → harness | the view mode the window settled in       |
 *
 * Every window starts in Edit and the settings arrive a moment later, so the
 * driver waits for the view to leave Edit, lets it settle (a second, wrong
 * change would show), then reports. A view that never leaves Edit is reported
 * as `edit` after the timeout — the harness only expects other views.
 */
import { invoke } from "@tauri-apps/api/core";
import { VIEW_EDIT } from "../../lib/view-mode";

export const START_VIEW_E2E_MARKER = 'e2e_start_view';
export const START_VIEW_E2E_REPORT = 'e2e_start_view.txt';

/** What the driver needs from its surroundings; replaced by fakes in tests. */
export interface StartViewE2EDeps {
    isDir: (path: string) => Promise<unknown>;
    writeText: (path: string, content: string) => Promise<void>;
    /** The window's `data-view-mode`, or null when the App is not mounted. */
    viewMode: () => string | null;
    sleep: (ms: number) => Promise<void>;
}

export interface StartViewE2ETiming {
    pollMs: number;
    /** How long the view may take to leave Edit. */
    changeTimeoutMs: number;
    /** How long to keep watching after it changed. */
    settleMs: number;
}

export const START_VIEW_E2E_TIMING: StartViewE2ETiming = {
    pollMs: 100,
    changeTimeoutMs: 15_000,
    settleMs: 1_500,
};

const defaultDeps: StartViewE2EDeps = {
    isDir: (path) => invoke('is_dir', { path }),
    writeText: async (path, content) => { await invoke('write_text_file', { path, content }); },
    viewMode: () => document.querySelector('.main-content')?.getAttribute('data-view-mode') ?? null,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};


//**************************************************************
// runStartViewE2EDriver
//**************************************************************
/**
 * Does nothing unless the harness created `e2e_start_view/` before launch —
 * so `tauri dev` and every other scenario pay one `is_dir` call and no more.
 * Never throws — a failure is reported through the report file or the log.
 */
export const runStartViewE2EDriver = async (
    deps: StartViewE2EDeps = defaultDeps,
    timing: StartViewE2ETiming = START_VIEW_E2E_TIMING,
): Promise<void> => {
    try {
        if ((await deps.isDir(START_VIEW_E2E_MARKER)) !== true) return;
        console.log("[TEST] start view scenario active");

        const polls = Math.max(1, Math.ceil(timing.changeTimeoutMs / timing.pollMs));
        for (let i = 0; i < polls; i++) {
            const mode = deps.viewMode();
            if (mode !== null && mode !== VIEW_EDIT) break;
            await deps.sleep(timing.pollMs);
        }
        await deps.sleep(timing.settleMs);
        await deps.writeText(START_VIEW_E2E_REPORT, deps.viewMode() ?? 'ERROR: the App is not mounted');
    } catch (e) {
        console.error("[TEST] start view driver failed:", e);
    }
};
// runStartViewE2EDriver END ***********************************
