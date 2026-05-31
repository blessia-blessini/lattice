# Dual-Mode Scroll Sync — Deep Analysis & Fix Log

## Root Cause (One Sentence)

Every time the editor's CSS layout changes, CodeMirror fires a `scroll` event
**before** it has finished remeasuring block heights. At that moment
`getTopVisibleLine()` reads stale data, computes line 1 (or a line near the
top), and the preview↔editor sync chain snaps both panes to the beginning of
the file.

---

## The Domino in Detail

```
Layout change
  → CodeMirror scroll event (stale block heights)
  → onEditorScroll fires (isSyncing = false)
  → getTopVisibleLine() returns wrong line (≈ 1)
  → offsetForLine(map, ~1) → preview.scrollTop ≈ 0
  → isSyncing = true, then rAF resets it to false
  → preview fires its own scroll event
  → onPreviewScroll fires (isSyncing is false again)
  → lineForOffset(map, 0) → line 1
  → scrollToLine(1) → editor snaps to top
```

The two-step bounce is why the snap always lands at **line 1** rather than
just some wrong line.

---

## All Triggers (Fixed and Unfixed)

| # | Trigger | Status | Fix applied |
|---|---------|--------|-------------|
| 1 | **Font size ± buttons** | ✅ Fixed | `pauseScrollSync()` in `handleFontSizeIncrease/Decrease` |
| 2 | **Ctrl/Cmd+Scroll wheel zoom** | ✅ Fixed | Calls same handlers above |
| 3 | **Theme toggle (🌙/☀️)** | ✅ Fixed | `pauseScrollSync()` in `toggleTheme` |
| 4 | **Window resize** | ✅ Fixed | `resize` event listener → `pauseScrollSync()` |
| 5 | **Pane divider drag** | ✅ Fixed | `pauseScrollSync()` on mousedown + each rAF frame |
| 6 | **Switch into dual mode** | ✅ Fixed | `useEffect([viewMode])` → `pauseScrollSync()` |
| 7 | **Word-wrap toggle (settings)** | ✅ Fixed | `useEffect([m_wordWrap])` → `pauseScrollSync()` |
| 8 | **Highlight-mark toggle (settings)** | ✅ Fixed | `useEffect([m_highlightMark])` → `pauseScrollSync()` |
| 9 | **Insert / Refresh TOC (menu)** | ✅ Fixed | `pauseScrollSync()` in onClick |
| 10 | **Pad Tables (menu)** | ✅ Fixed | `pauseScrollSync()` in onClick |
| 11 | **TOC / Table keyboard shortcuts** | ✅ Fixed | `pauseScrollSync()` in `handleKeyDown` |
| 12 | **`lineForOffset` fallthrough → `return 1`** | ✅ Fixed | Nearest-entry fallback instead of hard-coded 1 |
| 13 | **`scrollToLine` using stale `lineBlockAt().top`** | ✅ Fixed | Replaced with `EditorView.scrollIntoView` effect |
| 14 | **macOS elastic/rubber-band bounce** | ✅ Fixed | `overscroll-behavior: contain` on both panes |
| 15 | **`previewContent` in scroll-sync deps** | ✅ Fixed | Changed deps to `[viewMode, m_currentFilePath]` |

---

## Items Not Yet Addressed

### A. `getTopVisibleLine` accuracy after partial measurement

`view.lineBlockAtHeight(scrollTop)` is reliable only after CodeMirror has
measured all blocks above the viewport.  For very long files (10 000+ lines)
on first open, only the visible blocks are measured; blocks above are
estimated.  Consequence: if the user opens a 5 000-line file and immediately
jumps to line 4 000 via the preview, `getTopVisibleLine` may lag by several
lines until CodeMirror catches up.  The sync is *directionally correct* but
can be off by a few lines.

**Suggested fix**: call `view.requestMeasure()` before reading
`lineBlockAtHeight`, or accept the small error (it converges on next user
scroll).

### B. Undo / Redo in dual mode

`editorRef.current.undo()` and `redo()` dispatch transactions that can replace
large ranges of text, causing layout changes and scroll events.  Currently no
`pauseScrollSync()` is called for undo/redo.

**Suggested fix**: add `pauseScrollSync()` inside the Ctrl+Z / Ctrl+Y branches
of `handleKeyDown`.

### C. External file reload (file watcher)

When the Tauri file-watcher fires and the app reloads the file from disk,
`setLoadedContent` updates `initialDoc`, triggering `Editor`'s `[initialDoc]`
effect which calls `view.setState(newState)`.  This resets the scroll to 0 for
*all* view modes (not just dual).  Currently there is no scroll-position
preservation for external reloads.

**Suggested fix**: save `scrollDOM.scrollTop` before `setState` and restore it
in a `requestAnimationFrame` callback (only for same-file reloads; file
switches should start at the top).

### D. TOC / Table dispatch does not annotate `scrollIntoView`

`refreshTocFromBackend` and `padTablesFromBackend` dispatch
`{ changes: { from: 0, to: length, insert: after } }`.  CodeMirror may add a
`scrollIntoView` effect automatically to keep the cursor visible.  If the
cursor is near the top, the view scrolls there.  `pauseScrollSync` covers the
race window, but the editor itself may still scroll after the pause expires.

**Suggested fix**: add `scrollPreservation: true` annotation or save/restore
`scrollTop` around the dispatch (similar to fix C above).

### E. `splitPct` persistence

When the user drags the divider, `splitPct` is stored only in React state —
it resets to 57 % on every app restart.  Not a scroll bug, but a UX issue
discovered while auditing the divider code.

**Suggested fix**: persist `splitPct` in `localStorage` (same pattern as
`FONT_SIZE_KEY`).

### F. `onPreviewScroll` / `onEditorScroll` — no re-sync after pause

After `pauseScrollSync` expires (350 ms), both panes may be slightly
misaligned (the blocked sync events were dropped).  The user won't notice
unless they stop interacting for >350 ms immediately after a resize/zoom, then
look carefully.

**Suggested fix**: after the pause timer fires, do one forced editor→preview
sync: call `onEditorScroll()` once to re-align the preview.

---

## Architecture Notes

- `isSyncing` is a **closure-local boolean**, not a ref.  It resets to `false`
  every time the scroll-sync `useEffect` re-runs.  Previously it re-ran on
  every keystroke (because `previewContent` was in deps), which let macOS
  WKWebView's spurious re-render scroll events slip through.  Now deps are
  `[viewMode, m_currentFilePath]`.

- `scrollSyncPaused` is a **ref** (not state) so its value is always current
  inside the closure without requiring the effect to re-run.

- `pauseScrollSync` uses **debounce** (clears previous timer on each call), so
  calling it on every `resize` event or every drag rAF frame is safe and
  effectively extends the pause for the duration of the operation.
