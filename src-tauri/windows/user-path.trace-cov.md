# Trace Coverage — src-tauri/windows/user-path.ps1

Satellite file for the `IMPL-…` anchor in `user-path.ps1`, and for the pieces that use it: `hooks.nsh`,
`../tauri.windows.conf.json`, and the Store alias in `../../packaging/msix/Package.appxmanifest`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-CLU-00003 **covers** REQ-LTTCE-CLU-00004  (`user-path.ps1`: `ConvertTo-PathKey`, `Add-PathEntry`,
  `Remove-PathEntry`, `Update-UserPath` (raw value, type kept, an emptied value deleted),
  `Send-EnvironmentChange`, the `-Add` / `-Remove` entry point (exit 0 / 1 / 2); `hooks.nsh`
  `NSIS_HOOK_POSTINSTALL` / `NSIS_HOOK_PREUNINSTALL`; `tauri.windows.conf.json` `installerHooks` and the resource;
  `Package.appxmanifest` `uap5:AppExecutionAlias` `lattice.exe`)
- IMPL-LTTCE-CLU-00003 **covers** ARCH-LTTCE-CLU-00002

## Tests

- UTST `user-path.test.mjs` (Windows only, Windows PowerShell 5.1, the installer's `powershell.exe`) —
  `Add-PathEntry`: appended once; a trailing `;`, an empty PATH; already there in another case, with a trailing
  `\`, quoted, with blanks, or as `%LOCALAPPDATA%\lattice` = unchanged. `Remove-PathEntry`: every spelling removed,
  everything else (empty entries, order, a similar name) kept. A drive root keeps its `\`; an empty folder is
  refused. The script on a registry key of its own: add and remove keep `REG_EXPAND_SZ` and an unexpanded
  `%USERPROFILE%`; adding twice changes nothing; a `REG_SZ` value stays `REG_SZ`; a PATH over 1024 characters is
  kept whole; a missing `Path` is created and deleted again; no or both of `-Add` / `-Remove` = exit 2.
  Mutation checks (2026-11-13): writing without the type, or matching by exact spelling, each fail 2 tests.
- STST CI step 394 (`buildAndTest.yml`, both Windows legs): the real installer, silent, puts its folder on the
  user's PATH; a shell with PATH read from the registry finds `lattice` there and `lattice --help` exits 0 with
  the usage text; the real uninstaller restores the user's PATH exactly. First passed on both Windows legs in run 43379611060 (2026-11-13).
- The Store alias: `makeappx pack` validates the manifest against the schema on every Windows build that packs
  the MSIX (checked locally 2026-11-13, including that a wrong attribute in the alias is refused). Installing the
  Store package and typing `lattice` is not automated: an unsigned MSIX cannot be installed on a CI runner.
