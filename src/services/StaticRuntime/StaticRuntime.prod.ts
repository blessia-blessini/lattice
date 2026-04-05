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
// StaticRuntime (PROD)
//**************************************************************
import { IStaticRuntime } from "./IStaticRuntime";

/**
 * PRODUCTION Implementation.
 * Completely empty No-Op.
 * This code contains NO Reference to 'invoke' or 'trace_log'.
 */
export const StaticRuntime: IStaticRuntime = {
    //**************************************************************
    // init
    //************************************************************** 
    init: () => {
        // No-op
    },
    // init END ****************************************************

    //**************************************************************
    // log
    //**************************************************************
    log: (_msg: string, ..._args: any[]) => {
        // No-op
    },
    // log END *****************************************************

    //**************************************************************
    // error
    //**************************************************************
    error: (_msg: string, ..._args: any[]) => {
        // No-op (or maybe retain console.error? Usually we want to silence logs in prod)
        // The original App.tsx silenced console.log but left others? 
        // Steps say: "Production: Silence sensitive logs".
        // We will silence all debug logs.
    },
    // error END ***************************************************

    setupTestModeListeners: () => {
        // No-op
    }
    // setupTestModeListeners END ***********************************
};
// StaticRuntime END *******************************************
