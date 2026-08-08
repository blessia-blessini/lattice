import React, { useState } from 'react';
import { FileSystem } from '../services/FileSystem';
import { invoke } from '@tauri-apps/api/core';
import { clampTabSize, TAB_SIZE_MIN, TAB_SIZE_MAX } from '../lib/tab-size';

/** Props for the {@link Settings} panel component. */
export interface SettingsProps {
    /** Current default theme shown in the toggle on mount. */
    defaultTheme: 'light' | 'dark';
    /** Called when the user flips the theme toggle. */
    onDefaultThemeChange: (theme: 'light' | 'dark') => void;
    /** Current word-wrap state shown in the toggle on mount. */
    wordWrap: boolean;
    /** Called when the user flips the word-wrap toggle. */
    onWordWrapChange: (wrap: boolean) => void;
    /** Whether the editor auto-saves when it loses focus (display-only in this panel). */
    saveOnBlur: boolean;
    /** Directory used when creating or opening daily notes. */
    dailyNotesPath: string;
    /** Called on every keystroke in the daily-notes path field. */
    onDailyNotesPathChange: (path: string) => void;
    /** Current `==highlight mark==` rendering state shown in the toggle. */
    highlightMark: boolean;
    /** Called when the user flips the highlight-mark toggle. */
    onHighlightMarkChange: (enabled: boolean) => void;
    /** Current "Show Whitespace" state (spaces/tabs visualized in the edit pane). Default OFF. */
    showWhitespace: boolean;
    /** Called when the user flips the show-whitespace toggle. IMPL-LTTCE-WSP-00003. */
    onShowWhitespaceChange: (enabled: boolean) => void;
    /** Tab display width in columns (2–8, default 2). Indent width always equals this. */
    tabSize: number;
    /** Called with the clamped new tab size. IMPL-LTTCE-WSP-00007. */
    onTabSizeChange: (size: number) => void;
    /** When true, the preview pane refuses to fetch `http://` / `https://` images and shows a blocked-link placeholder instead (privacy-by-default). */
    blockExternalImages: boolean;
    /** Called when the user flips the block-external-images toggle. */
    onBlockExternalImagesChange: (enabled: boolean) => void;
    /**
     * Raw JS-object-literal / JSON string used as the global mermaid init for diagrams
     * that contain no `%%{init:...}%%` block. Charts with an inline init override this.
     */
    defaultMermaidInit: string;
    /** Called when the user edits the Default-Mermaid-Init textarea. */
    onDefaultMermaidInitChange: (value: string) => void;
    /**
     * When true, a diagram copied out of the preview is put on the clipboard
     * as a light diagram on white, whatever theme the application is using —
     * the documents people paste into are overwhelmingly white
     * (REQ-LTTCE-MRC-00005). When false the copy matches what is on screen.
     */
    copyDiagramsLight: boolean;
    /** Called when the user flips the copy-diagrams-light toggle. */
    onCopyDiagramsLightChange: (enabled: boolean) => void;
    /** Optional override for the close button; falls back to `close_settings_window` Tauri command. */
    onClose?: () => void;
    /** Absolute path of the settings file; shown at the bottom of the panel. */
    settingsPath: string;
}

//******************************************************************************
// Toggle
//******************************************************************************
/** Props for the shared {@link Toggle} switch. */
interface ToggleProps {
    /** Whether the switch is in its "on" (green, knob right) position. */
    on: boolean;
    /** Called when the user clicks anywhere on the switch. */
    onClick: () => void;
}
/**
 * Shared on/off switch used by every boolean setting in this panel (DRY —
 * previously this exact markup was copy-pasted per setting). Renders the
 * same DOM shape as the historical inline version: an outer clickable pill
 * `<div>` containing the knob `<div>`, so sibling-based DOM queries (e.g.
 * in Settings.test.tsx helpers) are unaffected.
 */
const Toggle: React.FC<ToggleProps> = ({ on, onClick }) => (
    <div
        onClick={onClick}
        style={{
            width: '50px',
            height: '24px',
            backgroundColor: on ? '#2ea44f' : '#ccc',
            borderRadius: '12px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'background-color 0.2s'
        }}
    >
        <div style={{
            width: '20px',
            height: '20px',
            backgroundColor: '#fff',
            borderRadius: '50%',
            position: 'absolute',
            top: '2px',
            left: on ? '28px' : '2px',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }} />
    </div>
);
// Toggle END ******************************************************************


//******************************************************************************
// Settings
//******************************************************************************
/**
 * The persisted settings object, exactly as the `save_settings` command
 * expects it — the camelCase mirror of the Rust `Settings` struct.
 *
 * Named here so the payload has one definition instead of being spelled out
 * inside a save call; adding a setting is then a change in two places (this
 * type and the Rust struct) rather than in every handler.
 */
interface SettingsPayload {
    defaultOpenTheme: 'light' | 'dark';
    wordWrap: boolean;
    saveOnBlur: boolean;
    dailyNotesPath: string;
    highlightMark: boolean;
    showWhitespace: boolean;
    tabSize: number;
    blockExternalImages: boolean;
    defaultMermaidInit: string;
    copyDiagramsLight: boolean;
}

export const Settings: React.FC<SettingsProps> = ({ defaultTheme, onDefaultThemeChange, wordWrap, onWordWrapChange, saveOnBlur, dailyNotesPath, onDailyNotesPathChange, highlightMark, onHighlightMarkChange, showWhitespace, onShowWhitespaceChange, tabSize, onTabSizeChange, blockExternalImages, onBlockExternalImagesChange, defaultMermaidInit, onDefaultMermaidInitChange, copyDiagramsLight, onCopyDiagramsLightChange, onClose, settingsPath }) => {
    const [status, setStatus] = useState<string>('');

    //**************************************************************************
    // persist
    //**************************************************************************
    /**
     * Write the whole settings object: what is currently on screen, with the
     * one field the user just changed applied on top.
     *
     * Every setting is always written, because `save_settings` merges a
     * complete object. Passing only the delta here — rather than repeating
     * the full argument list at each call site — is what keeps adding a
     * setting from touching every handler in this file.
     */
    const persist = async (overrides: Partial<SettingsPayload>) => {
        const settingsObject: SettingsPayload = {
            defaultOpenTheme: defaultTheme,
            wordWrap,
            saveOnBlur,
            dailyNotesPath,
            highlightMark,
            showWhitespace,
            tabSize,
            blockExternalImages,
            defaultMermaidInit,
            copyDiagramsLight,
            ...overrides,
        };
        try {
            await invoke('save_settings', { settingsPath, settings: settingsObject });
            setStatus('Saved!');
            setTimeout(() => setStatus(''), 2000);
        } catch (error) {
            console.error("Failed to save settings:", error);
            setStatus('Error saving settings');
        }
    };
    // persist END *************************************************************

    const handleThemeChange = (newTheme: 'light' | 'dark') => {
        onDefaultThemeChange(newTheme);
        persist({ defaultOpenTheme: newTheme });
    };

    const handleWordWrapChange = () => {
        const newWrap = !wordWrap;
        onWordWrapChange(newWrap);
        persist({ wordWrap: newWrap });
    };

    const handleDailyNotesPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newPath = e.target.value;
        onDailyNotesPathChange(newPath);
        persist({ dailyNotesPath: newPath });
    };

    const handleHighlightMarkChange = () => {
        const newValue = !highlightMark;
        onHighlightMarkChange(newValue);
        persist({ highlightMark: newValue });
    };

    // IMPL-LTTCE-WSP-00003 — "Show Whitespace" toggle: propagate + persist
    const handleShowWhitespaceChange = () => {
        const newValue = !showWhitespace;
        onShowWhitespaceChange(newValue);
        persist({ showWhitespace: newValue });
    };

    // IMPL-LTTCE-WSP-00007 — "Tab Size" numeric setting: clamp to the valid
    // range (shared contract in lib/tab-size.ts, mirroring the Rust-side
    // clamp on load), propagate + persist. Non-numeric intermediate input
    // states (e.g. an emptied field) are ignored rather than saved.
    const handleTabSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const parsed = parseInt(e.target.value, 10);
        if (Number.isNaN(parsed)) return;
        const newValue = clampTabSize(parsed);
        onTabSizeChange(newValue);
        persist({ tabSize: newValue });
    };

    const handleBlockExternalImagesChange = () => {
        const newValue = !blockExternalImages;
        onBlockExternalImagesChange(newValue);
        persist({ blockExternalImages: newValue });
    };

    const handleDefaultMermaidInitChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        onDefaultMermaidInitChange(newValue);
        persist({ defaultMermaidInit: newValue });
    };

    // IMPL-LTTCE-MRC-00003 — "Copy Diagrams On Light Background" toggle
    const handleCopyDiagramsLightChange = () => {
        const newValue = !copyDiagramsLight;
        onCopyDiagramsLightChange(newValue);
        persist({ copyDiagramsLight: newValue });
    };

    return (
        <div style={{
            padding: '2rem',
            height: '100vh',
            backgroundColor: defaultTheme === 'dark' ? '#0d1117' : '#ffffff',
            color: defaultTheme === 'dark' ? '#c9d1d9' : '#24292e',
            boxSizing: 'border-box'
        }}>
            <h1>Settings</h1>
            <div style={{ marginBottom: '2rem' }}>
                <h3>Appearance</h3>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span>Default Open Theme:</span>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span style={{ fontWeight: defaultTheme === 'light' ? 'bold' : 'normal' }}>Light</span>
                        <Toggle
                            on={defaultTheme === 'dark'}
                            onClick={() => handleThemeChange(defaultTheme === 'light' ? 'dark' : 'light')}
                        />
                        <span style={{ fontWeight: defaultTheme === 'dark' ? 'bold' : 'normal' }}>Dark</span>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span>Word Wrap:</span>
                    <Toggle on={wordWrap} onClick={handleWordWrapChange} />
                    <span>{wordWrap ? 'On' : 'Off'}</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span>Highlight Mark (<code style={{
                            backgroundColor: highlightMark ? '#ffe000' : undefined,
                            color: highlightMark ? '#1a1a1a' : undefined,
                            borderRadius: '2px',
                            padding: '0 2px',
                            transition: 'background-color 0.2s, color 0.2s',
                        }}>==text==</code>):</span>
                    <Toggle on={highlightMark} onClick={handleHighlightMarkChange} />
                    <span>{highlightMark ? 'On' : 'Off'}</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span title="When ON, spaces are shown as faint dots and tabs as faint arrows in the edit pane (like Word or VS Code). Purely visual — the text is never changed.">
                        Show Whitespace:
                    </span>
                    <Toggle on={showWhitespace} onClick={handleShowWhitespaceChange} />
                    <span>{showWhitespace ? 'Visible' : 'Hidden'}</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span title="Display width of a tab character in columns (2–8). The editor indents with real tabs, so the indent width is always exactly this value.">
                        Tab Size:
                    </span>
                    <input
                        type="number"
                        min={TAB_SIZE_MIN}
                        max={TAB_SIZE_MAX}
                        step={1}
                        value={tabSize}
                        onChange={handleTabSizeChange}
                        aria-label="Tab Size"
                        style={{
                            width: '4rem',
                            padding: '0.4rem',
                            borderRadius: '4px',
                            border: `1px solid ${defaultTheme === 'dark' ? '#30363d' : '#e1e4e8'}`,
                            backgroundColor: defaultTheme === 'dark' ? '#161b22' : '#f6f8fa',
                            color: defaultTheme === 'dark' ? '#c9d1d9' : '#24292e',
                        }}
                    />
                    <span style={{ opacity: 0.7 }}>columns ({TAB_SIZE_MIN}–{TAB_SIZE_MAX})</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span title="When ON, the preview will not fetch http(s):// images. Protects privacy by avoiding requests to third-party servers.">
                        Block External Images (privacy):
                    </span>
                    <Toggle on={blockExternalImages} onClick={handleBlockExternalImagesChange} />
                    <span>{blockExternalImages ? 'Blocked' : 'Allowed'}</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem', width: '100%' }}>
                    <span style={{ minWidth: '120px' }}>Daily Notes Path:</span>
                    <input
                        type="text"
                        value={dailyNotesPath}
                        onChange={handleDailyNotesPathChange}
                        style={{
                            flex: 1,
                            padding: '0.5rem',
                            borderRadius: '4px',
                            border: `1px solid ${defaultTheme === 'dark' ? '#30363d' : '#e1e4e8'}`,
                            backgroundColor: defaultTheme === 'dark' ? '#161b22' : '#f6f8fa',
                            color: defaultTheme === 'dark' ? '#c9d1d9' : '#24292e',
                        }}
                    />
                </div>

            </div>

            <div style={{ marginBottom: '2rem' }}>
                <h3>Mermaid</h3>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <span title="When ON, a diagram copied from the preview is put on the clipboard as a light diagram on a white background, whatever theme Lattice is using — most documents you paste into are white. When OFF, the copy matches what you see on screen.">
                        Copy Diagrams On Light Background:
                    </span>
                    <Toggle on={copyDiagramsLight} onClick={handleCopyDiagramsLightChange} />
                    <span>{copyDiagramsLight ? 'Always light' : 'Match theme'}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <span title="Applied as the global mermaid init for diagrams that have no %%{init:...}%% block. Charts with an inline init override this automatically.">
                        Default-Mermaid-Init:
                    </span>
                    <textarea
                        value={defaultMermaidInit}
                        onChange={handleDefaultMermaidInitChange}
                        rows={7}
                        spellCheck={false}
                        style={{
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            padding: '0.5rem',
                            borderRadius: '4px',
                            border: `1px solid ${defaultTheme === 'dark' ? '#30363d' : '#e1e4e8'}`,
                            backgroundColor: defaultTheme === 'dark' ? '#161b22' : '#f6f8fa',
                            color: defaultTheme === 'dark' ? '#c9d1d9' : '#24292e',
                            resize: 'vertical',
                        }}
                    />
                </div>
            </div>

            <div style={{ borderTop: `1px solid ${defaultTheme === 'dark' ? '#30363d' : '#e1e4e8'}`, paddingTop: '1rem', marginTop: 'auto' }}>
                <button
                    onClick={() => {
                        if (onClose) {
                            onClose();
                        } else {
                            invoke('close_settings_window');
                        }
                    }}
                    style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: defaultTheme === 'dark' ? '#2ea44f' : '#2ea44f',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        marginBottom: '1rem'
                    }}
                >
                    Close Settings
                </button>
                <p style={{ color: '#2ea44f', marginTop: '1rem', minHeight: '1.2em', visibility: status ? 'visible' : 'hidden' }}>{status || 'Placeholder'}</p>
                <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>Settings are saved to: {settingsPath}</p>
            </div>
        </div >
    );
};
// Settings END ****************************************************************
