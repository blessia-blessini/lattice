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
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import { Settings } from './Settings';

// ---------------------------------------------------------------------------
// Default prop set — individual tests override specific fields as needed
// ---------------------------------------------------------------------------
const DEFAULT_PROPS = {
    defaultTheme: 'dark' as const,
    onDefaultThemeChange: vi.fn(),
    wordWrap: false,
    onWordWrapChange: vi.fn(),
    saveOnBlur: false,
    dailyNotesPath: '/my/notes',
    onDailyNotesPathChange: vi.fn(),
    onClose: vi.fn(),
    settingsPath: '/vault/.lattice/settings.json',
};

// Helpers to locate the two toggle divs without depending on fragile CSS queries.
// Theme toggle: the onClick div sitting between the "Light" and "Dark" labels.
// Word-wrap toggle: the onClick div whose next sibling contains "On"/"Off".
const getThemeToggle = (container: HTMLElement) => {
    const darkSpan = Array.from(container.querySelectorAll('span')).find(
        s => s.textContent === 'Dark'
    )!;
    // Previous element sibling of the "Dark" label is the toggle div
    return darkSpan.previousElementSibling as HTMLElement;
};

const getWordWrapToggle = (container: HTMLElement) => {
    const onOffSpan = Array.from(container.querySelectorAll('span')).find(
        s => s.textContent === 'On' || s.textContent === 'Off'
    )!;
    return onOffSpan.previousElementSibling as HTMLElement;
};

describe('Settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    it('renders the Settings heading', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} />);
        expect(getByText('Settings')).toBeTruthy();
    });

    it('renders the "Appearance" section heading', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} />);
        expect(getByText('Appearance')).toBeTruthy();
    });

    it('shows the settings file path in the footer', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} settingsPath="/vault/.lattice/settings.json" />);
        expect(getByText(/\/vault\/.lattice\/settings.json/)).toBeTruthy();
    });

    it('displays the daily notes path in the input', () => {
        const { getByDisplayValue } = render(<Settings {...DEFAULT_PROPS} dailyNotesPath="/daily" />);
        expect(getByDisplayValue('/daily')).toBeTruthy();
    });

    // -----------------------------------------------------------------------
    // Dark / Light theme label weights
    // -----------------------------------------------------------------------
    it('bolds the "Dark" label when defaultTheme is dark', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} defaultTheme="dark" />);
        expect((getByText('Dark') as HTMLElement).style.fontWeight).toBe('bold');
    });

    it('bolds the "Light" label when defaultTheme is light', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} defaultTheme="light" />);
        expect((getByText('Light') as HTMLElement).style.fontWeight).toBe('bold');
    });

    // -----------------------------------------------------------------------
    // Theme toggle
    // -----------------------------------------------------------------------
    it('calls onDefaultThemeChange with "light" when toggled from dark', async () => {
        const onThemeChange = vi.fn();
        const { container } = render(
            <Settings {...DEFAULT_PROPS} defaultTheme="dark" onDefaultThemeChange={onThemeChange} />
        );
        await act(async () => { fireEvent.click(getThemeToggle(container)); });
        expect(onThemeChange).toHaveBeenCalledWith('light');
    });

    it('calls onDefaultThemeChange with "dark" when toggled from light', async () => {
        const onThemeChange = vi.fn();
        const { container } = render(
            <Settings {...DEFAULT_PROPS} defaultTheme="light" onDefaultThemeChange={onThemeChange} />
        );
        await act(async () => { fireEvent.click(getThemeToggle(container)); });
        expect(onThemeChange).toHaveBeenCalledWith('dark');
    });

    it('invokes save_settings after a theme toggle', async () => {
        const { container } = render(<Settings {...DEFAULT_PROPS} />);
        await act(async () => { fireEvent.click(getThemeToggle(container)); });
        expect(TauriCore.invoke).toHaveBeenCalledWith(
            'save_settings',
            expect.objectContaining({ settingsPath: DEFAULT_PROPS.settingsPath })
        );
    });

    // -----------------------------------------------------------------------
    // Word wrap toggle
    // -----------------------------------------------------------------------
    it('shows "Off" label when wordWrap is false', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} wordWrap={false} />);
        expect(getByText('Off')).toBeTruthy();
    });

    it('shows "On" label when wordWrap is true', () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} wordWrap={true} />);
        expect(getByText('On')).toBeTruthy();
    });

    it('calls onWordWrapChange with true when word wrap is toggled on', async () => {
        const onWrapChange = vi.fn();
        const { container } = render(
            <Settings {...DEFAULT_PROPS} wordWrap={false} onWordWrapChange={onWrapChange} />
        );
        await act(async () => { fireEvent.click(getWordWrapToggle(container)); });
        expect(onWrapChange).toHaveBeenCalledWith(true);
    });

    it('calls onWordWrapChange with false when word wrap is toggled off', async () => {
        const onWrapChange = vi.fn();
        const { container } = render(
            <Settings {...DEFAULT_PROPS} wordWrap={true} onWordWrapChange={onWrapChange} />
        );
        await act(async () => { fireEvent.click(getWordWrapToggle(container)); });
        expect(onWrapChange).toHaveBeenCalledWith(false);
    });

    // -----------------------------------------------------------------------
    // Daily notes path
    // -----------------------------------------------------------------------
    it('calls onDailyNotesPathChange when the input changes', async () => {
        const onPathChange = vi.fn();
        const { getByDisplayValue } = render(
            <Settings {...DEFAULT_PROPS} dailyNotesPath="/old" onDailyNotesPathChange={onPathChange} />
        );
        const input = getByDisplayValue('/old');
        await act(async () => { fireEvent.change(input, { target: { value: '/new/path' } }); });
        expect(onPathChange).toHaveBeenCalledWith('/new/path');
    });

    it('invokes save_settings with the new daily notes path', async () => {
        const { getByDisplayValue } = render(<Settings {...DEFAULT_PROPS} dailyNotesPath="/old" />);
        await act(async () => {
            fireEvent.change(getByDisplayValue('/old'), { target: { value: '/new' } });
        });
        expect(TauriCore.invoke).toHaveBeenCalledWith(
            'save_settings',
            expect.objectContaining({
                settings: expect.objectContaining({ dailyNotesPath: '/new' }),
            })
        );
    });

    // -----------------------------------------------------------------------
    // Close button
    // -----------------------------------------------------------------------
    it('calls onClose when the Close Settings button is clicked and onClose is provided', async () => {
        const onClose = vi.fn();
        const { getByText } = render(<Settings {...DEFAULT_PROPS} onClose={onClose} />);
        await act(async () => { fireEvent.click(getByText('Close Settings')); });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('invokes close_settings_window when onClose is not provided', async () => {
        const { getByText } = render(<Settings {...DEFAULT_PROPS} onClose={undefined} />);
        await act(async () => { fireEvent.click(getByText('Close Settings')); });
        expect(TauriCore.invoke).toHaveBeenCalledWith('close_settings_window');
    });

    // -----------------------------------------------------------------------
    // Save status message
    // -----------------------------------------------------------------------
    it('shows "Saved!" after a successful save_settings call', async () => {
        // The global setup mock resolves null for unknown commands — good enough here.
        const { container, getByText } = render(<Settings {...DEFAULT_PROPS} />);
        await act(async () => { fireEvent.click(getThemeToggle(container)); });
        await waitFor(() => expect(getByText('Saved!')).toBeTruthy());
    });

    it('shows "Error saving settings" when save_settings rejects', async () => {
        vi.mocked(TauriCore.invoke).mockRejectedValueOnce(new Error('disk full'));
        const { container, getByText } = render(<Settings {...DEFAULT_PROPS} />);
        await act(async () => { fireEvent.click(getThemeToggle(container)); });
        await waitFor(() => expect(getByText('Error saving settings')).toBeTruthy());
    });

    it('status paragraph is hidden when no save has occurred yet', () => {
        const { container } = render(<Settings {...DEFAULT_PROPS} />);
        // The status <p> uses visibility:hidden (not display:none) when empty
        const statusP = container.querySelector('p[style*="color: rgb(46, 164, 79)"]') as HTMLElement;
        expect(statusP).not.toBeNull();
        expect(statusP.style.visibility).toBe('hidden');
    });
});
