# LEGAL NOTE:
# LATTICE (tm) - The Portable and standard Markdown Editor
# Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
# email: blessia AT blessini.com
#
# GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# See LICENCE file in GitHUB root folder of the repository.
# END OF NOTE
#
<#
.SYNOPSIS
    Puts the Lattice install folder on the current user's PATH (-Add) or takes it
    off again (-Remove). IMPL-LTTCE-CLU-00003 -- REQ-LTTCE-CLU-00004, ARCH-LTTCE-CLU-00002.

.DESCRIPTION
    Run by the Windows installer (src-tauri/windows/hooks.nsh): -Add after
    installing, -Remove before uninstalling. Installed next to lattice.exe
    (src-tauri/tauri.windows.conf.json, bundle.resources).

    Why PowerShell and not NSIS: the installer's NSIS strings hold at most 1024
    characters, and a PATH read into one is cut there -- writing it back would
    destroy the rest of the user's PATH. Here the value is read and written whole.

    Only the user's own PATH (HKCU\Environment) is touched, never the system one,
    and only the one entry: every other entry, its order, its spelling and the
    value's type (REG_EXPAND_SZ keeps %USERPROFILE% and the like unexpanded) stay
    as they were. Adding is idempotent; removing takes every spelling of the
    folder (case, trailing "\", %LOCALAPPDATA%-style). A terminal opened after the
    change sees it; one already open does not -- Windows works that way.

    Dot-sourcing the file (". .\user-path.ps1") only defines the functions; the
    tests (user-path.test.mjs) use that, and -RegistryKey to work on a key of
    their own instead of the real Environment.
#>
param(
    [string] $Add = '',
    [string] $Remove = '',
    # Below HKEY_CURRENT_USER. Not "Environment": no WM_SETTINGCHANGE is sent.
    [string] $RegistryKey = 'Environment'
)


#**************************************************************
# ConvertTo-PathKey
#**************************************************************
<#
.SYNOPSIS
    The form two PATH entries are compared in: environment variables expanded,
    blanks and quotes trimmed, no trailing "\" (but "C:\" stays), lower case.
    Empty for an empty entry.
#>
function ConvertTo-PathKey {
    param([string] $Entry)
    $text = [Environment]::ExpandEnvironmentVariables([string] $Entry).Trim().Trim('"').Trim()
    if ($text.Length -gt 3) { $text = $text.TrimEnd('\') }
    return $text.ToLowerInvariant()
}
# ConvertTo-PathKey END ***************************************


#**************************************************************
# Add-PathEntry
#**************************************************************
<#
.SYNOPSIS
    $PathValue with $Entry appended, or $PathValue unchanged when it holds the
    folder already, in any spelling (ConvertTo-PathKey).
#>
function Add-PathEntry {
    param([string] $PathValue, [string] $Entry)
    # [string] parameters turn $null into '' already; no ?? -- Windows PowerShell 5.1 runs this.
    $value = [string] $PathValue
    $key = ConvertTo-PathKey $Entry
    if ($key -eq '') { throw 'Add-PathEntry: no folder given' }
    foreach ($part in $value.Split(';')) {
        if ((ConvertTo-PathKey $part) -eq $key) { return $value }
    }
    if ($value.Trim() -eq '') { return $Entry }
    return $value.TrimEnd(';') + ';' + $Entry
}
# Add-PathEntry END *******************************************


#**************************************************************
# Remove-PathEntry
#**************************************************************
<#
.SYNOPSIS
    $PathValue without any entry naming the folder $Entry (in any spelling); all
    other entries, empty ones included, kept as they were and in their order.
#>
function Remove-PathEntry {
    param([string] $PathValue, [string] $Entry)
    $key = ConvertTo-PathKey $Entry
    if ($key -eq '') { throw 'Remove-PathEntry: no folder given' }
    $kept = @(([string] $PathValue).Split(';') | Where-Object { (ConvertTo-PathKey $_) -ne $key })
    return ($kept -join ';')
}
# Remove-PathEntry END ****************************************


#**************************************************************
# Update-UserPath
#**************************************************************
<#
.SYNOPSIS
    Applies Add-PathEntry or Remove-PathEntry to the value "Path" under
    HKEY_CURRENT_USER\$RegistryKey, read and written raw (no expansion), keeping
    its type. A value left empty by a removal is deleted, as it was before the
    install added it. Returns $true when the value changed.
#>
function Update-UserPath {
    param([string] $Folder, [ValidateSet('Add', 'Remove')] [string] $Action, [string] $RegistryKey = 'Environment')
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($RegistryKey, $true)
    try {
        $exists = $key.GetValueNames() -contains 'Path'
        $old = if ($exists) { [string] $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { '' }
        $kind = if ($exists) { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        $new = if ($Action -eq 'Add') { Add-PathEntry $old $Folder } else { Remove-PathEntry $old $Folder }
        if ($exists -and $new -ceq $old) { return $false }
        if (-not $exists -and $new -eq '') { return $false }
        if ($new -eq '') { $key.DeleteValue('Path') } else { $key.SetValue('Path', $new, $kind) }
        return $true
    } finally {
        $key.Dispose()
    }
}
# Update-UserPath END *****************************************


#**************************************************************
# Send-EnvironmentChange
#**************************************************************
<#
.SYNOPSIS
    Tells running programs (Explorer above all) that the environment changed,
    so terminals started from them afterwards see the new PATH.
#>
function Send-EnvironmentChange {
    if (-not ('Lattice.EnvironmentNotice' -as [type])) {
        Add-Type -Namespace 'Lattice' -Name 'EnvironmentNotice' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
    }
    $result = [System.UIntPtr]::Zero
    # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5 s per window at most.
    [void] [Lattice.EnvironmentNotice]::SendMessageTimeout([System.IntPtr] 0xffff, 0x001A, [System.UIntPtr]::Zero, 'Environment', 0x0002, 5000, [ref] $result)
}
# Send-EnvironmentChange END **********************************


# Run as a script (not dot-sourced): exactly one of -Add / -Remove.
if ($MyInvocation.InvocationName -ne '.') {
    if ([string]::IsNullOrWhiteSpace($Add) -eq [string]::IsNullOrWhiteSpace($Remove)) {
        Write-Error 'user-path.ps1: give exactly one of -Add <folder> or -Remove <folder>'
        exit 2
    }
    $action = if ($Add) { 'Add' } else { 'Remove' }
    $folder = if ($Add) { $Add } else { $Remove }
    try {
        $changed = Update-UserPath -Folder $folder -Action $action -RegistryKey $RegistryKey
        if ($changed -and $RegistryKey -eq 'Environment') { Send-EnvironmentChange }
        Write-Output "user-path.ps1: $action $folder -- $(if ($changed) { 'PATH changed' } else { 'PATH already right' })"
        exit 0
    } catch {
        Write-Error "user-path.ps1: $action $folder failed: $($_.Exception.Message)"
        exit 1
    }
}
