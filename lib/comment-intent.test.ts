import { describe, expect, it } from 'vitest';
import { classifyIntent, INTENT_CLASSIFIER_VERSION, isIntent } from './comment-intent';

describe('classifyIntent — first-pass note interpretation (v1, correctable)', () => {
  it('reads a standing rule as a preference (EN + HE)', () => {
    expect(classifyIntent('I always chase Crest at month-end')).toBe('preference');
    expect(classifyIntent('בדרך כלל לא רודפת אחרי חשבוניות של Crest עד סוף החודש')).toBe('preference');
  });
  it('reads a time-bound note as an instruction (EN + HE)', () => {
    expect(classifyIntent('do this first today')).toBe('instruction');
    expect(classifyIntent('תטפל בזה עכשיו לפני הכל')).toBe('instruction');
  });
  it('preference outranks a same-sentence time word', () => {
    expect(classifyIntent('I always do the city call today')).toBe('preference');
  });
  it('falls back to fact for a plain statement', () => {
    expect(classifyIntent('Carlos signed the agreement on 08-11')).toBe('fact');
    expect(classifyIntent('קרלוס חתם על ההסכם')).toBe('fact');
  });
  it('is stable on empty input', () => {
    expect(classifyIntent('')).toBe('fact');
    expect(INTENT_CLASSIFIER_VERSION).toBe('v1-keywords');
  });
});

describe('isIntent guard', () => {
  it('accepts the three intents and rejects others', () => {
    expect(isIntent('preference')).toBe(true);
    expect(isIntent('instruction')).toBe(true);
    expect(isIntent('fact')).toBe(true);
    expect(isIntent('anything')).toBe(false);
  });
});
