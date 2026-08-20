import { describe, expect, it } from 'vitest';
import { dictionaryKeys } from './index';

describe('i18n dictionaries', () => {
  it('en and he expose identical key sets', () => {
    const en = dictionaryKeys('en').sort();
    const he = dictionaryKeys('he').sort();
    expect(he).toEqual(en);
  });
});
