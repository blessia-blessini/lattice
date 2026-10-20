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

/// SPDX licence expressions (spdx-expr.mjs)
///
/// Parses the licence expressions found in Cargo.toml `license` fields and
/// npm `license` fields, and evaluates them against a per-licence category.
///
/// Grammar (SPDX 2.3 Annex D, precedence WITH > AND > OR):
///   or   := and ("OR" and)*
///   and  := with ("AND" with)*
///   with := atom ("WITH" id)?
///   atom := "(" or ")" | id
///
/// Legacy crates write `MIT/Apache-2.0`; the slash is read as OR, which is
/// what crates.io itself does.


/** Category ranks, best first. A component's category is its worst AND part. */
export const CATEGORY_RANK = Object.freeze({
    allowed: 0,
    obligation: 1,
    review: 2,
    denied: 3,
});


//**************************************************************
// tokenize
//**************************************************************
/**
 * Splits an expression into tokens: "(", ")", "AND", "OR", "WITH" and ids.
 * Operators are matched case-insensitively (old npm packages write "or").
 * @param {string} expression
 * @returns {string[]}
 */
function tokenize(expression) {
    const normalized = expression.replace(/\s*\/\s*/g, ' OR ');
    const raw = normalized.replace(/([()])/g, ' $1 ').split(/\s+/).filter(Boolean);
    return raw.map((t) => (/^(and|or|with)$/i.test(t) ? t.toUpperCase() : t));
}
// tokenize END ************************************************


//**************************************************************
// parseExpression
//**************************************************************
/**
 * Parses an SPDX expression into an AST.
 *
 * Leaves are `{ type: 'license', id, exception }`; inner nodes are
 * `{ type: 'and' | 'or', args: [...] }`, flattened so `A OR B OR C` has three args.
 * @param {string} expression
 * @returns {object} the AST
 * @throws {Error} on an empty or malformed expression
 */
export function parseExpression(expression) {
    if (typeof expression !== 'string' || expression.trim() === '') {
        throw new Error('empty licence expression');
    }
    const tokens = tokenize(expression);
    let pos = 0;

    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const isOperator = (t) => t === 'AND' || t === 'OR' || t === 'WITH' || t === '(' || t === ')';

    function parseNary(type, operator, parseOperand) {
        const args = [parseOperand()];
        while (peek() === operator) {
            next();
            args.push(parseOperand());
        }
        if (args.length === 1) return args[0];
        // Flatten nested nodes of the same type: (A OR B) OR C == A OR B OR C
        return { type, args: args.flatMap((a) => (a.type === type ? a.args : [a])) };
    }

    function parseAtom() {
        const t = next();
        if (t === undefined) throw new Error(`unexpected end of expression "${expression}"`);
        if (t === '(') {
            const inner = parseOr();
            if (next() !== ')') throw new Error(`missing ")" in "${expression}"`);
            return inner;
        }
        if (isOperator(t)) throw new Error(`unexpected "${t}" in "${expression}"`);
        return { type: 'license', id: t, exception: null };
    }

    function parseWith() {
        const atom = parseAtom();
        if (peek() !== 'WITH') return atom;
        next();
        const exception = next();
        if (exception === undefined || isOperator(exception) || atom.type !== 'license') {
            throw new Error(`malformed WITH in "${expression}"`);
        }
        return { ...atom, exception };
    }

    const parseAnd = () => parseNary('and', 'AND', parseWith);
    const parseOr = () => parseNary('or', 'OR', parseAnd);

    const ast = parseOr();
    if (pos !== tokens.length) {
        throw new Error(`unexpected "${tokens[pos]}" in "${expression}"`);
    }
    return ast;
}
// parseExpression END *****************************************


//**************************************************************
// leafKey
//**************************************************************
/**
 * The display form of one licence leaf, e.g. `Apache-2.0 WITH LLVM-exception`.
 * @param {{id: string, exception: string|null}} leaf
 * @returns {string}
 */
export function leafKey(leaf) {
    return leaf.exception ? `${leaf.id} WITH ${leaf.exception}` : leaf.id;
}
// leafKey END *************************************************


//**************************************************************
// formatExpression
//**************************************************************
/**
 * Prints an AST back as a canonical SPDX expression (legacy "/" becomes OR).
 * @param {object} ast
 * @returns {string}
 */
export function formatExpression(ast) {
    if (ast.type === 'license') return leafKey(ast);
    const op = ast.type === 'and' ? ' AND ' : ' OR ';
    return ast.args
        .map((a) => (a.type !== 'license' && a.type !== ast.type ? `(${formatExpression(a)})` : formatExpression(a)))
        .join(op);
}
// formatExpression END ****************************************


//**************************************************************
// evaluateExpression
//**************************************************************
/**
 * Decides which licence(s) of an expression Lattice uses, and how good that is.
 *
 * - leaf: its category from `classifyLeaf`.
 * - AND:  every part applies; the category is the worst part's.
 * - OR:   the best option is chosen; ties go to the option whose first leaf
 *         has the lowest `rankLeaf`, then to the earlier option.
 *
 * @param {object} ast from parseExpression
 * @param {(leaf: object) => keyof CATEGORY_RANK} classifyLeaf
 * @param {(leaf: object) => number} rankLeaf tie-break among equal categories, lower wins
 * @returns {{category: string, chosen: object[]}} chosen = the leaves in use
 */
export function evaluateExpression(ast, classifyLeaf, rankLeaf = () => 0) {
    if (ast.type === 'license') {
        return { category: classifyLeaf(ast), chosen: [ast] };
    }
    const results = ast.args.map((a) => evaluateExpression(a, classifyLeaf, rankLeaf));
    if (ast.type === 'and') {
        const worst = results.reduce((w, r) => (CATEGORY_RANK[r.category] > CATEGORY_RANK[w] ? r.category : w), 'allowed');
        return { category: worst, chosen: results.flatMap((r) => r.chosen) };
    }
    let best = results[0];
    for (const r of results.slice(1)) {
        const byCategory = CATEGORY_RANK[r.category] - CATEGORY_RANK[best.category];
        if (byCategory < 0 || (byCategory === 0 && rankLeaf(r.chosen[0]) < rankLeaf(best.chosen[0]))) best = r;
    }
    return best;
}
// evaluateExpression END **************************************
