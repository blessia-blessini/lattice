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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TauriCore from '@tauri-apps/api/core';
import * as TauriEvent from '@tauri-apps/api/event';

// Import the dev implementation directly so the @services/StaticRuntime alias
// (which resolves to this same file in test/dev mode) does not matter.
import { StaticRuntime } from './StaticRuntime.dev';

describe('StaticRuntime.dev', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Ensure the console-patch flag is cleared before every test so that
        // init() tests can observe the patching behaviour fresh each time.
        delete (console as any).__isPatched;
    });

    afterEach(() => {
        // Always remove the flag so the patch never bleeds into other suites.
        delete (console as any).__isPatched;
    });

    // -----------------------------------------------------------------------
    // log
    // -----------------------------------------------------------------------
    describe('log', () => {
        it('calls invoke("trace_log") with a message containing the supplied text', () => {
            StaticRuntime.log('hello world');
            expect(TauriCore.invoke).toHaveBeenCalledWith(
                'trace_log',
                expect.objectContaining({ msg: expect.stringContaining('hello world') })
            );
        });

        it('includes the R-LOG prefix in the trace message', () => {
            StaticRuntime.log('prefix test');
            const { msg } = (vi.mocked(TauriCore.invoke).mock.calls[0][1] as any);
            expect(msg).toContain('R-LOG:');
        });

        it('serialises object args as JSON in the trace message', () => {
            StaticRuntime.log('structured', { key: 'val' });
            const { msg } = (vi.mocked(TauriCore.invoke).mock.calls[0][1] as any);
            expect(msg).toContain('{"key":"val"}');
        });

        it('serialises multiple extra args separated by spaces', () => {
            StaticRuntime.log('multi', 'a', 'b');
            const { msg } = (vi.mocked(TauriCore.invoke).mock.calls[0][1] as any);
            expect(msg).toContain('a b');
        });

        it('includes a timestamp in HH:MM:SS.mmm format', () => {
            StaticRuntime.log('ts test');
            const { msg } = (vi.mocked(TauriCore.invoke).mock.calls[0][1] as any);
            expect(msg).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
        });
    });

    // -----------------------------------------------------------------------
    // error
    // -----------------------------------------------------------------------
    describe('error', () => {
        it('calls invoke("trace_log") with the error message', () => {
            StaticRuntime.error('something broke');
            expect(TauriCore.invoke).toHaveBeenCalledWith(
                'trace_log',
                expect.objectContaining({ msg: expect.stringContaining('something broke') })
            );
        });

        it('includes the R-ERROR prefix in the trace message', () => {
            StaticRuntime.error('err details');
            const { msg } = (vi.mocked(TauriCore.invoke).mock.calls[0][1] as any);
            expect(msg).toContain('R-ERROR:');
        });

        it('serialises object args in the error trace', () => {
            StaticRuntime.error('with obj', { code: 42 });
            const { msg } = (vi.mocked(TauriCore.invoke).mock.calls[0][1] as any);
            expect(msg).toContain('{"code":42}');
        });
    });

    // -----------------------------------------------------------------------
    // init — console patching
    // -----------------------------------------------------------------------
    describe('init', () => {
        // We save and restore each console method so one test cannot pollute another.
        const originals: Record<string, any> = {};

        beforeEach(() => {
            for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
                originals[m] = console[m];
            }
        });

        afterEach(() => {
            for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
                (console as any)[m] = originals[m];
            }
            delete (console as any).__isPatched;
        });

        it('sets __isPatched to true after first call', () => {
            StaticRuntime.init();
            expect((console as any).__isPatched).toBe(true);
        });

        it('replaces console.log with a patched version', () => {
            StaticRuntime.init();
            expect(console.log).not.toBe(originals.log);
        });

        it('is idempotent — does not re-patch when called a second time', () => {
            StaticRuntime.init();
            const patchedLog = console.log;
            StaticRuntime.init();
            expect(console.log).toBe(patchedLog);
        });

        it('patched console.log forwards the message to trace_log via invoke', () => {
            StaticRuntime.init();
            vi.clearAllMocks(); // discard the invoke call made by the init() log itself
            console.log('patched message');
            expect(TauriCore.invoke).toHaveBeenCalledWith(
                'trace_log',
                expect.objectContaining({ msg: expect.stringContaining('patched message') })
            );
        });

        it('patched console.warn also sends a trace', () => {
            StaticRuntime.init();
            vi.clearAllMocks();
            console.warn('warning text');
            expect(TauriCore.invoke).toHaveBeenCalledWith(
                'trace_log',
                expect.objectContaining({ msg: expect.stringContaining('warning text') })
            );
        });
    });

    // -----------------------------------------------------------------------
    // setupTestModeListeners
    // -----------------------------------------------------------------------
    describe('setupTestModeListeners', () => {
        it('registers a "file-changed" event listener', async () => {
            await StaticRuntime.setupTestModeListeners();
            expect(TauriEvent.listen).toHaveBeenCalledWith(
                'file-changed',
                expect.any(Function)
            );
        });

        it('returns a promise', () => {
            const result = StaticRuntime.setupTestModeListeners();
            expect(result).toBeInstanceOf(Promise);
        });
    });
});

// ---------------------------------------------------------------------------
// setupTestModeListeners — event callback body (lines 99-114)
// ---------------------------------------------------------------------------
describe('setupTestModeListeners — event callback body', () => {
    it('invokes write_text_file with conflict_success.txt when the file-changed callback fires', async () => {
        // Capture the callback registered with listen
        let capturedCallback: ((event: any) => Promise<void>) | undefined;
        vi.mocked(TauriEvent.listen).mockImplementationOnce((_event, cb) => {
            capturedCallback = cb as any;
            return Promise.resolve(vi.fn());
        });

        await StaticRuntime.setupTestModeListeners();
        expect(capturedCallback).toBeDefined();

        vi.clearAllMocks();
        await capturedCallback!({ payload: '/vault/note.md' });

        expect(TauriCore.invoke).toHaveBeenCalledWith('write_text_file', {
            path: 'conflict_success.txt',
            content: expect.stringContaining('/vault/note.md'),
        });
    });

    it('does not throw when write_text_file rejects inside the callback', async () => {
        let capturedCallback: ((event: any) => Promise<void>) | undefined;
        vi.mocked(TauriEvent.listen).mockImplementationOnce((_event, cb) => {
            capturedCallback = cb as any;
            return Promise.resolve(vi.fn());
        });

        await StaticRuntime.setupTestModeListeners();
        vi.mocked(TauriCore.invoke).mockRejectedValueOnce(new Error('disk full'));

        // callback swallows the error internally — must not throw
        await expect(capturedCallback!({ payload: 'any.md' })).resolves.toBeUndefined();
    });
});
