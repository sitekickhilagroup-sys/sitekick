import { describe, expect, it } from 'vitest';
import {
  classifyPreflight, computeHasText, computeIsTooLarge, senderFromRawText, runPreflight,
  findBatchDuplicates, MIN_TEXT_CHARS, PREFLIGHT_MAX_CHARS,
} from './preflight';

const projects = [
  { id: 'p1', name: '2361-2367 San Marco', city_case: 'ENV-2024-0011', address: '2361 San Marco Ave' },
  { id: 'p2', name: '2650 Rinconia', city_case: 'ENV-2024-0022', address: '2650 Rinconia Dr' },
];

describe('computeHasText', () => {
  it('invoice_pdf is always considered to have text (Claude reads scans natively)', () => {
    expect(computeHasText({ kind: 'invoice_pdf', raw_text: null, storage_path: 'x.pdf' })).toBe(true);
  });
  it('an .mp4 recording (transcript kind, no raw_text, has storage_path) has no text', () => {
    expect(computeHasText({ kind: 'transcript', raw_text: null, storage_path: 'recordings/x.mp4' })).toBe(false);
  });
  it('a real transcript/email/sheet needs at least MIN_TEXT_CHARS', () => {
    expect(computeHasText({ kind: 'email', raw_text: 'short', storage_path: null })).toBe(false);
    expect(computeHasText({ kind: 'email', raw_text: 'x'.repeat(MIN_TEXT_CHARS), storage_path: null })).toBe(true);
  });
  it('null/empty raw_text with no storage_path has no text', () => {
    expect(computeHasText({ kind: 'transcript', raw_text: '', storage_path: null })).toBe(false);
    expect(computeHasText({ kind: 'transcript', raw_text: null, storage_path: null })).toBe(false);
  });
});

describe('computeIsTooLarge', () => {
  it('is false at or under the threshold, true just over it', () => {
    expect(computeIsTooLarge({ kind: 'email', raw_text: 'x'.repeat(PREFLIGHT_MAX_CHARS), storage_path: null })).toBe(false);
    expect(computeIsTooLarge({ kind: 'email', raw_text: 'x'.repeat(PREFLIGHT_MAX_CHARS + 1), storage_path: null })).toBe(true);
  });
  it('is false for null raw_text', () => {
    expect(computeIsTooLarge({ kind: 'invoice_pdf', raw_text: null, storage_path: 'x.pdf' })).toBe(false);
  });
});

describe('senderFromRawText', () => {
  it('reads the From: header line built by lib/parse/eml.ts', () => {
    expect(senderFromRawText('From: sharon@hillagroup.com\nTo: x\nDate: y\n\nbody')).toBe('sharon@hillagroup.com');
  });
  it('returns null when there is no From: line', () => {
    expect(senderFromRawText('just some text, no headers')).toBeNull();
    expect(senderFromRawText(null)).toBeNull();
  });
});

describe('classifyPreflight', () => {
  it('no text -> do_not_process, regardless of other signals', () => {
    expect(classifyPreflight({ hasText: false, isTooLarge: true, matchedProjectIds: ['p1'], senderKnown: true }))
      .toEqual({ group: 'do_not_process', reasons: ['no_extractable_text'] });
  });
  it('too large (with text) -> do_not_process', () => {
    expect(classifyPreflight({ hasText: true, isTooLarge: true, matchedProjectIds: ['p1'], senderKnown: true }))
      .toEqual({ group: 'do_not_process', reasons: ['too_large'] });
  });
  it('exactly one project match, sender known -> candidate', () => {
    expect(classifyPreflight({ hasText: true, isTooLarge: false, matchedProjectIds: ['p1'], senderKnown: true }))
      .toEqual({ group: 'candidate', reasons: ['project_identified'] });
  });
  it('two project matches -> needs_selection (project_ambiguous), even with a known sender', () => {
    expect(classifyPreflight({ hasText: true, isTooLarge: false, matchedProjectIds: ['p1', 'p2'], senderKnown: true }))
      .toEqual({ group: 'needs_selection', reasons: ['project_ambiguous'] });
  });
  it('sender unknown -> needs_selection (source_ambiguous), even with a single project match', () => {
    expect(classifyPreflight({ hasText: true, isTooLarge: false, matchedProjectIds: ['p1'], senderKnown: false }))
      .toEqual({ group: 'needs_selection', reasons: ['source_ambiguous'] });
  });
  it('both ambiguous at once -> needs_selection with both reasons', () => {
    expect(classifyPreflight({ hasText: true, isTooLarge: false, matchedProjectIds: ['p1', 'p2'], senderKnown: false }))
      .toEqual({ group: 'needs_selection', reasons: ['project_ambiguous', 'source_ambiguous'] });
  });
  it('zero project matches, sender known -> needs_selection (no_project_signal), NOT a confident candidate', () => {
    expect(classifyPreflight({ hasText: true, isTooLarge: false, matchedProjectIds: [], senderKnown: true }))
      .toEqual({ group: 'needs_selection', reasons: ['no_project_signal'] });
  });
});

describe('runPreflight (end-to-end, no DB/model access)', () => {
  it('a clean single-project email -> candidate', () => {
    const doc = { kind: 'email' as const, raw_text: 'From: sharon@hillagroup.com\nTo: x\nDate: y\n\nSan Marco update: corrections due Friday.', storage_path: null };
    const r = runPreflight(doc, projects);
    expect(r.group).toBe('candidate');
    expect(r.matchedProjectIds).toEqual(['p1']);
    expect(r.sender).toBe('sharon@hillagroup.com');
  });

  it('an email with no From: header -> needs_selection (source_ambiguous)', () => {
    const doc = { kind: 'email' as const, raw_text: 'San Marco update: corrections due Friday.', storage_path: null };
    const r = runPreflight(doc, projects);
    expect(r.group).toBe('needs_selection');
    expect(r.reasons).toContain('source_ambiguous');
    expect(r.sender).toBeNull();
  });

  it('a transcript (no From: header expected) with one project match -> candidate', () => {
    const doc = { kind: 'transcript' as const, raw_text: 'Weekly sync: San Marco plan check status...', storage_path: null };
    const r = runPreflight(doc, projects);
    expect(r.group).toBe('candidate');
  });

  it('an .mp4 recording -> do_not_process (no_extractable_text)', () => {
    const doc = { kind: 'transcript' as const, raw_text: null, storage_path: 'recordings/x.mp4' };
    expect(runPreflight(doc, projects)).toMatchObject({ group: 'do_not_process', reasons: ['no_extractable_text'] });
  });

  it('an invoice_pdf with no deterministic project signal -> needs_selection, never a false candidate', () => {
    const doc = { kind: 'invoice_pdf' as const, raw_text: null, storage_path: 'uploads/x.pdf' };
    const r = runPreflight(doc, projects);
    expect(r.group).toBe('needs_selection');
    expect(r.reasons).toEqual(['no_project_signal']);
  });

  it('a genuine multi-project weekly digest -> needs_selection (project_ambiguous), not silently dropped', () => {
    const doc = { kind: 'transcript' as const, raw_text: 'San Marco and Rinconia both had updates this week.', storage_path: null };
    const r = runPreflight(doc, projects);
    expect(r.group).toBe('needs_selection');
    expect(r.matchedProjectIds.sort()).toEqual(['p1', 'p2']);
  });
});

describe('findBatchDuplicates (Demo Safety Gate hardening — explicit duplicate detection)', () => {
  it('finds no duplicates when every content_hash is unique', () => {
    const docs = [
      { id: 'd1', content_hash: 'h1' },
      { id: 'd2', content_hash: 'h2' },
    ];
    expect(findBatchDuplicates(docs).size).toBe(0);
  });

  it('ignores documents with a null content_hash (nothing to compare)', () => {
    const docs = [{ id: 'd1', content_hash: null }, { id: 'd2', content_hash: null }];
    expect(findBatchDuplicates(docs).size).toBe(0);
  });

  it('marks the NEWER of two same-hash documents as a duplicate of the OLDER one (input is newest-first)', () => {
    // Caller passes newest-first (matches getDataInboxTriage's own query order).
    const docs = [
      { id: 'newer', content_hash: 'same' },
      { id: 'older', content_hash: 'same' },
    ];
    const dup = findBatchDuplicates(docs);
    expect(dup.get('newer')).toBe('older');
    expect(dup.has('older')).toBe(false); // the original is never marked a duplicate of itself
  });

  it('handles three-or-more documents sharing one hash — all but the oldest point at it', () => {
    const docs = [
      { id: 'd3', content_hash: 'same' }, // newest
      { id: 'd2', content_hash: 'same' },
      { id: 'd1', content_hash: 'same' }, // oldest -> the original
    ];
    const dup = findBatchDuplicates(docs);
    expect(dup.get('d3')).toBe('d1');
    expect(dup.get('d2')).toBe('d1');
    expect(dup.has('d1')).toBe(false);
  });

  it('does not confuse documents with different hashes even if some share no hash at all', () => {
    const docs = [
      { id: 'd1', content_hash: 'a' },
      { id: 'd2', content_hash: null },
      { id: 'd3', content_hash: 'a' },
      { id: 'd4', content_hash: 'b' },
    ];
    const dup = findBatchDuplicates(docs);
    expect(dup.get('d1')).toBe('d3'); // d1 is newer than d3 in this (newest-first) list
    expect(dup.has('d2')).toBe(false);
    expect(dup.has('d4')).toBe(false);
  });
});
