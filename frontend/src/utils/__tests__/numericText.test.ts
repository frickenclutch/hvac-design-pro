import { describe, it, expect } from 'vitest';
import { parseNumericText, formatNumericValue, numericTextMatches } from '../numericText';

describe('parseNumericText', () => {
  it('parses complete numbers, including negatives and decimals', () => {
    expect(parseNumericText('-7')).toBe(-7);
    expect(parseNumericText('0.25')).toBe(0.25);
    expect(parseNumericText('.5')).toBe(0.5);
    expect(parseNumericText(' 88 ')).toBe(88);
    expect(parseNumericText('0')).toBe(0);
  });

  it('returns null — not 0 — for empty or half-typed text', () => {
    for (const t of ['', '   ', '-', '.', '-.', 'abc', '1e']) {
      expect(parseNumericText(t)).toBeNull();
    }
  });
});

describe('formatNumericValue', () => {
  it('shows finite numbers and blanks everything else', () => {
    expect(formatNumericValue(-7)).toBe('-7');
    expect(formatNumericValue(0)).toBe('0');
    expect(formatNumericValue(Number.NaN)).toBe('');
    expect(formatNumericValue(null)).toBe('');       // NaN round-tripped through JSON
    expect(formatNumericValue(undefined)).toBe('');
    expect(formatNumericValue(Infinity)).toBe('');
  });
});

describe('numericTextMatches', () => {
  it('treats equivalent spellings as the same value so typing is not rewritten', () => {
    expect(numericTextMatches('0.50', 0.5)).toBe(true);
    expect(numericTextMatches('-7', -7)).toBe(true);
    expect(numericTextMatches('7', -7)).toBe(false);
  });

  it('treats partial text as matching an empty value only', () => {
    expect(numericTextMatches('-', Number.NaN)).toBe(true);
    expect(numericTextMatches('', null)).toBe(true);
    expect(numericTextMatches('', 0)).toBe(false);
  });
});
