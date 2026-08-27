import { describe, expect, it } from 'vitest';
import { buildUndoRestorePatch, verbToPatch } from './work-verbs.ts';

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
  it('sent_email only touches last_touched', () => {
    expect(verbToPatch('sent_email', null, TODAY)).toEqual({
      patch: { last_touched: TODAY }, action: 'verb:sent_email',
    });
  });
  it('note requires text and sets latest_note so it survives refresh', () => {
    expect(verbToPatch('note', 'called the city', TODAY)).toEqual({
      patch: { latest_note: 'called the city', last_touched: TODAY }, action: 'verb:note',
    });
    expect(verbToPatch('note', '', TODAY)).toEqual({ error: 'input required' });
  });
});

// C1 (whole-branch review): undoWorkVerb's restore must never send a column
// its before_json snapshot never captured — a pre-0015 snapshot has no
// latest_note/substage_template_id/workstream_id at all (the row SELECT
// simply returned no such key), and sending them anyway 400s the WHOLE
// restore with PGRST204, turning Undo into a dead button for every verb.
describe('buildUndoRestorePatch', () => {
  it('restores every whitelisted key present on a full snapshot', () => {
    const before = {
      status: 'open', waiting_for: 'Rowan', due: '2026-09-01', last_touched: '2026-08-20',
      description: 'desc', owner: 'Noa', latest_note: 'called the city',
      project_id: 'p1', substage_template_id: 's1', workstream_id: 'w1', process_impact: 'verify',
    };
    expect(buildUndoRestorePatch(before)).toEqual(before);
  });

  it('a pre-0015 snapshot with no latest_note/substage_template_id/workstream_id omits exactly those keys, not the whole restore', () => {
    // The real production shape today: select('*') on a `tasks` row before
    // migration 0015 adds these three columns simply never returns them —
    // `before` never has the keys at all, as opposed to having them set null.
    const before = { status: 'done', waiting_for: null, due: null, last_touched: '2026-08-20', owner: 'Noa' };
    const restore = buildUndoRestorePatch(before);
    expect(restore).toEqual({ status: 'done', waiting_for: null, due: null, last_touched: '2026-08-20', owner: 'Noa' });
    expect('latest_note' in restore).toBe(false);
    expect('substage_template_id' in restore).toBe(false);
    expect('workstream_id' in restore).toBe(false);
  });

  it('a key present but explicitly null is restored as null, not omitted — captured-as-null differs from never-captured', () => {
    const before = { status: 'open', latest_note: null };
    const restore = buildUndoRestorePatch(before);
    expect('latest_note' in restore).toBe(true);
    expect(restore.latest_note).toBeNull();
  });

  it('undefined on a present key is coalesced to null, same as an explicit null would be', () => {
    const restore = buildUndoRestorePatch({ owner: undefined });
    expect(restore).toEqual({ owner: null });
  });

  it('a key outside the whitelist (e.g. stage_key, id) is never copied into the restore', () => {
    const restore = buildUndoRestorePatch({ id: 't1', stage_key: 'permit', status: 'open' });
    expect(restore).toEqual({ status: 'open' });
  });

  it('an empty snapshot restores nothing', () => {
    expect(buildUndoRestorePatch({})).toEqual({});
  });
});
