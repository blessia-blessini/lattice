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
////////////////////////////////////////////////////////////////////////////////

/// CycloneDX SBOM (cyclonedx.mjs)
///
/// One CycloneDX 1.6 JSON document per target triple. Deterministic: the
/// serial number is derived from the content, and no timestamp is written,
/// so rebuilding the same commit gives the same file.

import crypto from 'crypto';


//**************************************************************
// purlFor
//**************************************************************
/**
 * Package URL (https://github.com/package-url/purl-spec) of a component.
 * @param {{ecosystem: string, name: string, version: string}} c
 * @returns {string|null} null for components no package manager knows
 */
export function purlFor(c) {
    if (c.ecosystem === 'cargo') return `pkg:cargo/${encodeURIComponent(c.name)}@${encodeURIComponent(c.version)}`;
    if (c.ecosystem === 'npm') {
        const [scope, name] = c.name.startsWith('@') ? c.name.split('/') : [null, c.name];
        const ns = scope ? `${encodeURIComponent(scope)}/` : '';
        return `pkg:npm/${ns}${encodeURIComponent(name)}@${encodeURIComponent(c.version)}`;
    }
    return null;
}
// purlFor END *************************************************


//**************************************************************
// buildSbom
//**************************************************************
/**
 * @param {object} input
 * @param {{name: string, version: string, license: string}} input.product
 * @param {{triple: string, label: string}} input.target
 * @param {{component: object, evaluation: object}[]} input.entries components shipped on this target
 * @returns {object} CycloneDX 1.6 BOM
 */
export function buildSbom({ product, target, entries }) {
    const components = entries
        .map(({ component: c, evaluation: ev }) => {
            const purl = purlFor(c);
            const out = {
                type: 'library',
                'bom-ref': purl ?? `other:${c.name}@${c.version}`,
                name: c.name,
                version: c.version,
                scope: c.linkage === 'linked' ? 'required' : 'excluded',
            };
            if (purl) out.purl = purl;
            if (ev.expression) out.licenses = [{ expression: ev.expression }];
            const source = c.repository ?? c.homepage;
            if (source) out.externalReferences = [{ type: 'vcs', url: source }];
            out.properties = [{ name: 'lattice:linkage', value: c.linkage }];
            if (ev.clarified) out.properties.push({ name: 'lattice:licence-clarified', value: 'foss/policy.json' });
            return out;
        })
        .sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'], 'en'));

    const bom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: '',
        version: 1,
        metadata: {
            component: {
                type: 'application',
                'bom-ref': `pkg:generic/${product.name}@${product.version}`,
                name: product.name,
                version: product.version,
                licenses: [{ expression: product.license }],
            },
            properties: [{ name: 'lattice:target', value: target.triple }],
        },
        components,
    };
    const digest = crypto.createHash('sha256').update(JSON.stringify(bom)).digest('hex');
    bom.serialNumber = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return bom;
}
// buildSbom END ***********************************************
