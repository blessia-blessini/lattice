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
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Menu, MenuItem } from './Menu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeItems = (): MenuItem[] => [
    { label: 'Item 1', onClick: vi.fn() },
    { label: '---' },
    { label: 'Item 2 (disabled)', onClick: vi.fn(), disabled: true },
    {
        label: 'Has Submenu',
        submenu: [
            { label: 'Sub Item A', onClick: vi.fn() },
            { label: 'Sub Item B', onClick: vi.fn() },
        ]
    },
];

describe('Menu', () => {
    let items: MenuItem[];

    beforeEach(() => {
        items = makeItems();
    });

    // -----------------------------------------------------------------------
    // Rendering & open/close
    // -----------------------------------------------------------------------
    it('renders the toggle button', () => {
        const { getByRole } = render(<Menu items={items} theme="dark" />);
        expect(getByRole('button')).toBeTruthy();
    });

    it('dropdown is closed initially', () => {
        const { queryByText } = render(<Menu items={items} theme="dark" />);
        expect(queryByText('Item 1')).toBeNull();
    });

    it('opens the dropdown when the button is clicked', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        expect(getByText('Item 1')).toBeTruthy();
    });

    it('closes the dropdown on a second button click', () => {
        const { getByRole, queryByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByRole('button'));
        expect(queryByText('Item 1')).toBeNull();
    });

    it('renders a horizontal rule separator for "---" labels', () => {
        const { container, getByRole } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        // Separator is a div with height 1px
        const sep = container.querySelector('div[style*="height: 1px"]');
        expect(sep).not.toBeNull();
    });

    // -----------------------------------------------------------------------
    // Click outside
    // -----------------------------------------------------------------------
    it('closes the dropdown when a mousedown fires outside the menu', () => {
        const { getByRole, getByText, queryByText } = render(
            <div>
                <Menu items={items} theme="dark" />
                <div data-testid="elsewhere">outside</div>
            </div>
        );
        fireEvent.click(getByRole('button'));
        expect(getByText('Item 1')).toBeTruthy();

        fireEvent.mouseDown(document.body);
        expect(queryByText('Item 1')).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Regular item interaction
    // -----------------------------------------------------------------------
    it('calls onClick and closes the menu when a regular item is clicked', () => {
        const onClick = vi.fn();
        const { getByRole, getByText, queryByText } = render(
            <Menu items={[{ label: 'Action', onClick }]} theme="dark" />
        );
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Action'));
        expect(onClick).toHaveBeenCalledOnce();
        expect(queryByText('Action')).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Disabled item
    // -----------------------------------------------------------------------
    it('does not call onClick when a disabled item is clicked', () => {
        const onClick = vi.fn();
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Noop', onClick, disabled: true }]} theme="dark" />
        );
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Noop'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('applies not-allowed cursor on a disabled item', () => {
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Noop', onClick: vi.fn(), disabled: true }]} theme="dark" />
        );
        fireEvent.click(getByRole('button'));
        const item = getByText('Noop').closest('.menu-item') as HTMLElement;
        expect(item.style.cursor).toBe('not-allowed');
    });

    // -----------------------------------------------------------------------
    // Submenu
    // -----------------------------------------------------------------------
    it('expands a submenu when the parent item is clicked', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Has Submenu'));
        expect(getByText('Sub Item A')).toBeTruthy();
    });

    it('collapses a submenu on a second click of the parent item', () => {
        const { getByRole, getByText, queryByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Has Submenu'));
        fireEvent.click(getByText('Has Submenu'));
        expect(queryByText('Sub Item A')).toBeNull();
    });

    it('shows ▶ indicator when submenu is collapsed', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        expect(getByText('▶')).toBeTruthy();
    });

    it('shows ▼ indicator when submenu is expanded', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Has Submenu'));
        expect(getByText('▼')).toBeTruthy();
    });

    it('resets submenus to collapsed when the menu is closed and reopened', () => {
        const { getByRole, getByText, queryByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button')); // open
        fireEvent.click(getByText('Has Submenu')); // expand submenu
        expect(getByText('Sub Item A')).toBeTruthy();

        fireEvent.click(getByRole('button')); // close
        fireEvent.click(getByRole('button')); // reopen
        expect(queryByText('Sub Item A')).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Sub-item click
    // -----------------------------------------------------------------------
    it('calls sub-item onClick and closes the whole menu', () => {
        const subClick = vi.fn();
        const { getByRole, getByText, queryByText } = render(
            <Menu
                items={[{ label: 'Parent', submenu: [{ label: 'Child', onClick: subClick }] }]}
                theme="dark"
            />
        );
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Parent'));
        fireEvent.click(getByText('Child'));
        expect(subClick).toHaveBeenCalledOnce();
        expect(queryByText('Child')).toBeNull();
    });

    // -----------------------------------------------------------------------
    // truncatePath
    // -----------------------------------------------------------------------
    it('truncates sub-item labels longer than 40 characters', () => {
        const longPath = '/very/long/path/to/some/deeply/nested/directory/file.md'; // > 40 chars
        const { getByRole, getByText } = render(
            <Menu
                items={[{ label: 'Recent', submenu: [{ label: longPath, onClick: vi.fn() }] }]}
                theme="dark"
            />
        );
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Recent'));
        expect(getByText('.../file.md')).toBeTruthy();
    });

    it('does not truncate sub-item labels of 40 characters or fewer', () => {
        const shortPath = 'short-file.md'; // <= 40 chars
        const { getByRole, getByText } = render(
            <Menu
                items={[{ label: 'Recent', submenu: [{ label: shortPath, onClick: vi.fn() }] }]}
                theme="dark"
            />
        );
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Recent'));
        expect(getByText('short-file.md')).toBeTruthy();
    });

    // -----------------------------------------------------------------------
    // Hover effects — enabled items
    // -----------------------------------------------------------------------
    it('highlights an enabled item on mouseEnter (dark theme)', () => {
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Hover Me', onClick: vi.fn() }]} theme="dark" />
        );
        fireEvent.click(getByRole('button'));
        const item = getByText('Hover Me').closest('.menu-item') as HTMLElement;
        fireEvent.mouseEnter(item);
        // JSDOM normalises hex colours set via JS inline style to rgb() form
        expect(item.style.backgroundColor).toBe('rgb(31, 111, 235)');
    });

    it('restores transparent background on mouseLeave (dark theme)', () => {
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Hover Me', onClick: vi.fn() }]} theme="dark" />
        );
        fireEvent.click(getByRole('button'));
        const item = getByText('Hover Me').closest('.menu-item') as HTMLElement;
        fireEvent.mouseEnter(item);
        fireEvent.mouseLeave(item);
        expect(item.style.backgroundColor).toBe('transparent');
    });

    it('highlights an enabled item on mouseEnter (light theme)', () => {
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Hover Me', onClick: vi.fn() }]} theme="light" />
        );
        fireEvent.click(getByRole('button'));
        const item = getByText('Hover Me').closest('.menu-item') as HTMLElement;
        fireEvent.mouseEnter(item);
        // JSDOM normalises hex colours set via JS inline style to rgb() form
        expect(item.style.backgroundColor).toBe('rgb(3, 102, 214)');
    });

    it('restores correct text color on mouseLeave (light theme)', () => {
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Hover Me', onClick: vi.fn() }]} theme="light" />
        );
        fireEvent.click(getByRole('button'));
        const item = getByText('Hover Me').closest('.menu-item') as HTMLElement;
        fireEvent.mouseEnter(item);
        fireEvent.mouseLeave(item);
        // JSDOM normalises hex colours set via JS inline style to rgb() form
        expect(item.style.color).toBe('rgb(36, 41, 46)');
    });

    // -----------------------------------------------------------------------
    // Hover effects — disabled items (no change)
    // -----------------------------------------------------------------------
    it('does not highlight a disabled item on mouseEnter', () => {
        const { getByRole, getByText } = render(
            <Menu items={[{ label: 'Disabled', onClick: vi.fn(), disabled: true }]} theme="dark" />
        );
        fireEvent.click(getByRole('button'));
        const item = getByText('Disabled').closest('.menu-item') as HTMLElement;
        const bgBefore = item.style.backgroundColor;
        fireEvent.mouseEnter(item);
        expect(item.style.backgroundColor).toBe(bgBefore);
    });

    // -----------------------------------------------------------------------
    // Hover effects — sub-items inside expanded submenus
    // -----------------------------------------------------------------------
    it('highlights a sub-item on mouseEnter (dark theme)', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Has Submenu'));
        const subItem = getByText('Sub Item A') as HTMLElement;
        fireEvent.mouseEnter(subItem);
        expect(subItem.style.backgroundColor).toBe('rgba(31, 111, 235, 0.2)');
    });

    it('resets sub-item background on mouseLeave (dark theme)', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="dark" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Has Submenu'));
        const subItem = getByText('Sub Item A') as HTMLElement;
        fireEvent.mouseEnter(subItem);
        fireEvent.mouseLeave(subItem);
        expect(subItem.style.backgroundColor).toBe('transparent');
    });

    it('highlights a sub-item on mouseEnter (light theme)', () => {
        const { getByRole, getByText } = render(<Menu items={items} theme="light" />);
        fireEvent.click(getByRole('button'));
        fireEvent.click(getByText('Has Submenu'));
        const subItem = getByText('Sub Item A') as HTMLElement;
        fireEvent.mouseEnter(subItem);
        expect(subItem.style.backgroundColor).toBe('rgba(3, 102, 214, 0.1)');
    });

    // -----------------------------------------------------------------------
    // buttonStyle prop
    // -----------------------------------------------------------------------
    it('applies buttonStyle to the toggle button', () => {
        const { getByRole } = render(
            <Menu items={[]} theme="dark" buttonStyle={{ fontSize: '20px' }} />
        );
        expect((getByRole('button') as HTMLElement).style.fontSize).toBe('20px');
    });

    // -----------------------------------------------------------------------
    // title attribute
    // -----------------------------------------------------------------------
    it('renders a native title tooltip on items that supply one', () => {
        const { getByRole, container } = render(
            <Menu
                items={[{ label: 'Action', onClick: vi.fn(), title: 'Shortcut: Ctrl+Shift+T' }]}
                theme="dark"
            />
        );
        fireEvent.click(getByRole('button'));
        const item = container.querySelector('.menu-item') as HTMLElement;
        expect(item.getAttribute('title')).toBe('Shortcut: Ctrl+Shift+T');
    });
});
