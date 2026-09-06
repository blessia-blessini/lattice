# MSIX packaging (Microsoft Store)

The Store re-signs MSIX packages after certification, so lattice needs **no
code-signing certificate** on this route. 

## Store-assigned identity — do not edit

From Partner Center > lattice-md > Product management > Product identity:

| Field | Value |
|:--|:--|
| `Package/Identity/Name` | `Blessia.lattice-md` |
| `Package/Identity/Publisher` | `CN=E88B3AC8-AD63-44BD-BDA6-22A1419A6C7B` |
| `Package/Properties/PublisherDisplayName` | `Blessia` |

`Package.appxmanifest` in this folder already carries them. If the upload is
rejected for an identity mismatch, re-read the page above — do not guess.

`DisplayName` must match a **reserved app name**, hence `lattice-md` rather
than `Lattice`. Reserve a nicer name in Partner Center and update both
`DisplayName` fields if you want a prettier Store entry.

## Version

4-part, revision 0: `0.3.19` -> `0.3.19.0`. Raise it for every submission —
the Store rejects a re-upload of a version it has already seen.

## Build (Windows, PowerShell)

```powershell
winget install microsoft.winappcli --source winget

cd <repo>
winapp init                                    # creates Assets/ (keep it)
copy /Y packaging\msix\Package.appxmanifest .  # overwrite the generated stub

# tile assets referenced by the manifest
copy /Y src-tauri\icons\StoreLogo.png          Assets\
copy /Y src-tauri\icons\Square44x44Logo.png    Assets\
copy /Y src-tauri\icons\Square71x71Logo.png    Assets\
copy /Y src-tauri\icons\Square150x150Logo.png  Assets\
copy /Y src-tauri\icons\Square310x310Logo.png  Assets\

npm run tauri -- build
mkdir dist-msix
copy /Y src-tauri\target\release\lattice.exe dist-msix\

# Local test signing only. The subject MUST equal Identity/Publisher above;
# the Store replaces this signature, so its self-signed-ness does not matter.
winapp cert generate --if-exists skip
winapp pack .\dist-msix --cert .\devcert.pfx
```

## Test before uploading

```powershell
winapp cert install .\devcert.pfx    # elevated, one-time
Add-AppxPackage .\lattice-md.msix
```

Open a `.md` from Documents. If that works, the full-trust filesystem
assumption holds: a packaged Tauri app runs at `TrustLevel="mediumIL"`,
outside the AppContainer, so `broadFileSystemAccess` is NOT required and the
existing `capabilities/default.json` scope (`$HOME/**`) applies unchanged.

Then drag the `.msix` onto the Packages page of the MSIX product.

## Known follow-ups

- **Updater must be disabled in this build.** `tauri.conf.json` configures
  `plugins.updater` against GitHub releases; the Store owns updates for
  packaged apps and a self-updating Store app fails certification.
- **`runFullTrust`** is a restricted capability: write a justification on the
  Store "Submission options" page ("packaged Win32 desktop application").
- **ARM64** is not built yet. Once it is, produce a `.msixbundle` (x64 +
  arm64) rather than two separate submissions.
