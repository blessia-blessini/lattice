// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

// Tests of the E2E driver itself (test tooling for the copy_diagram scenario,
// REQ-LTTCE-PRV-00004 / 00006 / 00007); it never ships.

import { describe, it, expect, vi } from 'vitest';
import {
    runCopyDiagramE2EDriver, CopyDiagramE2EDeps, CopyDiagramE2ETiming, pngSize,
    COPY_DIAGRAM_E2E_MARKER, COPY_DIAGRAM_E2E_TARGETS, COPY_DIAGRAM_E2E_BUTTONS,
    copyDiagramE2EClickSignal, copyDiagramE2EDoneFile,
} from './CopyDiagramE2EDriver';
import { COPY_IMAGE_LABEL, COPY_MERMAID_CODE_LABEL, COPY_SVG_LABEL } from '../../components/CodeBlock';

const FAST: CopyDiagramE2ETiming = { pollMs: 1, signalTimeoutMs: 5, pngTimeoutMs: 5, outcomeTimeoutMs: 5 };

/** A real 3×2 PNG header (signature + IHDR), enough for `pngSize`. */
const PNG_3x2 = 'data:image/png;base64,'
    + btoa('\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x03\x00\x00\x00\x02\x08\x06\x00\x00\x00');

/**
 * Fake surroundings. Button i (0-based) sits at (100 + 40·i, 50); `signals`
 * are the clicks the harness makes — a signalled button shows `outcome`.
 */
const makeDeps = (opts: {
    marker?: unknown;
    signals?: number[];
    png?: string | null;
    buttons?: string[];
    outcome?: string;
} = {}) => {
    const { marker = true, signals = [1, 2, 3], png = PNG_3x2, outcome = 'copied' } = opts;
    const buttons = opts.buttons ?? [...COPY_DIAGRAM_E2E_BUTTONS];
    const written: Record<string, string> = {};
    const states: Record<string, string> = {};
    const deps: CopyDiagramE2EDeps = {
        isDir: vi.fn(async (p: string) => {
            if (p === COPY_DIAGRAM_E2E_MARKER) return marker;
            const n = signals.find(k => copyDiagramE2EClickSignal(k) === p);
            if (n === undefined) return false;
            states[COPY_DIAGRAM_E2E_BUTTONS[n - 1]] = outcome; // the harness clicked it
            return true;
        }),
        writeText: vi.fn(async (p: string, c: string) => { written[p] = c; }),
        diagramPng: vi.fn(() => png),
        buttonCentre: vi.fn((label: string) => {
            const i = buttons.indexOf(label);
            return i < 0 ? null : { x: 100 + 40 * i, y: 50 };
        }),
        buttonState: vi.fn((label: string) => states[label] ?? (buttons.includes(label) ? 'idle' : null)),
        watch: vi.fn(),
        lastPointer: () => 'click@1,2 trusted=true on=x',
        sleep: async () => {},
    };
    return { deps, written };
};

describe('runCopyDiagramE2EDriver', () => {
    it('does nothing without the scenario marker (tauri dev, other scenarios)', async () => {
        const { deps } = makeDeps({ marker: false });
        await runCopyDiagramE2EDriver(deps, FAST);
        expect(deps.isDir).toHaveBeenCalledTimes(1);
        expect(deps.watch).not.toHaveBeenCalled();
        expect(deps.writeText).not.toHaveBeenCalled();
    });

    it('treats only a literal true as the marker', async () => {
        const { deps } = makeDeps({ marker: 'yes' });
        await runCopyDiagramE2EDriver(deps, FAST);
        expect(deps.writeText).not.toHaveBeenCalled();
    });

    it('reports the buttons\' positions in click order: code, SVG, image', async () => {
        const { deps, written } = makeDeps();
        await runCopyDiagramE2EDriver(deps, FAST);
        expect(written[COPY_DIAGRAM_E2E_TARGETS]).toBe('100,50\n140,50\n180,50');
        expect(vi.mocked(deps.buttonCentre).mock.calls.map(c => c[0]))
            .toEqual([COPY_MERMAID_CODE_LABEL, COPY_SVG_LABEL, COPY_IMAGE_LABEL]);
    });

    it('reports each click\'s outcome, the image with its PNG size', async () => {
        const { deps, written } = makeDeps();
        await runCopyDiagramE2EDriver(deps, FAST);
        const pointer = 'pointer=click@1,2 trusted=true on=x';
        expect(written[copyDiagramE2EDoneFile(1)]).toBe(`state=copied\n${pointer}`);
        expect(written[copyDiagramE2EDoneFile(2)]).toBe(`state=copied\n${pointer}`);
        expect(written[copyDiagramE2EDoneFile(3)]).toBe(`state=copied\n${pointer}\npng=3x2`);
    });

    it('reports a failed copy, and a button that never left idle, as such', async () => {
        const failed = makeDeps({ outcome: 'failed' });
        await runCopyDiagramE2EDriver(failed.deps, FAST);
        expect(failed.written[copyDiagramE2EDoneFile(1)]).toMatch(/^state=failed\n/);
        const idle = makeDeps({ outcome: 'idle' });
        await runCopyDiagramE2EDriver(idle.deps, FAST);
        expect(idle.written[copyDiagramE2EDoneFile(1)]).toMatch(/^state=idle\n/);
    });

    it('stops at a missing harness signal', async () => {
        const { deps, written } = makeDeps({ signals: [1] });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await runCopyDiagramE2EDriver(deps, FAST);
        err.mockRestore();
        expect(written[copyDiagramE2EDoneFile(1)]).toBe('state=copied\npointer=click@1,2 trusted=true on=x');
        expect(written[copyDiagramE2EDoneFile(2)]).toBeUndefined();
    });

    it('reports an error, and no targets, when the diagram never gets its PNG', async () => {
        const { deps, written } = makeDeps({ png: null });
        await runCopyDiagramE2EDriver(deps, FAST);
        expect(written[COPY_DIAGRAM_E2E_TARGETS]).toBe('ERROR: the diagram has no PNG');
        expect(deps.buttonCentre).not.toHaveBeenCalled();
    });

    it('reports an error when a button is missing or out of view', async () => {
        const { deps, written } = makeDeps({ buttons: [COPY_MERMAID_CODE_LABEL] });
        await runCopyDiagramE2EDriver(deps, FAST);
        expect(written[COPY_DIAGRAM_E2E_TARGETS])
            .toBe(`ERROR: button "${COPY_SVG_LABEL}" not found or not in view`);
        expect(written[copyDiagramE2EDoneFile(1)]).toBeUndefined();
    });

    it('never throws', async () => {
        const { deps } = makeDeps();
        deps.writeText = vi.fn(async () => { throw new Error('disk full'); });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(runCopyDiagramE2EDriver(deps, FAST)).resolves.toBeUndefined();
        err.mockRestore();
    });
});

describe('pngSize', () => {
    it('reads width and height from the IHDR chunk', () => {
        expect(pngSize(PNG_3x2)).toEqual({ width: 3, height: 2 });
    });

    it('reads sizes above 2^31 without going negative', () => {
        const big = 'data:image/png;base64,'
            + btoa('\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x80\x00\x00\x01\x00\x00\x01\x00\x08\x06\x00\x00\x00');
        expect(pngSize(big)).toEqual({ width: 2 ** 31 + 1, height: 256 });
    });

    it('is null for anything that is not a PNG', () => {
        expect(pngSize('')).toBeNull();
        expect(pngSize('data:image/png;base64,AAAA')).toBeNull();
        expect(pngSize('data:image/gif;base64,' + btoa('GIF89a'.padEnd(24, '\x00')))).toBeNull();
        expect(pngSize('data:image/png;base64,%%%not-base64%%%')).toBeNull();
    });
});
