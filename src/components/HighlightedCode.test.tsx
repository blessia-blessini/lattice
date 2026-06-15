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

// UTST / ITST for IMPL-LTTCE-PRV-00002 — wired tests for the preview
// HighlightedCode component (real Lezer parsers, no mocks).

import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HighlightedCode } from './HighlightedCode';

//******************************************************************************
// HighlightedCode tests
//******************************************************************************
describe('HighlightedCode', () => {
    it('renders plain code first, then swaps in tok-* spans (known language)', async () => {
        const { container } = render(
            <HighlightedCode code="const x = 1;" languageTag="js" className="language-js" />
        );
        // Immediately: plain fallback with the original class and full text.
        const codeEl = container.querySelector('code.language-js');
        expect(codeEl).not.toBeNull();
        expect(codeEl!.textContent).toBe('const x = 1;');

        // After the language bundle loads: highlighted spans appear.
        await waitFor(() => {
            expect(container.querySelector('span.tok-keyword')).not.toBeNull();
        });
        expect(container.querySelector('span.tok-keyword')!.textContent).toBe('const');
        expect(container.querySelector('span.tok-number')!.textContent).toBe('1');
        // Text content must be unchanged by highlighting.
        expect(container.querySelector('code')!.textContent).toBe('const x = 1;');
    });

    it('stays plain for an unknown language tag', async () => {
        const { container } = render(
            <HighlightedCode code="??" languageTag="no-such-language-xyz" />
        );
        // Give the (rejected) lookup a chance to settle, then assert no spans.
        await new Promise(r => setTimeout(r, 50));
        expect(container.querySelector('[class*="tok-"]')).toBeNull();
        expect(container.querySelector('code')!.textContent).toBe('??');
    });

    it('re-highlights when the language tag changes', async () => {
        const { container, rerender } = render(
            <HighlightedCode code="# title" languageTag="js" />
        );
        await waitFor(() => {
            // In JS, `# title` is no comment — just wait for load to settle.
            expect(container.querySelector('code')).not.toBeNull();
        });
        rerender(<HighlightedCode code="# title" languageTag="python" />);
        await waitFor(() => {
            expect(container.querySelector('span.tok-comment')).not.toBeNull();
        });
        expect(container.querySelector('span.tok-comment')!.textContent).toBe('# title');
    });
});
// HighlightedCode tests END ***************************************************
