import { describe, it, expect } from 'vitest';
import { resolveRelativePath, isDocumentLink } from './link-utils';

// ── isDocumentLink ────────────────────────────────────────────────────────────

describe('isDocumentLink', () => {
    it('accepts .md', () => expect(isDocumentLink('file.md')).toBe(true));
    it('accepts .markdown', () => expect(isDocumentLink('notes.markdown')).toBe(true));
    it('accepts .txt', () => expect(isDocumentLink('readme.txt')).toBe(true));
    it('is case-insensitive', () => expect(isDocumentLink('FILE.MD')).toBe(true));
    it('rejects .pdf', () => expect(isDocumentLink('report.pdf')).toBe(false));
    it('rejects .png', () => expect(isDocumentLink('image.png')).toBe(false));
    it('rejects bare name', () => expect(isDocumentLink('noextension')).toBe(false));
    it('rejects empty string', () => expect(isDocumentLink('')).toBe(false));
});

// ── resolveRelativePath ───────────────────────────────────────────────────────

describe('resolveRelativePath — Unix paths', () => {
    const base = '/home/blessia/vault/notes/index.md';

    it('resolves sibling file', () => {
        expect(resolveRelativePath('sibling.md', base)).toBe('/home/blessia/vault/notes/sibling.md');
    });

    it('resolves ./ prefix', () => {
        expect(resolveRelativePath('./sibling.md', base)).toBe('/home/blessia/vault/notes/sibling.md');
    });

    it('resolves one ../ step', () => {
        expect(resolveRelativePath('../other.md', base)).toBe('/home/blessia/vault/other.md');
    });

    it('resolves two ../ steps', () => {
        expect(resolveRelativePath('../../top.md', base)).toBe('/home/blessia/top.md');
    });

    it('resolves into subdirectory', () => {
        expect(resolveRelativePath('docs/arch.md', base)).toBe('/home/blessia/vault/notes/docs/arch.md');
    });

    it('strips #fragment before resolving', () => {
        expect(resolveRelativePath('../other.md#section-1', base))
            .toBe('/home/blessia/vault/other.md');
    });

    it('returns null for pure fragment', () => {
        expect(resolveRelativePath('#anchor', base)).toBeNull();
    });
});

describe('resolveRelativePath — Windows paths', () => {
    const base = 'C:\\Users\\blessia\\vault\\notes\\index.md';

    it('resolves sibling file', () => {
        expect(resolveRelativePath('sibling.md', base)).toBe('C:\\Users\\blessia\\vault\\notes\\sibling.md');
    });

    it('resolves one ../ step (forward-slash href)', () => {
        // Markdown links always use forward slashes even on Windows
        expect(resolveRelativePath('../other.md', base)).toBe('C:\\Users\\blessia\\vault\\other.md');
    });

    it('resolves two ../ steps', () => {
        expect(resolveRelativePath('../../top.md', base)).toBe('C:\\Users\\blessia\\top.md');
    });

    it('strips #fragment before resolving', () => {
        expect(resolveRelativePath('../other.md#heading', base))
            .toBe('C:\\Users\\blessia\\vault\\other.md');
    });
});

describe('resolveRelativePath — edge cases', () => {
    it('returns null when currentFilePath is empty', () => {
        expect(resolveRelativePath('file.md', '')).toBeNull();
    });

    it('returns null when href resolves to empty string', () => {
        // Extremely unlikely in practice but guards against misuse
        expect(resolveRelativePath('#', '/a/b.md')).toBeNull();
    });
});
