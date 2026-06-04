# Lattice — System Architecture
### Reference Document for Systems Engineers

> **View this file in Lattice** (Dual or Preview mode) to render all Mermaid diagrams inline.
> All diagrams follow UML conventions and are expressed as Mermaid source — they are
> ==version-controlled plain text==, diff-friendly, and editable without any drawing tool.

---

## Table of Contents

<!-- TOC -->
- [System Overview](#system-overview)
- [Component Decomposition](#component-decomposition)
- [Data Flow — File Read / Write Cycle](#data-flow--file-read--write-cycle)
- [Sequence — Conflict Detection Protocol](#sequence--conflict-detection-protocol)
- [Class Model — Core Domain](#class-model--core-domain)
- [State Machine — Editor Lifecycle](#state-machine--editor-lifecycle)
- [Deployment Diagram](#deployment-diagram)
- [CI/CD Pipeline](#cicd-pipeline)
- [Entity-Relationship — Settings & Persistence](#entity-relationship--settings--persistence)
- [Next Steps](#next-steps)
<!-- /TOC -->

---

## System Overview

Lattice is a ==local-first== desktop Markdown editor built on **Tauri v2** (Rust backend) +
**React 18** (TypeScript frontend) + **CodeMirror 6** (editor engine).

Key architectural principles:

- **No cloud dependency** — all file I/O happens through the Tauri Rust backend directly to the host OS.
- **Optimistic concurrency** — SHA-256 content hashing prevents silent data loss on concurrent external edits.
- **Single-binary distribution** — the Tauri shell bundles the React SPA into a native executable for each platform.
- **Documents as code** — `.md` files are plain text, VCS-friendly, and interoperable with any Markdown toolchain.

```mermaid
flowchart TB
    subgraph "User Device (local-first)"
        subgraph FE["Frontend — React / TypeScript"]
            CM["CodeMirror 6\nEditor Engine"]
            MP["ReactMarkdown\nPreview Renderer"]
            UI["Toolbar / Settings\nUI Components"]
        end
        subgraph BE["Backend — Rust / Tauri v2"]
            CMD["Tauri Commands\n(IPC bridge)"]
            FS["File System\nI/O + Hashing"]
            CFG["Persistent Config\n(tauri-plugin-store)"]
            UPD["Auto-Updater\n(tauri-plugin-updater)"]
        end
        FE <-->|"invoke() / emit()\nIPC over webview"| BE
        BE <--> OS["Host OS\nFile System"]
    end

    subgraph "GitHub Infrastructure"
        GH["GitHub Releases\nInstaller Assets"]
        GP["GitHub Pages\nRelease Portal"]
        CI["GitHub Actions\nCI / CD"]
    end

    UPD -->|"HTTPS — latest.json"| GH
    CI -->|"push assets"| GH
    CI -->|"push index.md"| GP
```

---

## Component Decomposition

```mermaid
flowchart LR
    subgraph App["App.tsx — Root Component"]
        direction TB
        SM["State Manager\n(useState / useRef)"]
        PH["Print Handler\nbeforeprint / afterprint"]
        SC["Scroll Sync\nuseScrollSync hook"]
    end

    subgraph Editor["Editor.tsx — CodeMirror Wrapper"]
        direction TB
        EX["Editor Extensions\n(highlight, vim, etc.)"]
        MD_["MatchDecorator\n==mark== highlight"]
        CME["cm-editor DOM"]
    end

    subgraph Preview["Preview Pane"]
        direction TB
        RM["ReactMarkdown"]
        KT["rehype-katex\nMath Renderer"]
        MM["Mermaid Component\nDiagram Renderer"]
        HM["rehype-highlight-mark\n<mark> injector"]
    end

    subgraph Services["src/services/"]
        WS["windowState.ts\nPersistent window size"]
        DM["dailyNote.ts\nDaily note path"]
    end

    subgraph Lib["src/lib/"]
        TOC["tocGenerator.ts\nCTRL+SHIFT+T"]
        TBL["tableFormatter.ts\nCTRL+SHIFT+L"]
        RHM["rehype-highlight-mark.ts"]
        RHA["rehype-heading-ids.ts"]
    end

    App --> Editor
    App --> Preview
    App --> Services
    Editor --> Lib
    Preview --> Lib
```

---

## Data Flow — File Read / Write Cycle

```mermaid
flowchart TD
    A([User triggers Open]) --> B["Tauri: open_file_dialog()"]
    B --> C["OS File Picker"]
    C --> D{File selected?}
    D -- No --> Z1([Cancelled])
    D -- Yes --> E["Tauri: read_file(path)"]
    E --> F["fs::read_to_string()"]
    F --> G["Compute SHA-256 hash"]
    G --> H["Return FileReadResult\n{ content, hash }"]
    H --> I["React: load into CodeMirror"]
    I --> J["Store currentHash in state"]

    J --> K{User edits}
    K --> L["Mark document dirty\nisDirty = true"]
    L --> M([User triggers Save])
    M --> N["Tauri: write_file(path, content, expectedHash)"]
    N --> O["Re-read disk hash"]
    O --> P{Hashes match?}
    P -- Yes --> Q["fs::write() atomic"]
    Q --> R["Return new hash"]
    R --> S["Update currentHash"]
    S --> T["isDirty = false"]
    T --> Z2([Save complete ✓])
    P -- No --> U["Return ConflictError"]
    U --> V["Show conflict dialog"]
    V --> W{User choice}
    W -- Overwrite --> Q
    W -- Discard --> X["Reload from disk"]
    X --> I
```

---

## Sequence — Conflict Detection Protocol

```mermaid
sequenceDiagram
    participant U as User A
    participant L as Lattice
    participant R as Rust Backend
    participant F as File System
    participant E as External Editor

    Note over U,E: Normal edit → save cycle
    U->>L: Open file.md
    L->>R: read_file("file.md")
    R->>F: read + hash
    F-->>R: content, hash=H1
    R-->>L: FileReadResult{H1}
    L-->>U: File loaded

    Note over E,F: External editor modifies the file concurrently
    E->>F: write file.md (new content)
    Note over F: File on disk now has hash H2 ≠ H1

    U->>L: Ctrl+S (save)
    L->>R: write_file("file.md", newContent, expectedHash=H1)
    R->>F: read current hash
    F-->>R: hash=H2
    R->>R: H1 ≠ H2 → ConflictError
    R-->>L: ConflictError{path, H1, H2}
    L-->>U: Conflict dialog shown

    alt User chooses Overwrite
        U->>L: "Keep my changes"
        L->>R: write_file(..., skipHashCheck=true)
        R->>F: atomic write
        F-->>R: ok, hash=H3
        R-->>L: SaveResult{H3}
        L-->>U: Saved ✓
    else User chooses Reload
        U->>L: "Discard and reload"
        L->>R: read_file("file.md")
        R->>F: read + hash H2
        F-->>R: content, hash=H2
        R-->>L: FileReadResult{H2}
        L-->>U: Editor reloaded with disk version
    end
```

---

## Class Model — Core Domain

```mermaid
classDiagram
    direction TB

    class LatticeApp {
        -ViewMode viewMode
        -string currentFilePath
        -string contentHash
        -bool isDirty
        -AppSettings settings
        +handleOpen()
        +handleSave()
        +handlePrint()
        +handleConflict()
    }

    class AppSettings {
        +int fontSize
        +bool wordWrap
        +bool highlightMark
        +string theme
        +string previewTheme
        +string dailyNoteDir
        +string defaultMermaidInit
        +save()
        +load()
    }

    class FileReadResult {
        +string content
        +string hash
    }

    class ConflictError {
        +string path
        +string expectedHash
        +string diskHash
    }

    class Editor {
        +CodeMirrorView view
        +string theme
        +bool wordWrap
        +int fontSize
        +bool highlightMark
        +getContent() string
        +setContent(content)
        +focus()
    }

    class PreviewRenderer {
        +string markdown
        +string theme
        +Components components
        +render() ReactElement
    }

    class MermaidComponent {
        +string chart
        +string theme
        +string mermaidInit
        +render() SVGElement
    }

    class TocGenerator {
        +generate(markdown) string
        +extractHeadings(markdown) Heading[]
    }

    class TableFormatter {
        +format(markdown, cursorPos) string
    }

    LatticeApp "1" --> "1" Editor : controls
    LatticeApp "1" --> "1" PreviewRenderer : drives
    LatticeApp "1" --> "1" AppSettings : owns
    LatticeApp ..> FileReadResult : receives
    LatticeApp ..> ConflictError : handles
    PreviewRenderer "1" --> "*" MermaidComponent : renders
    Editor ..> TocGenerator : uses
    Editor ..> TableFormatter : uses
```

---

## State Machine — Editor Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle : app starts

    Idle --> Loading : open file
    Loading --> Clean : read success
    Loading --> Error : read failure

    Clean --> Dirty : user edits
    Dirty --> Saving : Ctrl+S
    Saving --> Clean : save ok (no conflict)
    Saving --> ConflictDetected : hash mismatch

    ConflictDetected --> Saving : user → overwrite
    ConflictDetected --> Loading : user → reload

    Clean --> Idle : file closed
    Dirty --> DiscardConfirm : close / open new
    DiscardConfirm --> Idle : user confirms discard
    DiscardConfirm --> Dirty : user cancels

    Error --> Idle : dismiss

    Clean --> Printing : Ctrl+P
    Dirty --> Printing : Ctrl+P
    Printing --> Clean : print done
    Printing --> Dirty : print done
```

---

## Deployment Diagram

```mermaid
flowchart TB
    subgraph "End User Machine"
        subgraph "lattice.exe / lattice.app / lattice.AppImage"
            WV["WebView2 / WebKit\n(platform webview)"]
            RT["Tauri Runtime\n(Rust)"]
            WV <-->|"postMessage IPC"| RT
        end
        FS2["Local File System\n.md files, images"]
        RT <--> FS2
    end

    subgraph "GitHub — blessia-blessini/lattice"
        REL["GitHub Releases\n*.exe  *.dmg  *.AppImage\n*.deb  *.apk  *.aab"]
        LJ["latest.json\n(auto-update manifest)"]
    end

    subgraph "GitHub Pages — lattice-technologies.com"
        RLS["Lattice-Releases/\nindex.html (release portal)"]
        DM2["docs/demo/\ndemo docs (this file)"]
    end

    RT -->|"HTTPS check on start"| LJ
    RT -->|"HTTPS download"| REL
    WV -->|"browser → download page"| RLS
```

---

## CI/CD Pipeline

```mermaid
flowchart LR
    subgraph "Trigger"
        T1["push to *build* branch"]
        T2["git tag vX.X.X"]
        T3["workflow_dispatch"]
    end

    subgraph "Matrix Build (parallel)"
        W["windows-latest\nnsis .exe"]
        M1["macos-latest\naarch64 .dmg"]
        M2["macos-latest\nx86_64 .dmg"]
        L["ubuntu-latest\n.AppImage .deb"]
        A["ubuntu-latest\nAndroid .apk .aab"]
    end

    subgraph "Publish Job (tag only)"
        P1["Collect installers"]
        P2["Attest artifacts\n(build provenance)"]
        P3["Create GitHub Release\n+ upload assets"]
        P4["Generate index.md\n+ copy demo docs"]
        P5["Push to\nlattice-docs-releases"]
    end

    T1 & T2 & T3 --> W & M1 & M2 & L & A
    W & M1 & M2 & L & A --> P1
    P1 --> P2 --> P3 --> P4 --> P5
```

---

## Entity-Relationship — Settings & Persistence

```mermaid
erDiagram
    WINDOW_STATE {
        int width
        int height
        int x
        int y
        bool maximized
    }

    APP_SETTINGS {
        int fontSize
        bool wordWrap
        bool highlightMark
        string theme
        string previewTheme
        string viewMode
        string dailyNoteDir
        string defaultMermaidInit
    }

    OPEN_FILE {
        string path
        string contentHash
        bool isDirty
        string content
    }

    RECENT_FILES {
        string path
        datetime lastOpened
    }

    WINDOW_STATE ||--o| APP_SETTINGS : "persisted alongside"
    APP_SETTINGS ||--o{ OPEN_FILE : "applies to"
    OPEN_FILE }o--o{ RECENT_FILES : "recorded in"
```

---

## Next Steps

> This section tracks outstanding architectural work. Check off items as they are completed.

- [ ] **Multi-file tabs** — design tab bar state model; determine whether tabs live in a single window or spawn new Tauri windows
- [ ] **iOS build** — provision profiles and code-signing pipeline needed; CI placeholder exists at step 360
- [ ] **Plugin / extension API** — define a safe IPC surface for third-party CodeMirror extensions
- [ ] **Encrypted at-rest storage** — evaluate `tauri-plugin-stronghold` for sensitive note vaults
- [ ] **Full-text search across files** — Rust-side index using `tantivy` or similar; expose via Tauri command
- [ ] **Collaborative editing (offline-first)** — evaluate CRDT approach (e.g. Automerge) before any network layer is introduced
- [ ] **ARM64 Windows installer** — currently skipped in CI due to cross-compilation complexity; re-evaluate with Tauri v2.1+
- [ ] **Document the IPC command surface** — generate OpenAPI-style spec from Rust `#[tauri::command]` attributes

---

*Part of the Lattice demo suite.  
See also: [Feature Showcase](demo.md) · [Physics Equations](physics-equations.md)*
