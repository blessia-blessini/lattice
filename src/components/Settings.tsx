import React, { useState } from 'react';
import { FileSystem } from '../services/FileSystem';
import { invoke } from '@tauri-apps/api/core';

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
    /** Optional override for the close button; falls back to `close_settings_window` Tauri command. */
    onClose?: () => void;
    /** Absolute path of the settings file; shown at the bottom of the panel. */
    settingsPath: string;
}

//******************************************************************************
// Settings
//******************************************************************************
export const Settings: React.FC<SettingsProps> = ({ defaultTheme, onDefaultThemeChange, wordWrap, onWordWrapChange, saveOnBlur, dailyNotesPath, onDailyNotesPathChange, highlightMark, onHighlightMarkChange, blockExternalImages, onBlockExternalImagesChange, defaultMermaidInit, onDefaultMermaidInitChange, onClose, settingsPath }) => {
    const [status, setStatus] = useState<string>('');

    const saveSettings = async (newTheme: 'light' | 'dark',
        newWordWrap: boolean,
        newDailyNotesPath: string,
        newHighlightMark: boolean,
        newBlockExternalImages: boolean,
        newDefaultMermaidInit: string) => {
        try {
            const settingsObject = {
                defaultOpenTheme: newTheme,
                wordWrap: newWordWrap,
                saveOnBlur: saveOnBlur,
                dailyNotesPath: newDailyNotesPath,
                highlightMark: newHighlightMark,
                blockExternalImages: newBlockExternalImages,
                defaultMermaidInit: newDefaultMermaidInit,
            };
            await invoke('save_settings', { settingsPath, settings: settingsObject });
            setStatus('Saved!');
            setTimeout(() => setStatus(''), 2000);
        } catch (error) {
            console.error("Failed to save settings:", error);
            setStatus('Error saving settings');
        }
    };

    const handleThemeChange = (newTheme: 'light' | 'dark') => {
        onDefaultThemeChange(newTheme);
        saveSettings(newTheme, wordWrap, dailyNotesPath, highlightMark, blockExternalImages, defaultMermaidInit);
    };

    const handleWordWrapChange = () => {
        const newWrap = !wordWrap;
        onWordWrapChange(newWrap);
        saveSettings(defaultTheme, newWrap, dailyNotesPath, highlightMark, blockExternalImages, defaultMermaidInit);
    };

    const handleDailyNotesPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newPath = e.target.value;
        onDailyNotesPathChange(newPath);
        saveSettings(defaultTheme, wordWrap, newPath, highlightMark, blockExternalImages, defaultMermaidInit);
    };

    const handleHighlightMarkChange = () => {
        const newValue = !highlightMark;
        onHighlightMarkChange(newValue);
        saveSettings(defaultTheme, wordWrap, dailyNotesPath, newValue, blockExternalImages, defaultMermaidInit);
    };

    const handleBlockExternalImagesChange = () => {
        const newValue = !blockExternalImages;
        onBlockExternalImagesChange(newValue);
        saveSettings(defaultTheme, wordWrap, dailyNotesPath, highlightMark, newValue, defaultMermaidInit);
    };

    const handleDefaultMermaidInitChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        onDefaultMermaidInitChange(newValue);
        saveSettings(defaultTheme, wordWrap, dailyNotesPath, highlightMark, blockExternalImages, newValue);
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
                        <div
                            onClick={() => handleThemeChange(defaultTheme === 'light' ? 'dark' : 'light')}
                            style={{
                                width: '50px',
                                height: '24px',
                                backgroundColor: defaultTheme === 'dark' ? '#2ea44f' : '#ccc',
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
                                left: defaultTheme === 'dark' ? '28px' : '2px',
                                transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                            }} />
                        </div>
                        <span style={{ fontWeight: defaultTheme === 'dark' ? 'bold' : 'normal' }}>Dark</span>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span>Word Wrap:</span>
                    <div
                        onClick={handleWordWrapChange}
                        style={{
                            width: '50px',
                            height: '24px',
                            backgroundColor: wordWrap ? '#2ea44f' : '#ccc',
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
                            left: wordWrap ? '28px' : '2px',
                            transition: 'left 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                        }} />
                    </div>
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
                    <div
                        onClick={handleHighlightMarkChange}
                        style={{
                            width: '50px',
                            height: '24px',
                            backgroundColor: highlightMark ? '#2ea44f' : '#ccc',
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
                            left: highlightMark ? '28px' : '2px',
                            transition: 'left 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                        }} />
                    </div>
                    <span>{highlightMark ? 'On' : 'Off'}</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem' }}>
                    <span title="When ON, the preview will not fetch http(s):// images. Protects privacy by avoiding requests to third-party servers.">
                        Block External Images (privacy):
                    </span>
                    <div
                        onClick={handleBlockExternalImagesChange}
                        style={{
                            width: '50px',
                            height: '24px',
                            backgroundColor: blockExternalImages ? '#2ea44f' : '#ccc',
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
                            left: blockExternalImages ? '28px' : '2px',
                            transition: 'left 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                        }} />
                    </div>
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
