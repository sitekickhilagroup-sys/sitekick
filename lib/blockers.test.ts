import { describe, expect, it } from 'vitest';
import { selectBlockerView } from './blockers';
import type { Blocker, BlockerKind } from './types';

// Synthetic rows — the audit's rules are about classification and evidence,
// so the fixtures only need the fields the derivation reads.
function blocker(over: Partial<Blocker> & { id: string }): Blocker {
  return {
    project_id: 'p1',
    document_id: 'doc1',
    what: 'something',
    blocked_by: 'someone',
    days_at_risk: 0,
    days_stuck: 1,
    downstream: [],
    suggested_action: null,
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    kind: 'primary' as BlockerKind,
    blocks_phase: 'planning',
    blocks_substage: null,
    blocked_deliverable: 'Plan Approval',
    relationship_reason: 'proved by email',
    confidence: 0.9,
    effective_from: '2026-08-01',
    last_verified_at: '2026-08-20T00:00:00Z',
    release_condition: 'counter filing accepted',
    manually_corrected_by: null,
    undo_event_id: null,
    ...over,
  };
}

const AT_PLANNING = { currentPhaseKey: 'planning', activeSubstages: ['hold_letter'] };

describe('selectBlockerView — Main Blocker selection', () => {
  it('picks a primary blocker that targets the current phase', () => {
    const view = selectBlockerView([blocker({ id: 'a' })], AT_PLANNING);
    expect(view.primary?.id).toBe('a');
    expect(view.primaryKind).toBe('primary');
  });

  it('picks a primary blocker that targets an active sub-stage', () => {
    const b = blocker({ id: 'a', blocks_phase: null, blocks_substage: 'hold_letter' });
    expect(selectBlockerView([b], AT_PLANNING).primary?.id).toBe('a');
  });

  it('ignores a primary blocker aimed at a different phase', () => {
    const b = blocker({ id: 'a', blocks_phase: 'construction' });
    expect(selectBlockerView([b], AT_PLANNING).primary).toBeNull();
  });

  it('never promotes a blocker that names no phase or sub-stage', () => {
    // The mandatory test asks which exact stage cannot advance. No answer,
    // no Blocking.
    const b = blocker({ id: 'a', blocks_phase: null, blocks_substage: null });
    expect(selectBlockerView([b], AT_PLANNING).primary).toBeNull();
  });

  it('takes the longest-stuck primary when several qualify', () => {
    const rows = [
      blocker({ id: 'old', days_stuck: 30 }),
      blocker({ id: 'new', days_stuck: 2 }),
    ];
    expect(selectBlockerView(rows, AT_PLANNING).primary?.id).toBe('old');
  });

  it('falls back to the strongest external or workstream blocker, labelled honestly', () => {
    // "If no Primary Blocker exists, display the strongest External Gate or
    // Workstream Blocker and label it accurately. Do not silently call it a
    // project-wide blocker."
    const rows = [
      blocker({ id: 'ext', kind: 'external_gate', days_stuck: 40 }),
      blocker({ id: 'ws', kind: 'workstream', days_stuck: 5 }),
    ];
    const view = selectBlockerView(rows, AT_PLANNING);
    expect(view.primary?.id).toBe('ext');
    expect(view.primaryKind).toBe('external_gate');
  });

  it('reports a technical blocker separately from the primary one', () => {
    // "If two independent workstreams are blocked, show Primary Blocker and
    // Technical Blocker separately."
    const rows = [
      blocker({ id: 'main' }),
      blocker({ id: 'tech', kind: 'workstream', days_stuck: 9 }),
    ];
    const view = selectBlockerView(rows, AT_PLANNING);
    expect(view.primary?.id).toBe('main');
    expect(view.technical?.id).toBe('tech');
  });

  it('never repeats the primary row as the technical one', () => {
    const rows = [blocker({ id: 'ws', kind: 'workstream' })];
    const view = selectBlockerView(rows, AT_PLANNING);
    expect(view.primary?.id).toBe('ws');
    expect(view.technical).toBeNull();
  });

  it('ignores released blockers entirely', () => {
    const rows = [blocker({ id: 'gone', status: 'released' })];
    const view = selectBlockerView(rows, AT_PLANNING);
    expect(view.primary).toBeNull();
    expect(view.counts.blocking).toBe(0);
  });
});

describe('selectBlockerView — counts', () => {
  it('counts only primary and workstream as blocking', () => {
    // "The blocker count on the card must count only active blockers. External
    // waits, urgent actions, and Verify items must have separate counts."
    const rows = [
      blocker({ id: 'p', kind: 'primary' }),
      blocker({ id: 'w', kind: 'workstream' }),
      blocker({ id: 'e', kind: 'external_gate' }),
      blocker({ id: 'f', kind: 'future_gate' }),
      blocker({ id: 'u', kind: 'urgent_action' }),
      blocker({ id: 'v', kind: 'verify' }),
      blocker({ id: 'i', kind: 'information_only' }),
    ];
    const { counts } = selectBlockerView(rows, AT_PLANNING);
    expect(counts).toEqual({ blocking: 2, waiting: 1, futureGate: 1, urgent: 1, verify: 1 });
  });

  it('treats a low-confidence blocker as Verify, not Blocking', () => {
    const rows = [blocker({ id: 'shaky', confidence: 0.2 })];
    const { counts, primary } = selectBlockerView(rows, AT_PLANNING);
    expect(primary).toBeNull();
    expect(counts.blocking).toBe(0);
    expect(counts.verify).toBe(1);
  });

  it('excludes information_only from every count', () => {
    const rows = [blocker({ id: 'i', kind: 'information_only', confidence: 0.1 })];
    const { counts } = selectBlockerView(rows, AT_PLANNING);
    expect(counts).toEqual({ blocking: 0, waiting: 0, futureGate: 0, urgent: 0, verify: 0 });
  });

  it('returns an empty view for a project with no blockers', () => {
    const view = selectBlockerView([], AT_PLANNING);
    expect(view.primary).toBeNull();
    expect(view.technical).toBeNull();
    expect(view.primaryKind).toBeNull();
    expect(view.counts.blocking).toBe(0);
  });

  it('still counts blockers when the project has no current phase', () => {
    // No phase set means nothing can be confirmed against it, so there is no
    // Primary — but a workstream blocker is still a real blocker.
    const rows = [blocker({ id: 'w', kind: 'workstream' })];
    const view = selectBlockerView(rows, { currentPhaseKey: null });
    expect(view.primary?.id).toBe('w');
    expect(view.counts.blocking).toBe(1);
  });
});
