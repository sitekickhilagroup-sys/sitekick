import { describe, expect, it } from 'vitest';
import { verbToPatch } from './work-verbs.ts';

const TODAY = '2026-08-21';

describe('verbToPatch', () => {
  it('completed sets status done', () => {
    expect(verbToPatch('completed', null, TODAY)).toEqual({
      patch: { status: 'done', last_touched: TODAY }, action: 'verb:completed',
    });
  });
  it('waiting requires text and sets waiting_for', () => {
    expect(verbToPatch('waiting', 'Rowan', TODAY)).toEqual({
      patch: { waiting_for: 'Rowan', last_touched: TODAY }, action: 'verb:waiting',
    });
    expect(verbToPatch('waiting', '  ', TODAY)).toEqual({ error: 'input required' });
  });
  it('delayed/scheduled require a YYYY-MM-DD date and set due', () => {
    expect(verbToPatch('delayed', '2026-09-01', TODAY)).toEqual({
      patch: { due: '2026-09-01', last_touched: TODAY }, action: 'verb:delayed',
    });
    expect(verbToPatch('scheduled', 'not-a-date', TODAY)).toEqual({ error: 'invalid date' });
  });
  it('not_applicable drops the task', () => {
    expect(verbToPatch('not_applicable', null, TODAY)).toEqual({
      patch: { status: 'dropped', last_touched: TODAY }, action: 'verb:not_applicable',
    });
  });
  it('sent_email and note only touch last_touched (note text goes to activity log)', () => {
    expect(verbToPatch('sent_email', null, TODAY)).toEqual({
      patch: { last_touched: TODAY }, action: 'verb:sent_email',
    });
    expect(verbToPatch('note', 'called the city', TODAY)).toEqual({
      patch: { last_touched: TODAY }, action: 'verb:note',
    });
    expect(verbToPatch('note', '', TODAY)).toEqual({ error: 'input required' });
  });
});
