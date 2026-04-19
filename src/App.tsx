// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

import { useRef, useState, useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'github-markdown-css/github-markdown.css';
import { Editor } from "./components/Editor";
import { Mermaid } from "./components/Mermaid";
import { Menu } from "./components/Menu";
// we opted for using the settings pane within the same window
//  as it will be more mobile-friendly for porting later
import { Settings } from "./components/Settings";
import { FileSystem } from "./services/FileSystem";
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import tauriConfig from '../src-tauri/tauri.conf.json';

import { StaticRuntime } from "@services/StaticRuntime";

const APP_NAME = tauriConfig.productName || "Lattice";

//******************************************************************************
// App
//******************************************************************************
function App() {

  // Static Runtime Initialization (Shimmed)
  // - DEV: Sets up logging and backend trace
  // - PROD: Does nothing (Empty function)
  useEffect(() => {
    StaticRuntime.init();
    StaticRuntime.log("App mounted via StaticRuntime Shim");
  }, []);

  //****************************************************************************
  // State Management
  //****************************************************************************
  const [m_theme, setTheme] = useState<'dark' | 'light'>('dark'); // Local theme (current window)
  const [m_wordWrap, setWordWrap] = useState(false);
  const [m_dailyNotesPath, setDailyNotesPath] = useState<string>('');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'dual'>('edit');
  const [m_loadedContent, setLoadedContent] = useState("");
  const [m_isSettingsWindow, setIsSettingsWindow] = useState(false);
  const [isModalBlocked, setIsModalBlocked] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [m_vaultSettingsPath, setVaultSettingsPath] = useState<string>(""); // NEVER NULL
  const [previewContent, setPreviewContent] = useState("");


  // File Management State
  const [m_currentFilePath, setCurrentFilePath] = useState<string | null>(null);

  const [saveOnBlur, setSaveOnBlur] = useState(true);

  // Dirty State Management
  const [m_isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<import("./components/Editor").EditorHandle>(null);

  const autoSaveTimer = useRef<number | null>(null);

  // MRU State
  const [mruList, setMruList] = useState<string[]>([]);

  // Load MRU from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('lattice-mru-list');
    if (saved) {
      try {
        setMruList(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse MRU list", e);
      }
    }
  }, []);

  // Helper to add to MRU
  const addToMRU = (path: string) => {
    if (!path) return;
    setMruList(prev => {
      // Remove existing instance of path
      const newList = prev.filter(p => p !== path);
      // Add to front
      newList.unshift(path);
      // Trim to 20
      if (newList.length > 20) {
        newList.splice(20);
      }
      // Save
      localStorage.setItem('lattice-mru-list', JSON.stringify(newList));
      return newList;
    });
  };

  // TRACE: Monitor m_currentFilePath state changes
  useEffect(() => {
    console.log(`TRACE: State 'm_currentFilePath' changed to: ${m_currentFilePath}`);
  }, [m_currentFilePath]);
  // State Management END ******************************************************


  //****************************************************************************
  // Settings Loading
  //****************************************************************************
  const loadSettings = async () => {
    try {
      const filePath = m_vaultSettingsPath;
      console.log(`DEBUG: Entering loadSettings (m_vaultSettingsPath: ${filePath})`);
      if (!filePath) {
        console.error("[ERROR] loadSettings called with empty path - should never happen");
        return;
      }

      const settings = await invoke<any>('load_settings', { settingsPath: filePath });

      if (settings.defaultOpenTheme === 'dark' || settings.defaultOpenTheme === 'light') {
        setTheme(settings.defaultOpenTheme as 'dark' | 'light');
      } else {
        setTheme('dark');
      }
      setWordWrap(settings.wordWrap === true);
      setSaveOnBlur(settings.saveOnBlur !== false); // default true
      setDailyNotesPath(settings.dailyNotesPath || '');

    } catch (error) {
      console.log("Settings file not found or invalid, using default.", error);
    }
  };// Settings Loading END ****************************************************


  //****************************************************************************
  // Window Management
  //****************************************************************************
  useEffect(() => {
    const checkWindow = async () => {
      console.log("DEBUG: Entering checkWindow");

      await invoke('calc_base_path');

      const label = getCurrentWebviewWindow().label;
      if (label === 'settings') {
        console.log("DEBUG: Settings window detected");
        setIsSettingsWindow(true);
      }
    };

    checkWindow();
    loadSettings();


    const setupListeners = async () => {
      console.log("DEBUG: Entering setupListeners");

      // Error Injection Tests
      StaticRuntime.setupTestModeListeners();

      const unlistenOpened = await listen('app:settings-opened', () => {
        if (getCurrentWebviewWindow().label !== 'settings') {
          setIsModalBlocked(true);
        }
      });
      const unlistenClosed = await listen('app:settings-closed', () => {
        setIsModalBlocked(false);
        loadSettings(); // Reload settings when window closes
      });

      return () => {
        unlistenOpened();
        unlistenClosed();
      };
    };
    setupListeners();
  }, []);// Window Management END **********************************************

  //****************************************************************************
  // setWindowTitle (Helper)
  //****************************************************************************
  const setWindowTitle = async (path: string | null, dirty: boolean) => {

    if (m_isSettingsWindow) {
      return;
    }

    const window = getCurrentWebviewWindow();
    let title = APP_NAME;
    if (path) {
      const fileName = path.split(/[\\/]/).pop();
      title = `${fileName} - ${APP_NAME}`;
    }

    if (__APP_VERSION__) {
      title += ` (${__APP_VERSION__})`;
    }


    if (dirty) {
      title = `* ${title}`;
    }
    console.log("Setting window title to:", title);
    try {
      await window.setTitle(title);
      document.title = title; // Sync for printing
    } catch (error) {
      console.error("Warning: Failed to set window title:", error);
    }
  };


  //****************************************************************************
  // Window Title Management - bind the function above
  //****************************************************************************
  useEffect(() => {
    setWindowTitle(m_currentFilePath, m_isDirty);
  }, [m_currentFilePath, m_isDirty]);
  // Window Title Management END ***********************************************


  //****************************************************************************
  // Vault Settings Path Management
  //****************************************************************************
  // Reload settings when vault path changes
  useEffect(() => {
    console.log("*** DEBUG: Entering useEffect for m_vaultSettingsPath {}", m_vaultSettingsPath);
    if (m_vaultSettingsPath) {
      loadSettings();
    }
  }, [m_vaultSettingsPath]);
  // Vault Settings Path Management END ****************************************


  //****************************************************************************
  // Theme Management
  //****************************************************************************
  const toggleTheme = () => {
    console.log("DEBUG: Entering toggleTheme");
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };// Theme Management END ****************************************************


  //****************************************************************************
  // View Mode Management (edit → preview → dual → edit)
  //****************************************************************************
  const handleCycleView = () => {
    setViewMode(prev => {
      if (prev === 'edit') return 'preview';
      if (prev === 'preview') return 'dual';
      return 'edit';
    });
  };// View Mode Management END *************************************************


  //****************************************************************************
  // Auto-save & Watch Logic
  //****************************************************************************
  const saveFile = async (path: string, text: string) => {
    console.log(`DEBUG: Entering saveFile (path: ${path})`);
    try {
      const response = await FileSystem.writeTextFile(path, text);

      // Mark editor as saved (update history baseline)
      if (editorRef.current) {
        editorRef.current.markAsSaved();
      }

      addToMRU(response.path); // Add to MRU (ensures new files or save-as are tracked)

      if (response.path !== path) {
        setCurrentFilePath(response.path);
        FileSystem.watchFile(response.path); // Watch new file
        alert(`Conflict detected. Saved to new file: ${response.path}`);
      }
    } catch (error) {
      console.error("Save failed:", error);
      // Don't alert on auto-save generic errors to avoid spamming, unless critical (TODO)
    }
  };// Auto-save & Watch Logic END *********************************************


  //****************************************************************************
  // Auto-save Effect (Debounce)
  //****************************************************************************
  useEffect(() => {
    if (!m_currentFilePath || !m_isDirty) return;

    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }

    autoSaveTimer.current = window.setTimeout(() => {
      if (editorRef.current) {
        saveFile(m_currentFilePath, editorRef.current.getContent());
      }
    }, 10000);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [m_currentFilePath, m_isDirty]);
  // Auto-save Effect END ******************************************************


  //****************************************************************************
  // Save on Blur
  //****************************************************************************
  useEffect(() => {
    const handleBlur = () => {
      if (saveOnBlur && m_currentFilePath && m_isDirty && editorRef.current) {
        saveFile(m_currentFilePath, editorRef.current.getContent());
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [saveOnBlur, m_currentFilePath, m_isDirty]);
  // Save on Blur END **********************************************************


  //****************************************************************************
  // File Watching
  //****************************************************************************
  useEffect(() => {
    const unlisten = listen('file-changed', async (event) => {
      const changedPath = event.payload as string;
      console.log(`DEBUG: Received: File Changed Event: ${changedPath} | Current: ${m_currentFilePath}`); // Debug Log
      if (changedPath === m_currentFilePath) {
        if (!m_isDirty) {
          console.log("Reloaded.");
          // Safe to reload
          try {
            const response = await FileSystem.readTextFile(changedPath);
            setLoadedContent(response.content);
            setPreviewContent(response.content); // Sync preview on reload


            // Should IsDirty be false here?
            // When we reload from disk, we are by definition "saved"
            if (editorRef.current) {
              editorRef.current.markAsSaved();
            }

          } catch (e) { console.error("Reload failed", e); }
        } else {
          console.log("File is not saved, skipping reload.");
          // If dirty, do nothing. Next save will trigger conflict resolution.
        }

      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [m_currentFilePath, m_isDirty]); // File Watching END *************************


  //****************************************************************************
  // handleSave
  // plainSave: true = normal save (use current path if available)
  //            false = save as (always show dialog)
  //****************************************************************************
  const handleSave = async (plainSave: boolean = true) => {
    console.log(`DEBUG: Entering handleSave(plainSave: ${plainSave})`);

    // Only allow save if there's an active editor
    if (!editorRef.current) return;

    if (plainSave && m_currentFilePath) {
      // Normal direct save
      await saveFile(m_currentFilePath, editorRef.current.getContent());
    } else {
      // Save As Flow (plainSave is false, OR m_currentFilePath is null)

      // If we are doing a "Save As" but already have a dirty file, save current file first
      // to avoid race condition with autosave and ensure clean state.
      if (!plainSave && m_currentFilePath && m_isDirty) {
        console.log("DEBUG: handleSave - saving current file first before Save As prompt");
        await saveFile(m_currentFilePath, editorRef.current.getContent());
      }

      try {
        const path = await save({
          defaultPath: m_currentFilePath || "",
          filters: [{
            name: 'Markdown',
            extensions: ['md', 'markdown']
          }]
        });

        if (path) {
          setCurrentFilePath(path);
          await saveFile(path, editorRef.current.getContent());
          FileSystem.watchFile(path);
        }
      } catch (err) {
        console.error("Save As cancelled or failed:", err);
      }
    }
  };// handleSave END **********************************************************

  //****************************************************************************
  // enforceVaultPath (Helper)
  //****************************************************************************
  // Ensures we always have a valid vault path.
  // If 'targetPath' (file path) is provided, looks for local vault.
  // If not found (or no targetPath), falls back to global (~/.lattice).
  const enforceVaultPath = async (targetPath: string) => {
    let vPath: string | null = await FileSystem.findVaultSettingsFile(targetPath);

    if (!vPath) {
      // Fallback to global (Passing empty string triggers home dir fallback in backend)
      // Assuming backend handles this, but let's be explicit
      console.warn("No specific vault found, fallback to global");
      vPath = await FileSystem.findVaultSettingsFile("");
    }

    if (vPath) {
      setVaultSettingsPath(vPath);
    } else {
      // Critical Failure - backend refused to give even a fallback
      console.error("CRITICAL: No Vault Settings Path could be resolved!");
      alert("Error: Could not resolve any settings path (local or global).");
      // this should be dead code -> never possible, assert(0), etc
      // and yet here we are with defence:
      //setVaultSettingsPath("./.lattice/settings.json");
    }
  }; // enforceVaultPath END *************************************************

  //****************************************************************************
  // promptForFile (Shared Logic)
  //****************************************************************************
  const promptForFile = async (): Promise<{ path: string } | null> => {
    console.log("DEBUG: Entering promptForFile");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{
        name: 'Markdown',
        extensions: ['md', 'markdown']
      }, {
        name: 'All Files',
        extensions: ['*']
      }]
    });

    if (selected === null) {
      return null;
    }

    const path = selected as string;
    return { path };
  }; // promptForFile END ******************************************************


  //****************************************************************************
  // handleLoadInNewWindow
  //****************************************************************************
  const handleLoadInNewWindow = async () => {
    console.log("DEBUG: Entering handleLoadInNewWindow");
    try {
      const result = await promptForFile();
      if (result) {
        // For new window, we just pass the path.
        // The new window will detect its own vault context on startup.
        await invoke('open_new_window', { path: result.path });
      }
    } catch (err) {
      console.error("Error opening in new window:", err);
      alert("Failed to open new window: " + err);
    }
  }; // handleLoadInNewWindow END **********************************************


  //****************************************************************************
  // handleOpenDailyNote
  //****************************************************************************
  const handleOpenDailyNote = async () => {
    if (!m_dailyNotesPath) {
      console.error("Daily notes path is not set.");
      return;
    }
    try {
      const targetPath = await invoke<string>('create_daily_note_file', { dailyNotesPath: m_dailyNotesPath });
      await loadDocument(targetPath);
    } catch (err) {
      console.error("Error creating/opening daily note:", err);
    }
  };
  // handleOpenDailyNote END ***************************************************


  //****************************************************************************
  // handleLoad  - Menu Involed "Load..."
  //****************************************************************************
  // handleLoad  - Menu Involed "Load..."
  //****************************************************************************
  const handleLoad = async () => {
    try {
      console.log(`DEBUG: handleLoad called with m_currentFilePath: ${m_currentFilePath}`);
      const result = await promptForFile();
      if (!result) return;
      const { path } = result;

      if (path) {
        await loadDocument(path);
      }
    } catch (err) {
      console.error("Error loading file:", err);
    }
  };// handleLoad END **********************************************************


  //****************************************************************************
  // loadDocument
  //****************************************************************************
  const loadDocument = async (path: string) => {
    console.log(`DEBUG: loadDocument called with path: ${path} (Old: ${m_currentFilePath})`);

    // 1. Enforce vault path for this file (STRICT MODE)
    // This handles finding the vault or falling back to global
    await enforceVaultPath(path);

    if (path) {
      try {
        /*
        // Stress Test Simulation
        if (StaticRuntime.shouldSimulateSearchFailure()) {
           throw new Error("Simulated Search Failure");
        }
        */

        // Load Content
        const response = await FileSystem.readTextFile(path);
        setLoadedContent(response.content);
        setPreviewContent(response.content); // Sync preview on load


        console.log(`DEBUG: loadDocument calling setCurrentFilePath with: ${path} (Old: ${m_currentFilePath})`);
        setCurrentFilePath(path);
        addToMRU(path); // Add to MRU

        if (editorRef.current) {
          editorRef.current.markAsSaved();
          console.log("DEBUG File loaded， editor marked as saved");
        }
        else {
          console.log("DEBUG File loaded， NO CURRENT EDITOR");
        }

        // Force title update immediately
        setIsDirty(false); // Ensure state matches
        setWindowTitle(path, false);

        // Start Watching
        FileSystem.watchFile(path);

        // setSaveOnBlur(true);
      }
      catch (error) {
        alert("Failed to load file: " + path + " ***error: " + error);
      }
    };
  };
  // loadDocument END **********************************************************


  //****************************************************************************
  // Check for CLI args or file association launch
  //****************************************************************************
  //****************************************************************************
  useEffect(() => {
    const checkLaunch = async () => {
      console.log("DEBUG: Entering checkLaunch");

      await invoke('calc_base_path');

      // 1. Check Direct Push (Option B) - Priority High
      const initData = (window as any).__LATTICE_INIT_DATA__;
      // CLEANUP MEMORY
      delete (window as any).__LATTICE_INIT_DATA__;

      if (initData) {
        console.log("DEBUG: Direct Push Data found for:", initData.path);
        try {
          setLoadedContent(initData.content);
          setPreviewContent(initData.content); // Sync preview on launch

          setCurrentFilePath(initData.path);
          if (editorRef.current) {
            editorRef.current.markAsSaved();
          }
          setSaveOnBlur(true);

          if (initData.path) {
            // Strict Enforce
            await enforceVaultPath(initData.path);
            FileSystem.watchFile(initData.path);
          }
        } catch (e) {
          console.error("Direct Push Init Failed:", e);
        }
      }
      else { //there is no initData
        // No file opened
        await enforceVaultPath(""); // Get global fallback
        console.log("Info: No Direct Push Data found. App opened without any file");
      }
    };
    checkLaunch();
  }, []);
  // checkLaunch useEffect END *************************************************


  //****************************************************************************
  // New Window
  //****************************************************************************
  const handleNewWindow = async () => {
    console.log("DEBUG: Entering handleNewWindow");
    try {
      await invoke('open_new_window');
    } catch (error) {
      console.error(error);
      alert("Failed to open new window: " + error);
    }
  };
  // handleNewWindow END *******************************************************

  //****************************************************************************
  // Initialize Vault Here
  //****************************************************************************
  const handleInitializeVault = async () => {
    if (!m_currentFilePath) return;

    // Check if we are already in a local vault?
    // For now, naive optimization: Check if current vault settings path is NOT in user home?
    // Actually, backend initVaultSettingsPath is safe (idempotent).

    try {
      const newSettingsPath = await FileSystem.initVaultSettingsPath(m_currentFilePath);
      setVaultSettingsPath(newSettingsPath);
      alert(`Vault Initialized! Settings will now be saved to: ${newSettingsPath}`);
    } catch (e) {
      alert("Failed to initialize vault: " + e);
    }
  };
  // Initialize Vault Here END *************************************************


  //****************************************************************************
  // Open Settings
  //****************************************************************************
  const handleOpenSettings = async () => {
    console.log("DEBUG: Entering handleOpenSettings");

    // With Strict Fallback, m_vaultSettingsPath should always be valid.
    if (!m_vaultSettingsPath) {
      await enforceVaultPath(m_currentFilePath || "");
      if (!m_vaultSettingsPath) {
        alert("Critical: No vault configuration found.");
        return;
      }
    }

    setShowSettingsModal(true);

    /*
    // Basic mobile detection - Regex Prefix
    const isMobile = true; // /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      setShowSettingsModal(true);
    } else {
      try {
        await invoke('open_settings_window');
      } catch (error) {
        console.error(error);
        alert("Failed to open settings: " + error);
      }
    } */
  };// handleOpenSettings END **************************************************


  //****************************************************************************
  // Settings Window
  //****************************************************************************
  /*
  if (m_isSettingsWindow) {
    return <Settings
      defaultTheme={m_theme}
      onDefaultThemeChange={setTheme}
      wordWrap={m_wordWrap}
      onWordWrapChange={setWordWrap}
      settingsPath={m_vaultSettingsPath || ""}
    />;

  } // if (isSettingsWindow) END ***********************************************
  */

  //****************************************************************************
  // Main App
  //****************************************************************************
  //****************************************************************************
  // Keyboard Shortcuts
  //****************************************************************************
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+S or Meta+S (Mac)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); // Prevent browser "Save Page"
        console.log("DEBUG: Ctrl+S detected. Triggering save...");
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    //**************************************************************************
    // Print Handling
    //**************************************************************************
    const handleBeforePrint = () => {
      // Strip " - lattice (...)" from title for clean printing
      document.title = m_currentFilePath ? m_currentFilePath.split(/[\\/]/).pop() || "Untitled" : "Untitled";
    };

    const handleAfterPrint = () => {
      // Restore full title
      setWindowTitle(m_currentFilePath, m_isDirty);
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [m_currentFilePath]); // Re-bind if m_currentFilePath changes

  return (
    <>
      {showSettingsModal && ( // this is when the complete window is settings in mobile app
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: m_theme === 'dark' ? '#0d1117' : '#ffffff',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <Settings
            defaultTheme={m_theme}
            onDefaultThemeChange={setTheme}
            wordWrap={m_wordWrap}
            onWordWrapChange={setWordWrap}
            saveOnBlur={saveOnBlur}
            dailyNotesPath={m_dailyNotesPath}
            onDailyNotesPathChange={setDailyNotesPath}
            onClose={() => setShowSettingsModal(false)}
            settingsPath={m_vaultSettingsPath || ""}
          />
        </div>
      )}
      <div className="container" data-theme={m_theme} style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: m_theme === 'dark' ? '#0d1117' : '#ffffff' }}>
        <div className="file-path-display" style={{
          padding: '5px 16px',
          backgroundColor: m_theme === 'dark' ? '#161b22' : '#f6f8fa',
          color: m_theme === 'dark' ? '#8b949e' : '#57606a',
          borderBottom: `1px solid ${m_theme === 'dark' ? '#30363d' : '#d0d7de'}`,
          fontSize: '13px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'left'
        }}>
          {m_currentFilePath || "No file is associated with this editor"}
        </div>
        <div className="toolbar" style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          zIndex: 100,
          display: 'flex',
          gap: '0.5rem'
        }}>
          <button
            onClick={handleCycleView}
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              border: 'none',
              background: m_theme === 'dark' ? '#30363d' : '#e1e4e8',
              color: m_theme === 'dark' ? '#c9d1d9' : '#24292e',
              cursor: 'pointer',
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}
          >
            {viewMode === 'edit' ? 'Preview' : viewMode === 'preview' ? 'Dual' : '✏️ Edit'}
          </button>

          <button
            onClick={toggleTheme}
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              border: 'none',
              background: m_theme === 'dark' ? '#30363d' : '#e1e4e8',
              color: m_theme === 'dark' ? '#c9d1d9' : '#24292e',
              cursor: 'pointer',
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}
          >
            {m_theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <Menu
            theme={m_theme}
            items={[
              { label: (!m_isDirty ? "(no unsaved changes)" : (m_currentFilePath ? "Save" : "Save ...")), onClick: handleSave, disabled: !m_isDirty },
              { label: "Save as ...", onClick: () => handleSave(false), disabled: !m_currentFilePath },
              { label: "To the Daily Note", onClick: handleOpenDailyNote },
              { label: "Open here ...", onClick: handleLoad },
              {
                label: "Open Recent",
                disabled: mruList.length === 0,
                submenu: mruList.map(path => ({
                  label: path,
                  onClick: () => loadDocument(path)
                }))
              },
              { label: "Open in new ...", onClick: handleLoadInNewWindow },
              { label: "New Window", onClick: handleNewWindow },
              { label: "Settings ...", onClick: handleOpenSettings, disabled: false },
              { label: "Initialize Vault Here ...", onClick: handleInitializeVault, disabled: !m_currentFilePath }
            ]}
          />
        </div>

        <div className="main-content" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div className="editor-pane" style={{
            flex: 1,
            height: '100%',
            display: viewMode === 'preview' ? 'none' : 'flex',
            flexDirection: 'column',
            minWidth: 0
          }}>
            <Editor
              ref={editorRef}
              theme={m_theme}
              wordWrap={m_wordWrap}
              initialDoc={m_loadedContent}
              currentFilePath={m_currentFilePath}
              onDirtyChange={setIsDirty}
              onChange={setPreviewContent}
            />
          </div>
          {viewMode === 'dual' && (
            <div style={{
              width: '1px',
              backgroundColor: m_theme === 'dark' ? '#30363d' : '#d0d7de',
              flexShrink: 0
            }} />
          )}
          <div className="preview-pane" style={{
            flex: 1,
            padding: '2rem',
            overflowY: 'auto',
            height: '100%',
            backgroundColor: m_theme === 'dark' ? '#0d1117' : '#ffffff',
            display: viewMode === 'edit' ? 'none' : 'block',
            color: m_theme === 'dark' ? '#c9d1d9' : '#24292e',
            minWidth: 0
          }}>
            <div className="markdown-body" data-theme={m_theme} style={{ backgroundColor: 'transparent', maxWidth: '80%', margin: '0 auto' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a(props) {
                    const { href, children } = props;
                    return (
                      <a
                        href={href}
                        onClick={(e) => {
                          if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:'))) {
                            e.preventDefault();
                            openUrl(href).catch(err => console.error('Failed to open URL externally:', err));
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {children}
                      </a>
                    );
                  },
                  code(props) {
                    const { children, className, node, ...rest } = props;
                    const match = /language-(\w+)/.exec(className || '');
                    if (match && match[1] === 'mermaid') {
                      return <Mermaid chart={String(children).replace(/\n$/, '')} theme={m_theme} />;
                    }
                    return (
                      <code className={className} {...rest}>
                        {children}
                      </code>
                    );
                  },
                  img(props) {
                    const { alt, src } = props;
                    if (!src) return <img alt={alt} />;
                    if (src.startsWith('http://') || src.startsWith('https://')) {
                      return <img src={src} alt={alt} style={{ maxWidth: '100%' }} />;
                    }
                    if (m_currentFilePath) {
                      //return <img alt="Hi b" />;
                      const pathSeparator = m_currentFilePath.includes('\\') ? '\\' : '/';

                      const lastSepIndex = m_currentFilePath.lastIndexOf(pathSeparator);
                      const parentDir = lastSepIndex !== -1 ? m_currentFilePath.substring(0, lastSepIndex) : "";
                      let absolutePath = "";

                      const cleanSrc = src.startsWith('.') ? src.substring(2) : src;
                      if (cleanSrc.startsWith('/') || cleanSrc.startsWith('\\') || parentDir.endsWith('/') || parentDir.endsWith('\\')) {
                        absolutePath = `${parentDir}${cleanSrc}`;
                      }
                      else {
                        absolutePath = `${parentDir}${pathSeparator}${cleanSrc}`;
                      }
                      // Use direct Base64 loading to bypass protocol issues
                      const [realSrc, setRealSrc] = useState<string>("");
                      //const [errorMsg, setErrorMsg] = useState<string>("");
                      const [_, setErrorMsg] = useState<string>("");

                      useEffect(() => {
                        if (!absolutePath) return;
                        invoke('read_file_base64', { path: absolutePath })
                          .then((res: any) => setRealSrc(res as string))
                          .catch((err: any) => setErrorMsg("Load Failed: " + err));
                      }, [absolutePath]);
                      /*
                      const debugInfo = JSON.stringify({
                        absolute: absolutePath,
                        status: realSrc ? "Loaded Base64" : "Loading...",
                        error: errorMsg
                      }, null, 2);
                      */
                      let sReturn = (
                        /*
                        <span style={{ display: 'block', border: '1px dashed #666', padding: '10px', margin: '10px 0' }}>

                          <span style={{ display: 'block', fontSize: '10px', whiteSpace: 'pre-wrap', color: 'orange', fontFamily: 'monospace' }}>
                            DEBUG INFO:
                            {debugInfo}
                          </span>
                          {realSrc ? (
                            <img
                              src={realSrc}
                              alt={alt}
                              style={{ maxWidth: '100%', border: '2px solid green' }}
                            />
                          ) : (
                            <span style={{ display: 'block', color: 'red' }}>Image Not Loaded Yet</span>
                          )}
                        </span>
                        */
                        <img src={realSrc} alt={alt} />
                      );
                      return sReturn;
                    }
                    return <img src={src} alt={alt} />;
                  }
                }}
              >
                {previewContent}
              </ReactMarkdown>
            </div>

          </div>
        </div >
        {isModalBlocked && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.1)',
            zIndex: 9999,
            cursor: 'not-allowed'
          }} />
        )
        }
      </div >
    </>
  );
}
// App END *********************************************************************

export default App;
