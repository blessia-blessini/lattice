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

import '@testing-library/react';
import { vi } from 'vitest';
import { StaticRuntime } from "@services/StaticRuntime";

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn((cmd, args) => {
        if (cmd === 'trace_log') {
            const time = new Date().toISOString().split('T')[1].replace('Z', '');
            // Use process.stdout to avoid recursion with patched console.error
            StaticRuntime.log(`[MOCK_TRACE:${time}] ${args?.msg || ''}\n`);
            return Promise.resolve();
        }
        if (cmd === 'get_version_string') return Promise.resolve('0.0.0-TEST');
        return Promise.resolve(null);
    }),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: () => ({
        setFocus: vi.fn(),
        show: vi.fn(),
        close: vi.fn(),
        onCloseRequested: vi.fn(),
        setTitle: vi.fn(),
    }),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(vi.fn())), // Unlisten fn
    emit: vi.fn(),
}));

// Mock Plugin Dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
    save: vi.fn(),
}));
