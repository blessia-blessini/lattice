// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

// UTST for IMPL-LTTCE-WIN-00004 (REQ-LTTCE-WIN-00003).

import { describe, expect, it } from 'vitest';
import {
    START_VIEW_WITH_FILE_DEFAULT, START_VIEW_WITHOUT_FILE_DEFAULT, VIEW_MODE_OPTIONS,
    isDual, isVertical, startViewMode, toViewMode,
} from './view-mode';

describe('view modes', () => {
    it('are the six values Rust stores, in menu order, each with a label', () => {
        // The same strings as VIEW_MODE_STRINGS in src-tauri/src/settings_tests.rs.
        expect(VIEW_MODE_OPTIONS.map(o => o.value)).toEqual(
            ['edit', 'preview', 'dual', 'dual-swap', 'dual-top', 'dual-bottom']);
        expect(VIEW_MODE_OPTIONS.map(o => o.label)).toEqual([
            '▤  Edit', '▥ Preview', '◨ Dual (edit on the left)', '◧ Dual (edit on the right)',
            '⬓ Dual (edit on top)', '⬒ Dual (edit on bottom)',
        ]);
    });

    it('tell dual and stacked modes apart', () => {
        expect(VIEW_MODE_OPTIONS.filter(o => isDual(o.value)).map(o => o.value))
            .toEqual(['dual', 'dual-swap', 'dual-top', 'dual-bottom']);
        expect(VIEW_MODE_OPTIONS.filter(o => isVertical(o.value)).map(o => o.value))
            .toEqual(['dual-top', 'dual-bottom']);
    });
});

describe('toViewMode', () => {
    it('keeps every view mode and replaces anything else by the fallback', () => {
        for (const { value } of VIEW_MODE_OPTIONS) expect(toViewMode(value, 'edit')).toBe(value);
        for (const bad of [undefined, null, '', 'Preview', 'split', 3, {}]) {
            expect(toViewMode(bad, 'dual-top')).toBe('dual-top');
        }
    });
});

describe('startViewMode', () => {
    it('defaults to Preview with a document and Edit without one', () => {
        expect(START_VIEW_WITH_FILE_DEFAULT).toBe('preview');
        expect(START_VIEW_WITHOUT_FILE_DEFAULT).toBe('edit');
        for (const settings of [null, undefined, {}]) {
            expect(startViewMode(settings, true)).toBe('preview');
            expect(startViewMode(settings, false)).toBe('edit');
        }
    });

    it('takes the setting that matches how the window opened', () => {
        const settings = { startViewWithFile: 'dual-top', startViewWithoutFile: 'dual-swap' };
        expect(startViewMode(settings, true)).toBe('dual-top');
        expect(startViewMode(settings, false)).toBe('dual-swap');
    });

    it('falls back per setting when only that one is invalid', () => {
        const settings = { startViewWithFile: 'split', startViewWithoutFile: 'dual-bottom' };
        expect(startViewMode(settings, true)).toBe('preview');
        expect(startViewMode(settings, false)).toBe('dual-bottom');
    });
});
