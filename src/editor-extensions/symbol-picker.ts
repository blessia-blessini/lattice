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
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { symbols, SymbolInfo } from "../lib/special-characters";

const options = symbols.map(s => ({
  label: `${s.char} ${s.name}`,
  apply: s.char,
  type: "symbol",
  detail: s.keywords
}));

export function symbolCompletion(context: CompletionContext): CompletionResult | null {
  try {
    const trigger = context.matchBefore(/:[\w\s]*$/);

    if (!trigger) {
      return null;
    }

    if (!options || !Array.isArray(options)) {
      return null;
    }

    const query = trigger.text.slice(1).toLowerCase();
    const queryTerms = query.split(/\s+/).filter(t => t.length > 0);

    const filteredOptions = options.filter(o =>
      queryTerms.every(term =>
        o.label.toLowerCase().includes(term) || o.detail.toLowerCase().includes(term)
      )
    );

    return {
      from: trigger.from,
      options: filteredOptions,
      filter: false
    };
  } catch (e) {
    console.error("CRITICAL: Error in symbolCompletion:", e);
    return null;
  }
}

export const symbolPicker = autocompletion({ override: [symbolCompletion] });
