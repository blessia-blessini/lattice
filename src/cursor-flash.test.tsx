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
 * cursor-flash.test.tsx
 *
 * Integration ("wired", ITST level) and system-flow (STST level) tests for
 * the Dual-View Cursor Flash feature (Chapter DVW).
 *
 * Covers:
 *   REQ-LTTCE-DVW-00001 — innermost block flashed inverted; blank line → none
 *   REQ-LTTCE-DVW-00002 — ==mark== spans inside the flashed block; CSS
 *                          inversion + counter-inversion invariants
 *   REQ-LTTCE-DVW-00003 — immediate appearance, ~2 s hold, ~400 ms fade,
 *                          restart on movement, dual-views only
 *   via IMPL-LTTCE-DVW-00002 (Editor prop), -00003 (App effect),
 *   -00004 (App.css) against ARCH-LTTCE-DVW-00001.
 *
 * The full App is rendered (real ReactMarkdown preview pipeline, real
 * rehypeAddSourceLines tagging); only the Tauri IPC layer and the CodeMirror
 * Editor component are mocked, the latter exposing the captured
 * onCursorLineChange prop so tests can move the "cursor" programmatically.
 * This full-App user flow (open file → dual view → move cursor → observe
 * inverted block → fade) is the system-level (STST) coverage for this UI
 * feature: a compiled-app E2E lane for UI interactions does not exist in the
 * pipeline (see docs/60-test-strategy.md, "Mocked E2E").
 *
 * Timer strategy (house pattern from scroll-sync.test.tsx): render and reach
 * dual view with REAL timers so waitFor polling works, then switch to fake
 * timers inside the test to control the 2000 ms hold / 400 ms fade windows.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// External mocks (same pattern as App.test.tsx / scroll-sync.test.tsx)
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
// Editor mock — captures the onCursorLineChange prop so tests can simulate
// cursor movement without a real CodeMirror view.
// ---------------------------------------------------------------------------
let capturedOnCursorLineChange: ((line: number) => void) | null = null;

vi.mock('./components/Editor', () => ({
  Editor: React.forwardRef((props: any, ref: React.Ref<unknown>) => {
    capturedOnCursorLineChange = props.onCursorLineChange ?? null;
    const scrollDiv = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => ({
      markAsSaved: vi.fn(),
      getContent: () => '',
      getScrollDOM: () => scrollDiv.current,
      getTopVisibleLine: () => 1,
      scrollToLine: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      toggleTaskAtLine: vi.fn().mockReturnValue(false),
      insertTocBlock: vi.fn().mockResolvedValue(undefined),
      updateToc: vi.fn().mockResolvedValue(undefined),
      padTables: vi.fn().mockResolvedValue(undefined),
    }));
    return <div data-testid="mock-editor" ref={scrollDiv} />;
  }),
}));

// ---------------------------------------------------------------------------
// Test document — 1-based source lines:
//   1: # Title
//   3: paragraph containing ==marked text==
//   5: - item one        (ul spans 5..6, li one is 5..5)
//   6: - item two
//   8: closing paragraph
//  10: $$                (display math, spans 10..12 — KaTeX-rendered)
//  11: E = mc^2
//  12: $$
// Line 2/4/7/9 are blank separator lines (must produce NO flash).
// ---------------------------------------------------------------------------
const TEST_DOC = [
  '# Title',
  '',
  'First paragraph with ==marked text== inside.',
  '',
  '- item one',
  '- item two',
  '',
  'Last paragraph.',
  '',
  '$$',
  'E = mc^2',
  '$$',
].join('\n');

const makeInvokeMock = () => (cmd: string, args: any) => {
  if (cmd === 'initialize_vault_settings') return Promise.resolve('settings.json');
  if (cmd === 'find_vault_settings_file') return Promise.resolve('/vault/.lattice/settings.json');
  if (cmd === 'read_text_file') return Promise.resolve({ content: TEST_DOC, hash: '123' });
  if (cmd === 'calc_base_path') return Promise.resolve();
  if (cmd === 'write_text_file') return Promise.resolve({ path: args?.path || 'unknown', hash: 'new-hash' });
  if (cmd === 'watch_file') return Promise.resolve();
  if (cmd === 'read_file_base64') return Promise.resolve('data:image/png;base64,iVBORw==');
  return Promise.resolve(null);
};

// ---------------------------------------------------------------------------
// Helper: render App with real timers, switch to dual view, wait for the
// preview to contain the rendered test document.
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
  return { ...utils, preview, select };
};

const flashCursorTo = (line: number) => {
  expect(capturedOnCursorLineChange).toBeTruthy();
  act(() => { capturedOnCursorLineChange!(line); });
};

const flashed = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.lattice-cursor-flash'));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  // App consumes (and deletes) this on mount — it is how a window receives
  // its document. Set fresh for every test so the preview renders TEST_DOC.
  (window as any).__LATTICE_INIT_DATA__ = { path: 'test.md', content: TEST_DOC };
  capturedOnCursorLineChange = null;
  vi.mocked(TauriCore.invoke).mockImplementation(makeInvokeMock() as any);
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// 1. Source-interval tagging — data-source-line-end (IMPL-LTTCE-DVW-00003)
// ===========================================================================
describe('cursor flash — source interval tagging', () => {
  it('preview elements carry matching data-source-line / data-source-line-end intervals', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('p[data-source-line="3"]')).toBeTruthy());

    const p = preview.querySelector('p[data-source-line="3"]') as HTMLElement;
    expect(p.getAttribute('data-source-line-end')).toBe('3');

    const ul = preview.querySelector('ul[data-source-line="5"]') as HTMLElement;
    expect(ul).toBeTruthy();
    expect(ul.getAttribute('data-source-line-end')).toBe('6');
  });

  it('display-math blocks keep a source interval despite the KaTeX replacement (IMPL-LTTCE-DVW-00005)', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('.katex')).toBeTruthy());

    // rehype-katex splices the tagged <pre><code class="language-math">
    // host out of the tree; the wrapper injected by rehypeWrapMathBlocks
    // must survive, carrying the copied [10, 12] interval.
    const anchor = preview.querySelector('div.math-block-anchor') as HTMLElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('data-source-line')).toBe('10');
    expect(anchor.getAttribute('data-source-line-end')).toBe('12');
    expect(anchor.querySelector('.katex')).toBeTruthy(); // KaTeX output is inside
  });
});

// ===========================================================================
// 2. Flash application — REQ-LTTCE-DVW-00001 / 00002 (DOM side)
// ===========================================================================
describe('cursor flash — block selection (REQ-LTTCE-DVW-00001/00002)', () => {
  it('flashes the paragraph under the cursor, including its ==mark== span', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('p[data-source-line="3"]')).toBeTruthy());

    flashCursorTo(3);

    const hits = flashed(preview);
    expect(hits).toHaveLength(1);
    expect(hits[0].tagName).toBe('P');
    expect(hits[0].getAttribute('data-source-line')).toBe('3');
    // The ==marked text== <mark> is INSIDE the flashed block, so the CSS
    // inversion applies to it (REQ-LTTCE-DVW-00002).
    // Now a styled <span class="lattice-mark">, not a <mark> — see
    // REQ-LTTCE-CPY-00001 for why the tag had to change.
    const highlight = hits[0].querySelector('span.lattice-mark');
    expect(highlight).toBeTruthy();
    expect(highlight!.textContent).toBe('marked text');
    expect(highlight!.getAttribute('style')).toContain('background-color');
  });

  it('flashes the innermost block — the <li>, not its parent <ul>', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('ul[data-source-line="5"]')).toBeTruthy());

    flashCursorTo(5);

    const hits = flashed(preview);
    expect(hits).toHaveLength(1);
    expect(hits[0].tagName).toBe('LI');
    expect(hits[0].textContent).toContain('item one');
  });

  it('shows no flash when the cursor is on a blank separator line', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('p[data-source-line="3"]')).toBeTruthy());

    flashCursorTo(4); // blank line between paragraph and list
    expect(flashed(preview)).toHaveLength(0);
  });

  it('flashes the display-math wrapper when the cursor is inside $$...$$ (regression: math did not react)', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('div.math-block-anchor')).toBeTruthy());

    flashCursorTo(11); // middle line of the $$ block

    const hits = flashed(preview);
    expect(hits).toHaveLength(1);
    expect(hits[0].classList.contains('math-block-anchor')).toBe(true);
    expect(hits[0].querySelector('.katex')).toBeTruthy();
  });

  it('moving the cursor moves the flash (old block is cleaned)', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('p[data-source-line="3"]')).toBeTruthy());

    flashCursorTo(3);
    flashCursorTo(8);

    const hits = flashed(preview);
    expect(hits).toHaveLength(1);
    expect(hits[0].textContent).toContain('Last paragraph.');
  });
});

// ===========================================================================
// 3. Lifetime — REQ-LTTCE-DVW-00003 (hold, fade, restart, dual-only)
// ===========================================================================
describe('cursor flash — lifetime (REQ-LTTCE-DVW-00003)', () => {
  it('holds ~2 s, then fades ~400 ms, then removes all classes', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('p[data-source-line="3"]')).toBeTruthy());

    vi.useFakeTimers();
    flashCursorTo(3);

    const el = flashed(preview)[0];
    expect(el.classList.contains('lattice-cursor-flash--fade')).toBe(false);

    act(() => { vi.advanceTimersByTime(1999); });
    expect(el.classList.contains('lattice-cursor-flash--fade')).toBe(false); // still holding

    act(() => { vi.advanceTimersByTime(1); }); // t = 2000 — fade starts
    expect(el.classList.contains('lattice-cursor-flash--fade')).toBe(true);
    expect(el.classList.contains('lattice-cursor-flash')).toBe(true);

    act(() => { vi.advanceTimersByTime(400); }); // t = 2400 — fade over
    expect(el.classList.contains('lattice-cursor-flash')).toBe(false);
    expect(el.classList.contains('lattice-cursor-flash--fade')).toBe(false);
    expect(flashed(preview)).toHaveLength(0);
  });

  it('a new cursor move restarts the hold period', async () => {
    const { preview } = await renderInDualView();
    await waitFor(() => expect(preview.querySelector('p[data-source-line="3"]')).toBeTruthy());

    vi.useFakeTimers();
    flashCursorTo(3);
    act(() => { vi.advanceTimersByTime(1000); });

    flashCursorTo(5); // restart at t=1000
    const li = flashed(preview)[0];
    expect(li.tagName).toBe('LI');

    act(() => { vi.advanceTimersByTime(1999); }); // t=2999, restart expires at 3000
    expect(li.classList.contains('lattice-cursor-flash--fade')).toBe(false);

    act(() => { vi.advanceTimersByTime(1); }); // t=3000
    expect(li.classList.contains('lattice-cursor-flash--fade')).toBe(true);
  });

  it('does not flash outside dual views, and leaving dual view clears an active flash', async () => {
    const { container } = render(<App />);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="view-mode-select"]')).toBeTruthy()
    );

    // Default view mode is single 'edit' — cursor movement must not flash.
    await waitFor(() => expect(capturedOnCursorLineChange).toBeTruthy());
    act(() => { capturedOnCursorLineChange!(3); });
    expect(flashed(container as HTMLElement)).toHaveLength(0);

    // Switch to dual, flash, then switch back to edit: flash must be cleared.
    const select = container.querySelector('[data-testid="view-mode-select"]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(select, { target: { value: 'dual' } }); });
    await waitFor(() =>
      expect(container.querySelector('p[data-source-line="3"]')).toBeTruthy()
    );
    act(() => { capturedOnCursorLineChange!(3); });
    expect(flashed(container as HTMLElement)).toHaveLength(1);

    await act(async () => { fireEvent.change(select, { target: { value: 'edit' } }); });
    expect(flashed(container as HTMLElement)).toHaveLength(0);
  });
});

// ===========================================================================
// 4. CSS invariants — REQ-LTTCE-DVW-00002 / 00003 (IMPL-LTTCE-DVW-00004)
// ===========================================================================
// JSDOM does not evaluate stylesheets, so (house pattern, see App.test.tsx)
// the rules are asserted structurally against the App.css source.
// ===========================================================================
describe('cursor flash — App.css invariants (IMPL-LTTCE-DVW-00004)', () => {
  const css = readFileSync(resolve(import.meta.dirname, 'App.css'), 'utf-8');

  const ruleBlock = (selectorStart: string): string => {
    const idx = css.indexOf(selectorStart);
    expect(idx, `selector "${selectorStart}" must exist in App.css`).toBeGreaterThan(-1);
    return css.slice(idx, css.indexOf('}', idx));
  };

  it('inverts the flashed block', () => {
    expect(ruleBlock('.markdown-body .lattice-cursor-flash {')).toContain('filter: invert(1)');
  });

  it('gives the flashed block an explicit opaque background per preview theme', () => {
    expect(ruleBlock('.markdown-body[data-theme="light"] .lattice-cursor-flash {'))
      .toContain('background-color: #ffffff');
    expect(ruleBlock('.markdown-body[data-theme="dark"] .lattice-cursor-flash {'))
      .toContain('background-color: #0d1117');
  });

  it('counter-inverts images and Mermaid SVGs back to natural colors (REQ-LTTCE-DVW-00002)', () => {
    const block = ruleBlock('.markdown-body .lattice-cursor-flash img,');
    expect(block).toContain('.mermaid svg');
    expect(block).toContain('filter: invert(1)');
  });

  it('does NOT counter-invert bare svg — KaTeX glyph SVGs must invert with the math text', () => {
    // A selector like `.lattice-cursor-flash svg` (without the .mermaid
    // scope) would leave sqrt bars / stretchy braces black inside an
    // otherwise inverted math block.
    expect(css).not.toMatch(/\.lattice-cursor-flash(--fade)?\s+svg\b/);
  });

  it('does NOT exempt <mark> from the inversion — marks must invert with the block', () => {
    // A counter-invert rule for mark would defeat REQ-LTTCE-DVW-00002.
    expect(css).not.toMatch(/\.lattice-cursor-flash[^{]*\bmark\b[^{]*\{/);
  });

  it('fades via a filter transition (REQ-LTTCE-DVW-00003)', () => {
    const block = ruleBlock('.markdown-body .lattice-cursor-flash--fade,');
    expect(block).toContain('filter: invert(0)');
    expect(block).toContain('transition: filter 400ms');
  });

  it('never reaches the printer', () => {
    const printIdx = css.indexOf('@media print');
    const printCss = css.slice(printIdx >= 0 ? printIdx : 0);
    expect(printCss).toContain('.lattice-cursor-flash');
    expect(printCss).toContain('filter: none !important');
  });
});
