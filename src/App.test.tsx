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
//
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { StaticRuntime } from "@services/StaticRuntime";
import { save } from '@tauri-apps/plugin-dialog';

// Mock dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn()
}));

// Mock the Editor to ensure refs and imperative handles work reliably in JSDOM
vi.mock('./components/Editor', () => ({
    Editor: React.forwardRef((_props, ref) => {
        React.useImperativeHandle(ref, () => ({
            markAsSaved: vi.fn(),
            getContent: () => "mocked content"
        }));
        return <div data-testid="mock-editor"></div>;
    })
}));

// Mock invoke return values
vi.mocked(TauriCore.invoke).mockImplementation((cmd, args: any) => {
    if (cmd === 'initialize_vault_settings') {
        return Promise.resolve('settings.json');
    }
    if (cmd === 'find_vault_settings_file') {
        return Promise.resolve(null);
    }
    if (cmd === 'read_text_file') {
        return Promise.resolve({ content: '# Demo', hash: '123' });
    }
    if (cmd === 'calc_base_path') {
        return Promise.resolve();
    }
    if (cmd === 'write_text_file') {
        return Promise.resolve({ path: args?.path || 'unknown', hash: 'new-hash' });
    }
    if (cmd === 'watch_file') {
        return Promise.resolve();
    }
    if (cmd === 'trace_log') {
        const time = new Date().toISOString().split('T')[1].replace('Z', '');
        // Use process.stdout to avoid recursion with patched console.error
        StaticRuntime.log(`[MOCK_TRACE:${time}] ${args?.msg || ''}\n`);
        return Promise.resolve();
    }
    return Promise.resolve(null);
});

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders without crashing', () => {
        render(<App />);
        expect(document.body).toBeTruthy();
    });

    it('triggers save dialog and writes file when "Save as ..." is clicked', async () => {
        // Initialize the app with an open file so that "Save as ..." is enabled
        (window as any).__LATTICE_INIT_DATA__ = {
            path: 'mocked-initial.md',
            content: 'init content'
        };

        vi.mocked(save).mockResolvedValueOnce('mocked-new-file.md');
        const { getByText } = render(<App />);

        // Wait for render to settle
        await waitFor(() => expect(getByText('☰ Menu')).toBeTruthy());

        // Open menu
        fireEvent.click(getByText('☰ Menu'));

        // Click Save As ...
        const saveAsButton = await waitFor(() => getByText('Save as ...'));
        fireEvent.click(saveAsButton);

        // Verify save plugin was called
        await waitFor(() => expect(save).toHaveBeenCalled());

        // Verify Tauri write command was executed with the new path
        await waitFor(() => {
            expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({
                path: 'mocked-new-file.md',
                content: 'mocked content'
            }));
        });
    });
});
