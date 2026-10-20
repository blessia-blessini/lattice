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

// IMPL-LTTCE-FOS-00003 — thin wrapper over the backend command that opens the
// bundled third-party notices (src-tauri/src/licences.rs).

import { invoke } from '@tauri-apps/api/core';

/** Lattice's own licence, shown next to the link to the notices. */
export const LATTICE_LICENSE = 'AGPL-3.0-or-later';

//**************************************************************
// Licences
//**************************************************************
export const Licences = {
    /** Opens THIRD-PARTY-NOTICES.md in a new, read-only editor window. */
    openNotices: async (): Promise<void> => {
        await invoke('open_licences_window');
    },
};
// Licences END ************************************************
