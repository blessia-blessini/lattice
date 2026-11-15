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

/**
 * Pure rules of pasting a picture into the edit pane (Chapter IMP).
 * The paste handler in `Editor.tsx` does the I/O; what it decides with lives here.
 */

/** Shown when a picture is pasted into a document that has no file yet (REQ-LTTCE-IMP-00001). */
export const NO_FILE_FOR_IMAGE_MESSAGE =
    'The current editor has no associated file. Images are saved relative to the file, ' +
    'so before the editor is associated to a file and path we do not know where to save the image(s) to.';


//**************************************************************
// imageMarkdown
//**************************************************************
/** The Markdown inserted for a pasted picture saved at `relativePath` (REQ-LTTCE-IMP-00001). */
export function imageMarkdown(relativePath: string): string {
    return `![Image](${relativePath})`;
}
// imageMarkdown END *******************************************


//**************************************************************
// isEmptyPaste
//**************************************************************
/**
 * IMPL-LTTCE-IMP-00002 — whether a paste event carries nothing at all: no
 * item, no type, no text. That is how WebKitGTK delivers a pasted picture
 * (measured on WebKitGTK 2.52.6), so such a paste is the signal to ask the
 * host to read the clipboard itself.
 *
 * Decided by what the paste holds, never by the platform: on a host whose
 * web engine hands the picture over, a picture paste has an item and this is
 * `false`; a genuinely empty clipboard costs one host read that finds nothing.
 */
export function isEmptyPaste(data: DataTransfer | null | undefined): boolean {
    if (!data) return false;
    if ((data.items?.length ?? 0) > 0) return false;
    if ((data.types?.length ?? 0) > 0) return false;
    return (data.getData?.('text/plain') ?? '') === '' && (data.getData?.('text/html') ?? '') === '';
}
// isEmptyPaste END ********************************************
