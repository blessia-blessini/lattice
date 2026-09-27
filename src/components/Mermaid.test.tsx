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

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the mermaid library — it does not run in JSDOM
// ---------------------------------------------------------------------------
vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mock-svg">diagram</svg>' }),
    },
}));

// rasterizeSvg needs a canvas jsdom does not have; the PNG-cache tests below
// script its result. Every other test keeps the real implementation.
vi.mock('../lib/svg-raster', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/svg-raster')>();
    return { ...actual, rasterizeSvg: vi.fn(actual.rasterizeSvg) };
});

import mermaid from 'mermaid';
import { Mermaid } from './Mermaid';
import { rasterizeSvg } from '../lib/svg-raster';
import { DIAGRAM_PNG_ATTR, DIAGRAM_PNG_FAILED_ATTR, EXPORT_MODE_ATTR } from '../lib/preview-copy';

const CHART = 'graph TD; A-->B';

describe('Mermaid', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(mermaid.render).mockResolvedValue({
            svg: '<svg data-testid="mock-svg">diagram</svg>',
            diagramType: 'graph',
        });
    });

    // -----------------------------------------------------------------------
    // Basic rendering
    // -----------------------------------------------------------------------
    it('renders a container with class "mermaid"', async () => {
        let container!: HTMLElement;
        await act(async () => {
            ({ container } = render(<Mermaid chart={CHART} theme="dark" />));
        });
        expect(container.querySelector('.mermaid')).not.toBeNull();
    });

    it('is centred via flex layout', async () => {
        let container!: HTMLElement;
        await act(async () => {
            ({ container } = render(<Mermaid chart={CHART} theme="dark" />));
        });
        const div = container.querySelector('.mermaid') as HTMLElement;
        expect(div.style.justifyContent).toBe('center');
    });

    // -----------------------------------------------------------------------
    // mermaid.initialize
    // -----------------------------------------------------------------------
    it('initialises mermaid with the "dark" theme when theme prop is dark', async () => {
        render(<Mermaid chart={CHART} theme="dark" />);
        await act(async () => {});
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ theme: 'dark', startOnLoad: false })
        );
    });

    it('initialises mermaid with "default" theme when theme prop is light', async () => {
        render(<Mermaid chart={CHART} theme="light" />);
        await act(async () => {});
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ theme: 'default' })
        );
    });

    it('passes securityLevel: "loose" on every init', async () => {
        render(<Mermaid chart={CHART} theme="dark" />);
        await act(async () => {});
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ securityLevel: 'strict' })
        );
    });

    // -----------------------------------------------------------------------
    // mermaid.render + SVG injection
    // -----------------------------------------------------------------------
    it('injects the SVG returned by mermaid.render into the container', async () => {
        const { container } = render(<Mermaid chart={CHART} theme="dark" />);
        await waitFor(() => {
            expect(container.querySelector('.mermaid')!.innerHTML).toContain('mock-svg');
        });
    });

    it('calls mermaid.render with a unique id and the chart string', async () => {
        render(<Mermaid chart={CHART} theme="dark" />);
        await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
        const [id, chart] = vi.mocked(mermaid.render).mock.calls[0];
        expect(typeof id).toBe('string');
        expect(id).toMatch(/^mermaid-/);
        expect(chart).toBe(CHART);
    });

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------
    it('shows a "Failed to render diagram" message when mermaid.render rejects', async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('parse error'));
        const { container } = render(<Mermaid chart="bad $$$ chart" theme="dark" />);
        await waitFor(() => {
            expect(container.querySelector('.mermaid')!.innerHTML).toContain(
                'Failed to render diagram'
            );
        });
    });

    it('includes the error message in the failure output', async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('unexpected token'));
        const { container } = render(<Mermaid chart="bad" theme="dark" />);
        await waitFor(() => {
            expect(container.querySelector('.mermaid')!.innerHTML).toContain('unexpected token');
        });
    });

    it('handles non-Error rejection objects gracefully', async () => {
        vi.mocked(mermaid.render).mockRejectedValueOnce('plain string error');
        const { container } = render(<Mermaid chart="bad" theme="dark" />);
        await waitFor(() => {
            expect(container.querySelector('.mermaid')!.innerHTML).toContain(
                'Failed to render diagram'
            );
        });
    });

    // -----------------------------------------------------------------------
    // Empty chart — renderChart should bail out early
    // -----------------------------------------------------------------------
    it('does not call mermaid.render when the chart prop is empty', async () => {
        render(<Mermaid chart="" theme="dark" />);
        await act(async () => {});
        expect(mermaid.render).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Re-render on prop change
    // -----------------------------------------------------------------------
    it('re-initialises when the theme prop changes', async () => {
        const { rerender } = render(<Mermaid chart={CHART} theme="dark" />);
        await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledTimes(1));

        rerender(<Mermaid chart={CHART} theme="light" />);
        await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledTimes(2));
        expect(vi.mocked(mermaid.initialize).mock.calls[1][0]).toMatchObject({ theme: 'default' });
    });

    it('re-renders when the chart prop changes', async () => {
        const { rerender } = render(<Mermaid chart={CHART} theme="dark" />);
        await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

        rerender(<Mermaid chart="graph LR; X-->Y" theme="dark" />);
        await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    });

    // -----------------------------------------------------------------------
    // mermaidInit prop (Default-Mermaid-Init setting)
    // -----------------------------------------------------------------------
    it('spreads mermaidInit overrides into mermaid.initialize', async () => {
        const init = "{'theme': 'base', 'themeVariables': {'fontSize': '16px'}}";
        render(<Mermaid chart={CHART} theme="dark" mermaidInit={init} />);
        await act(async () => {});
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ theme: 'base' })
        );
    });

    it('falls back to theme-prop value when mermaidInit is empty', async () => {
        render(<Mermaid chart={CHART} theme="light" mermaidInit="" />);
        await act(async () => {});
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ theme: 'default' })
        );
    });

    it('falls back gracefully when mermaidInit is invalid syntax', async () => {
        render(<Mermaid chart={CHART} theme="dark" mermaidInit="{ not valid @@@ }" />);
        await act(async () => {});
        // parseMermaidInit returns {} on failure → base theme is used unchanged
        expect(mermaid.initialize).toHaveBeenCalledWith(
            expect.objectContaining({ theme: 'dark' })
        );
    });

    it('re-initialises when the mermaidInit prop changes', async () => {
        const { rerender } = render(<Mermaid chart={CHART} theme="dark" />);
        await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledTimes(1));

        rerender(<Mermaid chart={CHART} theme="dark" mermaidInit="{'theme':'base'}" />);
        await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledTimes(2));
        expect(vi.mocked(mermaid.initialize).mock.calls[1][0]).toMatchObject({ theme: 'base' });
    });

    // -----------------------------------------------------------------------
    // Light copy for the clipboard (REQ-LTTCE-MRC-00005, IMPL-LTTCE-MRC-00003)
    // -----------------------------------------------------------------------
    // Only the *request* for a light render is observable here: turning the
    // resulting SVG into a PNG needs a canvas, which jsdom does not have.
    // What these lock down is that the second render is asked for exactly
    // when it should be, and that it never disturbs the diagram on screen.

    /** The `chart` argument of the Nth mermaid.render call. */
    const renderedSource = (n: number) => String(vi.mocked(mermaid.render).mock.calls[n][1]);

    it('renders a second, light copy when in dark theme with copyLight on', async () => {
        render(<Mermaid chart={CHART} theme="dark" copyLight={true} />);
        await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));

        // The light theme is requested per-diagram, via a directive — NOT via
        // mermaid.initialize, which is global and would repaint other
        // diagrams rendering at the same time.
        expect(renderedSource(1)).toContain('%%{init:');
        expect(renderedSource(1)).toContain('"theme":"default"');
        expect(renderedSource(1)).toContain(CHART);
    });

    it('does not render a second copy in light theme — the screen copy is already light', async () => {
        render(<Mermaid chart={CHART} theme="light" copyLight={true} />);
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
        expect(mermaid.render).toHaveBeenCalledTimes(1);
    });

    it('does not render a second copy when copyLight is off', async () => {
        render(<Mermaid chart={CHART} theme="dark" copyLight={false} />);
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
        expect(mermaid.render).toHaveBeenCalledTimes(1);
    });

    it('keeps the user Default-Mermaid-Init in the light copy', async () => {
        // The setting decides the background, not the user's colours: their
        // themeVariables must survive into the copy.
        render(<Mermaid chart={CHART} theme="dark" copyLight={true}
            mermaidInit="{'themeVariables': {'fontSize': '20px'}}" />);
        await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));

        expect(renderedSource(1)).toContain('"fontSize":"20px"');
        expect(renderedSource(1)).toContain('"theme":"default"');
    });

    it('lets a user-chosen theme win over the light default', async () => {
        render(<Mermaid chart={CHART} theme="dark" copyLight={true} mermaidInit="{'theme':'forest'}" />);
        await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));

        expect(renderedSource(1)).toContain('"theme":"forest"');
    });

    it('leaves the on-screen diagram alone when the light copy fails', async () => {
        vi.mocked(mermaid.render)
            .mockResolvedValueOnce({ svg: '<svg data-testid="mock-svg">on screen</svg>', diagramType: 'graph' })
            .mockRejectedValueOnce(new Error('light render failed'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        let container!: HTMLElement;
        await act(async () => { ({ container } = render(<Mermaid chart={CHART} theme="dark" copyLight={true} />)); });
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        expect(container.querySelector('[data-testid="mock-svg"]')?.textContent).toBe('on screen');
        errSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// PNG cache reaches a final state; export mode skips the idle slot
// (REQ-LTTCE-XPT-00010, IMPL-LTTCE-MRC-00001)
// ---------------------------------------------------------------------------
// A diagram must end with either its PNG or DIAGRAM_PNG_FAILED_ATTR — never
// neither, which an export can only read as "still rendering". In a headless
// export window the cache must not wait for an idle slot a hidden page may
// never get. The idle callback is stubbed to never fire, so anything that
// still settles did so without one.
describe('Mermaid — PNG cache final state and export mode', () => {
    const PNG = 'data:image/png;base64,AAAA';
    let idle: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(mermaid.render).mockResolvedValue({ svg: '<svg data-testid="mock-svg">diagram</svg>', diagramType: 'graph' });
        idle = vi.fn(() => 1);
        vi.stubGlobal('requestIdleCallback', idle);
    });

    afterEach(() => {
        document.documentElement.removeAttribute(EXPORT_MODE_ATTR);
        vi.unstubAllGlobals();
    });

    const mount = async (chart = CHART) => {
        let view!: ReturnType<typeof render>;
        await act(async () => { view = render(<Mermaid chart={chart} theme="light" />); });
        return view;
    };
    const box = (view: ReturnType<typeof render>) => view.container.querySelector('.mermaid')!;

    it('rasterises at once in an export window, without an idle slot', async () => {
        document.documentElement.setAttribute(EXPORT_MODE_ATTR, 'html');
        vi.mocked(rasterizeSvg).mockResolvedValue(PNG);

        const view = await mount();
        await waitFor(() => expect(box(view).getAttribute(DIAGRAM_PNG_ATTR)).toBe(PNG));
        expect(idle).not.toHaveBeenCalled();
    });

    it('marks the diagram failed when rasterising returns nothing', async () => {
        document.documentElement.setAttribute(EXPORT_MODE_ATTR, 'pdf');
        vi.mocked(rasterizeSvg).mockResolvedValue(null);

        const view = await mount();
        await waitFor(() => expect(box(view).hasAttribute(DIAGRAM_PNG_FAILED_ATTR)).toBe(true));
        expect(box(view).hasAttribute(DIAGRAM_PNG_ATTR)).toBe(false);
    });

    it('drops a stale PNG when a later render fails to rasterise', async () => {
        document.documentElement.setAttribute(EXPORT_MODE_ATTR, 'html');
        vi.mocked(rasterizeSvg).mockResolvedValue(PNG);

        const view = await mount();
        await waitFor(() => expect(box(view).getAttribute(DIAGRAM_PNG_ATTR)).toBe(PNG));

        vi.mocked(rasterizeSvg).mockResolvedValue(null);
        vi.mocked(mermaid.render).mockResolvedValue({ svg: '<svg data-testid="mock-svg">changed</svg>', diagramType: 'graph' });
        await act(async () => { view.rerender(<Mermaid chart="graph TD; X-->Y" theme="light" />); });
        await waitFor(() => expect(box(view).hasAttribute(DIAGRAM_PNG_FAILED_ATTR)).toBe(true));
        expect(box(view).hasAttribute(DIAGRAM_PNG_ATTR)).toBe(false);
    });

    it('clears a stale failure mark once a later render succeeds', async () => {
        document.documentElement.setAttribute(EXPORT_MODE_ATTR, 'html');
        vi.mocked(rasterizeSvg).mockResolvedValue(null);

        const view = await mount();
        await waitFor(() => expect(box(view).hasAttribute(DIAGRAM_PNG_FAILED_ATTR)).toBe(true));

        vi.mocked(rasterizeSvg).mockResolvedValue(PNG);
        vi.mocked(mermaid.render).mockResolvedValue({ svg: '<svg data-testid="mock-svg">changed</svg>', diagramType: 'graph' });
        await act(async () => { view.rerender(<Mermaid chart="graph TD; X-->Y" theme="light" />); });
        await waitFor(() => expect(box(view).getAttribute(DIAGRAM_PNG_ATTR)).toBe(PNG));
        expect(box(view).hasAttribute(DIAGRAM_PNG_FAILED_ATTR)).toBe(false);
    });

    it('still defers to an idle slot in the interactive app', async () => {
        vi.mocked(rasterizeSvg).mockResolvedValue(PNG);

        const view = await mount();
        await waitFor(() => expect(idle).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });
        expect(rasterizeSvg).not.toHaveBeenCalled();
        expect(box(view).hasAttribute(DIAGRAM_PNG_ATTR)).toBe(false);
    });
});
