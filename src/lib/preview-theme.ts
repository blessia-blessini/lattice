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
 * Preview-pane colour scheme.
 *
 * Shared because two unrelated places need the *same* background value: the
 * preview pane paints it, and a diagram rasterised for the clipboard has to be
 * flattened onto it (a PNG with a transparent background renders black in
 * paste targets that do not composite). Two copies of these hex values would
 * drift, and the drift would only ever show up in someone's pasted document.
 */
export type PreviewTheme = 'light' | 'dark';

export const PREVIEW_THEME_COLORS: Record<
    PreviewTheme,
    { backgroundColor: string; color: string; colorScheme: PreviewTheme }
> = {
    light: { backgroundColor: '#ffffff', color: '#24292e', colorScheme: 'light' },
    dark: { backgroundColor: '#0d1117', color: '#c9d1d9', colorScheme: 'dark' },
};
