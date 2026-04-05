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
//**************************************************************
// IStaticRuntime
//**************************************************************
/**
 * Interface for the Static Runtime Environment.
 * Implementations are swapped at build time.
 */
export interface IStaticRuntime {
    /**
     * Initialize the runtime (e.g., set up logging hooks).
     * Should be called once at App startup.
     */
    init(): void;

    /**
     * Log a message to the debug output (and backend if configured).
     */
    log(msg: string, ...args: any[]): void;

    /**
     * Log an error.
     */
    /**
     * Log an error.
     */
    error(msg: string, ...args: any[]): void;

    /**
     * Set up listeners for test mode (e.g., file change detection).
     */
    setupTestModeListeners(): void;
}
// IStaticRuntime END *******************************************
