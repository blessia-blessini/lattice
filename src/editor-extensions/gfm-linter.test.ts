import { describe, it, expect } from 'vitest';
import { countTableCells } from './gfm-linter';

// IMPL-LTTCE-LNT-014
describe('countTableCells', () => {
    it('counts cells with leading and trailing pipes', () => {
        expect(countTableCells('| a | b | c |')).toBe(3);
    });

    it('counts cells without leading or trailing pipes', () => {
        expect(countTableCells('a | b | c')).toBe(3);
    });

    it('handles a single-cell row', () => {
        expect(countTableCells('| only |')).toBe(1);
    });

    it('handles two cells', () => {
        expect(countTableCells('| Name | Value |')).toBe(2);
    });

    it('handles extra surrounding whitespace', () => {
        expect(countTableCells('  | a | b |  ')).toBe(2);
    });

    it('does not split on escaped pipes', () => {
        // A backslash-escaped pipe inside a cell should not be a delimiter
        expect(countTableCells('| a\\|b | c |')).toBe(2);
    });

    it('handles a separator-style row', () => {
        // "| --- | --- |" → 2 cells
        expect(countTableCells('| --- | --- |')).toBe(2);
    });
});
