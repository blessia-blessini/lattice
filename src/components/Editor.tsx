import React, { useEffect, useRef, useImperativeHandle } from 'react';
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap } from '@codemirror/view';
import { EditorState, Compartment, StateEffect } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubLight, githubDark } from '@uiw/codemirror-themes-all';
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, defaultHighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { undoDepth, history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { FileSystem } from '../services/FileSystem';
import { symbolPicker } from '../editor-extensions/symbol-picker';

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
    /**
     * Toggle a GFM task-list marker on the given 1-based source line.
     * Matches lines of the form `  - [ ] text`, `* [x] text`, `1. [X] text`, etc.
     * Returns true if a marker was found and flipped, false otherwise.
     * Going through CodeMirror (rather than rewriting the string in React
     * state) preserves undo/redo history, dirty tracking and autosave.
     */
    toggleTaskAtLine: (line: number) => boolean;
}
export const Editor = React.forwardRef<EditorHandle, EditorProps>(({
    theme, wordWrap, onChange, initialDoc, currentFilePath, onDirtyChange
}, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartment = useRef(new Compartment());
    const wrappingCompartment = useRef(new Compartment());
    const isRemoteUpdate = useRef(false);
    const currentFilePathRef = useRef(currentFilePath);

    // History Depth State
    const lastSavedDepth = useRef<number>(0);

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
        }
    }));
    useEffect(() => {
        currentFilePathRef.current = currentFilePath;
    }, [currentFilePath]);

    useEffect(() => {
        if (!editorRef.current) return;

        const startState = EditorState.create({
            doc: initialDoc,
            extensions: [
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
                history(),
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
                    ...lintKeymap
                ]),
                symbolPicker, // <-- Add our custom extension here
                syntaxHighlighting(monoHighlightStyle),
                markdown({
                    base: markdownLanguage,
                    codeLanguages: languages,
                    addKeymap: true
                }),
                themeCompartment.current.of(githubDark), // Initial theme
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
            ]
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
            // Only update if content is materially different to avoid loop
            if (currentDoc !== initialDoc) {
                isRemoteUpdate.current = true;
                viewRef.current.dispatch({
                    changes: { from: 0, to: currentDoc.length, insert: initialDoc }
                });
                isRemoteUpdate.current = false;

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
