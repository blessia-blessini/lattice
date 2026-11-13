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

// IMPL-LTTCE-WIN-00004 — the single frontend source for the editor window's
// view modes: the values (also the `data-view-mode` attribute and the strings
// stored in settings.json), the labels shown by the toolbar dropdown and by
// Settings, and the start view of a window (REQ-LTTCE-WIN-00003). Keep the
// values in sync with the Rust enum `ViewMode` in src-tauri/src/settings.rs
// (documented pairing — the two codebases cannot share one list without codegen).

export const VIEW_EDIT = 'edit' as const;
export const VIEW_PREVIEW = 'preview' as const;
export const VIEW_DUAL = 'dual' as const;
export const VIEW_DUAL_SWAP = 'dual-swap' as const;
export const VIEW_DUAL_TOP = 'dual-top' as const;
export const VIEW_DUAL_BOTTOM = 'dual-bottom' as const;
export type ViewMode = typeof VIEW_EDIT | typeof VIEW_PREVIEW | typeof VIEW_DUAL | typeof VIEW_DUAL_SWAP
  | typeof VIEW_DUAL_TOP | typeof VIEW_DUAL_BOTTOM;

const DUAL_MODES = [VIEW_DUAL, VIEW_DUAL_SWAP, VIEW_DUAL_TOP, VIEW_DUAL_BOTTOM] as const;
/** True for the four modes that show editor and preview side by side or stacked. */
export const isDual = (m: ViewMode) => (DUAL_MODES as readonly string[]).includes(m);
/** True for the two dual modes that stack the panes (editor on top or at the bottom). */
export const isVertical = (m: ViewMode) => m === VIEW_DUAL_TOP || m === VIEW_DUAL_BOTTOM;

/**
 * Every view mode with its label, in menu order. The labels use one family of
 * monochrome geometric markers, so all rows render from the same font (no
 * colour-emoji vs outline mismatch); the filled half shows which pane is the
 * editor.
 */
export const VIEW_MODE_OPTIONS: readonly { value: ViewMode; label: string }[] = [
  { value: VIEW_EDIT, label: '▤  Edit' },
  { value: VIEW_PREVIEW, label: '▥ Preview' },
  { value: VIEW_DUAL, label: '◨ Dual (edit on the left)' },
  { value: VIEW_DUAL_SWAP, label: '◧ Dual (edit on the right)' },
  { value: VIEW_DUAL_TOP, label: '⬓ Dual (edit on top)' },
  { value: VIEW_DUAL_BOTTOM, label: '⬒ Dual (edit on bottom)' },
];

/** Default start view of a window opened with a document (REQ-LTTCE-WIN-00003). */
export const START_VIEW_WITH_FILE_DEFAULT: ViewMode = VIEW_PREVIEW;
/** Default start view of a window opened without a document (REQ-LTTCE-WIN-00003). */
export const START_VIEW_WITHOUT_FILE_DEFAULT: ViewMode = VIEW_EDIT;


//******************************************************************************
// toViewMode
//******************************************************************************
/**
 * `value` if it is one of the six view modes, otherwise `fallback`. Settings
 * arrive from Rust already validated; this guards a missing or malformed field
 * all the same (defensive — settings.json is hand-editable).
 */
export function toViewMode(value: unknown, fallback: ViewMode): ViewMode {
  return VIEW_MODE_OPTIONS.some(o => o.value === value) ? (value as ViewMode) : fallback;
}
// toViewMode END **************************************************************


//******************************************************************************
// startViewMode
//******************************************************************************
/**
 * The view a window starts in (REQ-LTTCE-WIN-00003): the `startViewWithFile`
 * setting when it opened with a document, `startViewWithoutFile` otherwise —
 * each falling back to its default when absent or invalid. `settings` may be
 * null when the settings could not be loaded.
 */
export function startViewMode(
  settings: { startViewWithFile?: unknown; startViewWithoutFile?: unknown } | null | undefined,
  openedWithFile: boolean,
): ViewMode {
  return openedWithFile
    ? toViewMode(settings?.startViewWithFile, START_VIEW_WITH_FILE_DEFAULT)
    : toViewMode(settings?.startViewWithoutFile, START_VIEW_WITHOUT_FILE_DEFAULT);
}
// startViewMode END ***********************************************************
