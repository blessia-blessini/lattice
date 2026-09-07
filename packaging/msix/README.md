# MSIX packaging (Microsoft Store)

The Store re-signs MSIX packages after certification, so lattice needs **no
code-signing certificate** on this route. 

## Store-assigned identity — do not edit

From Partner Center > lattice-md > Product management > Product identity:

| Field                                     | Value                                     |
| :---------------------------------------- | :---------------------------------------- |
| `Package/Identity/Name`                   | `Blessia.lattice-md`                      |
| `Package/Identity/Publisher`              | `CN=E88B3AC8-AD63-44BD-BDA6-22A1419A6C7B` |
| `Package/Properties/PublisherDisplayName` | `Blessia`                                 |

`Package.appxmanifest` in this folder already carries them. If the upload is
rejected for an identity mismatch, re-read the page above — do not guess.

`DisplayName` must match a **reserved app name**, hence `lattice-md` rather
than `Lattice`. Reserve a nicer name in Partner Center and update both
`DisplayName` fields if you want a prettier Store entry.

## Version

4-part, revision 0: `0.3.19` -> `0.3.19.0`. Raise it for every submission —
the Store rejects a re-upload of a version it has already seen.

## Build (Windows, PowerShell)

`winapp init` is **interactive** (it prompts for name, publisher, extensions)
and is therefore unusable here: everything it would ask has a fixed answer
already, and an interactive step cannot run in CI. Skip it. `init` only
scaffolds a stub manifest and an `Assets/` folder -- both of which this repo
can produce deterministically.

Pack with `makeappx` from the Windows SDK, which is non-interactive and is
already present on GitHub's `windows-latest` runners. Note the rename: inside
the package the manifest must be called `AppxManifest.xml`.

```powershell
cd <repo>

npm run tauri -- build

# Assemble the package payload
$pkg = "dist-msix"
Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$pkg\Assets" | Out-Null

Copy-Item packaging\msix\Package.appxmanifest "$pkg\AppxManifest.xml"
Copy-Item src-tauri\target\release\lattice.exe $pkg

foreach ($i in "StoreLogo","Square44x44Logo","Square71x71Logo",
               "Square150x150Logo") {
  Copy-Item "src-tauri\icons\$i.png" "$pkg\Assets\"
}

# Unsigned package -- this is the one that goes to the Store.
makeappx pack /d $pkg /p lattice-md.msix
```

If `makeappx` is not on PATH it ships with the Windows SDK, at
`C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\makeappx.exe`.

### Optional: a signed copy for local install testing

`Add-AppxPackage` refuses a package Windows does not trust, so testing
locally needs a self-signed cert whose subject equals `Identity/Publisher`.
Sign a **copy** -- never the one you upload.

```powershell
Copy-Item lattice-md.msix lattice-md-devtest.msix

$cert = New-SelfSignedCertificate -Type Custom `
  -Subject "CN=E88B3AC8-AD63-44BD-BDA6-22A1419A6C7B" `
  -KeyUsage DigitalSignature -FriendlyName "lattice-md MSIX dev" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

$pw = Read-Host -AsSecureString "PFX password"
Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
  -FilePath .\devcert.pfx -Password $pw

signtool sign /fd SHA256 /f .\devcert.pfx /p <password> lattice-md-devtest.msix
```

Trust it once (elevated), install, and check that a `.md` from Documents
opens:

```powershell
Import-Certificate -FilePath .\devcert.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Add-AppxPackage .\lattice-md-devtest.msix
```

`devcert.pfx` and `*-devtest.msix` belong in `.gitignore`.

## Signing: the Store package must be UNSIGNED

Per Microsoft's package requirements:

> Your MSIX and AppX packages don't have to be signed with a certificate
> rooted in a trusted certificate authority when submitting to the Microsoft
> Store. The Microsoft Store will automatically re-sign your MSIX/AppX
> packages with a Microsoft certificate during the publishing process after
> your app passes certification.

And Microsoft support is explicit that self-signing before submission
*causes* validation failures (publisher mismatch against what the Store
expects). So:

- **Uploaded package: unsigned.** `makeappx pack /d dist-msix /p lattice-md.msix`
  produces an unsigned package. (Check `winapp pack --help` for an unsigned
  option before reaching for makeappx.)
- **Locally installed package: signed with `devcert.pfx`**, only because
  `Add-AppxPackage` refuses a package Windows does not trust. This cert never
  leaves the machine and is unrelated to the Store, to Entra/Azure, and to the
  developer account.
- Add `devcert.pfx` to `.gitignore`.

The MSI/EXE case is the opposite, and is why the first submission failed:
the Store does **not** re-sign Win32 installers, so those must be
Authenticode-signed by a CA-rooted certificate before submission.

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
