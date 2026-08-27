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
 * Calls fetchPage(offset, pageSize) repeatedly, starting at offset 0 and
 * advancing by pageSize each call, collecting every row into one array.
 * Stops as soon as a page comes back with FEWER than pageSize rows — the
 * only stopping condition that doesn't require knowing the total row count
 * ahead of time (an exact multiple of pageSize costs one extra, empty final
 * call; negligible next to the alternative of silently dropping rows).
 * Returns the first error verbatim and stops paging immediately — a partial
 * page never gets folded in as if it were the complete answer.
 */
export async function fetchAllPages<T>(
  pageSize: number,
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) return { error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows };
}
