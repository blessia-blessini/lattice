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
import React, { useEffect, useRef } from 'react';

/** How the user resolved the spreadsheet-paste question. */
export type PasteTableChoice = 'table' | 'plain' | 'cancel';

/** Maximum preview lines shown before the preview is elided. */
const PREVIEW_MAX_LINES = 8;

/** Props for {@link PasteTableDialog}. */
export interface PasteTableDialogProps {
    /** Colour scheme, mirrored from the editor so the dialog never flashes white on dark. */
    theme: 'light' | 'dark';
    /** Grid row count reported by the backend (header row included). */
    rows: number;
    /** Grid column count reported by the backend. */
    columns: number;
    /** The Markdown table that would be inserted — shown as a preview. */
    markdown: string;
    /** Called exactly once with the user's decision; the dialog does not close itself. */
    onChoice: (choice: PasteTableChoice) => void;
}

//******************************************************************************
// PasteTableDialog
//******************************************************************************
/**
 * IMPL-LTTCE-TBL-00002 — in-app confirmation shown after a spreadsheet paste
 * is intercepted (REQ-LTTCE-TBL-00001, REQ-LTTCE-TBL-00002).
 *
 * Deliberately a plain React overlay rather than a platform dialog API
 * (`window.confirm`, `@tauri-apps/plugin-dialog`, a native alert): those either
 * do not exist, look alien, or block the WebView differently on Windows,
 * macOS, Linux, Android and iOS. Markup renders identically everywhere and is
 * reachable from the unit tests.
 *
 * Keyboard contract: `Enter` = insert the table (the default action, matching
 * the focused button), `Escape` = cancel and insert nothing.
 */
export const PasteTableDialog: React.FC<PasteTableDialogProps> = ({
    theme,
    rows,
    columns,
    markdown,
    onChoice,
}) => {
    const primaryRef = useRef<HTMLButtonElement | null>(null);
    const dark = theme === 'dark';

    // Focus the default action so Enter/Space work without a mouse, and so
    // screen readers announce the dialog on open.
    useEffect(() => {
        primaryRef.current?.focus();
    }, []);

    //**************************************************************************
    // key handling
    //**************************************************************************
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onChoice('cancel');
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            onChoice('table');
        }
    };
    // key handling END ********************************************************

    const previewLines = markdown.split('\n');
    const preview = previewLines.slice(0, PREVIEW_MAX_LINES).join('\n');
    const elided = previewLines.length > PREVIEW_MAX_LINES;

    const buttonBase: React.CSSProperties = {
        padding: '0.5rem 0.9rem',
        borderRadius: '6px',
        border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
        cursor: 'pointer',
        fontSize: '0.9rem',
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Paste from spreadsheet"
            onKeyDown={onKeyDown}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
                zIndex: 100000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
            }}
        >
            <div
                style={{
                    backgroundColor: dark ? '#161b22' : '#ffffff',
                    color: dark ? '#c9d1d9' : '#24292f',
                    border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
                    borderRadius: '8px',
                    padding: '1.25rem',
                    maxWidth: '40rem',
                    width: '100%',
                    maxHeight: '100%',
                    overflow: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}
            >
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>Paste from spreadsheet</h3>
                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem' }}>
                    The pasted text looks like a table of {rows} row{rows === 1 ? '' : 's'} ×{' '}
                    {columns} column{columns === 1 ? '' : 's'}. Insert it as a Markdown table?
                </p>
                <pre
                    data-testid="paste-table-preview"
                    style={{
                        margin: '0 0 1rem 0',
                        padding: '0.6rem',
                        backgroundColor: dark ? '#0d1117' : '#f6f8fa',
                        border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        whiteSpace: 'pre',
                    }}
                >
                    {preview}
                    {elided ? '\n…' : ''}
                </pre>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                        ref={primaryRef}
                        onClick={() => onChoice('table')}
                        style={{
                            ...buttonBase,
                            backgroundColor: '#2ea44f',
                            color: 'white',
                            borderColor: '#2ea44f',
                        }}
                    >
                        Insert as Markdown table
                    </button>
                    <button
                        onClick={() => onChoice('plain')}
                        style={{
                            ...buttonBase,
                            backgroundColor: dark ? '#21262d' : '#f6f8fa',
                            color: dark ? '#c9d1d9' : '#24292f',
                        }}
                    >
                        Insert as plain text
                    </button>
                    <button
                        onClick={() => onChoice('cancel')}
                        style={{
                            ...buttonBase,
                            backgroundColor: 'transparent',
                            color: dark ? '#8b949e' : '#57606a',
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
// PasteTableDialog END ********************************************************

export default PasteTableDialog;
