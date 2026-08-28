/**
 * The five-column grid template shared by the My Work table header (a server
 * component, work/page.tsx) and every data row (the client component
 * work-table-row.tsx).
 *
 * Lives in its own module with no 'use client' directive on purpose: when
 * this constant lived inside work-table-row.tsx, importing it from the
 * server page handed the server a client-reference proxy instead of the
 * string — the header's className ended up containing the proxy's throw-on-
 * call source text, the grid-cols utility never applied, and the header
 * labels stacked into a single column.
 */
export const WORK_COLS =
  'lg:grid-cols-[minmax(240px,2.2fr)_minmax(130px,1.15fr)_minmax(150px,1.25fr)_minmax(70px,0.55fr)_minmax(120px,0.9fr)]';
