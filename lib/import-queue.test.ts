import { describe, expect, it } from 'vitest';
import { countFailuresByDocument, selectPermanentlyFailed, selectBatch, drainPending, type BatchResult } from './import-queue.ts';

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

describe('drainPending — "process all now"', () => {
  /** A fake batch runner: each call "processes" up to `batchSize` of the
   *  remaining count, decrementing it, until none are left. */
  function fakeRunner(totalDocs: number) {
    let remaining = totalDocs;
    const calls: number[] = [];
    const runBatch = async (batchSize: number): Promise<BatchResult> => {
      calls.push(batchSize);
      const attempted = Math.min(batchSize, remaining);
      remaining -= attempted;
      return { attempted, succeeded: attempted, failed: 0, more: remaining > 0 };
    };
    return { runBatch, calls, remaining: () => remaining };
  }

  it('loops until the queue actually empties, not just one batch', async () => {
    const { runBatch, calls } = fakeRunner(37);
    const result = await drainPending(runBatch, { batchSize: 15 });
    expect(result).toEqual({ attempted: 37, succeeded: 37, failed: 0, batches: 3, timedOut: false });
    expect(calls).toEqual([15, 15, 15]);
  });

  it('stops when the time budget runs out, reporting timedOut', async () => {
    // now() is called once for `start`, then once per loop-condition check
    // before each batch. Stay at 0 for the first two calls (start + the
    // check that lets batch 1 run), then jump past the budget so the check
    // before a would-be batch 2 fails.
    let calls = 0;
    const now = () => (calls++ < 2 ? 0 : 1000);
    const { runBatch } = fakeRunner(1000); // far more than one batch can drain
    const result = await drainPending(runBatch, { batchSize: 15, budgetMs: 500, now });
    expect(result.timedOut).toBe(true);
    expect(result.batches).toBe(1);
  });

  it('an empty queue returns immediately with zero batches beyond the first check', async () => {
    const { runBatch } = fakeRunner(0);
    const result = await drainPending(runBatch, { batchSize: 15 });
    expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0, batches: 1, timedOut: false });
  });

  it('stops after two consecutive no-progress batches instead of spinning', async () => {
    let calls = 0;
    const runBatch = async (): Promise<BatchResult> => {
      calls++;
      // Always claims to have more work, but a race means nothing gets attempted.
      return { attempted: 0, succeeded: 0, failed: 0, more: true };
    };
    const result = await drainPending(runBatch, { batchSize: 15 });
    expect(calls).toBe(2);
    expect(result.timedOut).toBe(true); // more was still true when it gave up
  });

  it('accumulates failed counts across batches without stopping on partial failure', async () => {
    let call = 0;
    const runBatch = async (): Promise<BatchResult> => {
      call++;
      // First batch: 10 attempted, 2 failed. Second batch: 5 attempted, all ok.
      return call === 1
        ? { attempted: 10, succeeded: 8, failed: 2, more: true }
        : { attempted: 5, succeeded: 5, failed: 0, more: false };
    };
    const result = await drainPending(runBatch, { batchSize: 15 });
    expect(result).toEqual({ attempted: 15, succeeded: 13, failed: 2, batches: 2, timedOut: false });
  });
});
