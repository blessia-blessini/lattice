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
import { homeDir } from "@tauri-apps/api/path";
import { shortenHomePath } from "./lib/path-utils";
import { clampTabSize, TAB_SIZE_DEFAULT } from "./lib/tab-size";
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
import { HighlightedCode } from "./components/HighlightedCode";
import { rehypeAddHeadingIds } from "./lib/rehype-heading-ids";
import { rehypeHighlightMark } from "./lib/rehype-highlight-mark";
import { rehypeSafeHtml } from "./lib/rehype-safe-html";
import { remarkStripHtmlComments } from "./lib/remark-strip-html-comments";
// we opted for using the settings pane within the same window
//  as it will be more mobile-friendly for porting later
import { Settings } from "./components/Settings";
import { FileSystem } from "./services/FileSystem";
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import tauriConfig from '../src-tauri/tauri.conf.json';
import { resolveRelativePath, isDocumentLink } from './lib/link-utils';
import { toSourceRange, findInnermostBlockIndex, isBlockTag } from './lib/cursor-block';
import { PREVIEW_THEME_COLORS } from './lib/preview-theme';
import { buildCopyHtml } from './lib/preview-copy';

import { StaticRuntime } from "@services/StaticRuntime";

const APP_NAME = tauriConfig.productName || "Lattice";

// Rehype plugin: copy each element's source line number from its mdast position
// onto a data-source-line attribute, used by dual-view scroll sync.
// IMPL-LTTCE-DVW-00003 — additionally emits data-source-line-end so every
// preview element carries a closed [start, end] source interval, which the
// cursor-flash feature needs for innermost-block containment tests.
const rehypeAddSourceLines = () => (tree: any) => {
  const walk = (node: any) => {
    if (node.type === 'element' && node.position?.start?.line != null) {
      node.properties = node.properties || {};
      node.properties['data-source-line'] = String(node.position.start.line);
      if (node.position?.end?.line != null) {
        node.properties['data-source-line-end'] = String(node.position.end.line);
      }
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
};

//******************************************************************************
// rehypeWrapMathBlocks
//******************************************************************************
// IMPL-LTTCE-DVW-00005 — rehype-katex REPLACES the display-math host element
// (`<pre><code class="language-math math-display">`, or a legacy
// `div.math-display`) with freshly generated KaTeX spans
// (`parent.children.splice(index, 1, ...result)`), destroying the
// data-source-line / data-source-line-end attributes rehypeAddSourceLines put
// on the host. Math blocks therefore had no source interval and never reacted
// to the cursor flash (and were invisible to the scroll-sync line map).
//
// Fix: wrap every display-math host in a <div class="math-block-anchor"> that
// carries a COPY of the interval. KaTeX replaces the inner host; the wrapper
// and its attributes survive. Inline math needs no wrapper — its enclosing
// paragraph keeps its own attributes.
// MUST run AFTER rehypeAddSourceLines and BEFORE rehypeKatex.
const rehypeWrapMathBlocks = () => (tree: any) => {
  const hasClass = (node: any, name: string) =>
    Array.isArray(node?.properties?.className) && node.properties.className.includes(name);

  const isDisplayMathHost = (node: any): boolean => {
    if (node?.type !== 'element') return false;
    // Legacy shape: <div class="math math-display"> (older mdast-util-math).
    if (hasClass(node, 'math-display') && node.tagName !== 'code') return true;
    // Current shape: <pre> hosting <code class="language-math math-display">.
    return node.tagName === 'pre' && Array.isArray(node.children) &&
      node.children.some((c: any) => c?.type === 'element' && c.tagName === 'code' &&
        (hasClass(c, 'language-math') || hasClass(c, 'math-display')));
  };

  const walk = (node: any) => {
    if (!Array.isArray(node?.children)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child?.type === 'element' && isDisplayMathHost(child) &&
          child.properties?.['data-source-line'] != null) {
        node.children[i] = {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['math-block-anchor'],
            'data-source-line': child.properties['data-source-line'],
            'data-source-line-end':
              child.properties['data-source-line-end'] ?? child.properties['data-source-line'],
          },
          children: [child],
        };
      } else {
        walk(child);
      }
    }
  };
  walk(tree);
};
// rehypeWrapMathBlocks END ****************************************************

// Preview colours live in lib/preview-theme.ts — the diagram rasteriser needs
// the same background value (IMPL-LTTCE-MRC-00001).

// ==highlight== background per preview theme (REQ-LTTCE-CPY-00001/00002).
// Handed to rehypeHighlightMark and written as an INLINE style on the emitted
// <span>, which is what lets the highlight survive a copy into MS Word — a CSS
// class would not travel with the clipboard.
//
// OPAQUE HEX ONLY — deliberately no rgba()/hsl()/colour keywords. These values
// are consumed by foreign HTML readers whose CSS parsers are far older than the
// WebView's; `#rrggbb` is the one notation they all accept. The dark value is
// the former rgba(255, 215, 0, 0.22) flattened over the dark preview background
// #0d1117, so it looks identical on screen while remaining copy-safe.
const MARK_COLORS = {
  light: '#ffe000',
  dark: '#423d12',
};

const VIEW_EDIT = 'edit' as const;
const VIEW_PREVIEW = 'preview' as const;
const VIEW_DUAL = 'dual' as const;
const VIEW_DUAL_SWAP = 'dual-swap' as const;
const VIEW_DUAL_TOP = 'dual-top' as const;
const VIEW_DUAL_BOTTOM = 'dual-bottom' as const;
type ViewMode = typeof VIEW_EDIT | typeof VIEW_PREVIEW | typeof VIEW_DUAL | typeof VIEW_DUAL_SWAP
  | typeof VIEW_DUAL_TOP | typeof VIEW_DUAL_BOTTOM;
const DUAL_MODES = [VIEW_DUAL, VIEW_DUAL_SWAP, VIEW_DUAL_TOP, VIEW_DUAL_BOTTOM] as const;
const isDual = (m: ViewMode) => (DUAL_MODES as readonly string[]).includes(m);
const isVertical = (m: ViewMode) => m === VIEW_DUAL_TOP || m === VIEW_DUAL_BOTTOM;

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

  // Fetch home directory once on mount for path display shortening.
  useEffect(() => {
    homeDir().then(dir => setHomeDir(dir)).catch(() => {});
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
    height: '32px',
    boxSizing: 'border-box',
    padding: '0 16px',
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
  const [m_highlightMark, setHighlightMark] = useState(true);
  const [m_showWhitespace, setShowWhitespace] = useState(false); // REQ-LTTCE-WSP-00002 — default OFF
  const [m_tabSize, setTabSize] = useState(TAB_SIZE_DEFAULT); // REQ-LTTCE-WSP-00005 — shared contract in lib/tab-size.ts
  const [m_blockExternalImages, setBlockExternalImages] = useState(true);
  const [m_defaultMermaidInit, setDefaultMermaidInit] = useState<string>('');
  // REQ-LTTCE-MRC-00005 — copy diagrams light-on-white regardless of theme.
  const [m_copyDiagramsLight, setCopyDiagramsLight] = useState(true);
  const [m_dailyNotesPath, setDailyNotesPath] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>(VIEW_EDIT);
  const [splitPct, setSplitPct] = useState(57); // editor share in %, preview gets remainder
  const [m_loadedContent, setLoadedContent] = useState("");
  // IMPL-LTTCE-FWT-00002 — monotonic counter, incremented once per genuine
  // load/reload from disk. It is the ONLY thing that lets the editor discard
  // its document and undo history; see `applyLoadedDocument`.
  const [m_docEpoch, setDocEpoch] = useState(0);
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

  // When the editor reconfigures (font size, theme, word-wrap), CodeMirror fires
  // a scroll event before it has remeasured block heights. getTopVisibleLine()
  // returns stale data at that moment, driving a bad preview sync that then
  // bounces back and snaps the editor to line 1. We pause the scroll sync for a
  // short window after any reconfiguration to let CodeMirror finish measuring.
  const scrollSyncPaused = useRef(false);
  const scrollSyncPauseTimer = useRef<number | null>(null);
  const pauseScrollSync = useCallback(() => {
    scrollSyncPaused.current = true;
    if (scrollSyncPauseTimer.current !== null) clearTimeout(scrollSyncPauseTimer.current);
    scrollSyncPauseTimer.current = window.setTimeout(() => {
      scrollSyncPaused.current = false;
      scrollSyncPauseTimer.current = null;
    }, 350);
  }, []);

  const handleEditorChange = useCallback((content: string) => {
    setPreviewContent(content);
  }, []);

  //****************************************************************************
  // Live mirrors of the dirty flag and the open path
  //****************************************************************************
  // IMPL-LTTCE-FWT-00002 — the `file-changed` listener is registered ONCE and
  // therefore cannot close over `m_isDirty` / `m_currentFilePath`: a callback
  // installed while the document was clean would keep believing that forever.
  // Worse, `listen()` resolves asynchronously, so re-registering the callback
  // on every dirty transition (the previous design) left a window in which the
  // *old* callback was still the live one — it saw `isDirty === false` while
  // the user was already typing, reloaded the file underneath them and threw
  // the un-saved keystrokes away. Refs are read at fire time, so they are
  // always current.
  const isDirtyRef = useRef(false);
  const currentFilePathRef = useRef<string | null>(null);

  //****************************************************************************
  // applyLoadedDocument
  //****************************************************************************
  /**
   * The single funnel for "this text just came from disk".
   *
   * Bumps `m_docEpoch`, which is what actually authorises the editor to throw
   * its state (and with it the undo history) away — see the `docEpoch` prop on
   * `Editor`. Because the epoch is the trigger, an ordinary React re-render can
   * never resurrect stale content into a document the user is editing; only an
   * explicit load reaching this function can.
   */
  const applyLoadedDocument = useCallback((text: string) => {
    setLoadedContent(text);
    setPreviewContent(text);
    setDocEpoch(prev => prev + 1);
  }, []);
  // applyLoadedDocument END ***************************************************

  const autoSaveTimer = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  // Used to skip the initial run of the m_currentFilePath effect so that the
  // sessionStorage session-restore item isn't wiped before checkLaunch reads it.
  const isInitialMount = useRef(true);

  // Guard: ensures checkLaunch runs only once, even under React StrictMode
  // double-mount.  Without this, the first mount deletes __LATTICE_INIT_DATA__
  // and the second mount falls to the "no file" branch, clearing the editor.
  const launchDone = useRef(false);

  // Home directory for path display shortening (fetched once on mount).
  // Kept in state so the display re-renders once the async fetch resolves.
  const [m_homeDir, setHomeDir] = useState<string>("");

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    pauseScrollSync(); // pane resize → stale block heights until CodeMirror remeasures
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
        pauseScrollSync(); // extend pause on every drag frame
        const delta = (vertical ? mv.clientY : mv.clientX) - startPos;
        // row-reverse (dual-swap) and column-reverse (dual-bottom) place the
        // editor pane on the trailing side, so the divider moves opposite to
        // how splitPct grows — negate the delta to restore natural drag feel.
        const isReversed = viewMode === VIEW_DUAL_SWAP || viewMode === VIEW_DUAL_BOTTOM;
        const newPct = Math.min(90, Math.max(10, startPct + ((isReversed ? -delta : delta) / containerSize) * 100));
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

  const FONT_SIZE_KEY = 'lattice-font-size';
  const FONT_SIZE_MIN = 70;
  const FONT_SIZE_MAX = 200;
  const FONT_SIZE_STEP = 5;
  const [m_fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return isNaN(parsed) ? 100 : Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, parsed));
  });

  const handleFontSizeIncrease = useCallback(() => {
    pauseScrollSync();
    setFontSize(prev => {
      const next = Math.min(FONT_SIZE_MAX, prev + FONT_SIZE_STEP);
      localStorage.setItem(FONT_SIZE_KEY, String(next));
      return next;
    });
  }, [pauseScrollSync]);

  const handleFontSizeDecrease = useCallback(() => {
    pauseScrollSync();
    setFontSize(prev => {
      const next = Math.max(FONT_SIZE_MIN, prev - FONT_SIZE_STEP);
      localStorage.setItem(FONT_SIZE_KEY, String(next));
      return next;
    });
  }, [pauseScrollSync]);

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
    // Skip the very first run (initial mount with null) so that a sessionStorage
    // key set by a previous session is still readable by checkLaunch below.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      console.log(`TRACE: State 'm_currentFilePath' changed to: ${m_currentFilePath} (initial — skipping sessionStorage update)`);
      return;
    }
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
      setHighlightMark(settings.highlightMark !== false); // default true
      setShowWhitespace(settings.showWhitespace === true); // default false — opt-in (REQ-LTTCE-WSP-00002)
      // Rust clamps on load, but guard against a malformed value anyway
      // (defensive; REQ-LTTCE-WSP-00005; shared contract in lib/tab-size.ts).
      setTabSize(clampTabSize(settings.tabSize));
      setBlockExternalImages(settings.blockExternalImages !== false); // default true — privacy-by-default
      setDefaultMermaidInit(settings.defaultMermaidInit || '');
      // REQ-LTTCE-MRC-00005 — default ON: pasted diagrams land in white
      // documents far more often than dark ones.
      setCopyDiagramsLight(settings.copyDiagramsLight !== false);

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
  // Scroll-sync pause triggers
  // Any operation that changes the editor's CSS layout causes CodeMirror to
  // remeasure block heights asynchronously.  During that window, scroll events
  // carry stale getTopVisibleLine() data and trigger the snap-to-top domino.
  // We pause the scroll sync for 350 ms after each such operation.
  //****************************************************************************

  // Window resize: fires continuously while the user drags the OS window edge.
  // Each call resets the 350 ms timer, so the pause extends for the full drag.
  useEffect(() => {
    window.addEventListener('resize', pauseScrollSync);
    return () => window.removeEventListener('resize', pauseScrollSync);
  }, [pauseScrollSync]);

  // View mode switch: switching into any dual mode resizes the editor pane.
  useEffect(() => {
    if (isDual(viewMode)) pauseScrollSync();
  }, [viewMode, pauseScrollSync]);

  // Word-wrap / highlight-mark toggles: both trigger a compartment reconfigure
  // that changes line heights (wrap) or adds inline decorations (highlight).
  useEffect(() => { pauseScrollSync(); }, [m_wordWrap, pauseScrollSync]);
  useEffect(() => { pauseScrollSync(); }, [m_highlightMark, pauseScrollSync]);

  // Scroll-sync pause triggers END ********************************************

  //****************************************************************************
  // Theme Management
  //****************************************************************************
  const toggleTheme = () => {
    console.log("DEBUG: Entering toggleTheme");
    pauseScrollSync();
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
  // Dirty / path ref mirrors
  //****************************************************************************
  // Updated in the same commit as the state they mirror, so any later task —
  // a timer, an IPC event — reads the value that is actually current.
  useEffect(() => {
    isDirtyRef.current = m_isDirty;
    currentFilePathRef.current = m_currentFilePath;
  }, [m_isDirty, m_currentFilePath]);
  // Dirty / path ref mirrors END **********************************************


  //****************************************************************************
  // File Watching
  //****************************************************************************
  // IMPL-LTTCE-FWT-00002 — registered exactly once, for the lifetime of the
  // window. Everything variable is read through a ref at fire time.
  useEffect(() => {
    const unlisten = listen('file-changed', async (event) => {
      const changedPath = event.payload as string;
      console.log(`DEBUG: Received: File Changed Event: ${changedPath} | Current: ${currentFilePathRef.current}`); // Debug Log
      if (changedPath !== currentFilePathRef.current) return;

      if (isDirtyRef.current) {
        console.log("File is not saved, skipping reload.");
        // If dirty, do nothing. Next save will trigger conflict resolution.
        return;
      }

      try {
        const response = await FileSystem.readTextFile(changedPath);

        // Re-check AFTER the await. Reading the file is asynchronous, and the
        // user keeps typing during it; without this second gate a keystroke
        // landing mid-read would be overwritten by the (now stale) disk copy.
        if (isDirtyRef.current || changedPath !== currentFilePathRef.current) {
          console.log("File went dirty during reload, skipping.");
          return;
        }

        // Nothing actually differs — most often the echo of our own autosave
        // that slipped past the backend filter (IMPL-LTTCE-FWT-00001).
        // Reloading identical text would still cost the user their undo
        // history, so don't.
        const inEditor = editorRef.current?.getContent();
        if (inEditor !== undefined && inEditor === response.content) {
          console.log("Reload skipped: content identical to editor.");
          return;
        }

        console.log("Reloaded.");
        applyLoadedDocument(response.content);

        // When we reload from disk, we are by definition "saved"
        if (editorRef.current) {
          editorRef.current.markAsSaved();
        }
      } catch (e) { console.error("Reload failed", e); }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [applyLoadedDocument]); // File Watching END *************************


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
        applyLoadedDocument(response.content); // Sync editor + preview on load


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

      // StrictMode guard: skip second mount (init data was consumed on first)
      if (launchDone.current) {
        // DO nothing more
        return;
      }
      launchDone.current = true;

      await invoke('calc_base_path');

      // 1. Check Direct Push (Option B) - Priority High
      const initData = (window as any).__LATTICE_INIT_DATA__;
      // CLEANUP MEMORY
      delete (window as any).__LATTICE_INIT_DATA__;

      if (initData) {
        console.log("DEBUG: Direct Push Data found for:", initData.path);
        try {
          applyLoadedDocument(initData.content); // Sync editor + preview on launch

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
            applyLoadedDocument(response.content);
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

      // Check for Ctrl+Z or Meta+Z (Undo)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        if (editorRef.current) {
          e.preventDefault();
          console.log("DEBUG: Undo shortcut detected.");
          editorRef.current.undo();
        }
      }

      // Check for Redo: Ctrl+Y (Win) or Cmd+Shift+Z / Cmd+Y (Mac)
      const isRedo = ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'));
      if (isRedo) {
        if (editorRef.current) {
          e.preventDefault();
          console.log("DEBUG: Redo shortcut detected.");
          editorRef.current.redo();
        }
      }

      // TOC refresh / table pad — both replace the full document, causing
      // CodeMirror to remeasure.  Pause sync so stale measurements don't
      // trigger a snap-to-top.  (CodeMirror's keymap also handles these keys;
      // we just need the pause to fire before the dispatch lands.)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        pauseScrollSync();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        pauseScrollSync();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    //**************************************************************************
    // Print Handling
    //**************************************************************************
    // Ctrl/Cmd + Scroll wheel → zoom in / out (mirrors the +/− toolbar buttons).
    // { passive: false } is required so preventDefault() actually suppresses the
    // browser's own pinch-zoom / page-zoom on the WKWebView/WebView2 host.
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // pauseScrollSync is called inside handleFontSizeIncrease/Decrease
        if (e.deltaY < 0) {
          handleFontSizeIncrease();
        } else if (e.deltaY > 0) {
          handleFontSizeDecrease();
        }
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });

    const handleBeforePrint = () => {
      // Strip " - lattice (...)" from title for clean printing
      const fileName = m_currentFilePath
        ? m_currentFilePath.split(/[\\/]/).pop() || "Untitled"
        : "Untitled";
      document.title = fileName;

      // Inject @page @top-center with the file name so it appears as a
      // running header on every printed page.  We write it as a <style>
      // tag rather than a static rule because the value is only known at
      // runtime.  Escape backslashes and double-quotes for CSS string safety.
      const esc = fileName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // Scale the print body font from an 11 pt baseline using the current
      // zoom level so Ctrl-P / Save-as-PDF honours the +/- zoom setting.
      const printPt = ((11 * m_fontSize) / 100).toFixed(2);
      const style = document.createElement('style');
      style.id = 'lattice-print-dynamic';
      const pageCss = '@page {\n  @top-center {\n    content: "' + esc + '";\n    font-size: 9pt;\n    font-family: Arial, Helvetica, sans-serif;\n    color: #555;\n  }\n}\n';
      const zoomCss = '.preview-pane, .preview-pane__body, .markdown-body { font-size: ' + printPt + 'pt !important; }\n'
        + '.cm-content, .cm-line { font-size: ' + printPt + 'pt !important; }';
      style.textContent = pageCss + zoomCss;
      document.head.appendChild(style);
    };

    const handleAfterPrint = () => {
      // Restore full title
      setWindowTitle(m_currentFilePath, m_isDirty);
      // Remove the dynamically injected print header style
      document.getElementById('lattice-print-dynamic')?.remove();
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [m_currentFilePath, m_fontSize]); // Re-bind when path or zoom changes

  //****************************************************************************
  // Dual View Scroll Synchronization (line-accurate)
  //****************************************************************************
  useEffect(() => {
    if (!isDual(viewMode)) return;

    const editorScroll = editorRef.current?.getScrollDOM();
    const preview = previewPaneRef.current;
    if (!editorScroll || !preview) return;

    // Suppress-window guard (replaces a single-rAF `isSyncing` flag).
    //
    // On Linux/X11 (incl. WSLg), mouse-wheel scrolling fires many small,
    // coalesced 'scroll' events whose delivery can lag a frame or more behind
    // the programmatic write that caused them — long enough for a one-rAF
    // `isSyncing` reset to have already cleared. The "echo" of our own write
    // then slips through as if it were user input, drives the other pane,
    // and that drives this one back, compounding small interpolation error
    // into a slow drift toward the top. (Keyboard scrolling moves the cursor
    // at a much lower event rate and stays inside a single rAF, so it never
    // triggers the loop.)
    //
    // Fix: remember *when* we last wrote to each pane and ignore any 'scroll'
    // event on that pane that arrives within SYNC_GUARD_MS of that write —
    // regardless of how many animation frames have elapsed.
    const SYNC_GUARD_MS = 120;
    let editorSyncUntil = 0;
    let previewSyncUntil = 0;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
      // Fallthrough: 'top' didn't land inside any interval.
      // This happens on macOS when sub-pixel getBoundingClientRect() values
      // create floating-point gaps between adjacent entries that share the
      // same source line (nested list items, table cells, etc.).
      // Defaulting to line 1 caused the editor to snap to the top — instead,
      // find the map entry whose content-Y is closest to 'top'.
      let closest = map[0];
      let minDist = Math.abs(top - map[0][1]);
      for (let i = 1; i < map.length; i++) {
        const dist = Math.abs(top - map[i][1]);
        if (dist < minDist) { minDist = dist; closest = map[i]; }
      }
      return closest[0];
    };

    const onEditorScroll = () => {
      if (scrollSyncPaused.current) return;
      if (now() < editorSyncUntil) return; // echo of our own preview→editor write
      const handle = editorRef.current;
      if (!handle) return;
      const line = handle.getTopVisibleLine();
      if (line == null) return;
      const target = offsetForLine(buildLineMap(), line);
      previewSyncUntil = now() + SYNC_GUARD_MS;
      preview.scrollTop = target;
    };

    const onPreviewScroll = () => {
      if (scrollSyncPaused.current) return;
      if (now() < previewSyncUntil) return; // echo of our own editor→preview write
      const handle = editorRef.current;
      if (!handle) return;
      const line = lineForOffset(buildLineMap(), preview.scrollTop);
      editorSyncUntil = now() + SYNC_GUARD_MS;
      handle.scrollToLine(line);
    };

    editorScroll.addEventListener('scroll', onEditorScroll, { passive: true });
    preview.addEventListener('scroll', onPreviewScroll, { passive: true });

    return () => {
      editorScroll.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
    };
    // NOTE: previewContent is intentionally excluded from deps.
    // buildLineMap() reads live DOM on every scroll event, so it never goes
    // stale. Including previewContent was causing the effect to re-register
    // on every keystroke, which reset isSyncing and let macOS WKWebView's
    // spurious scroll events (fired during ReactMarkdown re-renders) drive
    // the editor back to line 1 without any user input.
    // m_currentFilePath is included so we re-capture editorScroll when the
    // user switches to a different file (editor may remount).
  }, [viewMode, m_currentFilePath]); // eslint-disable-line react-hooks/exhaustive-deps

  //****************************************************************************
  // Dual-View Cursor Flash (IMPL-LTTCE-DVW-00003)
  //****************************************************************************
  // When the editor cursor changes line in a dual view, invert the innermost
  // preview block whose [data-source-line, data-source-line-end] interval
  // contains that line. Hold ~2 s after the last cursor move, then fade out
  // (REQ-LTTCE-DVW-00001..00003 / ARCH-LTTCE-DVW-00001).
  //
  // All DOM bookkeeping lives here; the selection algorithm is pure and lives
  // in lib/cursor-block.ts (IMPL-LTTCE-DVW-00001). Refs (not state) are used
  // throughout so cursor movement never re-renders the App tree.
  const FLASH_HOLD_MS = 2000;
  const FLASH_FADE_MS = 400;
  const flashLineRef = useRef<number>(-1);      // last cursor line reported
  const flashUntilRef = useRef<number>(0);      // epoch ms when hold expires
  const flashElRef = useRef<HTMLElement | null>(null);
  const flashHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  //****************************************************************************
  // clearCursorFlash
  //****************************************************************************
  /** Cancel timers and strip flash classes from the current element (if any). */
  const clearCursorFlash = useCallback(() => {
    if (flashHoldTimer.current != null) {
      clearTimeout(flashHoldTimer.current);
      flashHoldTimer.current = null;
    }
    if (flashFadeTimer.current != null) {
      clearTimeout(flashFadeTimer.current);
      flashFadeTimer.current = null;
    }
    const el = flashElRef.current;
    if (el) {
      el.classList.remove('lattice-cursor-flash', 'lattice-cursor-flash--fade');
      flashElRef.current = null;
    }
  }, []);
  // clearCursorFlash END ******************************************************

  //****************************************************************************
  // applyCursorFlashAt
  //****************************************************************************
  /**
   * Apply the inverted flash to the innermost preview block containing
   * `line`, holding for `holdMs` before starting the fade. No-op (after
   * clearing any previous flash) when no block contains the line — e.g. the
   * cursor sits on a blank separator line (REQ-LTTCE-DVW-00001).
   */
  const applyCursorFlashAt = useCallback((line: number, holdMs: number) => {
    clearCursorFlash();
    const preview = previewPaneRef.current;
    if (!preview || holdMs <= 0) return;
    const elements = Array.from(
      preview.querySelectorAll<HTMLElement>('[data-source-line]')
    ).filter(el => isBlockTag(el.tagName));
    const ranges = elements.map(el =>
      toSourceRange(el.getAttribute('data-source-line'), el.getAttribute('data-source-line-end'))
    );
    const idx = findInnermostBlockIndex(ranges, line);
    if (idx < 0) return;
    const el = elements[idx];
    el.classList.add('lattice-cursor-flash');
    flashElRef.current = el;
    flashHoldTimer.current = setTimeout(() => {
      el.classList.add('lattice-cursor-flash--fade');
      flashFadeTimer.current = setTimeout(() => {
        el.classList.remove('lattice-cursor-flash', 'lattice-cursor-flash--fade');
        if (flashElRef.current === el) flashElRef.current = null;
      }, FLASH_FADE_MS);
    }, holdMs);
  }, [clearCursorFlash]);
  // applyCursorFlashAt END ****************************************************

  //****************************************************************************
  // handleCursorLineChange
  //****************************************************************************
  /** Editor → App callback: cursor moved to a new 1-based source line. */
  const handleCursorLineChange = useCallback((line: number) => {
    flashLineRef.current = line;
    if (!isDual(viewMode)) return; // single edit/preview: no flash (DVW-00003)
    flashUntilRef.current = Date.now() + FLASH_HOLD_MS;
    applyCursorFlashAt(line, FLASH_HOLD_MS);
  }, [viewMode, applyCursorFlashAt]);
  // handleCursorLineChange END ************************************************


  //****************************************************************************
  // Preview copy — carry diagrams across the clipboard (IMPL-LTTCE-MRC-00002)
  //****************************************************************************
  // A rendered Mermaid diagram is an inline <svg>. The WebView does put that
  // markup on the clipboard, but the applications people paste into drop it,
  // so the diagram arrives as a blank. Here the selection is cloned, each
  // diagram swapped for the PNG cached on it at render time, and the result
  // written to the text/html flavour.
  //
  // Selections WITHOUT a diagram are not touched at all — no preventDefault,
  // no rewrite, the WebView's own copy path exactly as before. That is what
  // keeps REQ-LTTCE-CPY-00001 (highlights survive a copy into legacy HTML
  // readers, with no clipboard interception) true for every other selection.
  useEffect(() => {
    const preview = previewPaneRef.current;
    if (!preview) return;

    const onCopy = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      if (!preview.contains(range.commonAncestorContainer)) return;

      const html = buildCopyHtml(range.cloneContents());
      if (html === null) return; // no diagram in there — leave the copy alone

      // Taking over the event means owning BOTH flavours: a plain-text paste
      // must still get the text it would have got.
      event.clipboardData?.setData('text/html', html);
      event.clipboardData?.setData('text/plain', selection.toString());
      event.preventDefault();
    };

    preview.addEventListener('copy', onCopy);
    return () => preview.removeEventListener('copy', onCopy);
  }, []);
  // Preview copy END **********************************************************


  // Re-apply after a preview re-render: typing replaces the preview DOM
  // (ReactMarkdown), which silently drops the flash class. If the hold
  // period is still running, re-apply with the *remaining* hold time so the
  // total lifetime stays ~FLASH_HOLD_MS (REQ-LTTCE-DVW-00003). Also clears
  // the flash when leaving dual view. Cleanup clears on unmount.
  useEffect(() => {
    if (!isDual(viewMode)) {
      clearCursorFlash();
      return;
    }
    const remaining = flashUntilRef.current - Date.now();
    if (remaining > 0) {
      applyCursorFlashAt(flashLineRef.current, remaining);
    }
    return clearCursorFlash;
  }, [previewContent, viewMode, applyCursorFlashAt, clearCursorFlash]);
  // Dual-View Cursor Flash END ************************************************

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
    // IMPL-LTTCE-LNK-00001 — preview link router
    a(props) {
      const { href, children } = props;

      // ── Plain HTTP → render as blocked span, no click handler ────────────
      // IMPL-LTTCE-LNK-00003
      if (href?.startsWith('http://')) {
        return (
          <span
            title="Insecure HTTP link — intentionally blocked. Use HTTPS instead."
            style={{ cursor: 'not-allowed', textDecoration: 'line-through', opacity: 0.5 }}
          >
            {children}
          </span>
        );
      }

      const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!href) return;

        // ── HTTPS / mailto → system browser ────────────────────────────────
        if (href.startsWith('https://') || href.startsWith('mailto:')) {
          e.preventDefault();
          openUrl(href).catch(err => console.error('Failed to open URL externally:', err));
          return;
        }

        // ── In-page anchor → scroll within preview pane ────────────────────
        if (href.startsWith('#')) {
          e.preventDefault();
          const id = decodeURIComponent(href.slice(1));
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
          return;
        }

        // ── Schemeless web URL → assume https and open externally ───────────
        // IMPL-LTTCE-LNK-00004
        // Catches bare www. links written without a protocol, e.g.
        // [text](www.example.com). The markdown renderer passes the raw href
        // through; without this guard the link falls through to the local-file
        // handler and silently does nothing.
        if (href.startsWith('www.')) {
          e.preventDefault();
          openUrl(`https://${href}`).catch(err => console.error('Failed to open URL externally:', err));
          return;
        }

        // ── All local file links → prevent WebView navigation ───────────────
        e.preventDefault();

        // Only open recognised document types in a new Lattice window
        const [filePart] = href.split('#');
        if (!filePart || !isDocumentLink(filePart) || !m_currentFilePath) return;

        const resolvedPath = resolveRelativePath(href, m_currentFilePath);
        if (!resolvedPath) return;

        invoke('open_new_window', { path: resolvedPath })
          .catch(err => console.error('Failed to open local file in new window:', err));
      };

      return (
        <a href={href} onClick={handleClick} style={{ cursor: 'pointer' }}>
          {children}
        </a>
      );
    },
    code(props) {
      const { children, className, node, ...rest } = props;
      const match = /language-([\w+#-]+)/.exec(className || '');
      if (match && match[1] === 'mermaid') {
        return <Mermaid chart={String(children).replace(/\n$/, '')} theme={m_theme} mermaidInit={m_defaultMermaidInit} copyLight={m_copyDiagramsLight} />;
      }
      // IMPL-LTTCE-PRV-00002 — fenced blocks with a language tag are
      // syntax-highlighted with the same Lezer parsers as the edit pane.
      // Inline code and untagged fences keep the plain rendering below.
      if (match) {
        return (
          <HighlightedCode
            code={String(children).replace(/\n$/, '')}
            languageTag={match[1]}
            className={className}
          />
        );
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
        // Privacy/security gate: when blockExternalImages is enabled (default),
        // we do NOT render the <img> — that would trigger an immediate browser
        // fetch and leak the user's IP/User-Agent to the external host. Instead
        // we render a visible link the user can choose to open in a browser.
        if (m_blockExternalImages) {
          return (
            <span style={{
              display: 'inline-block',
              padding: '2px 6px',
              border: '1px dashed #999',
              borderRadius: '4px',
              fontSize: '0.85em',
              color: m_previewTheme === 'dark' ? '#c9d1d9' : '#57606a',
            }}>
              🚫 External image blocked — <a href={src} target="_blank" rel="noopener noreferrer">{alt || src}</a>
            </span>
          );
        }
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
  }), [m_theme, m_currentFilePath, m_blockExternalImages, m_previewTheme, m_defaultMermaidInit, m_copyDiagramsLight]);

  const previewMarkdown = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={[remarkStripHtmlComments, remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeAddSourceLines,
        rehypeWrapMathBlocks, // after AddSourceLines, before Katex — see plugin doc
        rehypeSafeHtml,       // before Katex — whitelisted raw tags → hast elements
        rehypeAddHeadingIds,
        rehypeKatex,
        // The highlight colour is passed as data, not taken from CSS, so it is
        // written as an inline style and therefore survives a copy into MS Word
        // (REQ-LTTCE-CPY-00001).
        ...(m_highlightMark
          ? [[rehypeHighlightMark, { color: MARK_COLORS[m_previewTheme] }] as
            [typeof rehypeHighlightMark, { color: string }]]
          : []),
      ]}
      components={previewComponents}
    >
      {previewContent}
    </ReactMarkdown>
  ), [previewContent, previewComponents, m_highlightMark, m_previewTheme]);

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
      highlightMark={m_highlightMark}
      onHighlightMarkChange={setHighlightMark}
      showWhitespace={m_showWhitespace}
      onShowWhitespaceChange={setShowWhitespace}
      tabSize={m_tabSize}
      onTabSizeChange={setTabSize}
      blockExternalImages={m_blockExternalImages}
      onBlockExternalImagesChange={setBlockExternalImages}
      defaultMermaidInit={m_defaultMermaidInit}
      onDefaultMermaidInitChange={setDefaultMermaidInit}
      copyDiagramsLight={m_copyDiagramsLight}
      onCopyDiagramsLightChange={setCopyDiagramsLight}
      settingsPath={m_vaultSettingsPath || ""}
    />;

  } // if (isSettingsWindow) END ***********************************************

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
            highlightMark={m_highlightMark}
            onHighlightMarkChange={setHighlightMark}
            showWhitespace={m_showWhitespace}
            onShowWhitespaceChange={setShowWhitespace}
            tabSize={m_tabSize}
            onTabSizeChange={setTabSize}
            blockExternalImages={m_blockExternalImages}
            onBlockExternalImagesChange={setBlockExternalImages}
            defaultMermaidInit={m_defaultMermaidInit}
            onDefaultMermaidInitChange={setDefaultMermaidInit}
            copyDiagramsLight={m_copyDiagramsLight}
            onCopyDiagramsLightChange={setCopyDiagramsLight}
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
          {m_currentFilePath
            ? shortenHomePath(m_currentFilePath, m_homeDir)
            : "No file is associated with this editor"}
        </div>
        <div className="toolbar" style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          zIndex: 100,
          display: 'flex',
          gap: '0.5rem'
        }}>
          {/* Font size controls */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: '2px' }}>
            <button
              onClick={handleFontSizeDecrease}
              disabled={m_fontSize <= FONT_SIZE_MIN}
              title="Decrease font size"
              style={{ ...toolbarBtnStyle, padding: '0 10px' }}
            >−</button>
            <span style={{
              ...toolbarBtnStyle,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '3.5em',
              cursor: 'default',
              userSelect: 'none',
            }}>{m_fontSize}%</span>
            <button
              onClick={handleFontSizeIncrease}
              disabled={m_fontSize >= FONT_SIZE_MAX}
              title="Increase font size"
              style={{ ...toolbarBtnStyle, padding: '0 10px' }}
            >+</button>
          </div>

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
              {
                label: "Insert TOC",
                onClick: () => { pauseScrollSync(); void editorRef.current?.insertTocBlock(); }
              },
              {
                label: "Refresh TOC (Ctrl+Shift+T)",
                onClick: () => { pauseScrollSync(); void editorRef.current?.updateToc(); },
                title: "Regenerate every <!-- TOC --> block in the document. Shortcut: Ctrl/Cmd+Shift+T"
              },
              {
                label: "Pad Tables (Ctrl+Shift+L)",
                onClick: () => { pauseScrollSync(); void editorRef.current?.padTables(); },
                title: "Space-pad every GFM pipe table so columns line up vertically. Shortcut: Ctrl/Cmd+Shift+L"
              },
              {
                label: "Tabify Indentation (Ctrl+Alt+T)",
                onClick: () => { pauseScrollSync(); void editorRef.current?.tabifyIndentation(); },
                title: "Convert line-start spaces to tabs on the selected lines (whole document if nothing is selected). Only leading whitespace is touched. Shortcut: Ctrl/Cmd+Alt+T"
              },
              {
                label: "Untabify Indentation (Ctrl+Alt+Shift+T)",
                onClick: () => { pauseScrollSync(); void editorRef.current?.untabifyIndentation(); },
                title: "Convert line-start tabs to spaces on the selected lines (whole document if nothing is selected). Only leading whitespace is touched. Shortcut: Ctrl/Cmd+Alt+Shift+T"
              },
              { label: "---" },
              { label: "Exit", onClick: () => invoke('exit_app') }
            ]}
          />
        </div>

        <div ref={mainContentRef} className="main-content" data-view-mode={viewMode} style={{
          display: 'flex', flex: 1, overflow: 'hidden', position: 'relative',
          flexDirection: viewMode === VIEW_DUAL_SWAP ? 'row-reverse'
            : viewMode === VIEW_DUAL_TOP ? 'column'
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
              fontSize={m_fontSize}
              highlightMark={m_highlightMark}
              showWhitespace={m_showWhitespace}
              tabSize={m_tabSize}
              initialDoc={m_loadedContent}
              docEpoch={m_docEpoch}
              currentFilePath={m_currentFilePath}
              onDirtyChange={setIsDirty}
              onChange={handleEditorChange}
              onCursorLineChange={handleCursorLineChange}
            />
          </div>
          {isDual(viewMode) && (
            <div
              className="pane-divider"
              data-testid="pane-divider"
              onMouseDown={handleDividerMouseDown}
              style={isVertical(viewMode)
                ? { width: '100%', height: '5px', cursor: 'row-resize' }
                : { width: '5px', height: '100%', cursor: 'col-resize' }
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
              style={{
                backgroundColor: PREVIEW_THEME_COLORS[m_previewTheme].backgroundColor,
                color: PREVIEW_THEME_COLORS[m_previewTheme].color,
                fontSize: `${m_fontSize}%`
              }}>
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
