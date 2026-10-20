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

/// Licence policy (policy.mjs)
///
/// Loads `foss/policy.json` and decides, per component, whether its declared
/// licence may ship in Lattice (REQ-LTTCE-FOS-00004).

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CATEGORY_RANK, evaluateExpression, formatExpression, parseExpression } from './spdx-expr.mjs';


//**************************************************************
// validatePolicy
//**************************************************************
/**
 * Checks the shape of a parsed policy and fills defaults.
 * @param {object} policy parsed policy.json
 * @returns {object} the same policy, defaults filled
 * @throws {Error} naming the first malformed field
 */
export function validatePolicy(policy) {
    if (!policy || typeof policy !== 'object') throw new Error('policy: not an object');
    for (const key of ['allowed', 'denied', 'allowedExceptions', 'preference', 'clarifications', 'exceptions']) {
        policy[key] ??= [];
        if (!Array.isArray(policy[key])) throw new Error(`policy: "${key}" must be an array`);
    }
    policy.obligation ??= {};
    if (typeof policy.obligation !== 'object' || Array.isArray(policy.obligation)) {
        throw new Error('policy: "obligation" must be an object of licence id -> note');
    }
    policy.types ??= {};
    if (typeof policy.types !== 'object' || Array.isArray(policy.types)) {
        throw new Error('policy: "types" must be an object of type -> licence ids');
    }
    const typed = new Set(Object.values(policy.types).flat());
    const untyped = [...policy.allowed, ...Object.keys(policy.obligation)].filter((id) => !typed.has(id));
    if (untyped.length) throw new Error(`policy: no entry in "types" for ${untyped.join(', ')}`);
    for (const c of policy.clarifications) {
        if (!c.ecosystem || !c.name || !c.version || !c.license || !c.evidence?.file || !c.evidence?.sha256) {
            throw new Error(`policy: clarification ${JSON.stringify(c)} needs ecosystem, name, version, license, evidence.file, evidence.sha256`);
        }
    }
    for (const e of policy.exceptions) {
        if (!e.ecosystem || !e.name || !e.version || !e.reason || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? '')) {
            throw new Error(`policy: exception ${JSON.stringify(e)} needs ecosystem, name, version, reason, expires (YYYY-MM-DD)`);
        }
    }
    return policy;
}
// validatePolicy END ******************************************


//**************************************************************
// loadPolicy
//**************************************************************
/**
 * Reads and validates a policy file.
 * @param {string} file path to policy.json
 * @returns {object}
 */
export function loadPolicy(file) {
    return validatePolicy(JSON.parse(fs.readFileSync(file, 'utf8')));
}
// loadPolicy END **********************************************


//**************************************************************
// classifyLeaf
//**************************************************************
/**
 * The category of a single licence leaf under the policy.
 * A `WITH` exception keeps the base licence's category only when the
 * exception is listed in `allowedExceptions`; otherwise it needs review.
 * @param {{id: string, exception: string|null}} leaf
 * @param {object} policy
 * @returns {'allowed'|'obligation'|'review'|'denied'}
 */
export function classifyLeaf(leaf, policy) {
    let base = 'review';
    if (policy.denied.includes(leaf.id)) base = 'denied';
    else if (policy.allowed.includes(leaf.id)) base = 'allowed';
    else if (Object.hasOwn(policy.obligation, leaf.id)) base = 'obligation';
    if (leaf.exception && base !== 'denied' && !policy.allowedExceptions.includes(leaf.exception)) {
        return 'review';
    }
    return base;
}
// classifyLeaf END ********************************************


//**************************************************************
// sameComponent
//**************************************************************
/** True when a policy entry names this exact component version. */
function sameComponent(entry, component) {
    return entry.ecosystem === component.ecosystem && entry.name === component.name && entry.version === component.version;
}
// sameComponent END *******************************************


//**************************************************************
// evaluateComponent
//**************************************************************
/**
 * Applies the policy to one component.
 *
 * Order: a clarification replaces the declared licence (its evidence file
 * must still hash to the recorded value); a missing licence is denied; the
 * expression is evaluated; a 'review' result passes only with an unexpired
 * exception. 'denied' cannot be excepted.
 *
 * @param {object} component {ecosystem, name, version, license, dir}
 * @param {object} policy validated policy
 * @param {string} today YYYY-MM-DD, injected so tests are not date-dependent
 * @param {Set<string>} [shippedIds] licences whose text the package ships;
 *   among equally good OR options, one of these wins over `preference`, so
 *   the component's own text can be reproduced instead of a template
 * @returns {{pass: boolean, category: string, expression: string|null, chosen: object[], problems: string[], clarified: boolean}}
 */
export function evaluateComponent(component, policy, today, shippedIds = new Set()) {
    const problems = [];
    let declared = component.license;
    let clarified = false;

    const clarification = policy.clarifications.find((c) => sameComponent(c, component));
    if (clarification) {
        const evidencePath = path.join(component.dir ?? '', clarification.evidence.file);
        let actual = null;
        try {
            actual = crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex');
        } catch {
            problems.push(`clarification evidence "${clarification.evidence.file}" is missing`);
        }
        if (actual !== null && actual !== clarification.evidence.sha256) {
            problems.push(`clarification evidence "${clarification.evidence.file}" changed (sha256 ${actual}); re-check the licence and update foss/policy.json`);
        }
        declared = clarification.license;
        clarified = true;
    }

    if (!declared) {
        return { pass: false, category: 'denied', expression: null, chosen: [], clarified, problems: [...problems, 'no licence declared; add a clarification to foss/policy.json if the package ships a licence file'] };
    }

    let ast;
    try {
        ast = parseExpression(declared);
    } catch (e) {
        return { pass: false, category: 'review', expression: declared, chosen: [], clarified, problems: [...problems, `unparsable licence "${declared}": ${e.message}`] };
    }

    const rankLeaf = (leaf) => {
        const i = policy.preference.indexOf(leaf.id);
        return (shippedIds.has(leaf.id) ? 0 : 1000) + (i < 0 ? policy.preference.length : i);
    };
    const { category, chosen } = evaluateExpression(ast, (leaf) => classifyLeaf(leaf, policy), rankLeaf);
    const expression = formatExpression(ast);

    if (category === 'denied') {
        problems.push(`licence "${expression}" is denied by policy`);
    } else if (category === 'review') {
        const exception = policy.exceptions.find((e) => sameComponent(e, component));
        if (!exception) problems.push(`licence "${expression}" needs review: classify it in foss/policy.json or add an exception`);
        else if (exception.expires < today) problems.push(`exception for "${expression}" expired on ${exception.expires}`);
    }

    return { pass: problems.length === 0 && CATEGORY_RANK[category] <= CATEGORY_RANK.review, category, expression, chosen, clarified, problems };
}
// evaluateComponent END ***************************************


//**************************************************************
// unusedPolicyEntries
//**************************************************************
/**
 * Clarifications and exceptions that match no shipped component — usually
 * left behind by a dependency bump. Reported as warnings, not failures.
 * @param {object} policy
 * @param {object[]} components
 * @returns {string[]} human-readable descriptions
 */
export function unusedPolicyEntries(policy, components) {
    const unused = [];
    for (const kind of ['clarifications', 'exceptions']) {
        for (const entry of policy[kind]) {
            if (!components.some((c) => sameComponent(entry, c))) {
                unused.push(`${kind}: ${entry.ecosystem}:${entry.name}@${entry.version}`);
            }
        }
    }
    return unused;
}
// unusedPolicyEntries END *************************************


//**************************************************************
// licenceTypeMap
//**************************************************************
/**
 * The policy's "types" as a licence id -> type lookup.
 * @param {object} policy validated policy
 * @returns {Record<string, string>}
 */
export function licenceTypeMap(policy) {
    const map = {};
    for (const [type, ids] of Object.entries(policy.types ?? {})) {
        for (const id of ids) map[id] = type;
    }
    return map;
}
// licenceTypeMap END ******************************************
