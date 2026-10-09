import { describe, expect, it } from 'vitest';
import { neutralizeFormula } from '../export';

describe('neutralizeFormula', () => {
  it.each(['=SUM(A1)', '+91 98765', '-2+3', '@cmd', '\tfoo', '\rfoo'])(
    'prefixes a leading formula trigger: %j',
    (v) => {
      expect(neutralizeFormula(v)).toBe(`'${v}`);
    },
  );

  it('leaves ordinary text, empty strings and numbers untouched', () => {
    expect(neutralizeFormula('Mumbai Main Page')).toBe('Mumbai Main Page');
    expect(neutralizeFormula('a=b')).toBe('a=b');
    expect(neutralizeFormula('')).toBe('');
    expect(neutralizeFormula(-5)).toBe(-5);
    expect(neutralizeFormula(0)).toBe(0);
  });
});
