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

// UTST for REQ-LTTCE-FOS-00002 — each component's own licence text and
// copyright are reproduced; MPL Exhibit B code is detected (REQ-LTTCE-FOS-00004).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    detectLicences, extractCopyrights, fallbackCopyright, findExhibitB, listLicenceFiles,
    normalizeText, selectTexts, stripTemplateCopyright,
} from './licence-texts.mjs';

const LICENSES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'foss', 'licenses');
const std = (id) => fs.readFileSync(path.join(LICENSES, `${id}.txt`), 'utf8');
const MIT_OWN = std('MIT').replace('Copyright (c) <year> <copyright holders>', 'Copyright (c) 2019 Jane Doe');

describe('detectLicences', () => {
    it.each(['MIT', 'MIT-0', '0BSD', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'Apache-2.0', 'MPL-2.0', 'BSL-1.0', 'CC0-1.0', 'Unlicense', 'Unicode-3.0'])(
        'recognises the SPDX text of %s',
        (id) => {
            expect(detectLicences(std(id))).toEqual([id]);
        },
    );

    it('reads the "(including the next paragraph)" variant as MIT, not MIT-0', () => {
        // bytemuck's LICENSE-MIT: an earlier absence-based rule misread it.
        const variant = MIT_OWN.replace('this permission notice shall', 'this permission notice (including the next paragraph) shall');
        expect(detectLicences(variant)).toEqual(['MIT']);
    });

    it('finds both licences in a combined file', () => {
        expect(detectLicences(`${MIT_OWN}\n\n${std('Apache-2.0')}`)).toEqual(['MIT', 'Apache-2.0']);
    });

    it('reads a BSD-3 with an affirmative non-endorsement clause as BSD-3', () => {
        // node_modules/rw: "The name Michael Bostock may not be used to endorse ..."
        // was read as BSD-2 before review cycle 1, and its own text was dropped.
        const variant = std('BSD-3-Clause').replace(
            /3\. Neither the name[\s\S]*?permission\./,
            '3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.',
        );
        expect(variant).not.toMatch(/Neither the name/);
        expect(detectLicences(variant)).toEqual(['BSD-3-Clause']);
    });

    it('tells BSD-4 by its advertising clause', () => {
        const bsd4 = std('BSD-3-Clause').replace('3. Neither', '3. All advertising materials mentioning features or use of this software must display an acknowledgement.\n\n4. Neither');
        expect(detectLicences(bsd4)).toEqual(['BSD-4-Clause']);
    });

    it('returns nothing for an unknown text', () => {
        expect(detectLicences('MIT OR Apache-2.0')).toEqual([]);
    });
});

describe('extractCopyrights', () => {
    it('takes holder lines and skips placeholders', () => {
        expect(extractCopyrights([MIT_OWN, std('Apache-2.0'), std('BSD-3-Clause')])).toEqual(['Copyright (c) 2019 Jane Doe']);
    });

    it('skips "(c)" list items and lower-case prose', () => {
        // "(c)" items occur inside Apache / MPL texts, which is what marks them.
        const prose = '(c) under Patent Claims infringed\n(c) You must retain';
        expect(extractCopyrights([`${prose}\n${std('MPL-2.0')}`, std('Apache-2.0'), std('MPL-2.0')])).toEqual([]);
        expect(extractCopyrights(['copyright protection under copyright law'])).toEqual([]);
    });

    it('keeps "(c) <year>", "©" and "Copyrights in ... retained by" statements', () => {
        const text = '(c) 2001 Old Corp\n© Kornel\nCopyrights in the demo project are retained by their contributors.';
        expect(extractCopyrights([text])).toEqual(['(c) 2001 Old Corp', '© Kornel', 'Copyrights in the demo project are retained by their contributors.']);
    });

    it('keeps "(c) <name>" without a year outside list-label prose', () => {
        // zune-core / zune-jpeg ship "(C) zune-image developers".
        const own = MIT_OWN.replace('Copyright (c) 2019 Jane Doe', '(C) zune-image developers');
        expect(extractCopyrights([own])).toEqual(['(C) zune-image developers']);
        // A combined MIT + Apache file keeps its holder (review cycle 2: a
        // file-level rule dropped it) while "(c) You must retain" stays prose.
        expect(extractCopyrights([`${own}\n\n${std('Apache-2.0')}`])).toEqual(['(C) zune-image developers']);
        expect(extractCopyrights([`(c) Google LLC\n\n${std('Apache-2.0')}`])).toEqual(['(c) Google LLC']);
    });

    it('keeps a holder written "(c)2024" without the space, and still drops "(c)" list prose', () => {
        expect(extractCopyrights(['(c)2024 Jane Doe\n(C)Example Org'])).toEqual(['(c)2024 Jane Doe', '(C)Example Org']);
        expect(extractCopyrights([`(c)2024 Jane Doe\n\n${std('Apache-2.0')}`])).toEqual(['(c)2024 Jane Doe']);
    });

    it('keeps "Portions Copyright" and "Copyright holder: <name>"', () => {
        expect(extractCopyrights(['Portions Copyright 2001 Old Corp\nCopyright holder: Jane Doe\nCopyright holders are listed below'])).toEqual([
            'Portions Copyright 2001 Old Corp',
            'Copyright holder: Jane Doe',
        ]);
    });

    it('does not take "Copyright notice: ..." prose for a holder', () => {
        // Review cycle 2: the ":" exemption once covered every prose word.
        const prose = 'Copyright notice: The above copyright notice shall be included.\nCopyright statement: see below\nCopyright license: granted';
        expect(extractCopyrights([prose])).toEqual([]);
        expect(extractCopyrights(['Copyright owner: Old Corp'])).toEqual(['Copyright owner: Old Corp']);
    });

    it('de-duplicates across files', () => {
        expect(extractCopyrights([MIT_OWN, MIT_OWN])).toHaveLength(1);
    });
});

describe('fallbackCopyright', () => {
    it('names the authors and says where they came from', () => {
        expect(fallbackCopyright({ name: 'x', authors: ['Jane Doe <jane@example.org>'] })).toBe('Copyright (c) Jane Doe (authors as declared in the package metadata)');
    });

    it('says so when no holder is known', () => {
        expect(fallbackCopyright({ name: 'x', authors: [] })).toMatch(/no holder named/);
    });
});

describe('selectTexts', () => {
    const files = [
        { name: 'LICENSE-APACHE', text: std('Apache-2.0') },
        { name: 'LICENSE-MIT', text: MIT_OWN },
        { name: 'NOTICE', text: 'Demo\nCopyright 2020 Demo Inc.' },
    ];

    it('uses the package own per-copy text', () => {
        const s = selectTexts(['MIT'], files);
        expect(s.texts).toEqual([{ id: 'MIT', source: 'package', file: 'LICENSE-MIT', text: MIT_OWN }]);
        expect(s.copyrights).toEqual(['Copyright (c) 2019 Jane Doe', 'Copyright 2020 Demo Inc.']);
    });

    it('uses the standard text for Apache-2.0 and keeps the NOTICE file', () => {
        const s = selectTexts(['Apache-2.0'], files);
        expect(s.texts).toEqual([{ id: 'Apache-2.0', source: 'standard' }]);
        expect(s.notices.map((n) => n.name)).toEqual(['NOTICE']);
    });

    it('falls back to the template when no file holds the licence', () => {
        expect(selectTexts(['BSD-3-Clause'], files).texts[0].source).toBe('template');
    });

    it('takes a single unrecognised licence file as a reworded variant', () => {
        const s = selectTexts(['MIT'], [{ name: 'LICENSE', text: 'Copyright 2001 X\nDo what you want, keep this line.' }]);
        expect(s.texts[0]).toMatchObject({ source: 'package', file: 'LICENSE' });
    });

    it('prefers a single-licence file over a combined one', () => {
        const s = selectTexts(['MIT'], [{ name: 'LICENSE', text: `${MIT_OWN}\n${std('Apache-2.0')}` }, { name: 'LICENSE-MIT', text: MIT_OWN }]);
        expect(s.texts[0].file).toBe('LICENSE-MIT');
    });
});

describe('stripTemplateCopyright and normalizeText', () => {
    it('removes the placeholder copyright line', () => {
        expect(stripTemplateCopyright(std('MIT'))).not.toMatch(/<year>/);
        expect(stripTemplateCopyright(std('MIT'))).toMatch(/^MIT License/);
    });

    it.each(['0BSD', 'ISC', 'MIT-0', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'MIT'])(
        'leaves no copyright line in the %s template',
        (id) => {
            // Review cycle 2: 0BSD's "YEAR by AUTHOR EMAIL" survived, and the
            // ISC template names ISC itself as the holder.
            expect(stripTemplateCopyright(std(id))).not.toMatch(/^\s*copyright\b/im);
        },
    );

    it('gives the same text for CRLF, BOM and trailing spaces', () => {
        expect(normalizeText('﻿a  \r\nb\r\n\r\n')).toBe('a\nb');
    });
});

describe('files on disk', () => {
    let dir;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-texts-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists only licence-like files at the top level', () => {
        fs.writeFileSync(path.join(dir, 'LICENSE-MIT'), 'x\r\n');
        fs.writeFileSync(path.join(dir, 'COPYING'), 'y');
        fs.writeFileSync(path.join(dir, 'README.md'), 'z');
        fs.mkdirSync(path.join(dir, 'LICENSES'));
        expect(listLicenceFiles(dir)).toEqual([{ name: 'COPYING', text: 'y' }, { name: 'LICENSE-MIT', text: 'x' }]);
        expect(listLicenceFiles(path.join(dir, 'absent'))).toEqual([]);
        expect(listLicenceFiles(null)).toEqual([]);
    });

    it('finds an Exhibit B notice in source but not in the MPL text itself', () => {
        // The official Exhibit A + B header, wrapped as sources wrap it. It names
        // the "Mozilla Public License, v. 2.0" — review cycle 1 found that an
        // earlier rule skipped every file that names the MPL, i.e. every real one.
        const header = [
            '// This Source Code Form is subject to the terms of the Mozilla Public',
            '// License, v. 2.0. If a copy of the MPL was not distributed with this',
            '// file, You can obtain one at http://mozilla.org/MPL/2.0/.',
            '//',
            '// This Source Code Form is "Incompatible With Secondary',
            '// Licenses", as defined by the Mozilla Public License, v. 2.0.',
        ].join('\n');
        fs.writeFileSync(path.join(dir, 'LICENSE.md'), std('MPL-2.0'));
        fs.writeFileSync(path.join(dir, 'COPYING.txt'), std('MPL-2.0'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'ok.rs'), header.split('\n').slice(0, 3).join('\n'));
        expect(findExhibitB(dir)).toEqual([]);
        fs.writeFileSync(path.join(dir, 'src', 'bad.rs'), `${header}\nfn main() {}`);
        expect(findExhibitB(dir)).toEqual(['src/bad.rs']);
    });

    it('flags a header that copies the Exhibit B heading, not a reflowed MPL text', () => {
        // Review cycle 2: the skip rule keyed on the Exhibit B heading, which
        // a header may copy and a reformatted licence may spell differently.
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'copied.rs'), [
            '// Exhibit B - "Incompatible With Secondary Licenses" Notice',
            '//',
            '//   This Source Code Form is "Incompatible With Secondary Licenses", as',
            '//   defined by the Mozilla Public License, v. 2.0.',
        ].join('\n'));
        const reflowed = std('MPL-2.0')
            .replace(/Exhibit B - "Incompatible With Secondary Licenses" Notice/, 'Exhibit B -- "Incompatible With\nSecondary Licenses" Notice')
            .replace(/\n(?!\n)/g, ' ');
        fs.writeFileSync(path.join(dir, 'MPL.md'), reflowed);
        expect(findExhibitB(dir)).toEqual(['src/copied.rs']);
    });
});
