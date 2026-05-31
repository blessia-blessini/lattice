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
 * scroll-sync.test.tsx
 *
 * Unit / integration tests for the dual-view scroll-sync fixes introduced in
 * v0.2.37–v0.2.38.  The bugs were first observed on macOS but the fixes apply
 * on all platforms — the code is not conditionally compiled per platform.
 *
 *  1. CSS guard — `overscroll-behavior: contain` on .preview-pane prevents
 *     elastic/rubber-band overscroll from briefly pushing scrollTop to 0
 *     and snapping the editor to line 1.
 *
 *  2. pauseScrollSync — a 350 ms pause window blocks scroll-sync after any
 *     operation that causes CodeMirror to remeasure block heights (theme
 *     toggle, word-wrap toggle, window resize, view-mode switch).
 *     Without the pause, stale getTopVisibleLine() data drove the preview
 *     back to the top.
 *
 *  3. lineForOffset floating-point gap fallback — sub-pixel
 *     getBoundingClientRect() values can create tiny gaps between adjacent
 *     line-map entries.  The original code fell through to `return 0`
 *     (line 1), snapping the editor to the top.  The fix finds the closest
 *     entry instead.
 *
 * Key testing strategy:
 *   - pauseScrollSync tests: render with real timers (so waitFor works), then
 *     call vi.useFakeTimers() AFTER the component is mounted and in dual view.
 *     This avoids the known issue where fake timers block waitFor's polling.
 *   - lineForOffset tests: pure unit tests that replicate the function logic.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { StaticRuntime } from "@services/StaticRuntime";

// ---------------------------------------------------------------------------
// External mocks (same pattern as App.test.tsx)
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mermaid-mock</svg>' }),
  },
}));

// ---------------------------------------------------------------------------
// Editor mock — exposes scrollToLine via a module-level spy so each test can
// reset and assert independently.
// ---------------------------------------------------------------------------
let scrollToLineSpy = vi.fn();

vi.mock('./components/Editor', () => ({
  Editor: React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
    const scrollDiv = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => ({
      markAsSaved: vi.fn(),
      getContent: () => '',
      getScrollDOM: () => scrollDiv.current,
      getTopVisibleLine: () => 1,
      scrollToLine: (...args: unknown[]) => scrollToLineSpy(...args),
      undo: vi.fn(),
      redo: vi.fn(),
      toggleTaskAtLine: vi.fn().mockReturnValue(false),
      insertTocBlock: vi.fn().mockResolvedValue(undefined),
      updateToc: vi.fn().mockResolvedValue(undefined),
      padTables: vi.fn().mockResolvedValue(undefined),
    }));
    return (
      <div
        data-testid="mock-editor"
        ref={scrollDiv}
        style={{ overflowY: 'scroll', height: '200px' }}
      />
    );
  }),
}));

// ---------------------------------------------------------------------------
// Invoke mock
// ---------------------------------------------------------------------------
const makeInvokeMock = () => (cmd: string, args: any) => {
  if (cmd === 'initialize_vault_settings') return Promise.resolve('settings.json');
  if (cmd === 'find_vault_settings_file') return Promise.resolve('/vault/.lattice/settings.json');
  if (cmd === 'read_text_file') return Promise.resolve({ content: '# Demo', hash: '123' });
  if (cmd === 'calc_base_path') return Promise.resolve();
  if (cmd === 'write_text_file') return Promise.resolve({ path: args?.path || 'unknown', hash: 'new-hash' });
  if (cmd === 'watch_file') return Promise.resolve();
  if (cmd === 'read_file_base64') return Promise.resolve('data:image/png;base64,iVBORw==');
  if (cmd === 'trace_log') {
    const time = new Date().toISOString().split('T')[1].replace('Z', '');
    StaticRuntime.log(`[MOCK_TRACE:${time}] ${args?.msg || ''}\n`);
    return Promise.resolve();
  }
  return Promise.resolve(null);
};

// ---------------------------------------------------------------------------
// Helper: render App with real timers, switch to dual view, return preview.
// Always call this BEFORE vi.useFakeTimers() so waitFor polling works.
// ---------------------------------------------------------------------------
const renderInDualView = async () => {
  const utils = render(<App />);
  const { container } = utils;

  await waitFor(() =>
    expect(container.querySelector('[data-testid="view-mode-select"]')).toBeTruthy()
  );

  const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
  await act(async () => {
    fireEvent.change(select, { target: { value: 'dual' } });
  });

  await waitFor(() => expect(container.querySelector('.preview-pane')).toBeTruthy());
  const preview = container.querySelector('.preview-pane') as HTMLDivElement;
  return { ...utils, preview };
};

// ===========================================================================
// 1. CSS guard — .preview-pane class is present on the preview element
// ===========================================================================
// JSDOM cannot evaluate stylesheet rules, but asserting the class name exists
// means a refactor that renames or removes .preview-pane will fail here,
// keeping the overscroll-behavior: contain guard visible.
// ===========================================================================
describe('scroll-sync fix #1 — CSS overscroll-behavior guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    delete (window as any).__LATTICE_INIT_DATA__;
    vi.mocked(TauriCore.invoke).mockImplementation(makeInvokeMock());
  });

  it('preview pane renders with .preview-pane class (carrier of overscroll-behavior: contain)', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('[data-testid="view-mode-select"]')).toBeTruthy());
    const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(select, { target: { value: 'dual' } }); });

    await waitFor(() => {
      expect(container.querySelector('.preview-pane')).not.toBeNull();
    });
  });

  it('mock editor exposes a scrollable container (scroll-sync wires up to it)', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('[data-testid="mock-editor"]')).toBeTruthy());
    const editorEl = container.querySelector('[data-testid="mock-editor"]') as HTMLElement;
    expect(editorEl.style.overflowY).toBe('scroll');
  });
});

// ===========================================================================
// 2. pauseScrollSync — blocks and resumes dual-view scroll sync
// ===========================================================================
// Render with real timers first (so waitFor works), then switch to fake
// timers inside each test to control the 350 ms pause window.
// ===========================================================================
describe('scroll-sync fix #2 — pauseScrollSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    delete (window as any).__LATTICE_INIT_DATA__;
    scrollToLineSpy = vi.fn();
    vi.mocked(TauriCore.invoke).mockImplementation(makeInvokeMock());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 2a. Window resize immediately blocks preview → editor sync
  // -------------------------------------------------------------------------
  it('preview scroll does NOT call scrollToLine while resize-triggered pause is active', async () => {
    const { preview } = await renderInDualView();

    // Switch to fake timers AFTER mount so waitFor above worked correctly.
    vi.useFakeTimers();

    // App registers: window.addEventListener('resize', pauseScrollSync)
    act(() => { fireEvent(window, new Event('resize')); });

    // scrollSyncPaused.current is now true.
    act(() => { fireEvent.scroll(preview); });

    expect(scrollToLineSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2b. Scroll-sync resumes after the 350 ms window expires
  // -------------------------------------------------------------------------
  it('preview scroll calls scrollToLine once the 350 ms pause has expired', async () => {
    const { preview } = await renderInDualView();
    vi.useFakeTimers();

    act(() => { fireEvent(window, new Event('resize')); });

    // Still paused — scroll is a no-op.
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).not.toHaveBeenCalled();

    // Advance past the pause window.
    act(() => { vi.advanceTimersByTime(351); });

    // Now sync is live again.
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 2c. Repeated resize events extend the pause (debounce behaviour)
  // -------------------------------------------------------------------------
  it('each resize event resets the 350 ms timer, extending the pause', async () => {
    const { preview } = await renderInDualView();
    vi.useFakeTimers();

    // Three resize events, 200 ms apart — each one resets the timer.
    act(() => { fireEvent(window, new Event('resize')); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { fireEvent(window, new Event('resize')); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { fireEvent(window, new Event('resize')); });

    // 400 ms since last resize — still in the 350 ms window.
    act(() => { vi.advanceTimersByTime(349); });
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).not.toHaveBeenCalled();

    // One more ms tips past the window.
    act(() => { vi.advanceTimersByTime(1); });
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 2d. Theme toggle (the 🌙 / ☀️ button) triggers a pause
  // -------------------------------------------------------------------------
  it('theme toggle button pauses scroll sync for 350 ms', async () => {
    const { container, preview } = await renderInDualView();
    vi.useFakeTimers();

    // The theme button has no title attr — find it by emoji content.
    const themeBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === '🌙' || b.textContent === '☀️'
    );
    expect(themeBtn).toBeTruthy();

    act(() => { fireEvent.click(themeBtn as HTMLElement); });

    // Paused — scroll ignored.
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).not.toHaveBeenCalled();

    // Resume.
    act(() => { vi.advanceTimersByTime(351); });
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 2e. Switching into dual view itself triggers a pause
  //     (so stale block heights from the split-pane resize don't fire sync)
  // -------------------------------------------------------------------------
  it('switching into dual view immediately pauses scroll sync', async () => {
    // Start from a fresh (non-dual) render so we can observe the switch.
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('[data-testid="view-mode-select"]')).toBeTruthy());

    const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;

    // Switch to dual — fires pauseScrollSync() via the viewMode effect.
    await act(async () => { fireEvent.change(select, { target: { value: 'dual' } }); });
    await waitFor(() => expect(container.querySelector('.preview-pane')).toBeTruthy());
    const preview = container.querySelector('.preview-pane') as HTMLDivElement;

    // Switch to fake timers AFTER rendering so the real-timer-based waitFor
    // above works.  The pause timer was set with the real setTimeout, so it
    // hasn't expired yet (render completes in ~250 ms; pause lasts 350 ms).
    vi.useFakeTimers();

    // Scroll immediately after switching — must be blocked by the pause.
    // (Timer expiry is covered by tests 2a–2b above.)
    act(() => { fireEvent.scroll(preview); });
    expect(scrollToLineSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. lineForOffset — floating-point gap fallback (pure unit tests)
// ===========================================================================
// lineForOffset lives inside App's scroll-sync useEffect closure and cannot
// be imported directly.  We replicate its logic verbatim so the algorithm is
// tested in isolation.  If the source changes, update this mirror and these
// tests will catch regressions in the scroll-sync fix.
//
// Mirrors App.tsx — keep in sync with the implementation.
// ===========================================================================

function lineForOffset(map: Array<[number, number]>, top: number): number {
  if (map.length === 0) return 1;
  if (top <= map[0][1]) return map[0][0];
  if (top >= map[map.length - 1][1]) return map[map.length - 1][0];
  for (let i = 0; i < map.length - 1; i++) {
    if (top >= map[i][1] && top <= map[i + 1][1]) {
      const [l1, t1] = map[i];
      const [l2, t2] = map[i + 1];
      const r = t2 === t1 ? 0 : (top - t1) / (t2 - t1);
      return l1 + r * (l2 - l1);
    }
  }
  // Floating-point gap fallback — find closest entry instead of
  // returning 0 (which would snap the editor to line 1).
  let closest = map[0];
  let minDist = Math.abs(top - map[0][1]);
  for (let i = 1; i < map.length; i++) {
    const dist = Math.abs(top - map[i][1]);
    if (dist < minDist) { minDist = dist; closest = map[i]; }
  }
  return closest[0];
}

describe('scroll-sync fix #3 — lineForOffset floating-point gap fallback', () => {
  // Realistic line-map: [sourceLine, offsetTop]
  const map: Array<[number, number]> = [
    [1,   0],
    [5,  80],
    [10, 160],
    [15, 240],
    [20, 320],
  ];

  it('returns first source line when top is at or before the first entry', () => {
    expect(lineForOffset(map, 0)).toBe(1);
    expect(lineForOffset(map, -10)).toBe(1);
  });

  it('returns last source line when top is at or beyond the last entry', () => {
    expect(lineForOffset(map, 320)).toBe(20);
    expect(lineForOffset(map, 999)).toBe(20);
  });

  it('interpolates correctly within a normal interval', () => {
    // Midpoint between [5, 80] and [10, 160]: offset 120 → line 7.5
    expect(lineForOffset(map, 120)).toBeCloseTo(7.5, 5);
  });

  it('returns line 1 (not 0) for an empty map', () => {
    expect(lineForOffset([], 100)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Core regression: sub-pixel gap — the fallback closest-entry logic
  // -------------------------------------------------------------------------
  // Mathematical note: by the discrete IVT, the loop in lineForOffset
  // always finds a bracketing interval when the map is sorted by source
  // line (as buildLineMap guarantees).  The fallback branch is therefore a
  // safety net that cannot be triggered with a well-formed input, but its
  // closest-entry logic is what prevents the old snap-to-top bug if it
  // ever runs.  We test the fallback algorithm directly below.
  // -------------------------------------------------------------------------

  it('non-monotone map: lineForOffset still returns a reasonable line, never line 1 for mid-document top', () => {
    // Source line 5 renders far below line 10 (e.g. a large code block),
    // producing non-monotone offsets when sorted by line number.
    const nonMonotoneMap: Array<[number, number]> = [
      [1,    0],
      [5,  300],   // code block: line 5 renders at offset 300
      [10, 100],   // following prose: line 10 at offset 100
      [15, 400],
    ];
    // top = 200: falls in interval i=0 [0,300] → interpolated between line 1 and 5
    const result = lineForOffset(nonMonotoneMap, 200);
    expect(result).not.toBe(1);       // must not snap to top
    expect(result).toBeGreaterThan(1); // must be somewhere in the document
    expect(result).toBeLessThan(15);   // must be before the last line
  });

  it('interpolation in second interval is correct', () => {
    // map: [[1,100], [10,130], [20,170]]
    // top = 150 falls in i=1 interval [130, 170]
    const map2: Array<[number, number]> = [[1, 100], [10, 130], [20, 170]];
    // r = (150-130)/(170-130) = 20/40 = 0.5 → line = 10 + 0.5*10 = 15
    expect(lineForOffset(map2, 150)).toBeCloseTo(15, 5);
    expect(lineForOffset(map2, 150)).not.toBe(1); // regression guard
  });

  it('fallback closest-entry algorithm: returns nearest line, never line 1 (isolated unit)', () => {
    // Test the fallback sub-algorithm directly, independent of the loop.
    // The fallback is: find map entry whose offsetTop is closest to `top`.
    function closestEntry(map: Array<[number, number]>, top: number): number {
      let closest = map[0];
      let minDist = Math.abs(top - map[0][1]);
      for (let i = 1; i < map.length; i++) {
        const dist = Math.abs(top - map[i][1]);
        if (dist < minDist) { minDist = dist; closest = map[i]; }
      }
      return closest[0];
    }

    const map3: Array<[number, number]> = [[1, 0], [10, 160], [20, 320]];

    // Value near 160 → closest is line 10 (NOT line 1)
    expect(closestEntry(map3, 165)).toBe(10);
    expect(closestEntry(map3, 155)).toBe(10);
    expect(closestEntry(map3, 165)).not.toBe(1); // regression guard: old code returned map[0][0]=1

    // Value near 320 → closest is line 20
    expect(closestEntry(map3, 310)).toBe(20);

    // Tie between two entries: first minimum wins (deterministic)
    const tieMap: Array<[number, number]> = [[1, 100], [10, 200], [20, 300]];
    // top=150 equidistant from 100 and 200 → first found (line 1 at offset 100)
    expect(closestEntry(tieMap, 150)).toBe(1);
  });
});
