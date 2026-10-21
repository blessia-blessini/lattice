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

// UTST for REQ-LTTCE-FOS-00005 — the notices an exported document carries:
// the embedded-package list, matching it to the inventory, the rendered text,
// and a cross-check that the list names every package export-document.ts
// actually copies into an export.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMBEDDED_FILE, loadEmbedded, renderExportNotices, selectEmbedded } from './export-notices.mjs';
import { loadStandardTexts } from './foss.mjs';

const REAL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.join(os.tmpdir(), 'export-notices-root');

/** An evaluated inventory entry as `collect` builds it. */
const entry = ({ name, version = '1.0.0', ecosystem = 'npm', texts, copyrights = [`Copyright ${name} authors`], repository = null }) => ({
    component: { ecosystem, name, version, repository, homepage: null, dir: path.join(ROOT, 'node_modules', name) },
    evaluation: { expression: 'MIT', chosen: [{ id: 'MIT', exception: null }] },
    selection: { texts: texts ?? [{ id: 'MIT', source: 'package', file: 'LICENSE', text: `MIT text of ${name}` }], notices: [], copyrights },
});


//**************************************************************
// packagesCopiedBy (cross-check helper)
//**************************************************************
/**
 * The npm packages a module's source pulls in as assets — the material an
 * export copies into the user's file:
 * - a bare specifier with a Vite query (`?raw`, `?url`, `?inline`, `?raw&…`)
 *   in a static `from`, a dynamic `import(…)` or a `new URL(…)`;
 * - any string literal naming `/node_modules/<pkg>/` (an `import.meta.glob`).
 * Both quote styles and template literals. Relative paths are Lattice's own.
 * A plain `from 'pkg'` is code bundled into the app, not material in a file.
 */
function packagesCopiedBy(source) {
    const names = new Set();
    const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    const asset = /(?:\bfrom\s*|\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)(['"`])([^.'"`/][^'"`?]*)\?[^'"`]*\1/g;
    for (const m of source.matchAll(asset)) names.add(pkgOf(m[2]));
    for (const m of source.matchAll(/(['"`])\/node_modules\/((?:@[^/'"`]+\/)?[^/'"`]+)\//g)) names.add(m[2]);
    return [...names].sort();
}
// packagesCopiedBy END ****************************************


describe('loadEmbedded', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'export-embedded-'));
        fs.mkdirSync(path.join(root, 'foss'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (value) => fs.writeFileSync(path.join(root, EMBEDDED_FILE), JSON.stringify(value));

    it('reads the list', () => {
        write({ components: [{ lockKey: 'node_modules/a', material: 'stylesheet' }] });
        expect(loadEmbedded(root)).toEqual([{ lockKey: 'node_modules/a', material: 'stylesheet' }]);
    });

    it.each([
        [{}],
        [{ components: [] }],
        [{ components: [{ lockKey: 'a', material: 'x' }] }],
        [{ components: [{ lockKey: 'node_modules/a' }] }],
        [{ components: [{ lockKey: 'node_modules/a', material: '' }] }],
    ])('rejects %j', (value) => {
        write(value);
        expect(() => loadEmbedded(root)).toThrow(EMBEDDED_FILE);
    });
});

describe('selectEmbedded', () => {
    const entries = [entry({ name: 'katex' }), entry({ name: 'other' }), entry({ name: 'katex', ecosystem: 'cargo' })];

    it('matches by installed directory, in the order of the list', () => {
        const picked = selectEmbedded(entries, [
            { lockKey: 'node_modules/other', material: 'b' },
            { lockKey: 'node_modules/katex', material: 'a' },
        ], ROOT);
        expect(picked.map((p) => [p.entry.component.name, p.entry.component.ecosystem, p.material])).toEqual([
            ['other', 'npm', 'b'],
            ['katex', 'npm', 'a'],
        ]);
    });

    it('distinguishes two installed copies of one package by their directory', () => {
        const nested = { ...entry({ name: 'katex', version: '0.1.0' }) };
        nested.component = { ...nested.component, dir: path.join(ROOT, 'node_modules', 'rehype-katex', 'node_modules', 'katex') };
        const picked = selectEmbedded([nested, entry({ name: 'katex', version: '0.2.0' })], [{ lockKey: 'node_modules/katex', material: 'a' }], ROOT);
        expect(picked[0].entry.component.version).toBe('0.2.0');
    });

    it('fails for a package the inventory does not ship', () => {
        expect(() => selectEmbedded(entries, [{ lockKey: 'node_modules/missing', material: 'a' }], ROOT)).toThrow(/node_modules\/missing.*not a shipped npm package/);
    });
});

describe('renderExportNotices', () => {
    const std = loadStandardTexts(REAL_ROOT);

    it('names each component with its material, licence, copyright and source', () => {
        const text = renderExportNotices([{ entry: entry({ name: 'katex', version: '0.18.2', repository: 'https://example.org/katex' }), material: 'stylesheet and fonts' }], std);
        expect(text).toMatch(/^- katex 0\.18\.2 \(stylesheet and fonts\): MIT\n {2}Copyright katex authors\n {2}Source: https:\/\/example\.org\/katex$/m);
        expect(text).toMatch(/^---- MIT licence text \(katex\) ----\n\nMIT text of katex$/m);
        expect(text.endsWith('\n')).toBe(true);
    });

    it('prints an identical licence text once, naming every component that uses it', () => {
        const same = [{ id: 'MIT', source: 'package', file: 'LICENSE', text: 'shared text' }];
        const text = renderExportNotices([
            { entry: entry({ name: 'a', texts: same }), material: 'x' },
            { entry: entry({ name: 'b', texts: same }), material: 'y' },
        ], std);
        expect(text.match(/shared text/g)).toHaveLength(1);
        expect(text).toMatch(/---- MIT licence text \(a, b\) ----/);
    });

    it('names a component once under a text it uses twice', () => {
        const twice = [
            { id: 'MIT', source: 'package', file: 'LICENSE', text: 'same body' },
            { id: 'MIT', source: 'package', file: 'LICENSE.md', text: 'same body' },
        ];
        const text = renderExportNotices([{ entry: entry({ name: 'a', texts: twice }), material: 'x' }], std);
        expect(text).toMatch(/---- MIT licence text \(a\) ----/);
    });

    it('uses the standard text for a package that ships no licence file', () => {
        const text = renderExportNotices([{ entry: entry({ name: 'a', texts: [{ id: 'MIT', source: 'template' }] }), material: 'x' }], std);
        expect(text).toMatch(/Permission is hereby granted, free of charge/);
        expect(text).not.toMatch(/<year> <copyright holders>/);
    });

    it('points at the permission for Lattice\'s own styles', () => {
        const text = renderExportNotices([{ entry: entry({ name: 'a' }), material: 'x' }], std);
        expect(text).toMatch(/additional permission for exported\ndocuments/);
    });

    it.each([['*/'], ['</STYLE>']])('refuses text containing %s — it would end the CSS comment or the <style> element', (bad) => {
        expect(() => renderExportNotices([{ entry: entry({ name: 'a', copyrights: [`Copyright ${bad}`] }), material: 'x' }], std)).toThrow(/CSS comment/);
    });

    it('normalises CRLF licence files to LF', () => {
        const crlf = [{ id: 'MIT', source: 'package', file: 'LICENSE', text: 'line one\r\nline two\r\n' }];
        expect(renderExportNotices([{ entry: entry({ name: 'a', texts: crlf }), material: 'x' }], std)).not.toMatch(/\r/);
    });
});

describe('packagesCopiedBy (the cross-check parser)', () => {
    it.each([
        ["import a from 'katex/dist/katex.min.css?raw';", ['katex']],
        ['import a from "katex/dist/katex.min.css?raw";', ['katex']],
        ["import a from 'pkg/font.woff2?url';", ['pkg']],
        ["import a from 'pkg/a.css?raw&inline';", ['pkg']],
        ["const a = await import('pkg/a.css?inline');", ['pkg']],
        ['const a = await import(`pkg/a.css?raw`);', ['pkg']],
        ["const u = new URL('pkg/f.woff2?url', import.meta.url);", ['pkg']],
        ["import a from '@scope/pkg/a.css?raw';", ['@scope/pkg']],
        ["import.meta.glob('/node_modules/katex/dist/fonts/*.woff2');", ['katex']],
        ['import.meta.glob("/node_modules/@scope/pkg/x/*.css");', ['@scope/pkg']],
    ])('finds the package in %s', (source, expected) => {
        expect(packagesCopiedBy(source)).toEqual(expected);
    });

    it.each([
        ["import a from '../preview-theme.css?raw';"],
        ["import a from './export-notices.generated.txt?raw';"],
        ["import { x } from 'some-library';"],
        ["import { y } from './preview-theme';"],
    ])('ignores Lattice\'s own files and plain code imports: %s', (source) => {
        expect(packagesCopiedBy(source)).toEqual([]);
    });
});

describe('foss/export-embedded.json on the real tree', () => {
    it('lists exactly the packages export-document.ts copies into an export', () => {
        const source = fs.readFileSync(path.join(REAL_ROOT, 'src', 'lib', 'export-document.ts'), 'utf8');
        const copied = packagesCopiedBy(source);
        const listed = loadEmbedded(REAL_ROOT).map((c) => c.lockKey.slice('node_modules/'.length)).sort();
        expect(copied.length).toBeGreaterThan(0); // the parser still sees the imports at all
        expect(listed).toEqual(copied);
    });
});
