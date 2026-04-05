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

import { describe, it, expect } from 'vitest';
import { symbolCompletion } from './symbol-picker';
import { CompletionContext } from "@codemirror/autocomplete";

// Mock CompletionContext
class MockCompletionContext {
    constructor(public text: string, public pos: number) { }

    matchBefore(regex: RegExp) {
        // Simple mock for matchBefore logic relevant to the picker
        const slice = this.text.slice(0, this.pos);
        const match = regex.exec(slice);
        if (match) {
            return { from: match.index, to: this.pos, text: match[0] };
        }
        return null;
    }
}

describe('symbolCompletion', () => {
    it('returns null when no trigger is found', () => {
        const context = new MockCompletionContext("hello world", 11) as unknown as CompletionContext;
        const result = symbolCompletion(context);
        expect(result).toBeNull();
    });

    it('returns options when trigger ":" is found', () => {
        const context = new MockCompletionContext("hello :", 7) as unknown as CompletionContext;
        const result = symbolCompletion(context);
        expect(result).not.toBeNull();
        expect(result?.from).toBe(6);
        expect(result?.options.length).toBeGreaterThan(0);
    });

    it('filters options based on query', () => {
        const context = new MockCompletionContext("hello :arr", 10) as unknown as CompletionContext;
        const result = symbolCompletion(context);
        expect(result).not.toBeNull();
        // Should find "arrow" related items
        const arrowOption = result?.options.find(o => o.label.includes('Arrow'));
        expect(arrowOption).toBeDefined();
        // Should not find "Copyright"
        const copyrightOption = result?.options.find(o => o.label.includes('Copyright'));
        expect(copyrightOption).toBeUndefined();
    });

    it('handles space in query', () => {
        const context = new MockCompletionContext("hello :arr rig", 14) as unknown as CompletionContext;
        const result = symbolCompletion(context);
        expect(result).not.toBeNull();
        // "arrow right" should match
        const rightArrow = result?.options.find(o => o.label.includes('Right Arrow'));
        expect(rightArrow).toBeDefined();
    });
});
