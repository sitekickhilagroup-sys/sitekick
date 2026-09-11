import { describe, expect, it } from 'vitest';
import { classifyIntent, INTENT_CLASSIFIER_VERSION, isIntent } from './comment-intent';

describe('classifyIntent — first-pass note interpretation (v2, correctable)', () => {
  it('reads a standing rule as a preference (EN + HE)', () => {
    expect(classifyIntent('I always chase Crest at month-end')).toBe('preference');
    expect(classifyIntent('בדרך כלל לא רודפת אחרי חשבוניות של Crest עד סוף החודש')).toBe('preference');
    expect(classifyIntent('בדרך כלל אני מעדיפה לטפל בחשבוניות בסוף החודש')).toBe('preference');
  });
  it('reads a directive to the reader as an instruction (EN + HE)', () => {
    expect(classifyIntent('do this first today')).toBe('instruction');
    expect(classifyIntent('תטפל בזה עכשיו לפני הכל')).toBe('instruction');
    // The brief's request example — an imperative aimed at the reader.
    expect(classifyIntent('תזכירי לי לפנות לגרג השבוע')).toBe('instruction');
    expect(classifyIntent('please send the soils report to the lender this week')).toBe('instruction');
  });
  it('preference outranks a same-sentence directive', () => {
    expect(classifyIntent('I always do the city call today')).toBe('preference');
  });

  // The core of Noa's report §3: a time word ("this week"/"השבוע") no longer
  // makes a third-party report an instruction.
  it('reads a third-party report with a time word as a FACT, not an instruction (EN + HE)', () => {
    expect(classifyIntent('גרג אמר שיחזור השבוע')).toBe('fact');
    expect(classifyIntent('Greg said he will revise and respond by the end of this week')).toBe('fact');
  });
  it('reads a fact correction (a negation about a date) as a FACT (EN + HE)', () => {
    expect(classifyIntent('התאריך 2026-09-04 אינו התחייבות שלו')).toBe('fact');
    expect(classifyIntent('The 2026-09-04 date did not come from him and is not his commitment')).toBe('fact');
  });
  it('treats a request QUOTED inside a report as a fact, not an instruction', () => {
    // The directive ("send it") is what Greg said — it is reported, not issued.
    expect(classifyIntent("Greg said please send it this week")).toBe('fact');
    expect(classifyIntent('רואן מסר שתשלח את הדוח השבוע')).toBe('fact');
  });
  it('falls back to fact for a plain statement', () => {
    expect(classifyIntent('Carlos signed the agreement on 08-11')).toBe('fact');
    expect(classifyIntent('קרלוס חתם על ההסכם')).toBe('fact');
  });
  it('is stable on empty input, and reports its version', () => {
    expect(classifyIntent('')).toBe('fact');
    expect(INTENT_CLASSIFIER_VERSION).toBe('v3-issue');
  });

  // v3: a bug report reads as 'issue', even when phrased as a request to fix
  // it (a request cue alone would otherwise route it to 'instruction').
  it('reads an app malfunction as an issue, not a fact or instruction (EN + HE)', () => {
    expect(classifyIntent("the save button doesn't work")).toBe('issue');
    expect(classifyIntent('please fix this, the app keeps crashing')).toBe('issue');
    expect(classifyIntent('לא עובד לי כפתור השמירה')).toBe('issue');
    expect(classifyIntent('תתקן בבקשה, יש תקלה במסך')).toBe('issue');
  });
  it('does not misread an ordinary status update as an issue', () => {
    expect(classifyIntent('the appraisal fell through, lender pulled out')).toBe('fact');
  });
});

describe('isIntent guard', () => {
  it('accepts the four intents and rejects others', () => {
    expect(isIntent('preference')).toBe(true);
    expect(isIntent('instruction')).toBe(true);
    expect(isIntent('fact')).toBe(true);
    expect(isIntent('issue')).toBe(true);
    expect(isIntent('anything')).toBe(false);
  });
});
