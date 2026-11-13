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

// Tests of user-path.ps1 (REQ-LTTCE-CLU-00004), run with Windows PowerShell 5.1 --
// the powershell.exe the installer calls. Windows only. The registry tests work on
// a key of their own under HKCU\Software, never on the real Environment.

import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'user-path.ps1');
const TEST_KEY = `Software\\LatticeUserPathTest-${process.pid}`;
const onWindows = process.platform === 'win32';

/** A PowerShell single-quoted string literal. */
const psQuote = (s) => `'${String(s).replaceAll("'", "''")}'`;

/**
 * Runs PowerShell 5.1 code after dot-sourcing the script; returns its output
 * without the final line ends -- blanks are kept, they can be part of a PATH.
 */
function ps(code) {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `. ${psQuote(SCRIPT)}; ${code}`],
        { encoding: 'utf8' }).replace(/\r/g, '').replace(/\n+$/, '');
}

/** Runs the script itself, as the installer does, on the test key. */
function runScript(...args) {
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
        ...args, '-RegistryKey', TEST_KEY], { encoding: 'utf8' });
}

/** The test key's Path: raw value and type, or null when absent. */
function readPath() {
    const out = ps(`$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${psQuote(TEST_KEY)});`
        + ` if ($k -and ($k.GetValueNames() -contains 'Path')) {`
        + ` $k.GetValueKind('Path').ToString() + '|' + $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames') } else { 'ABSENT' }`);
    if (out === 'ABSENT') return null;
    const [kind, ...rest] = out.split('|');
    return { kind, value: rest.join('|') };
}

/** Sets the test key's Path (raw), with the given type. */
const writePath = (value, kind = 'ExpandString') => ps(
    `[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${psQuote(TEST_KEY)}).SetValue('Path', ${psQuote(value)}, '${kind}')`);

const deleteKey = () => ps(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree(${psQuote(TEST_KEY)}, $false)`);


describe.skipIf(!onWindows)('user-path.ps1 (Windows PowerShell 5.1)', () => {
    describe('Add-PathEntry and Remove-PathEntry', () => {
        it('appends a folder, once, whatever its spelling in PATH', () => {
            expect(ps(`Add-PathEntry 'C:\\a;C:\\b' 'C:\\Lattice'`)).toBe('C:\\a;C:\\b;C:\\Lattice');
            expect(ps(`Add-PathEntry 'C:\\a;' 'C:\\Lattice'`)).toBe('C:\\a;C:\\Lattice');
            expect(ps(`Add-PathEntry '' 'C:\\Lattice'`)).toBe('C:\\Lattice');
            for (const present of ['c:\\LATTICE', 'C:\\Lattice\\', '"C:\\Lattice"', ' C:\\Lattice ']) {
                expect(ps(`Add-PathEntry ${psQuote(`C:\\a;${present}`)} 'C:\\Lattice'`)).toBe(`C:\\a;${present}`);
            }
            const local = process.env.LOCALAPPDATA;
            expect(ps(`Add-PathEntry 'C:\\a;%LOCALAPPDATA%\\lattice' ${psQuote(`${local}\\Lattice`)}`)).toBe('C:\\a;%LOCALAPPDATA%\\lattice');
        });

        it('removes every spelling of the folder and keeps everything else as it was', () => {
            expect(ps(`Remove-PathEntry 'C:\\a;;C:\\Lattice\\;D:\\x;c:\\lattice' 'C:\\Lattice'`)).toBe('C:\\a;;D:\\x');
            expect(ps(`Remove-PathEntry 'C:\\a;C:\\Lattice2' 'C:\\Lattice'`)).toBe('C:\\a;C:\\Lattice2');
            expect(ps(`Remove-PathEntry 'C:\\Lattice' 'C:\\Lattice'`)).toBe('');
        });

        it('keeps a drive root as it is and refuses an empty folder', () => {
            expect(ps(`ConvertTo-PathKey 'D:\\'`)).toBe('d:\\');
            expect(ps(`try { Add-PathEntry 'C:\\a' '' } catch { 'refused' }`)).toBe('refused');
            expect(ps(`try { Remove-PathEntry 'C:\\a' ' ' } catch { 'refused' }`)).toBe('refused');
        });
    });

    describe('the script on a registry key of its own', () => {
        beforeAll(deleteKey);
        afterAll(deleteKey);

        it('adds and removes its entry, keeping the type and unexpanded %VARIABLES% of the rest', () => {
            const before = '%USERPROFILE%\\bin;C:\\tools';
            writePath(before);
            const add = runScript('-Add', 'C:\\Program Files\\Lattice Test');
            expect(add.status, add.stderr).toBe(0);
            expect(add.stdout).toMatch(/PATH changed/);
            expect(readPath()).toEqual({ kind: 'ExpandString', value: `${before};C:\\Program Files\\Lattice Test` });

            const again = runScript('-Add', 'c:\\program files\\lattice test\\');
            expect(again.stdout).toMatch(/PATH already right/);

            const remove = runScript('-Remove', 'C:\\Program Files\\Lattice Test');
            expect(remove.status, remove.stderr).toBe(0);
            expect(readPath()).toEqual({ kind: 'ExpandString', value: before });
        });

        it('keeps a plain REG_SZ value plain, and keeps a PATH longer than 1024 characters whole', () => {
            const long = Array.from({ length: 60 }, (_, i) => `C:\\some\\rather\\long\\folder\\number${i}`).join(';');
            expect(long.length).toBeGreaterThan(1024);
            writePath(long, 'String');
            expect(runScript('-Add', 'C:\\Lattice').status).toBe(0);
            expect(readPath()).toEqual({ kind: 'String', value: `${long};C:\\Lattice` });
            expect(runScript('-Remove', 'C:\\Lattice').status).toBe(0);
            expect(readPath()).toEqual({ kind: 'String', value: long });
        });

        it('creates Path when there was none, and deletes it again when nothing else is left', () => {
            deleteKey();
            expect(runScript('-Add', 'C:\\Lattice').status).toBe(0);
            expect(readPath()).toEqual({ kind: 'ExpandString', value: 'C:\\Lattice' });
            expect(runScript('-Remove', 'C:\\Lattice').status).toBe(0);
            expect(readPath()).toBeNull();
            expect(runScript('-Remove', 'C:\\Lattice').stdout).toMatch(/PATH already right/);
        });

        it('refuses to run without exactly one of -Add and -Remove (exit 2)', () => {
            expect(runScript().status).toBe(2);
            expect(runScript('-Add', 'C:\\a', '-Remove', 'C:\\a').status).toBe(2);
        });
    });
});
