# Privacy Statement — Lattice

**Effective date:** 2026-06-01
**Product:** Lattice — The Portable and Standard Markdown Editor
**Publisher:** Blessia · blessini.com
**Contact:** blessia AT blessini.com

---

## The short version

Lattice does not collect, transmit, or share any personal data.
Everything the app knows about you stays on your own machine.

---

## What Lattice stores — locally, on your machine only

| What                           | Where                                                                | Why                                   |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------- |
| Vault settings                 | `.lattice-settings.json` next to your files                          | Per-folder editor preferences         |
| Recent files list (MRU)        | App data folder                                                      | So you can reopen recent files        |
| Window size and UI preferences | App data folder                                                      | To restore your layout on next launch |
| Diagnostic log file            | App data folder (`%APPDATA%`, `~/Library/Logs`, or `~/.local/share`) | Troubleshooting crashes and errors    |

None of these files leave your device. Lattice has no server, no account system, and no cloud sync.

---

## The auto-updater

Lattice checks for updates by requesting a small JSON file from GitHub:

```
https://github.com/blessia-blessini/lattice/releases/latest/download/latest.json
```

This request is made by your machine directly to GitHub's servers.
Lattice itself does not see or log this request.
GitHub may process your IP address and request metadata under their own
[Privacy Policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The update check sends no personally identifiable information beyond what any
standard HTTPS request contains (IP address, user-agent string, current app version).

---

## What Lattice does NOT do

- Does not collect analytics or telemetry
- Does not track which files you open or edit
- Does not read file content beyond what you explicitly open in the editor
- Does not transmit your files or their content anywhere
- Does not use cookies or any web tracking technology
- Does not create user accounts or profiles

---

## Third-party components

Lattice is built on [Tauri](https://tauri.app) and renders its UI inside a system WebView
(Microsoft Edge WebView2 on Windows, WebKit on macOS and Linux).
These components are provided by the OS vendor and are governed by their respective privacy policies.
Lattice does not add any additional tracking on top of them.

---

## Your rights

Since Lattice collects no personal data, there is nothing to request, correct, or delete.
If you want to remove all traces of Lattice from your machine, uninstalling the app and
deleting the app data folder is sufficient.

---

## Changes to this statement

If this statement changes in a material way, the effective date above will be updated
and the change will be noted in the [CHANGELOG](CHANGELOG.md).

---

## Contact

Questions about privacy: **blessia AT blessini.com**
