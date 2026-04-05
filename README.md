# Lattice &emsp;&emsp;&emsp; [![Build and Test Matrix](https://github.com/blessia-blessini/lattice/actions/workflows/buildAndTest.yml/badge.svg)](https://github.com/blessia-blessini/lattice/actions/workflows/buildAndTest.yml) [![License](https://img.shields.io/badge/License-AGPL--3.0-red.svg)](LICENSE) 

**Lattice** is an open-source, local-first Markdown environment editor, designed to bridge the gap between Personal Knowledge Management (PKM) and Corporate Systems Engineering. 

---

## Installation

### For Users
Download the latest stable release for your platform from our **[Releases Page](https://github.com/blessia-blessini/lattice/releases)**.

For bleeding-edge builds, check the artifacts from our latest [GitHub Actions](https://github.com/blessia-blessini/lattice/actions).

### For Developers
Lattice is built with **Tauri v2**, **Rust**, and **React**.

#### Prerequisites

*   **Rust**: [Install Rust](https://www.rust-lang.org/tools/install)
*   **Node.js & npm**: [Install Node.js](https://nodejs.org/)

> Note: installation can be done with, and is documented in `.\scripts\setup_env.ps1` and `.\scripts\setup_env.sh` for Windows and Linux/MacOS respectively.


#### Setup
1.  Clone the repository.
2.  Initialize the environment:
    *   **Windows**    : `.\scripts\setup_env.ps1`
    *   **macOS/Linux**: `./scripts/setup_env.sh`

#### Environment Configuration (Critical)

The build system requires the `LATTICEBUILD_NO` environment variable to be set. Without this, even `rust-analyzer` (which often runs automatically depending on installed extensions in VSCode) might report errors or builds may fail (though debug builds default to a safe fallback).

**For VS Code Users:**
We recommend adding this to your `.vscode/settings.json` or `.code-workspace` file:

```json
{
    "rust-analyzer.cargo.extraEnv": {
        "LATTICEBUILD_NO": "DevBuild"
    }
}
```

**For Command Line:**
*   **PowerShell**: `$env:LATTICEBUILD_NO="DevBuild"; npm run tauri dev # (| build )`
*   **Bash**: `export LATTICEBUILD_NO="DevBuild"; npm run tauri dev # (| build )`

#### Development Commands

| Command               | Description                                           |
| :-------------------- | :---------------------------------------------------- |
| `npm run tauri dev`   | Start the app in development mode with hot-reloading. |
| `npm run tauri build` | Build a production release for your OS.               |

#### Commandline for developers (while developing)

We provide cross-platform scripts to help you build andrun the app, and to automatically handle environment variables (like `LATTICEBUILD_NO`) and standardize the build pipeline. You are encouraged to look into the scripts before you run them

| Description                                                               | macOS / Linux (Bash)         | Windows (PowerShell)          |
| :------------------------------------------------------------------------ | :--------------------------- | :---------------------------- |
| **1. Setup environment** (Install Rust, Node, NPM deps, init Android)     | `./scripts/setup_env.sh`     | `.\scripts\setup_env.ps1`     |
| **2. Start the app** in _development mode_ with hot-reload                | `./scripts/build-dev.sh`     | `.\scripts\build-dev.ps1`     |
| **3. Run the complete test suite** (Backend, Frontend, Coverage, Linting) | `./scripts/build-test.sh`    | `.\scripts\build-test.ps1`    |
| **4. Build a production release** for the respective OS                   | `./scripts/build-release.sh` | `.\scripts\build-release.ps1` |

## Licensing

This software is dual-licensed:

1. **Personal & Open Source Use**: Licensed under the [GNU AGPLv3](LICENSE). 
   This ensures the software remains transparent and that improvements 
   by the community are shared back.
   
2. **Commercial Use**: For entities that wish to use this software 
   without the "share-alike" requirements of the AGPL, a commercial 
   license is required. Please contact `blessia AT blessini.com` for details.


### Commercial Usage Policy

To encourage individual productivity, Blessia-Blessini grants you the following additional permissions under **Section 7** of the [GNU AGPLv3](LICENSE):

  - **Individual Employee Use**: Any individual employee of a corporation is permitted to use the software for their personal work tasks and editing without a paid commercial license.

  - **Threshold for Commercial Licensing**: A formal Commercial License is only required when the software is:

    - Integrated (embedded) into the company's automated workflows or production pipelines.
    - Distributed as part of a commercial product or service.
    - Deployed for use by more than *25 employees* within the same organization
   
⇒ If your usage meets these "embedded" or "team-wide" criteria, please contact  `blessia AT blessini.com` for a Commercial License.



```  
LATTICE - The Portable and standard Markdown Editor
  
Copyright (C) 2026 Owner of blessini.com (a.k.a **_blessia_**)
email: blessia AT blessini.com

GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE
===========================================

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```
  
See LICENCE file in GitHUB root folder of the repository.
