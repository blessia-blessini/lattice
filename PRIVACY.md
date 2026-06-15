# Privacy Statement — Lattice

**Effective date:** 2026-06-01
**Product:** Lattice — The Portable and Standard Markdown Editor
**Publisher:** Blessia · blessini.com
**Contact:** blessia AT blessini.com

---

## The short version

Lattice does not collect, transmit, or share any personal data.
Everything the app knows about you stays on your own machine.
Versions are built and published online by automatic scripts on [GitHub Actions](https://github.com/features/actions).
These versions are [attested](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)(one can verify that the downloadable file comes from the automated scripts from Hithub actions) and scanned for viruses already.

Thus, anyone can check the source and a release origins.

---

## What Lattice stores — locally, on your machine only

> **None of these files leave your device.**
> Lattice has no server, no account system, and no cloud sync.

| What                           | Where                                                                | Why                                    |
|:------------------------------ |:-------------------------------------------------------------------- |:-------------------------------------- |
| Vault settings                 | `.lattice-settings.json` next to your files                          | Per-folder hierarchy editor preferences|
| Recent files list (MRU)        | App data folder                                                      | So you can reopen recent files         |
| Window size and UI preferences | App data folder                                                      | To restore your layout on next launch  |
| Diagnostic log file            | App data folder (`%APPDATA%`, `~/Library/Logs`, or `~/.local/share`) | Troubleshooting crashes and errors     |


---

## The auto-updater

In the future, Lattice checks for updates by requesting a small JSON file from GitHub:

```
https://github.com/blessia-blessini/lattice/releases/latest/download/latest.json
```

This request is made by your machine directly to GitHub's servers.
Lattice itself does not see or log this request.
GitHub may process your IP address and request metadata under their own
[Privacy Policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The update check sends no personally identifiable information beyond what any
standard HTTPS request contains (IP address, user-agent string, current app version).

> At the time of writing this Privacy Statement, the auto-updater is configured in the app
> but the update manifest has not yet been published, so no update checks occur at this time.

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

In other Open Source Software Products **(NOT IN LATTICE)**, there were reports of malicious 
Software components that got integrated into consumer releases because of malicious behavior
by community members part of the integration chain of the attached Software. 

To avoid similar failures, Lattice gets the following methods:
 - the Software Releases are Automatically scanned for viruses
 - all the Software release and publish sequence is completely performed online 
   by [GitHub Actions](https://github.com/features/actions) and [**attested**](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) (GitHub-provided signing method that proves the origin of releases and packages)

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
