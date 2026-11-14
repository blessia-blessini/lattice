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
// CopyDiagramE2EDriver
//**************************************************************
/**
 * Frontend half of the `copy_diagram` scenario in
 * `src-tauri/examples/e2e_harness.rs` (STST for REQ-LTTCE-PRV-00004 / 00006 /
 * 00007). The harness clicks a Mermaid diagram's copy buttons with the real
 * mouse and reads the system clipboard back; this driver tells it where the
 * buttons are and what each click reported.
 *
 * The click has to come from the operating system: a scripted `click()` is
 * no user gesture, and the WebView then refuses the copy or never settles
 * it — tried first, and the first button simply stayed idle.
 *
 * Imported only by `StaticRuntime.dev.ts`. Release bundles resolve
 * `@services/StaticRuntime` to `StaticRuntime.prod.ts` (vite.config.ts), so
 * this module never ships.
 *
 * Protocol — names are relative to the app's working directory (the repo
 * root under the harness). Documented pairing with `e2e_harness.rs`, which
 * cannot import these constants:
 *
 * | Name                                  | Direction     | Meaning                                         |
 * | ------------------------------------- | ------------- | ----------------------------------------------- |
 * | `e2e_copy_diagram/`                   | harness → app | scenario active; checked once at startup        |
 * | `e2e_copy_diagram_targets.txt`        | app → harness | line n: `x,y` of button n's centre in physical client pixels (1 code, 2 SVG, 3 image) |
 * | `e2e_copy_diagram_click_<n>/`         | harness → app | button n has been clicked                       |
 * | `e2e_copy_diagram_click_<n>_done.txt` | app → harness | `state=<copied/failed/idle>`; `pointer=…` (where the last click landed — diagnostics); for the image also `png=<w>x<h>` |
 *
 * The targets are written only once the diagram's PNG exists: "Copy PNG image"
 * fails by design until then (REQ-LTTCE-PRV-00007).
 */
import { invoke } from "@tauri-apps/api/core";
import { COPY_IMAGE_LABEL, COPY_KIND_ATTR, COPY_MERMAID_CODE_LABEL, COPY_SVG_LABEL } from "../../components/CodeBlock";
import { DIAGRAM_PNG_ATTR } from "../../lib/preview-copy";

export const COPY_DIAGRAM_E2E_MARKER = 'e2e_copy_diagram';
export const COPY_DIAGRAM_E2E_TARGETS = 'e2e_copy_diagram_targets.txt';
export const copyDiagramE2EClickSignal = (n: number) => `e2e_copy_diagram_click_${n}`;
export const copyDiagramE2EDoneFile = (n: number) => `e2e_copy_diagram_click_${n}_done.txt`;

/** The buttons, in click order: signal n is about `COPY_DIAGRAM_E2E_BUTTONS[n - 1]`. */
export const COPY_DIAGRAM_E2E_BUTTONS = [COPY_MERMAID_CODE_LABEL, COPY_SVG_LABEL, COPY_IMAGE_LABEL] as const;

/** A button's centre in physical pixels of the window's client area. */
export interface ClientPoint { x: number; y: number }

/** What the driver needs from its surroundings; replaced by fakes in tests. */
export interface CopyDiagramE2EDeps {
    isDir: (path: string) => Promise<unknown>;
    writeText: (path: string, content: string) => Promise<void>;
    /** The cached PNG data URI of the first diagram, or null while it has none. */
    diagramPng: () => string | null;
    /** Where the diagram's button labelled `label` is, or null when it is not in view. */
    buttonCentre: (label: string) => ClientPoint | null;
    /** Start recording clicks and button states (`lastPointer`, `buttonState`). */
    watch: () => void;
    /**
     * The outcome that button showed: the last non-idle `data-state`
     * (`copied | failed`) recorded since `watch`, else its current state, or
     * null without the button. Recorded, not sampled: the outcome shows for
     * only `COPY_FEEDBACK_MS`, and the harness's signal can arrive later.
     */
    buttonState: (label: string) => string | null;
    /** The last click the page saw since `watch` — diagnostics for a click that missed. */
    lastPointer: () => string;
    sleep: (ms: number) => Promise<void>;
}

export interface CopyDiagramE2ETiming {
    pollMs: number;
    /** How long to wait for each harness signal. */
    signalTimeoutMs: number;
    /** How long the diagram may take to render and rasterise. */
    pngTimeoutMs: number;
    /** How long a click may take to show its outcome. */
    outcomeTimeoutMs: number;
}

export const COPY_DIAGRAM_E2E_TIMING: CopyDiagramE2ETiming = {
    pollMs: 50,
    signalTimeoutMs: 30_000,
    pngTimeoutMs: 20_000,
    outcomeTimeoutMs: 5_000,
};

/** `data-copy` kind of each button, by its idle label. */
const KIND_OF: Record<string, string> = {
    [COPY_MERMAID_CODE_LABEL]: 'code', [COPY_SVG_LABEL]: 'svg', [COPY_IMAGE_LABEL]: 'image',
};

/**
 * The copy button labelled `label` (when idle) on the first diagram's code
 * block — found by its `data-copy` kind, because the label itself changes to
 * "Copied" while the outcome shows.
 */
const diagramButton = (label: string): HTMLButtonElement | null =>
    document.querySelector('.mermaid')?.closest('.code-block')
        ?.querySelector<HTMLButtonElement>(`.code-copy-btn[${COPY_KIND_ATTR}="${KIND_OF[label]}"]`) ?? null;

// The last click the page saw (`lastPointer`), recorded in the capture phase.
let g_lastPointer = 'none';
const recordPointer = (e: MouseEvent) => {
    const t = e.target as Element | null;
    const what = t?.closest?.('button')?.getAttribute('aria-label') ?? t?.tagName ?? '?';
    g_lastPointer = `${e.type}@${Math.round(e.clientX)},${Math.round(e.clientY)} trusted=${e.isTrusted} on=${what}`;
};

// The last non-idle state each copy button showed (`buttonState`), by its
// `data-copy` kind.
const g_outcomes = new Map<string, string>();


//**************************************************************
// watchPage
//**************************************************************
/** Default `watch`: record clicks, and every copy button's state change. */
const watchPage = (): void => {
    document.addEventListener('mousedown', recordPointer, true);
    document.addEventListener('click', recordPointer, true);
    new MutationObserver((records) => {
        for (const r of records) {
            const el = r.target as Element;
            const state = el.getAttribute('data-state');
            const kind = el.getAttribute(COPY_KIND_ATTR);
            if (kind && state && state !== 'idle') g_outcomes.set(kind, state);
        }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
};
// watchPage END ***********************************************

const defaultDeps: CopyDiagramE2EDeps = {
    isDir: (path) => invoke('is_dir', { path }),
    writeText: async (path, content) => { await invoke('write_text_file', { path, content }); },
    diagramPng: () => document.querySelector('.mermaid')?.getAttribute(DIAGRAM_PNG_ATTR) ?? null,
    buttonCentre: (label) => {
        const r = diagramButton(label)?.getBoundingClientRect();
        if (!r || r.width === 0) return null;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return null;
        // The WebView fills the client area, so viewport CSS pixels times the
        // device pixel ratio are physical client pixels.
        const dpr = window.devicePixelRatio || 1;
        return { x: Math.round(cx * dpr), y: Math.round(cy * dpr) };
    },
    watch: watchPage,
    buttonState: (label) =>
        g_outcomes.get(KIND_OF[label]) ?? diagramButton(label)?.getAttribute('data-state') ?? null,
    lastPointer: () => g_lastPointer,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};


//**************************************************************
// pngSize
//**************************************************************
/**
 * Width and height of a `data:image/png;base64,…` URI, read from its IHDR
 * chunk (bytes 16–23, big-endian), or null when it is not a PNG.
 */
export const pngSize = (dataUri: string): { width: number; height: number } | null => {
    try {
        // 32 base64 characters decode to exactly the first 24 bytes.
        const head = atob(dataUri.slice(dataUri.indexOf(',') + 1).slice(0, 32));
        if (head.length < 24 || head.slice(1, 4) !== 'PNG' || head.slice(12, 16) !== 'IHDR') return null;
        const u32 = (at: number) =>
            head.charCodeAt(at) * 0x1000000 + (head.charCodeAt(at + 1) << 16)
            + (head.charCodeAt(at + 2) << 8) + head.charCodeAt(at + 3);
        return { width: u32(16), height: u32(20) };
    } catch {
        return null;
    }
};
// pngSize END *************************************************


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
// runCopyDiagramE2EDriver
//**************************************************************
/**
 * Does nothing unless the harness created `e2e_copy_diagram/` before launch —
 * so `tauri dev` and every other scenario pay one `is_dir` call and no more.
 * Never throws — a failure is reported through the targets / done files or
 * the log.
 */
export const runCopyDiagramE2EDriver = async (
    deps: CopyDiagramE2EDeps = defaultDeps,
    timing: CopyDiagramE2ETiming = COPY_DIAGRAM_E2E_TIMING,
): Promise<void> => {
    const isSignal = async (path: string) => (await deps.isDir(path)) === true;
    try {
        if (!(await isSignal(COPY_DIAGRAM_E2E_MARKER))) return;
        console.log("[TEST] copy diagram scenario active");
        deps.watch();

        if (!(await waitUntil(() => deps.diagramPng() !== null, timing.pngTimeoutMs, timing.pollMs, deps.sleep))) {
            await deps.writeText(COPY_DIAGRAM_E2E_TARGETS, 'ERROR: the diagram has no PNG');
            return;
        }
        const targets: string[] = [];
        for (const label of COPY_DIAGRAM_E2E_BUTTONS) {
            const p = deps.buttonCentre(label);
            if (!p) {
                await deps.writeText(COPY_DIAGRAM_E2E_TARGETS, `ERROR: button "${label}" not found or not in view`);
                return;
            }
            targets.push(`${p.x},${p.y}`);
        }
        await deps.writeText(COPY_DIAGRAM_E2E_TARGETS, targets.join('\n'));

        for (let n = 1; n <= COPY_DIAGRAM_E2E_BUTTONS.length; n++) {
            const label = COPY_DIAGRAM_E2E_BUTTONS[n - 1];
            if (!(await waitUntil(() => isSignal(copyDiagramE2EClickSignal(n)),
                timing.signalTimeoutMs, timing.pollMs, deps.sleep))) {
                console.error(`[TEST] copy diagram: no click ${n} signal from the harness`);
                return;
            }
            await waitUntil(() => (deps.buttonState(label) ?? 'idle') !== 'idle',
                timing.outcomeTimeoutMs, timing.pollMs, deps.sleep);

            let report = `state=${deps.buttonState(label) ?? 'missing'}\npointer=${deps.lastPointer()}`;
            if (label === COPY_IMAGE_LABEL) {
                const size = pngSize(deps.diagramPng() ?? '');
                report += `\npng=${size ? `${size.width}x${size.height}` : 'unknown'}`;
            }
            await deps.writeText(copyDiagramE2EDoneFile(n), report);
        }
    } catch (e) {
        console.error("[TEST] copy diagram driver failed:", e);
    }
};
// runCopyDiagramE2EDriver END *********************************
