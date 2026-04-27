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
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the mermaid library — it does not run in JSDOM
// ---------------------------------------------------------------------------
vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mock-svg">diagram</svg>' }),
    },
}));

import mermaid from 'mermaid';
import { Mermaid } from './Mermaid';

const CHART = 'graph TD; A-->B';

describe('Mermaid', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(mermaid.render).mockResolvedValue({
            svg: '<svg data-testid="mock-svg">diagram</svg>',
        });
    });

    // -----------------------------------------------------------------------
    // Basic rendering
    // -----------------------------------------------------------------------
    it('renders a container with class "mermaid"', () => {
        const { container } = render(<Mermaid chart={CHART} theme="dark" />);
        expect(container.querySelector('.mermaid')).not.toBeNull();
    });

    it('is centred via flex layout', () => {
        const { container } = render(<Mermaid chart={CHART} theme="dark" />);
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
            expect.objectContaining({ securityLevel: 'loose' })
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
});
