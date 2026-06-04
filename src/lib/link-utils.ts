// IMPL-LTTCE-LNK-00002 — pure link-handling helpers

/**
 * File extensions that Lattice can open as documents in a new window.
 * All comparisons are case-insensitive.
 */
const DOCUMENT_EXTENSIONS = /\.(md|markdown|txt)$/i;

/**
 * Returns true when the given file-path portion of an href points to a
 * document type that Lattice can open (Markdown or plain text).
 * The href must have had its #fragment stripped before calling this.
 */
export function isDocumentLink(filePart: string): boolean {
    return DOCUMENT_EXTENSIONS.test(filePart);
}

/**
 * Resolves a relative markdown link href against the directory of the currently
 * open file. Handles `..` and `.` path segments correctly and normalises
 * path separators to the platform convention detected from `currentFilePath`.
 *
 * A `#fragment` suffix in `href` is stripped before resolution. The returned
 * path is always the file path without any fragment.
 *
 * @param href            Raw href from the markdown link (e.g. `../docs/x.md#section`).
 * @param currentFilePath Absolute path of the file currently open in the editor.
 * @returns Resolved absolute path string, or `null` when resolution is not
 *          possible (e.g. href is a pure fragment, or currentFilePath is empty).
 *
 * @example
 * resolveRelativePath('../other.md', 'C:\\docs\\notes\\index.md')
 * // → 'C:\\docs\\other.md'
 *
 * resolveRelativePath('./sibling.md#intro', '/home/blessia/vault/index.md')
 * // → '/home/blessia/vault/sibling.md'
 */
export function resolveRelativePath(href: string, currentFilePath: string): string | null {
    if (!currentFilePath) return null;

    // Strip #fragment — we only resolve the file path
    const [filePart] = href.split('#');
    if (!filePart) return null; // pure anchor link — caller should handle

    // Detect platform separator from the current file path
    const sep = currentFilePath.includes('\\') ? '\\' : '/';

    const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf(sep));
    if (!dir && !currentFilePath.startsWith('/')) return null;

    // Normalise the href to the platform separator before joining
    const normalised = filePart.replace(/\//g, sep);

    // Walk the combined path, resolving `.` and `..` segments
    const parts = `${dir}${sep}${normalised}`.split(/[/\\]/);
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            resolved.pop();
        } else if (part !== '.') {
            resolved.push(part);
        }
    }

    const result = resolved.join(sep);
    return result || null;
}
