import { describe, expect, test, vi } from 'vitest';
import { fetchAllPages, type Page } from './paginate.ts';

function fakeSource<T>(rows: T[]) {
  const calls: Array<{ offset: number; limit: number }> = [];
  const fetchPage = vi.fn(async (offset: number, limit: number): Promise<Page<T>> => {
    calls.push({ offset, limit });
    return { data: rows.slice(offset, offset + limit), error: null };
  });
  return { fetchPage, calls };
}

test('a single short page returns everything in one call', async () => {
  const { fetchPage, calls } = fakeSource([1, 2, 3]);
  const res = await fetchAllPages(1000, fetchPage);
  expect(res).toEqual({ data: [1, 2, 3] });
  expect(calls).toEqual([{ offset: 0, limit: 1000 }]);
});

test('an empty source returns an empty array in one call', async () => {
  const { fetchPage, calls } = fakeSource<number>([]);
  const res = await fetchAllPages(1000, fetchPage);
  expect(res).toEqual({ data: [] });
  expect(calls).toHaveLength(1);
});

// I4's whole point: proving nothing was left behind past Supabase's default
// 1000-row max, without knowing the real count ahead of time.
test('a source larger than one page is collected across multiple calls', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const { fetchPage, calls } = fakeSource(rows);
  const res = await fetchAllPages(1000, fetchPage);
  expect(res).toEqual({ data: rows });
  expect(calls).toEqual([
    { offset: 0, limit: 1000 },
    { offset: 1000, limit: 1000 },
    { offset: 2000, limit: 1000 },
  ]);
});

// Boundary: a source that is an EXACT multiple of the page size still has to
// take one extra, empty call to prove there wasn't a 2001st row waiting —
// the only way to stop without trusting a row count computed some other way.
test('an exact multiple of the page size still confirms completeness with one more call', async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => i);
  const { fetchPage, calls } = fakeSource(rows);
  const res = await fetchAllPages(1000, fetchPage);
  expect(res).toEqual({ data: rows });
  expect(calls).toHaveLength(3);
  expect(calls[2]).toEqual({ offset: 2000, limit: 1000 });
});

describe('a page error stops paging immediately', () => {
  test('the error is returned verbatim, not folded into a partial result', async () => {
    const fetchPage = vi.fn(async (offset: number): Promise<Page<number>> => {
      if (offset === 0) return { data: [1, 2, 3], error: null };
      return { data: null, error: { message: 'connection reset' } };
    });
    const res = await fetchAllPages(3, fetchPage);
    expect(res).toEqual({ error: 'connection reset' });
    // Only the two calls needed to reach the failure — never keeps going
    // past an error hoping a later page recovers.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  test('an error on the very first page never calls a second time', async () => {
    const fetchPage = vi.fn(async (): Promise<Page<number>> => ({ data: null, error: { message: 'RLS denied' } }));
    const res = await fetchAllPages(1000, fetchPage);
    expect(res).toEqual({ error: 'RLS denied' });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
