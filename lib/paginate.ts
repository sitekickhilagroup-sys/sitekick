// I4 (whole-branch review): Supabase's REST API caps a single .select() at
// 1000 rows (its own default max-rows) with no error when the real count is
// higher — it just silently truncates. A caller that genuinely needs the
// WHOLE table (app/actions/invoices.ts's two reconciliation reads: the
// source-vs-system diff needs to see every system row to find Orphans, and
// "Flag Verify" needs to find a match wherever it is) has to page through it
// explicitly and prove it stopped only because a page came back short, never
// because it silently hit a 1000-row ceiling.
//
// Takes a plain fetchPage callback rather than a Supabase client/table name
// directly, so the paging loop itself is testable with a fake page source —
// no database, no query builder to mock.

export interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Calls fetchPage(offset, pageSize) repeatedly, collecting every row into
 * one array, and stops only once a page comes back EMPTY.
 *
 * Re-review fix: this used to stop as soon as a page came back shorter than
 * `pageSize` and advance the next offset by the requested `pageSize` itself
 * — both assume the caller's chosen `pageSize` matches what the server is
 * actually willing to return per request. Neither is safe: PostgREST's own
 * row cap (Supabase's default max-rows) can be configured lower than
 * whatever `pageSize` this is called with, in which case EVERY page comes
 * back short of `pageSize` even with plenty of rows still waiting — the old
 * logic would treat the very first page as the whole answer, silently
 * dropping everything past it (page 2 could then also re-return rows page 1
 * already had, or skip rows entirely, once concurrent writes are in the
 * mix). An empty page is the only signal that doesn't depend on knowing the
 * server's real per-request cap ahead of time, and advancing the offset by
 * the page's ACTUAL length (not the requested `pageSize`) means the next
 * request always picks up exactly where the last one left off, regardless
 * of how many rows the server chose to return. The cost: a source whose
 * total is an exact multiple of the server's real cap costs one extra,
 * empty confirming call — negligible next to the alternative of silently
 * missing rows.
 */
export async function fetchAllPages<T>(
  pageSize: number,
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) return { error: error.message };
    const page = data ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    offset += page.length;
  }
  return { data: rows };
}
