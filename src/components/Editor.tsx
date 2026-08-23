import React, { useEffect, useRef, useState, useImperativeHandle } from 'react';
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap, MatchDecorator, ViewPlugin, DecorationSet, ViewUpdate, Decoration } from '@codemirror/view';
import { EditorState, Compartment, StateEffect } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubLight, githubDark } from '@uiw/codemirror-themes-all';
import { HighlightStyle, syntaxHighlighting, indentOnInput, indentUnit, bracketMatching, foldGutter, defaultHighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { undoDepth, history, historyKeymap, defaultKeymap, indentWithTab, undo, redo, selectAll as cmSelectAll } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { gfmLinter } from '../editor-extensions/gfm-linter';
import { FileSystem } from '../services/FileSystem';
import { Toc, TOC_OPEN_MARKER, TOC_CLOSE_MARKER } from '../services/Toc';
import { TableFormat } from '../services/TableFormat';
import { Tabify } from '../services/Tabify';
import { TsvTable, mayBeTabular, TabularPaste } from '../services/TsvTable';
import { PasteTableDialog, PasteTableChoice } from './PasteTableDialog';
import { symbolPicker } from '../editor-extensions/symbol-picker';
import { showWhitespaceExtension } from '../editor-extensions/show-whitespace';
import { tocTooltip } from '../editor-extensions/toc-tooltip';
import { cursorLineOf } from '../lib/cursor-block';
import { wrapAsBlock } from '../lib/block-insert';

/** Props for the {@link Editor} component. */
export interface EditorProps {
    /** UI colour scheme applied to the CodeMirror theme and gutter. */
    theme: 'light' | 'dark';
    /** When true, long lines soft-wrap instead of scrolling horizontally. */
    wordWrap: boolean;
    /** Font-size percentage applied to the editor content and gutters (e.g. `100` = 100%). */
    fontSize: number;
    /** When true, `==text==` patterns are rendered with a highlighted background. */
    highlightMark: boolean;
    /**
     * When true, whitespace characters are visualized in the edit pane:
     * spaces as faint centered dots, tabs as faint arrows (subtle, VS-Code
     * style — decoration only, never changes the text). IMPL-LTTCE-WSP-00002.
     */
    showWhitespace: boolean;
    /**
     * Tab display width in columns (valid 2–8, enforced by the settings
     * layer). The indent unit is one real tab character, so the indent
     * width always equals this value. IMPL-LTTCE-WSP-00006.
     */
    tabSize: number;
    /** Called on every document change with the full updated text. */
    onChange?: (doc: string) => void;
    /** Initial document text loaded into the editor on mount. */
    initialDoc?: string;
    /**
     * Monotonic load counter, incremented by the owner **only** when
     * `initialDoc` carries text that genuinely came from disk (open, reopen,
     * external-change reload). IMPL-LTTCE-FWT-00003.
     *
     * Resetting the editor destroys the undo history, so it must never be
     * driven by comparing `initialDoc` against the live document: any stale
     * prop — a re-render, a reload racing the user's keystrokes — would then
     * silently discard the session. Gating on the epoch makes the reset
     * something the owner asks for explicitly. Leave it undefined and the
     * document is never replaced after mount.
     */
    docEpoch?: number;
    /** Absolute path of the file currently open; used to resolve relative image paste targets. */
    currentFilePath?: string | null;
    /** Called whenever the dirty state (unsaved changes) transitions. */
    onDirtyChange?: (isDirty: boolean) => void;
    /**
     * Called when the primary cursor moves to a *different* 1-based source
     * line (deduplicated — consecutive updates on the same line fire once).
     * Used by the dual-view cursor flash (IMPL-LTTCE-DVW-00002).
     */
    onCursorLineChange?: (line: number) => void;
}

//******************************************************************************
// ==highlight== extension
// Uses MatchDecorator so only visible ranges are scanned — no full-doc pass.
//******************************************************************************
const _highlightMarkDeco = Decoration.mark({ class: 'cm-marker-highlight' });
const _highlightMarkDecorator = new MatchDecorator({
    regexp: /==([^=\n]+?)==/g,
    decoration: () => _highlightMarkDeco,
});
const highlightMarkExtension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = _highlightMarkDecorator.createDeco(view);
        }
        update(update: ViewUpdate) {
            this.decorations = _highlightMarkDecorator.updateDeco(update, this.decorations);
        }
    },
    { decorations: (v) => v.decorations }
);
// highlight extension END ********************************************

const monoHighlightStyle = HighlightStyle.define([
    { tag: tags.monospace, fontFamily: "'Fira Code', 'Consolas', monospace", backgroundColor: "transparent" },
    { tag: tags.comment, backgroundColor: "#2d333b", color: "#8b949e", fontStyle: "italic" }
]);

//******************************************************************************
// Editor
//******************************************************************************
/** Imperative API exposed by {@link Editor} via `React.forwardRef`. */
export interface EditorHandle {
    /** Resets the dirty-tracking baseline to the current document state. */
    markAsSaved: () => void;
    /** Returns the current document text. */
    getContent: () => string;
    /** Returns the CodeMirror scroll container element, or `null` when unmounted. */
    getScrollDOM: () => HTMLElement | null;
    /** Returns the 1-based line number of the topmost visible line, or `null` when unmounted. */
    getTopVisibleLine: () => number | null;
    /** Scrolls the editor so that `line` (1-based) is at the top of the viewport. */
    scrollToLine: (line: number) => void;
    /** Undoes the last edit, preserving CodeMirror history. */
    undo: () => void;
    /** Redoes the last undone edit. */
    redo: () => void;
    /**
     * Focus the edit pane and select the whole document (IMPL-LTTCE-SEL-00003).
     *
     * Exposed because Ctrl/Cmd+A can arrive while focus sits on the application
     * chrome, where CodeMirror's own keymap never sees it — see `lib/select-all.ts`
     * for why that matters. Focusing first is part of the contract: a selection
     * the user cannot immediately type over or extend is not Select All.
     *
     * @returns true when an editor view existed to act on.
     */
    selectAll: () => boolean;
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
    /**
     * Convert line-start whitespace to tabs (column-accurate for the current
     * tab size) on the selected lines, or the whole document when the
     * selection is empty. Returns true iff the document changed.
     * REQ-LTTCE-WSP-00006.
     */
    tabifyIndentation: () => Promise<boolean>;
    /** Opposite direction of {@link tabifyIndentation}: leading tabs → spaces. */
    untabifyIndentation: () => Promise<boolean>;
}
export const Editor = React.forwardRef<EditorHandle, EditorProps>(({
    theme, wordWrap, fontSize, highlightMark, showWhitespace, tabSize, onChange, initialDoc, docEpoch, currentFilePath, onDirtyChange,
    onCursorLineChange
}, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartment = useRef(new Compartment());
    const wrappingCompartment = useRef(new Compartment());
    const fontSizeCompartment = useRef(new Compartment());
    const historyCompartment = useRef(new Compartment());
    const highlightMarkCompartment = useRef(new Compartment());
    const showWhitespaceCompartment = useRef(new Compartment());
    const tabSizeCompartment = useRef(new Compartment());
    // Latest tabSize for closures captured once at extension-build time
    // (same stale-props guard as onCursorLineChangeRef below).
    const tabSizeRef = useRef(tabSize);
    useEffect(() => {
        tabSizeRef.current = tabSize;
    }, [tabSize]);
    const isRemoteUpdate = useRef(false);
    const currentFilePathRef = useRef(currentFilePath);

    // IMPL-LTTCE-FWT-00003 — the external-load effect keys on `docEpoch` alone,
    // so it reads the incoming text through a ref (updated on every render,
    // during render, so a load that arrives in the same commit as its epoch
    // bump is never missed).
    const initialDocRef = useRef(initialDoc);
    initialDocRef.current = initialDoc;
    // Epoch already applied to the document. `null` until the first run, which
    // belongs to mount — mount seeds the state from `initialDoc` directly.
    const appliedEpoch = useRef<number | undefined | null>(null);
    // Path the document currently in the editor was loaded from. Compared
    // against the incoming path to tell "the file I am editing was reloaded"
    // (keep my place) from "a different file was opened" (start at the top).
    const loadedPathRef = useRef(currentFilePath);

    useEffect(() => {
        currentFilePathRef.current = currentFilePath;
        // A path change with no load attached is a rename (Save As): the same
        // document under a new name, so the caret still belongs to it. When a
        // load *is* attached to this commit the epoch effect below owns the
        // decision — it runs after this one and needs the previous value.
        if (appliedEpoch.current === docEpoch) loadedPathRef.current = currentFilePath;
    }, [currentFilePath]);

    /**
     * Spreadsheet paste awaiting the user's decision, or `null` when no dialog
     * is open (IMPL-LTTCE-TBL-00003). `text` is the untouched clipboard payload
     * so "Insert as plain text" still delivers exactly what was copied.
     */
    const [pendingPaste, setPendingPaste] = useState<(TabularPaste & { text: string }) | null>(null);


    //**************************************************************************
    // insertAtSelection
    //**************************************************************************
    /**
     * Replace the current selection with `text` as if it had been pasted —
     * one undo step, cursor left after the insertion, view scrolled to it.
     *
     * With `asBlock`, the insertion is forced onto its own line(s): a GFM table
     * is only recognised when its header row starts a line, so pasting into the
     * middle of a paragraph must break the line first. Blank surroundings are
     * left alone — we never add a newline that isn't needed.
     */
    const insertAtSelection = (view: EditorView, text: string, asBlock: boolean) => {
        const { from, to } = view.state.selection.main;
        let body = text;
        if (asBlock) {
            const startLine = view.state.doc.lineAt(from);
            const endLine = view.state.doc.lineAt(to);
            body = wrapAsBlock(
                body,
                view.state.sliceDoc(startLine.from, from),
                view.state.sliceDoc(to, endLine.to)
            );
        }
        view.dispatch({
            ...view.state.replaceSelection(body),
            scrollIntoView: true,
            userEvent: 'input.paste',
        });
    };
    // insertAtSelection END ***************************************************


    //**************************************************************************
    // resolvePendingPaste
    //**************************************************************************
    /**
     * Apply the user's answer to the spreadsheet-paste dialog and close it.
     * `cancel` inserts nothing at all — the document is left exactly as it was
     * before the paste (REQ-LTTCE-TBL-00002).
     */
    const resolvePendingPaste = (choice: PasteTableChoice) => {
        const pending = pendingPaste;
        setPendingPaste(null);
        const view = viewRef.current;
        if (!pending || !view) return;
        if (choice === 'table') {
            insertAtSelection(view, pending.markdown, true);
        } else if (choice === 'plain') {
            insertAtSelection(view, pending.text, false);
        }
        // Return focus to the document; the dialog took it on open.
        view.focus();
    };
    // resolvePendingPaste END *************************************************

    // IMPL-LTTCE-DVW-00002 — cursor-line change notification (dual-view
    // cursor flash). The callback lives in a ref so the updateListener
    // closure (captured once when the extensions are built) never goes
    // stale; lastCursorLine deduplicates per-line so same-line cursor
    // movement (e.g. horizontal arrow keys) does not re-fire.
    const onCursorLineChangeRef = useRef(onCursorLineChange);
    const lastCursorLine = useRef<number>(-1);
    useEffect(() => {
        onCursorLineChangeRef.current = onCursorLineChange;
    }, [onCursorLineChange]);

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

    //**************************************************************************
    // convertIndentationFromBackend
    //**************************************************************************
    /**
     * Shared tabify/untabify engine (IMPL-LTTCE-WSP-00009 wiring;
     * REQ-LTTCE-WSP-00006). Converts ONLY line-start whitespace, column-
     * accurate for the current tab size. Scope: the lines covered by the
     * main selection, or the whole document when the selection is empty.
     * Same snapshot → IPC → guarded-dispatch flow as the TOC and table-pad
     * operations: a concurrent edit invalidates the snapshot and the stale
     * result is dropped.
     */
    const convertIndentationFromBackend = async (toTabs: boolean): Promise<boolean> => {
        const view = viewRef.current;
        if (!view) return false;

        const before = view.state.doc.toString();

        // 1-based inclusive line range of the main selection; 0/0 = whole
        // document. A selection ending exactly at a line start excludes
        // that line (the user has not visually selected any of it).
        const sel = view.state.selection.main;
        let startLine = 0;
        let endLine = 0;
        if (!sel.empty) {
            startLine = view.state.doc.lineAt(sel.from).number;
            const endLineObj = view.state.doc.lineAt(sel.to);
            endLine = (sel.to === endLineObj.from && endLineObj.number > startLine)
                ? endLineObj.number - 1
                : endLineObj.number;
        }

        let after: string;
        try {
            after = toTabs
                ? await Tabify.toTabs(before, tabSizeRef.current, startLine, endLine)
                : await Tabify.toSpaces(before, tabSizeRef.current, startLine, endLine);
        } catch (e) {
            console.error('Indentation conversion failed:', e);
            return false;
        }

        const liveView = viewRef.current;
        if (!liveView) return false;
        if (liveView.state.doc.toString() !== before) {
            // Concurrent change — drop the stale result rather than clobber.
            return false;
        }
        if (after === before) {
            // Nothing to convert (already in the requested form).
            return false;
        }

        liveView.dispatch({
            changes: { from: 0, to: liveView.state.doc.length, insert: after },
        });
        return true;
    };
    // convertIndentationFromBackend END ****************************************

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
            // Use CodeMirror's scrollIntoView effect instead of directly setting
            // scrollDOM.scrollTop. The direct approach used lineBlockAt().top which
            // returns estimated/stale values when CodeMirror hasn't fully measured
            // the layout (e.g., immediately after switching to dual mode on macOS),
            // causing it to report top=0 for all lines and snap the editor to the top.
            // scrollIntoView handles measurement internally and is always accurate.
            view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
        },
        undo: () => {
            if (viewRef.current) undo(viewRef.current);
        },
        redo: () => {
            if (viewRef.current) redo(viewRef.current);
        },
        //**********************************************************************
        // IMPL-LTTCE-SEL-00003 — selectAll
        //**********************************************************************
        // Reuses CM6's own `selectAll` command rather than dispatching a
        // hand-built selection, so multi-cursor state, the selection history
        // and any future CM semantics stay correct by construction.
        selectAll: () => {
            const view = viewRef.current;
            if (!view) return false;
            view.focus();
            cmSelectAll(view);
            return true;
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
        padTables: padTablesFromBackend,
        tabifyIndentation: () => convertIndentationFromBackend(true),
        untabifyIndentation: () => convertIndentationFromBackend(false)
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
        // IMPL-LTTCE-WSP-00005 — the indent unit is a real tab character.
        // CM6's `insertTab` (bound below via indentWithTab) inserts the
        // configured indent unit, which defaults to two spaces; without this
        // facet the Tab key would insert spaces instead of "\t"
        // (REQ-LTTCE-WSP-00004). Selection-indent and auto-indent use the
        // same unit, so all indentation is consistently tab-based.
        indentUnit.of('\t'),
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
            // IMPL-LTTCE-WSP-00005 — Tab types a real tab character instead of
            // moving browser focus (REQ-LTTCE-WSP-00004). CM6's standard
            // binding: empty selection → insert "\t"; selection → indent the
            // selected lines; Shift-Tab → un-indent. Keyboard-only users can
            // still leave the editor with the documented CM6 escape hatch:
            // press Esc, then Tab.
            indentWithTab,
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
            // Tabify / Untabify leading whitespace (REQ-LTTCE-WSP-00006).
            // Same fire-and-forget pattern as the two operations above.
            // Why Mod-Alt-t: Mod-Shift-t is taken (TOC refresh), and the
            // Alt layer keeps the T mnemonic ("Tabify"); the shifted
            // variant is the inverse operation, mirroring the
            // indentMore/indentLess pairing of Tab/Shift-Tab.
            {
                key: 'Mod-Alt-t',
                preventDefault: true,
                run: () => {
                    void convertIndentationFromBackend(true);
                    return true;
                },
            },
            {
                key: 'Mod-Alt-Shift-t',
                preventDefault: true,
                run: () => {
                    void convertIndentationFromBackend(false);
                    return true;
                },
            },
        ]),
        gfmLinter,    // <-- GFM ambiguity + error linter (green/orange/red underlines)
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
        fontSizeCompartment.current.of(EditorView.theme({ '.cm-content': { fontSize: `${fontSize}%` }, '.cm-gutters': { fontSize: `${fontSize}%` } })),
        highlightMarkCompartment.current.of(highlightMark ? highlightMarkExtension : []),
        // IMPL-LTTCE-WSP-00002 — "Show Whitespace" lives in its own compartment
        // so the setting toggles live without recreating the editor state.
        showWhitespaceCompartment.current.of(showWhitespace ? showWhitespaceExtension : []),
        // IMPL-LTTCE-WSP-00006 — tab display width (REQ-LTTCE-WSP-00005).
        // The indent unit above is one real tab, so indent width and tab
        // width are the same value by construction.
        tabSizeCompartment.current.of(EditorState.tabSize.of(tabSize)),
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

            // IMPL-LTTCE-DVW-00002 — notify on cursor-line change (dual-view
            // cursor flash). docChanged is included because typing can move
            // the cursor to a new line without a discrete selection event.
            if (update.selectionSet || update.docChanged) {
                const line = cursorLineOf(update.state);
                if (line !== lastCursorLine.current) {
                    lastCursorLine.current = line;
                    onCursorLineChangeRef.current?.(line);
                }
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

                //**********************************************************************
                // spreadsheet paste (IMPL-LTTCE-TBL-00003)
                //**********************************************************************
                // Only reached when the image branch above did not claim the event.
                // The handler must decide *synchronously* whether to preventDefault,
                // so the gate here is the weakest possible pre-filter ("is there a
                // TAB?"); the real verdict comes from Rust a tick later. If the
                // backend says "not a grid" — or the IPC fails — we insert the raw
                // text ourselves, so the user still sees an ordinary paste.
                if (!event.defaultPrevented) {
                    const pastedText = event.clipboardData?.getData('text/plain') ?? '';
                    if (mayBeTabular(pastedText)) {
                        event.preventDefault();
                        void (async () => {
                            let verdict: TabularPaste | null = null;
                            try {
                                verdict = await TsvTable.analyze(pastedText);
                            } catch (err) {
                                console.error('Tabular paste analysis failed', err);
                            }
                            if (!verdict || !verdict.tabular) {
                                insertAtSelection(view, pastedText, false);
                                return;
                            }
                            setPendingPaste({ ...verdict, text: pastedText });
                        })();
                    }
                }
                // spreadsheet paste END ***********************************************
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

    //**************************************************************************
    // External document load (IMPL-LTTCE-FWT-00003)
    //**************************************************************************
    // Replaces the document when — and ONLY when — the owner bumps `docEpoch`.
    //
    // The trigger used to be "`initialDoc` differs from what's in the editor",
    // which made every stale render of the prop a loaded gun: a reload racing
    // the user's typing rebuilt the state, and rebuilding the state throws away
    // the undo history and drops the cursor at offset 0 — the user's next
    // keystroke landed at the top of the file. The epoch makes the reset an
    // explicit request from the owner instead of a side effect of comparison.
    useEffect(() => {
        // First run belongs to mount, which already seeded the state with
        // `initialDoc`; adopt the epoch without touching the document.
        if (appliedEpoch.current === null || appliedEpoch.current === docEpoch) {
            appliedEpoch.current = docEpoch;
            loadedPathRef.current = currentFilePathRef.current;
            return;
        }
        appliedEpoch.current = docEpoch;

        const view = viewRef.current;
        const nextDoc = initialDocRef.current;
        const fromPath = currentFilePathRef.current;
        const isSameFile = fromPath === loadedPathRef.current;
        loadedPathRef.current = fromPath;
        if (!view || nextDoc === undefined) return;
        if (view.state.doc.toString() === nextDoc) return; // nothing to do

        // Reloading the file the user is editing (an external edit) must not
        // fling the caret to the top: keep the offset, clamped into the new
        // text. A *different* file is a different document — opening it
        // anywhere but at the beginning would be meaningless to the user.
        const anchor = isSameFile
            ? Math.min(view.state.selection.main.anchor, nextDoc.length)
            : 0;

        // A full state reset is intentional here — the new text is a different
        // document, so its undo history starts empty and becomes the baseline.
        const newState = EditorState.create({
            doc: nextDoc,
            selection: { anchor },
            extensions: getExtensions()
        });
        view.setState(newState);

        // When loading a new doc from outside, we assume it's "saved" state
        lastSavedDepth.current = undoDepth(view.state);
        onDirtyChange?.(false);
    }, [docEpoch]);
    // External document load END **********************************************

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

    // Update font size when prop changes
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.dispatch({
                effects: fontSizeCompartment.current.reconfigure(
                    EditorView.theme({ '.cm-content': { fontSize: `${fontSize}%` }, '.cm-gutters': { fontSize: `${fontSize}%` } })
                )
            });
        }
    }, [fontSize]);

    // Update highlight-mark extension when prop changes
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.dispatch({
                effects: highlightMarkCompartment.current.reconfigure(
                    highlightMark ? highlightMarkExtension : []
                )
            });
        }
    }, [highlightMark]);

    // Update show-whitespace extension when prop changes (IMPL-LTTCE-WSP-00002)
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.dispatch({
                effects: showWhitespaceCompartment.current.reconfigure(
                    showWhitespace ? showWhitespaceExtension : []
                )
            });
        }
    }, [showWhitespace]);

    // Update tab display width when prop changes (IMPL-LTTCE-WSP-00006)
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.dispatch({
                effects: tabSizeCompartment.current.reconfigure(
                    EditorState.tabSize.of(tabSize)
                )
            });
        }
    }, [tabSize]);

    return (
        <>
            <div ref={editorRef} className="editor-container" />
            {/* IMPL-LTTCE-TBL-00003 — rendered next to the editor rather than
                from App.tsx: the paste event, the pending payload and the
                insertion all live here, so the dialog has no props to thread. */}
            {pendingPaste && (
                <PasteTableDialog
                    theme={theme}
                    rows={pendingPaste.rows}
                    columns={pendingPaste.columns}
                    markdown={pendingPaste.markdown}
                    onChoice={resolvePendingPaste}
                />
            )}
        </>
    );
});
// Editor END ******************************************************************
