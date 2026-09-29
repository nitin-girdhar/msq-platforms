import { describe, expect, it } from 'vitest';
import { appendDictation } from '../useSpeechToText';

describe('appendDictation', () => {
  it('capitalises into an empty field', () => {
    expect(appendDictation('', 'call back tomorrow')).toBe('Call back tomorrow');
  });

  it('joins with a single space mid-sentence', () => {
    expect(appendDictation('Call back', 'tomorrow')).toBe('Call back tomorrow');
    expect(appendDictation('Call back ', 'tomorrow')).toBe('Call back tomorrow');
  });

  it('capitalises after sentence punctuation, including the Devanagari danda', () => {
    expect(appendDictation('Done.', 'next step')).toBe('Done. Next step');
    expect(appendDictation('हो गया।', 'कल फॉलो अप')).toBe('हो गया। कल फॉलो अप');
  });

  it('ignores blank phrases and truncates to maxLength', () => {
    expect(appendDictation('Note', '   ')).toBe('Note');
    expect(appendDictation('abc', 'defgh', 6)).toBe('abc de');
  });
});
