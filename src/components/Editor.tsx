import React, { useEffect, useRef, useImperativeHandle } from 'react';
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap } from '@codemirror/view';
import { EditorState, Compartment, StateEffect } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubLight, githubDark } from '@uiw/codemirror-themes-all';
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, defaultHighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { undoDepth, history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { FileSystem } from '../services/FileSystem';
import { Toc, TOC_OPEN_MARKER, TOC_CLOSE_MARKER } from '../services/Toc';
import { TableFormat } from '../services/TableFormat';
import { symbolPicker } from '../editor-extensions/symbol-picker';
import { tocTooltip } from '../editor-extensions/toc-tooltip';

interface EditorProps {
    theme: 'light' | 'dark';
    wordWrap: boolean;
    onChange?: (doc: string) => void;
    initialDoc?: string;
    currentFilePath?: string | null;
    onDirtyChange?: (isDirty: boolean) => void;
}
const monoHighlightStyle = HighlightStyle.define([
    { tag: tags.monospace, fontFamily: "'Fira Code', 'Consolas', monospace", backgroundColor: "transparent" },
    { tag: tags.comment, backgroundColor: "#2d333b", color: "#8b949e", fontStyle: "italic" }
]);

//******************************************************************************
// Editor
//******************************************************************************
export interface EditorHandle {
    markAsSaved: () => void;
    getContent: () => string;
    getScrollDOM: () => HTMLElement | null;
    getTopVisibleLine: () => number | null;
    scrollToLine: (line: number) => void;
    undo: () => void;
    redo: () => void;
    /**
     * Toggle a GFM task-list marker on the given 1-based source line.
     * Matches lines of the form `  - [ ] text`, `* [x] text`, `1. [X] text`, etc.
     * Returns true if a marker was found and flipped, false otherwise.
     * Going through CodeMirror (rather than rewriting the string in React
     * state) preserves undo/redo history, dirty tracking and autosave.
     */
    toggleTaskAtLine: (line: number) => boolean;
    /**
     * Send the current document text to the backend for TOC regeneration. If
     * the backend returns different text (i.e. at least one TOC block was
     * present and its body changed) we dispatch a CodeMirror transaction to
     * replace the doc, preserving undo history. No-op when no TOC blocks are
     * present.
     */
    updateToc: () => Promise<boolean>;
    /**
     * Insert a fresh `<!-- TOC --> ... <!-- /TOC -->` block at the cursor and
     * immediately request the backend to populate it. Returns true if the
     * block was inserted (always true when an editor view exists).
     */
    insertTocBlock: () => Promise<boolean>;
    /**
     * Send the current document to the backend, which detects every GFM-style
     * pipe table and re-emits it with space-padded columns so all `|`
     * delimiters line up vertically. Returns true iff the backend produced a
     * different document and the editor was updated. No-op (returns false) on
     * documents with no tables, on already-padded tables, or when a concurrent
     * edit invalidated the snapshot mid-IPC.
     */
    padTables: () => Promise<boolean>;
}
export const Editor = React.forwardRef<EditorHandle, EditorProps>(({
    theme, wordWrap, onChange, initialDoc, currentFilePath, onDirtyChange
}, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartment = useRef(new Compartment());
    const wrappingCompartment = useRef(new Compartment());
    const historyCompartment = useRef(new Compartment());
    const isRemoteUpdate = useRef(false);
    const currentFilePathRef = useRef(currentFilePath);

    useEffect(() => {
        currentFilePathRef.current = currentFilePath;
    }, [currentFilePath]);

    // History Depth State
    const lastSavedDepth = useRef<number>(0);

    //**************************************************************************
    // refreshTocFromBackend
    //**************************************************************************
    /**
     * Shared TOC-refresh helper used by the imperative API, the menu, and the
     * keymap. Snapshots the current doc, awaits the Rust backend, and only
     * applies the result if the doc hasn't moved under us in the meantime.
     */
    const refreshTocFromBackend = async (): Promise<boolean> => {
        const view = viewRef.current;
        if (!view) return false;

        const before = view.state.doc.toString();
        let after: string;
        try {
            after = await Toc.update(before);
        } catch (e) {
            console.error('TOC update failed:', e);
            return false;
        }

        // Re-check the view after the await: a remote update or user edit
        // could have invalidated our snapshot.
        const liveView = viewRef.current;
        if (!liveView) return false;
        if (liveView.state.doc.toString() !== before) {
            // Concurrent change — drop the stale result rather than clobber.
            return false;
        }
        if (after === before) {
            // No TOC blocks present, or already in sync.
            return false;
        }

        liveView.dispatch({
            changes: { from: 0, to: liveView.state.doc.length, insert: after },
        });
        return true;
    };
    // refreshTocFromBackend END ************************************************

    //**************************************************************************
    // padTablesFromBackend
    //**************************************************************************
    /**
     * Same shape as `refreshTocFromBackend` (snapshot → IPC → guarded
     * dispatch). Kept as a separate function rather than parameterising one
     * helper because each operation has its own logging context and may
     * grow distinct concurrency rules later (e.g. tables might want to run
     * over a selection range, while TOC always works on the whole doc).
     */
    const padTablesFromBackend = async (): Promise<boolean> => {
        const view = viewRef.current;
        if (!view) return false;

        const before = view.state.doc.toString();
        let after: string;
        try {
            after = await TableFormat.pad(before);
        } catch (e) {
            console.error('Table padding failed:', e);
            return false;
        }

        const liveView = viewRef.current;
        if (!liveView) return false;
        if (liveView.state.doc.toString() !== before) {
            // The user typed (or a remote update arrived) while we were
            // waiting on Rust — discarding our stale "after" string is the
            // safe move. They can press the shortcut again.
            return false;
        }
        if (after === before) {
            // No tables found, or every table was already in canonical
            // padded form. Either way, no dispatch needed.
            return false;
        }

        liveView.dispatch({
            changes: { from: 0, to: liveView.state.doc.length, insert: after },
        });
        return true;
    };
    // padTablesFromBackend END *************************************************

    useImperativeHandle(ref, () => ({
        markAsSaved: () => {
            if (viewRef.current) {
                lastSavedDepth.current = undoDepth(viewRef.current.state);
                onDirtyChange?.(false);
            }
        },
        getContent: () => {
            return viewRef.current ? viewRef.current.state.doc.toString() : "";
        },
        getScrollDOM: () => {
            return viewRef.current ? viewRef.current.scrollDOM : null;
        },
        getTopVisibleLine: () => {
            const view = viewRef.current;
            if (!view) return null;
            const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
            return view.state.doc.lineAt(block.from).number;
        },
        scrollToLine: (line: number) => {
            const view = viewRef.current;
            if (!view) return;
            const total = view.state.doc.lines;
            const safe = Math.max(1, Math.min(total, Math.round(line)));
            const pos = view.state.doc.line(safe).from;
            const block = view.lineBlockAt(pos);
            view.scrollDOM.scrollTop = block.top;
        },
        undo: () => {
            if (viewRef.current) undo(viewRef.current);
        },
        redo: () => {
            if (viewRef.current) redo(viewRef.current);
        },
        toggleTaskAtLine: (line: number) => {
            const view = viewRef.current;
            if (!view) return false;
            const total = view.state.doc.lines;
            if (!Number.isFinite(line) || line < 1 || line > total) return false;
            const docLine = view.state.doc.line(line);
            // Optional indent, list marker (-, *, +, or `N.`), whitespace,
            // then the 3-char task marker "[ ]" / "[x]" / "[X]".
            const re = /^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/;
            const m = docLine.text.match(re);
            if (!m) return false;
            const prefix = m[1];
            const wasChecked = m[2] !== ' ';
            const insert = wasChecked ? '[ ]' : '[x]';
            const from = docLine.from + prefix.length;
            const to = from + 3; // "[ ]" / "[x]" are always 3 chars
            view.dispatch({ changes: { from, to, insert } });
            return true;
        },
        updateToc: refreshTocFromBackend,
        insertTocBlock: async () => {
            const view = viewRef.current;
            if (!view) return false;

            // Insert the marker pair at the cursor (or replace the selection).
            // The Rust backend recognises this exact shape and will populate
            // the empty body on the follow-up refresh.
            const template = `${TOC_OPEN_MARKER}\n${TOC_CLOSE_MARKER}\n`;
            view.dispatch(view.state.replaceSelection(template));

            await refreshTocFromBackend();
            return true;
        },
        padTables: padTablesFromBackend
    }));

    const getExtensions = () => [
        // Disable OS and browser spellcheck/autocorrect/autocomplete
        EditorView.contentAttributes.of({
            spellcheck: "true",
            autocorrect: "off",
            autocapitalize: "off",
            autocomplete: "off",
            "data-gramm": "false",
            role: "textbox",
            "aria-multiline": "true"
        }),

        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        historyCompartment.current.of(history()),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
            // Refresh all TOC blocks in the document. Mod = Cmd on macOS,
            // Ctrl elsewhere. The handler returns true synchronously and
            // performs the IPC + dispatch in the background (the helper
            // already guards against concurrent edits).
            {
                key: 'Mod-Shift-t',
                preventDefault: true,
                run: () => {
                    void refreshTocFromBackend();
                    return true;
                },
            },
            // Pad / format every GFM-style pipe table in the document so
            // pipes line up vertically. Same fire-and-forget pattern as the
            // TOC refresh above — synchronous return so CodeMirror knows the
            // key was handled, with the actual rewrite landing later via the
            // helper's guarded dispatch.
            //
            // Why Mod-Shift-l: parallels Mod-Shift-t (TOC) so the two doc-
            // wide refresh ops live in the same keyspace, and the L mnemonic
            // ("Layout / aLign") is unbound by default in CodeMirror's
            // standard keymaps on every platform we ship to.
            {
                key: 'Mod-Shift-l',
                preventDefault: true,
                run: () => {
                    void padTablesFromBackend();
                    return true;
                },
            },
        ]),
        symbolPicker, // <-- Add our custom extension here
        tocTooltip,   // <-- Hint when cursor is between TOC markers
        syntaxHighlighting(monoHighlightStyle),
        markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            addKeymap: true
        }),
        themeCompartment.current.of(theme === 'dark' ? githubDark : githubLight),
        wrappingCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
            if (update.docChanged && onChange && !isRemoteUpdate.current) {
                onChange(update.state.doc.toString());
            }

            // Check internal history depth for dirty state
            if (onDirtyChange) {
                const currentDepth = undoDepth(update.state);
                const isDirty = currentDepth !== lastSavedDepth.current;
                onDirtyChange(isDirty);
            }
        }),
        EditorView.domEventHandlers({
            paste: (event, view) => {
                //**********************************************************************
                // paste sction coming from user
                //**********************************************************************
                const items = event.clipboardData?.items;
                if (items) {
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf('image') !== -1) {
                            const blob = items[i].getAsFile();
                            if (blob && currentFilePathRef.current) {
                                const reader = new FileReader();
                                reader.onload = async (e) => {
                                    const base64Data = e.target?.result as string;
                                    // Split to remove "data:image/png;base64," prefix
                                    const pureBase64 = base64Data.split(',')[1];
                                    if (pureBase64) {
                                        try {
                                            const relativePath = await FileSystem.saveImage(currentFilePathRef.current!, pureBase64);
                                            const markdownImage = `![Image](${relativePath})`;

                                            view.dispatch(view.state.replaceSelection(markdownImage));
                                        } catch (err) {
                                            console.error("Failed to save image", err);
                                            alert("Failed to save paste image: " + err);
                                        }
                                    }
                                };
                                reader.readAsDataURL(blob);
                                event.preventDefault();
                            } else if (!currentFilePathRef.current) {
                                alert("The current editor has no associated file. Images are saved relative to the file, " +
                                    "so before the editor is associated to a file and path we do not know where to save the image(s) to.");
                            }
                        }
                    }
                }// paste END **********************************************************
            }
        })
    ];

    useEffect(() => {
        if (!editorRef.current) return;

        const startState = EditorState.create({
            doc: initialDoc,
            extensions: getExtensions()
        });

        const view = new EditorView({
            state: startState,
            parent: editorRef.current
        });

        viewRef.current = view;

        // Initialize depth
        lastSavedDepth.current = undoDepth(view.state);

        return () => {
            view.destroy();
        };
    }, []);

    useEffect(() => {
        if (viewRef.current && initialDoc !== undefined) {
            const currentDoc = viewRef.current.state.doc.toString();
            // Only update if content is materially different
            if (currentDoc !== initialDoc) {
                // Use setState to completely reset the editor state for the new document.
                // This clears the undo/redo history and sets the new content as the baseline.
                const newState = EditorState.create({
                    doc: initialDoc,
                    extensions: getExtensions()
                });
                viewRef.current.setState(newState);

                // When loading a new doc from outside, we assume it's "saved" state
                lastSavedDepth.current = undoDepth(viewRef.current.state);
                onDirtyChange?.(false);
            }
        }
    }, [initialDoc]);

    // Update theme when prop changes
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.dispatch({
                effects: themeCompartment.current.reconfigure(
                    theme === 'dark' ? githubDark : githubLight
                )
            });
        }
    }, [theme]);

    // Update word wrap when prop changes
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.dispatch({
                effects: wrappingCompartment.current.reconfigure(
                    wordWrap ? EditorView.lineWrapping : []
                )
            });
        }
    }, [wordWrap]);

    return <div ref={editorRef} className="editor-container" />;
});
// Editor END ******************************************************************
