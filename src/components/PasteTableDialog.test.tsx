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

// UTST for REQ-LTTCE-TBL-00001 / REQ-LTTCE-TBL-00002 (IMPL-LTTCE-TBL-00002):
// the in-app spreadsheet-paste dialog. These tests deliberately assert markup
// and keyboard behaviour rather than pixels — the requirement is that the same
// dialog exists and behaves identically on every platform, and markup is the
// part that is platform-independent by construction.

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PasteTableDialog } from './PasteTableDialog';

const MARKDOWN = '| a | b |\n| - | - |\n| 1 | 2 |';

const renderDialog = (overrides: Partial<React.ComponentProps<typeof PasteTableDialog>> = {}) => {
    const onChoice = vi.fn();
    render(
        <PasteTableDialog
            theme="light"
            rows={2}
            columns={2}
            markdown={MARKDOWN}
            onChoice={onChoice}
            {...overrides}
        />
    );
    return { onChoice };
};

describe('PasteTableDialog', () => {
    it('renders as a modal dialog with the grid size in the prompt', () => {
        renderDialog({ rows: 3, columns: 4 });
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.textContent).toContain('3 rows × 4 columns');
    });

    it('singularises a one-row, one-column grid', () => {
        renderDialog({ rows: 1, columns: 1 });
        expect(screen.getByRole('dialog').textContent).toContain('1 row × 1 column');
    });

    it('previews the markdown that would be inserted', () => {
        renderDialog();
        expect(screen.getByTestId('paste-table-preview').textContent).toContain('| a | b |');
    });

    it('elides a long preview instead of growing without bound', () => {
        const long = Array.from({ length: 30 }, (_, i) => `| r${i} |`).join('\n');
        renderDialog({ markdown: long });
        const preview = screen.getByTestId('paste-table-preview').textContent!;
        expect(preview).toContain('…');
        expect(preview.split('\n').length).toBeLessThanOrEqual(9); // 8 lines + the ellipsis line
    });

    it('focuses the default action so Enter works without a mouse', () => {
        renderDialog();
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: /insert as markdown table/i })
        );
    });

    it.each([
        [/insert as markdown table/i, 'table'],
        [/insert as plain text/i, 'plain'],
        [/cancel/i, 'cancel'],
    ])('reports %s as choice "%s"', (label, expected) => {
        const { onChoice } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(onChoice).toHaveBeenCalledTimes(1);
        expect(onChoice).toHaveBeenCalledWith(expected);
    });

    it('Enter chooses the table, Escape cancels', () => {
        const { onChoice } = renderDialog();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
        expect(onChoice).toHaveBeenLastCalledWith('table');

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onChoice).toHaveBeenLastCalledWith('cancel');
    });

    it('ignores unrelated keys', () => {
        const { onChoice } = renderDialog();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });
        expect(onChoice).not.toHaveBeenCalled();
    });

    it('does not close itself — the owner decides', () => {
        const { onChoice } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onChoice).toHaveBeenCalledWith('cancel');
        // Still mounted: unmounting is the caller's job (Editor clears its state).
        expect(screen.getByRole('dialog')).toBeTruthy();
    });
});
