; LEGAL NOTE:
; LATTICE (tm) - The Portable and standard Markdown Editor
; Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
; email: blessia AT blessini.com
;
; GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
;
; This program is free software: you can redistribute it and/or modify
; it under the terms of the GNU Affero General Public License as
; published by the Free Software Foundation, either version 3 of the
; License, or (at your option) any later version.
;
; This program is distributed in the hope that it will be useful,
; but WITHOUT ANY WARRANTY; without even the implied warranty of
; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
; GNU Affero General Public License for more details.
;
; You should have received a copy of the GNU Affero General Public License
; along with this program.  If not, see <https://www.gnu.org/licenses/>.
;
; See LICENCE file in GitHUB root folder of the repository.
; END OF NOTE
;
; Hooks of the Windows installer (Tauri's NSIS template; installerHooks in
; src-tauri/tauri.windows.conf.json). REQ-LTTCE-CLU-00004, ARCH-LTTCE-CLU-00002: after installing,
; `lattice` runs from a new terminal; uninstalling takes that away again.
;
; The work is done by user-path.ps1, installed next to lattice.exe: NSIS
; strings hold 1024 characters, too few to read and write a whole PATH safely.
; powershell.exe is called by its full path (no PATH lookup). A failure is
; logged and does not fail the install or the uninstall: Lattice itself works
; without being on the PATH.

;**************************************************************
; NSIS_HOOK_POSTINSTALL
;**************************************************************
; After the files are copied: put $INSTDIR on the user's PATH.
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Adding $INSTDIR to the user's PATH"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\user-path.ps1" -Add "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" +2
    DetailPrint "Lattice could not be put on the PATH (exit $0); run it by its full path: $INSTDIR\lattice.exe"
!macroend
; NSIS_HOOK_POSTINSTALL END ***********************************


;**************************************************************
; NSIS_HOOK_PREUNINSTALL
;**************************************************************
; Before the files are removed, while user-path.ps1 is still there: take
; $INSTDIR off the user's PATH.
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing $INSTDIR from the user's PATH"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\user-path.ps1" -Remove "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" +2
    DetailPrint "$INSTDIR could not be taken off the PATH (exit $0); remove it by hand under Settings > System > About > Advanced system settings > Environment Variables"
!macroend
; NSIS_HOOK_PREUNINSTALL END **********************************
