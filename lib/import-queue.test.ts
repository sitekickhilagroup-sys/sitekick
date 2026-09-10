import { describe, expect, it } from 'vitest';
import { countFailuresByDocument, selectPermanentlyFailed, selectBatch } from './import-queue.ts';

describe('countFailuresByDocument', () => {
  it('counts one failure per row, grouped by document', () => {
    const counts = countFailuresByDocument([
      { entity_id: 'doc-1' }, { entity_id: 'doc-2' }, { entity_id: 'doc-1' }, { entity_id: 'doc-1' },
    ]);
    expect(counts.get('doc-1')).toBe(3);
    expect(counts.get('doc-2')).toBe(1);
  });
  it('empty input yields an empty map', () => {
    expect(countFailuresByDocument([]).size).toBe(0);
  });
});

describe('selectPermanentlyFailed', () => {
  it('includes a document at or above maxAttempts, excludes one below it', () => {
    const counts = new Map([['doc-1', 3], ['doc-2', 2], ['doc-3', 5]]);
    expect(selectPermanentlyFailed(counts, 3)).toEqual(new Set(['doc-1', 'doc-3']));
  });
  it('empty counts yields an empty set', () => {
    expect(selectPermanentlyFailed(new Map(), 3).size).toBe(0);
  });
});

describe('selectBatch', () => {
  const docs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];

  it('takes the first batchSize candidates when none are permanently failed', () => {
    const { batch, more } = selectBatch(docs, new Set(), 3);
    expect(batch.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(more).toBe(true);
  });

  it('skips permanently-failed ids rather than counting them against the batch', () => {
    // 'a' and 'b' are permanently failed — a naive slice(0, 3) on the raw
    // candidates would include them; this must skip past to 'c','d','e'.
    const { batch, more } = selectBatch(docs, new Set(['a', 'b']), 3);
    expect(batch.map((d) => d.id)).toEqual(['c', 'd', 'e']);
    expect(more).toBe(false);
  });

  it('more is false when everything eligible fits in one batch', () => {
    const { batch, more } = selectBatch(docs, new Set(), 10);
    expect(batch.length).toBe(5);
    expect(more).toBe(false);
  });

  it('empty candidates yields an empty batch', () => {
    const { batch, more } = selectBatch([], new Set(), 5);
    expect(batch).toEqual([]);
    expect(more).toBe(false);
  });

  it('everything permanently failed yields an empty batch, not a crash', () => {
    const { batch, more } = selectBatch(docs, new Set(['a', 'b', 'c', 'd', 'e']), 3);
    expect(batch).toEqual([]);
    expect(more).toBe(false);
  });
});
