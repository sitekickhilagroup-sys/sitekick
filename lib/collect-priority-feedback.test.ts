import { afterEach, describe, expect, it } from 'vitest';
import { isCapturedEvent, isCollectionEnabled } from './collect-priority-feedback';

const prev = process.env.LEARNING_COLLECT;
afterEach(() => {
  if (prev === undefined) delete process.env.LEARNING_COLLECT;
  else process.env.LEARNING_COLLECT = prev;
});

describe('isCollectionEnabled — the kill-switch', () => {
  it('is off unless LEARNING_COLLECT is exactly "1"', () => {
    delete process.env.LEARNING_COLLECT;
    expect(isCollectionEnabled()).toBe(false);
    process.env.LEARNING_COLLECT = '0';
    expect(isCollectionEnabled()).toBe(false);
    process.env.LEARNING_COLLECT = 'true';
    expect(isCollectionEnabled()).toBe(false);
    process.env.LEARNING_COLLECT = '1';
    expect(isCollectionEnabled()).toBe(true);
  });
});

describe('isCapturedEvent — only prioritization dispositions are captured', () => {
  it('captures the five disposition verbs', () => {
    for (const v of ['completed', 'not_applicable', 'waiting', 'delayed', 'scheduled']) {
      expect(isCapturedEvent(v)).toBe(true);
    }
  });
  it('ignores non-signal verbs', () => {
    for (const v of ['note', 'sent_email', 'reopen', 'anything']) {
      expect(isCapturedEvent(v)).toBe(false);
    }
  });
});
