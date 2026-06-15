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
// StaticRuntime (DEV)
//**************************************************************
import { invoke } from "@tauri-apps/api/core";
import { IStaticRuntime } from "./IStaticRuntime";
import { listen } from "@tauri-apps/api/event";

/**
 * DEVELOPMENT Implementation.
 * Contains real logging logic and backend tracing.
 */
// Helper for sending traces
const sendTrace = (level: string, msg: string, ...args: any[]) => {
    try {
        const argStr = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
        const fullMsg = `INT ${level.padEnd(7)} [${time}] ${msg} ${argStr}`;

        invoke('trace_log', { msg: fullMsg }).catch(() => { });
    } catch (e) { }
};

export const StaticRuntime: IStaticRuntime = {
    //**************************************************************
    // init
    //**************************************************************
    init: () => {
        // E2E / dev startup signal.
        // Fire-and-forget so init() stays synchronous (IStaticRuntime.init(): void).
        // The E2E harness waits up to 15 s for 'e2e_startup_ok.txt' before
        // proceeding — this is how every scenario detects "frontend loaded".
        // In normal `tauri dev` the file lands in the repo root and is harmless.
        invoke('write_text_file', { path: 'e2e_startup_ok.txt', content: 'OK' })
            .catch(() => { /* best-effort — never block startup */ });

        // Intercept global console methods to ensure ALL existing app logs
        // get forwarded to the backend trace.
        if ((console as any).__isPatched) return;

        const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

        methods.forEach(method => {
            const original = console[method];
            if (typeof original === 'function') {
                (console as any)[method] = (msg: any, ...args: any[]) => {
                    original.call(console, msg, ...args);
                    sendTrace(method.toUpperCase(), msg, ...args);
                };
            }
        });

        (console as any).__isPatched = true;

        console.log("====> StaticRuntime (DEV) initialized with Comprehensive Console Interception.");
    },
    // init END ****************************************************

    //**************************************************************
    // log
    //**************************************************************
    log: (msg: string, ...args: any[]) => {
        // Delegate to console.log, which is now patched to trace.
        sendTrace('R-LOG:', msg, ...args);
    },
    // log END *****************************************************

    //**************************************************************
    // error
    //**************************************************************
    error: (msg: string, ...args: any[]) => {
        sendTrace('R-ERROR:', msg, ...args);
    },
    // error END ***************************************************

    //**************************************************************
    // TEST MODE: Self-Driving Success Reporter
    // If we receive a file change event AND we are in test mode, it means
    // the internal bad actor's work was detected. Report Success!
    //  THE PRODUCTION IMPLEMENTATION DOES NOTHING
    //**************************************************************
    setupTestModeListeners: async () => {
        console.log("DEBUG --->: Registering setupTestModeListeners");
        await listen('file-changed', async (event) => {
            console.log("DEBUG: Received sync event: File Changed Event:", event.payload);

            console.log("[TEST] Conflict Detected! Reporting Success.");
            // We write to the CWD (where reproduce_conflict is watching)
            // Note: 'conflict_success.txt' will be relative to app execution dir
            try {
                // We use the raw invoke to bypass any FileSystem wrappers if needed, 
                // but FileSystem.writeTextFile is fine.
                // We write the EVENT PAYLOAD (the path) as content to prove it worked.
                await invoke('write_text_file', {
                    path: 'conflict_success.txt',
                    content: `SUCCESS: Detected change in ${event.payload}`
                });
                console.log("[TEST] Success marker written.");
            } catch (e) {
                console.error("[TEST] Failed to write success marker:", e);
            }

        });
    }
    // setupTestModeListeners END ***********************************

};
// StaticRuntime END *******************************************
