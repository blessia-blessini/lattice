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

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import ReactMarkdown, { type Components } from 'react-markdown';
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

// Rehype plugin: copy each element's source line number from its mdast position
// onto a data-source-line attribute, used by dual-view scroll sync.
const rehypeAddSourceLines = () => (tree: any) => {
  const walk = (node: any) => {
    if (node.type === 'element' && node.position?.start?.line != null) {
      node.properties = node.properties || {};
      node.properties['data-source-line'] = String(node.position.start.line);
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
};

const PREVIEW_THEME_COLORS = {
  light: { backgroundColor: '#ffffff', color: '#24292e', colorScheme: 'light' as const },
  dark:  { backgroundColor: '#0d1117', color: '#c9d1d9', colorScheme: 'dark'  as const },
};

const VIEW_EDIT        = 'edit'         as const;
const VIEW_PREVIEW     = 'preview'      as const;
const VIEW_DUAL        = 'dual'         as const;
const VIEW_DUAL_SWAP   = 'dual-swap'    as const;
const VIEW_DUAL_TOP    = 'dual-top'     as const;
const VIEW_DUAL_BOTTOM = 'dual-bottom'  as const;
type ViewMode = typeof VIEW_EDIT | typeof VIEW_PREVIEW | typeof VIEW_DUAL | typeof VIEW_DUAL_SWAP
              | typeof VIEW_DUAL_TOP | typeof VIEW_DUAL_BOTTOM;
const DUAL_MODES = [VIEW_DUAL, VIEW_DUAL_SWAP, VIEW_DUAL_TOP, VIEW_DUAL_BOTTOM] as const;
const isDual       = (m: ViewMode) => (DUAL_MODES as readonly string[]).includes(m);
const isVertical   = (m: ViewMode) => m === VIEW_DUAL_TOP || m === VIEW_DUAL_BOTTOM;

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

  // Prevent browser-level WebView refresh via keyboard (F5 / Ctrl+R / Cmd+R)
  // and via right-click context menu. Both would restart the React app and
  // discard unsaved editor state. sessionStorage recovery handles the rare case
  // where a reload still occurs (e.g. Tauri dev hot-reload).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
        e.preventDefault();
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  //****************************************************************************
  // State Management
  //****************************************************************************
  const [m_theme, setTheme] = useState<'dark' | 'light'>('dark');
  const toolbarBtnStyle: React.CSSProperties = {
    padding: '6px 16px',
    borderRadius: '10px',
    border: 'none',
    // Use backgroundColor (not the `background` shorthand) so components that
    // spread this style can layer their own backgroundImage (e.g. the view-mode
    // <select>'s dropdown chevron) without the shorthand resetting image /
    // repeat / position / size and producing tiled-triangle artifacts.
    backgroundColor: m_theme === 'dark' ? 'rgba(48,54,61,0.75)' : 'rgba(225,228,232,0.75)',
    backgroundImage: 'none',
    backgroundRepeat: 'no-repeat',
    color: m_theme === 'dark' ? '#c9d1d9' : '#24292e',
    cursor: 'pointer',
    fontWeight: 600,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  }; // Local theme (current window)
  const [m_previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('light'); // Preview pane theme (independent)
  const [m_wordWrap, setWordWrap] = useState(false);
  const [m_dailyNotesPath, setDailyNotesPath] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>(VIEW_EDIT);
  const [splitPct, setSplitPct] = useState(57); // editor share in %, preview gets remainder
  const [m_loadedContent, setLoadedContent] = useState("");
  const [m_isSettingsWindow, setIsSettingsWindow] = useState(false);
  const [isModalBlocked, setIsModalBlocked] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [m_vaultSettingsPath, setVaultSettingsPath] = useState<string>(""); // NEVER NULL
  const [previewContent, setPreviewContent] = useState("");

  // Note on checkbox-click sync:
  // Every edit — including a preview checkbox toggle, a keystroke in the
  // source pane, an undo, a redo, an external file reload — flows through
  // the same path: editor dispatches change -> updateListener fires
  // onChange(doc) -> setPreviewContent(doc). That single codepath is why
  // undo / redo stay in sync across both panes.
  //
  // The reason a checkbox click does not visibly "redraw the whole preview"
  // is the two layers of memoization set up below (`previewComponents` +
  // `previewMarkdown`). With stable component identities React reconciles
  // the new ReactMarkdown output against the previous tree, sees every
  // subtree (images, Mermaid, paragraphs, code blocks) is unchanged, and
  // the only DOM write is flipping `checked` on the one <input>. Images
  // and Mermaid charts stay mounted — no remount, no flicker.


  // File Management State
  const [m_currentFilePath, setCurrentFilePath] = useState<string | null>(null);

  const [saveOnBlur, setSaveOnBlur] = useState(true);

  // Dirty State Management
  const [m_isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<import("./components/Editor").EditorHandle>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);

  const handleEditorChange = useCallback((content: string) => {
    setPreviewContent(content);
  }, []);

  const autoSaveTimer = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = mainContentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const vertical = isVertical(viewMode);
    const startPos = vertical ? e.clientY : e.clientX;
    const containerSize = vertical ? rect.height : rect.width;
    const startPct = splitPct;
    let rafId: number | null = null;

    const onMouseMove = (mv: MouseEvent) => {
      if (rafId !== null) return; // already a frame pending
      rafId = requestAnimationFrame(() => {
        const delta = (vertical ? mv.clientY : mv.clientX) - startPos;
        const newPct = Math.min(90, Math.max(10, startPct + (delta / containerSize) * 100));
        setSplitPct(newPct);
        rafId = null;
      });
    };
    const onMouseUp = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

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

  // TRACE: Monitor m_currentFilePath state changes + persist for refresh recovery
  useEffect(() => {
    console.log(`TRACE: State 'm_currentFilePath' changed to: ${m_currentFilePath}`);
    if (m_currentFilePath) {
      sessionStorage.setItem('lattice-last-open-path', m_currentFilePath);
    } else {
      sessionStorage.removeItem('lattice-last-open-path');
    }
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
        // Try to restore last open file from session (survives WebView refresh)
        const lastPath = sessionStorage.getItem('lattice-last-open-path');
        if (lastPath) {
          console.log("Info: Restoring last open file after refresh:", lastPath);
          try {
            await enforceVaultPath(lastPath);
            const response = await FileSystem.readTextFile(lastPath);
            setLoadedContent(response.content);
            setPreviewContent(response.content);
            setCurrentFilePath(lastPath);
            FileSystem.watchFile(lastPath);
            if (editorRef.current) editorRef.current.markAsSaved();
          } catch (e) {
            console.error("Failed to restore last file:", e);
            sessionStorage.removeItem('lattice-last-open-path');
            await enforceVaultPath("");
          }
        } else {
          await enforceVaultPath(""); // Get global fallback
          console.log("Info: No Direct Push Data found. App opened without any file");
        }
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
  if (m_isSettingsWindow) {
    return <Settings
      defaultTheme={m_theme}
      onDefaultThemeChange={setTheme}
      wordWrap={m_wordWrap}
      onWordWrapChange={setWordWrap}
      saveOnBlur={saveOnBlur}
      dailyNotesPath={m_dailyNotesPath}
      onDailyNotesPathChange={setDailyNotesPath}
      settingsPath={m_vaultSettingsPath || ""}
    />;

  } // if (isSettingsWindow) END ***********************************************

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

  //****************************************************************************
  // Dual View Scroll Synchronization (line-accurate)
  //****************************************************************************
  useEffect(() => {
    if (!isDual(viewMode)) return;

    const editorScroll = editorRef.current?.getScrollDOM();
    const preview = previewPaneRef.current;
    if (!editorScroll || !preview) return;

    let isSyncing = false;

    // Build sorted [sourceLine, offsetTop] pairs from preview's tagged elements.
    const buildLineMap = (): Array<[number, number]> => {
      const elements = preview.querySelectorAll<HTMLElement>('[data-source-line]');
      const previewTop = preview.getBoundingClientRect().top;
      const map: Array<[number, number]> = [];
      elements.forEach(el => {
        const line = parseInt(el.dataset.sourceLine || '0', 10);
        if (line > 0) {
          const top = el.getBoundingClientRect().top - previewTop + preview.scrollTop;
          map.push([line, top]);
        }
      });
      return map.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    };

    const offsetForLine = (map: Array<[number, number]>, line: number): number => {
      if (map.length === 0) return 0;
      if (line <= map[0][0]) return 0;
      if (line >= map[map.length - 1][0]) {
        return Math.max(0, preview.scrollHeight - preview.clientHeight);
      }
      for (let i = 0; i < map.length - 1; i++) {
        if (line >= map[i][0] && line <= map[i + 1][0]) {
          const [l1, t1] = map[i];
          const [l2, t2] = map[i + 1];
          const r = l2 === l1 ? 0 : (line - l1) / (l2 - l1);
          return t1 + r * (t2 - t1);
        }
      }
      return 0;
    };

    const lineForOffset = (map: Array<[number, number]>, top: number): number => {
      if (map.length === 0) return 1;
      if (top <= map[0][1]) return map[0][0];
      if (top >= map[map.length - 1][1]) return map[map.length - 1][0];
      for (let i = 0; i < map.length - 1; i++) {
        if (top >= map[i][1] && top <= map[i + 1][1]) {
          const [l1, t1] = map[i];
          const [l2, t2] = map[i + 1];
          const r = t2 === t1 ? 0 : (top - t1) / (t2 - t1);
          return l1 + r * (l2 - l1);
        }
      }
      return 1;
    };

    const onEditorScroll = () => {
      if (isSyncing) return;
      const handle = editorRef.current;
      if (!handle) return;
      const line = handle.getTopVisibleLine();
      if (line == null) return;
      const target = offsetForLine(buildLineMap(), line);
      isSyncing = true;
      preview.scrollTop = target;
      requestAnimationFrame(() => { isSyncing = false; });
    };

    const onPreviewScroll = () => {
      if (isSyncing) return;
      const handle = editorRef.current;
      if (!handle) return;
      const line = lineForOffset(buildLineMap(), preview.scrollTop);
      isSyncing = true;
      handle.scrollToLine(line);
      requestAnimationFrame(() => { isSyncing = false; });
    };

    editorScroll.addEventListener('scroll', onEditorScroll, { passive: true });
    preview.addEventListener('scroll', onPreviewScroll, { passive: true });

    return () => {
      editorScroll.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
    };
  }, [viewMode, previewContent]);

  //****************************************************************************
  // Memoized preview pipeline
  // ---------------------------------------------------------------------------
  // Two memoization layers, both important for avoiding full-preview redraws:
  //
  // 1. `previewComponents` gives the ReactMarkdown renderers stable function
  //    identity across App re-renders. Without this the `components={{...}}`
  //    literal would be rebuilt every render, React would see each custom
  //    renderer (img, code, a, input) as a "new component type", and would
  //    unmount + remount every corresponding DOM subtree on every preview
  //    update. That's what produces the image/Mermaid flicker on checkbox
  //    clicks and on every unrelated state change (theme flips, split drag,
  //    settings modal, ...).
  //
  // 2. `previewMarkdown` caches the actual <ReactMarkdown> React element,
  //    keyed on previewContent + previewComponents. Unrelated App re-renders
  //    will then reuse this cached element wholesale and React won't even
  //    call into ReactMarkdown's internals — no re-parse, no reconciliation
  //    inside the preview subtree at all.
  //
  // Deps note: the renderers close over m_theme (for Mermaid) and
  // m_currentFilePath (for image path resolution). Both change rarely, and
  // when they do the preview should refresh anyway, so it's correct that
  // those invalidate the memo.
  //****************************************************************************
  const previewComponents = useMemo<Components>(() => ({
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
    // GFM task-list checkboxes. remark-gfm renders them as
    // <input type="checkbox" disabled [checked]>. We override that to
    // make them clickable and to avoid re-rendering the
    // whole preview on toggle.
    input(props) {
      const anyProps = props as any;
      if (anyProps.type === 'checkbox') {
        const directLine = anyProps['data-source-line'];
        return (
          <input
            type="checkbox"
            className={`task-checkbox ${anyProps.className || ''}`.trim()}
            // GFM task-list checkboxes. We use `checked` (controlled) to
            // ensure the DOM stays in sync with the source pane, especially
            // during undo/redo. React's reconciliation, combined with the
            // stable component identities from useMemo, handles the
            // update efficiently without remounting or flickering.
            checked={!!anyProps.checked}
            onChange={(e) => {
              let line: number | null = directLine ? Number(directLine) : null;
              if (!line || !Number.isFinite(line)) {
                const host = (e.currentTarget as HTMLElement)
                  .closest('[data-source-line]') as HTMLElement | null;
                const raw = host?.getAttribute('data-source-line');
                if (raw) line = Number(raw);
              }
              if (line && Number.isFinite(line)) {
                const toggled = editorRef.current?.toggleTaskAtLine(line);
                if (!toggled) {
                  // Regex didn't match the line — nothing got dispatched
                  // to CodeMirror, so undo the native click.
                  e.currentTarget.checked = !e.currentTarget.checked;
                }
              }
            }}
          />
        );
      }
      // Non-checkbox inputs (rare inside markdown) pass through.
      return <input {...(props as any)} />;
    },
    img(props) {
      const { alt, src } = props;
      if (!src) return <img alt={alt} />;
      if (src.startsWith('http://') || src.startsWith('https://')) {
        return <img src={src} alt={alt} style={{ maxWidth: '100%' }} />;
      }
      if (m_currentFilePath) {
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
        // Use direct Base64 loading to bypass protocol issues.
        // Initialize with `undefined` (not "") so the first render does
        // not produce <img src="">, which React warns about and which
        // makes the browser re-request the current page.
        const [realSrc, setRealSrc] = useState<string | undefined>(undefined);
        const [_, setErrorMsg] = useState<string>("");

        useEffect(() => {
          if (!absolutePath) return;
          invoke('read_file_base64', { path: absolutePath })
            .then((res: any) => setRealSrc(res as string))
            .catch((err: any) => setErrorMsg("Load Failed: " + err));
        }, [absolutePath]);
        return realSrc ? <img src={realSrc} alt={alt} /> : <img alt={alt} />;
      }
      return <img src={src} alt={alt} />;
    },
  }), [m_theme, m_currentFilePath]);

  const previewMarkdown = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeAddSourceLines, rehypeKatex]}
      components={previewComponents}
    >
      {previewContent}
    </ReactMarkdown>
  ), [previewContent, previewComponents]);

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
          <select
            data-testid="view-mode-select"
            value={viewMode}
            onChange={e => setViewMode(e.target.value as ViewMode)}
            style={{
              ...toolbarBtnStyle,
              // All vendor prefixes — WebView2/WebKit can still draw their own
              // native chevron if only the unprefixed `appearance` is set,
              // which then stacks on top of our custom SVG and looks like
              // extra triangles on the button.
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              paddingRight: '28px',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='${m_theme === 'dark' ? '%23c9d1d9' : '%2324292e'}' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              backgroundSize: '12px 12px',
            }}
          >
            {/* Use a single family of monochrome geometric markers so all
                rows render from the same font (no color-emoji vs outline
                mismatch). The filled half-square also conveys which pane is
                the editor at a glance. */}
            <option value={VIEW_EDIT}>▤  Edit</option>
            <option value={VIEW_PREVIEW}>▥ Preview</option>
            <option value={VIEW_DUAL}>◨ Dual (edit on the left)</option>
            <option value={VIEW_DUAL_SWAP}>◧ Dual (edit on the right)</option>
            <option value={VIEW_DUAL_TOP}>⬓ Dual (edit on top)</option>
            <option value={VIEW_DUAL_BOTTOM}>⬒ Dual (edit on bottom)</option>
          </select>

          <button
            onClick={toggleTheme}
            style={toolbarBtnStyle}
          >
            {m_theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <Menu
            theme={m_theme}
            buttonStyle={toolbarBtnStyle}
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
              { label: "Initialize Vault Here ...", onClick: handleInitializeVault, disabled: !m_currentFilePath },
              { label: "---" },
              { label: "Exit", onClick: () => invoke('exit_app') }
            ]}
          />
        </div>

        <div ref={mainContentRef} className="main-content" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative',
          flexDirection: viewMode === VIEW_DUAL_SWAP ? 'row-reverse'
                       : viewMode === VIEW_DUAL_TOP    ? 'column'
                       : viewMode === VIEW_DUAL_BOTTOM ? 'column-reverse'
                       : 'row'
        }}>
          <div className="editor-pane" style={{
            flex: isDual(viewMode) ? `0 0 ${splitPct}%` : 1,
            display: viewMode === VIEW_PREVIEW ? 'none' : 'flex',
            height: isVertical(viewMode) ? 'auto' : '100%',
          }}>
            <Editor
              ref={editorRef}
              theme={m_theme}
              wordWrap={m_wordWrap}
              initialDoc={m_loadedContent}
              currentFilePath={m_currentFilePath}
              onDirtyChange={setIsDirty}
              onChange={handleEditorChange}
            />
          </div>
          {isDual(viewMode) && (
            <div
              className="pane-divider"
              data-testid="pane-divider"
              onMouseDown={handleDividerMouseDown}
              style={isVertical(viewMode)
                ? { width: '100%', height: '5px', cursor: 'row-resize' }
                : { width: '5px',  height: '100%', cursor: 'col-resize' }
              }
            />
          )}
          <div ref={previewPaneRef} className="preview-pane" data-preview-theme={m_previewTheme} style={{
            flex: isDual(viewMode) ? `0 0 ${100 - splitPct}%` : 1,
            display: viewMode === VIEW_EDIT ? 'none' : 'block',
            height: isVertical(viewMode) ? 'auto' : '100%',
            ...PREVIEW_THEME_COLORS[m_previewTheme],
          }}>
            <div className="markdown-body preview-pane__body" data-theme={m_previewTheme}
              style={{ backgroundColor: PREVIEW_THEME_COLORS[m_previewTheme].backgroundColor,
                       color: PREVIEW_THEME_COLORS[m_previewTheme].color }}>
              {/* Rendered via useMemo above — see `previewMarkdown`. Using
                  the cached element here means unrelated App re-renders do
                  not re-invoke ReactMarkdown, and a checkbox click (which
                  deliberately does not call setPreviewContent) leaves this
                  subtree completely untouched. */}
              {previewMarkdown}
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
