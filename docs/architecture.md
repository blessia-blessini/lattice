# Lattice Architecture (v2)

Lattice is a local-first Markdown editor built with **Tauri**, combining a **Rust** backend for system interactions and performance with a **React (TypeScript)** frontend for the user interface. This document reflects the current architecture, including the introduction of a more robust file tracking system, new UI components, and a formal testing and CI pipeline.

## Technology Stack

- **Frontend**: React, TypeScript, Vite, CodeMirror, Vitest
- **Backend**: Rust, Tauri, `notify` (file watching)
- **Data Persistence**: Local file system (Markdown files).
- **Concurrency Control**: Hash-based optimistic locking (SHA-512) managed by the `FileState` module.

## High-Level Architecture

The application remains split into the Rust Core process and the Frontend WebView process. Communication is handled via Tauri's IPC bridge. The backend now contains a dedicated `FileState` manager to handle concurrency and file tracking.

```mermaid
graph TD
    subgraph "Frontend (WebView)"
        UI[React UI]
        Editor[Markdown Editor]
        FS_Service[FileSystem Service]
        
        UI --> Editor
        Editor --> FS_Service
    end

    subgraph "Backend (Rust Core)"
        IPC[Tauri Command Handler]
        FS_Cmd[File IO Commands]
        FileState_Manager[File State Manager]
        Watch_Cmd[Watcher System]
        
        IPC --> FS_Cmd
        FS_Cmd -- Uses --> FileState_Manager
        IPC -- Manages --> Watch_Cmd
    end
    
    FS_Service -- "IPC (invoke)" --> IPC
    Watch_Cmd -- "Events (emit)" --> UI
    FileState_Manager -- "Read/Write" --> Disk[(Local File System)]
```

## Key Components & Diagrams

### 1. File Operation & Concurrency

The concurrency model remains optimistic-locking but is now encapsulated within the `file_state.rs` module on the backend. The `FileTrackerState` holds a map of all known files, their last-seen hashes, and which windows are viewing them.

```mermaid
sequenceDiagram
    participant FE as Frontend (Editor)
    participant BE as Backend (Rust Commands)
    participant FSM as File State Manager
    participant FS as FileSystem

    Note over FE, FS: Read Flow
    FE->>BE: read_text_file(path)
    BE->>FSM: read_text_file_internal(path)
    FSM->>FS: read_to_string()
    FS-->>FSM: content
    FSM->>FSM: compute_hash(content)
    FSM->>FSM: update_tracker(path, hash)
    FSM-->>BE: { content, hash }
    BE-->>FE: { content, hash }

    Note over FE, FS: Write Flow (No Conflict)
    FE->>BE: write_text_file(path, new_content)
    BE->>FSM: write_text_file_internal(path, new_content)
    FSM->>FS: read_to_string()
    FS-->>FSM: current_content_on_disk
    FSM->>FSM: current_hash = compute_hash(current_content_on_disk)
    FSM->>FSM: expected_hash = get_hash_from_tracker(path)
    
    alt Hash Matches (Safe to Overwrite)
        FSM->>FS: write(path, new_content)
        FSM-->>BE: { path, new_hash }
        BE-->>FE: { path, new_hash }
    else Hash Mismatch (Conflict)
        FSM->>FSM: generate_conflict_filename()
        FSM->>FS: write(new_path, new_content)
        FSM-->>BE: { new_path, new_hash } (Conflict Resolved)
        BE-->>FE: { new_path, new_hash }
    end
```

### 2. Class and Instance Diagram (UML)

This diagram is updated to include new UI components (`Menu`, `Settings`, `Mermaid`) and the new backend modules (`FileTrackerState`, `FileState`, `TextHashingModule`).

```mermaid
classDiagram
    namespace Backend_Rust_Core {
        class TauriApp {
            <<src-tauri/src/lib.rs, Singleton>>
            +run()
            +manage(WatcherState)
            +manage(FileTrackerState)
        }
        
        class WatcherState {
            <<State>>
            +watchers: HashMap
        }

        class FileTrackerState {
            <<file_state.rs, State>>
            +files: HashMap<String, FileState>
        }

        class FileState {
            <<file_state.rs, Struct>>
            +last_hash: String
            +window_ids: Vec<String>
            +wished_format: FileWishedFormat
        }

        class TextHashingModule {
            <<textcontent_hashing.rs>>
            +compute_hash(content)
        }

        class RustCommands {
            <<src-tauri/src/lib.rs, Module>>
            +read_text_file(path)
            +write_text_file(path)
            +open_new_window(path)
            +watch_file(path)
            +save_image(path, data)
            +find_vault_settings_file()
            +initialize_vault_settings()
        }
    }

    namespace Frontend_WebView {
        class WindowFrontend {
            <<src/App.tsx, React App>>
            +App()
        }

        class EditorComponent {
            <<src/components/Editor.tsx>>
        }

        class MenuComponent {
            <<src/components/Menu.tsx>>
        }

        class SettingsComponent {
            <<src/components/Settings.tsx>>
        }

        class MermaidComponent {
            <<src/components/Mermaid.tsx>>
        }

        class FileSystemService {
            <<src/services/FileSystem.ts>>
            +readTextFile()
            +writeTextFile()
            +watchFile()
            +saveImage()
            +findVaultSettingsFile()
            +initVaultSettingsPath()
        }
    }

    %% Relationships
    TauriApp *-- WatcherState : Manages
    TauriApp *-- FileTrackerState : Manages
    FileTrackerState o-- FileState : Contains 0..*
    
    WindowFrontend --o EditorComponent
    WindowFrontend --o MenuComponent
    WindowFrontend --o SettingsComponent
    WindowFrontend --o MermaidComponent
    WindowFrontend ..> FileSystemService : Uses
    
    FileSystemService ..> RustCommands : Invokes (IPC)
    RustCommands ..> WatcherState : Modifies/Reads
    RustCommands ..> FileTrackerState : Modifies/Reads
    RustCommands ..> TextHashingModule : Uses
```

## Theme Design

Lattice uses an **orthogonal, two-theme model**: the editor (app) theme and the preview pane theme are fully independent of each other and of the OS color scheme.

### Editor Theme

Controlled by the `m_theme` state (`'dark' | 'light'`) in `App.tsx`, loaded from vault settings on startup and toggled via the toolbar. It is applied by setting `data-theme` on the root `.container` div, which cascades to all editor UI elements (toolbar, CodeMirror, dividers, etc.) via CSS attribute selectors.

### Preview Theme

Controlled by a separate `m_previewTheme` state (`'dark' | 'light'`) in `App.tsx`, defaulting to `'light'`. It is applied via:

- `data-preview-theme` on the `.preview-pane` div — drives background/text colors.
- `data-theme` on the inner `.markdown-body` div — drives `github-markdown-css` rendering.
- An explicit `color-scheme` CSS declaration on each `[data-preview-theme]` variant — this prevents the OS or root `color-scheme: light dark` from overriding the pane's rendering.

### Independence Guarantee

The two themes do not influence each other. A dark editor with a light preview, or any other combination, is valid. This is enforced at the CSS level: `.preview-pane[data-preview-theme]` rules carry their own `color-scheme` declaration, isolating the pane from both the ancestor `data-theme` cascade and the OS preference.

```
OS color scheme
      │  (blocked by color-scheme declaration on .preview-pane)
      ▼
.container [data-theme]          ← Editor / App theme
      │
      ├── toolbar, dividers, CodeMirror ...
      │
      └── .preview-pane [data-preview-theme]   ← Preview theme (independent)
                │
                └── .markdown-body [data-theme=previewTheme]
```

### Adding a New Theme Variant

To add a new preview theme (e.g. `'sepia'`):
1. Extend the `ViewMode`-style union type for `m_previewTheme` in `App.tsx`.
2. Add a `.preview-pane[data-preview-theme="sepia"] { color-scheme: light; ... }` block in `App.css`.
3. Add the matching `.markdown-body[data-theme="sepia"]` overrides in `App.css`.

No changes to `App.tsx` rendering logic are needed beyond wiring `setPreviewTheme` to a UI control.

## Testing Architecture

The project employs a dual strategy for testing, covering both the Rust backend and the React frontend.

-   **Backend (Rust)**: Unit and integration tests are written within the Rust modules (e.g., `lib.rs`, `file_state.rs`) under a `#[cfg(test)]` configuration. They are executed with `cargo test`.
-   **Frontend (React)**: Component and hook tests are written using **Vitest**, a Vite-native test framework. It uses `jsdom` to simulate a browser environment, allowing tests to run in a standard Node.js environment.

```mermaid
graph TD
    subgraph "Test Execution"
        CargoTest[cargo test]
        Vitest[npm run test]
    end

    subgraph "Codebases"
        RustBackend[Rust Backend Modules]
        ReactFrontend[React Frontend Components]
    end

    CargoTest --> RustBackend
    Vitest --> ReactFrontend
```

## Continuous Integration (CI) Architecture

The CI pipeline is defined in `.github/workflows/buildAndTest.yml` and is triggered on pushes to specific branches or manually. It uses a matrix strategy to ensure the application builds and passes tests across all major desktop platforms.

### CI Pipeline Flow

```mermaid
graph TD
    A[Push to 'build' branch or Manual Dispatch] --> B{Setup Job};
    B --> C{Define Build Matrix};
    C --> D1[Windows Build & Test];
    C --> D2[macOS Build & Test];
    C --> D3[Linux Build & Test];
    
    D1 --> E[Upload Artifacts];
    D2 --> E[Upload Artifacts];
    D3 --> E[Upload Artifacts];

    D3 --> F[Generate & Upload Documentation];
```

### Key CI Steps:
1.  **Setup Job**: A preliminary job determines which platforms (e.g., `windows-desktop`, `linux-desktop`, `all`) to run on based on the manual trigger input or the branch name. It generates a JSON matrix for the next job.
2.  **Build & Test Job**: This job runs in parallel for each configuration in the matrix.
    -   **Environment**: Sets up Node.js, Rust (including cross-compilation targets if needed), and caches dependencies.
    -   **Build**: Compiles the Rust backend and builds the frontend, finally bundling them into a native application (`.exe`, `.dmg`, `.AppImage`).
    -   **Test**: Runs `cargo test` for the backend and `npm run test` (Vitest) for the frontend to ensure correctness.
    -   **Artifacts**: The final compiled applications and documentation are uploaded as artifacts for download and deployment.
