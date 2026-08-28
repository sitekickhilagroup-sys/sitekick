// Money formatters shared by server pages AND client components.
//
// These used to live inside app/(dash)/(focused)/invoices/page.tsx and were
// passed to client components as props — `<AddInvoice money={moneyExact}>` —
// which Next 16 rejects at render time ("Functions cannot be passed directly
// to Client Components"), taking the whole /invoices route down with a 500
// (Rotem's QA item 03, ERROR 1245643886). A plain shared module both sides
// import keeps one definition and crosses no serialization boundary.

/** Headline figures round; spec §10. */
export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Row amounts must not round — $181.30 stays $181.30 on a financial screen. */
export const moneyExact = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** Dates DISPLAY American — MM/DD/YY — everywhere (Dor, 2026-08-28), while
 *  storage, sorting and <input type="date"> stay ISO. Accepts a plain
 *  YYYY-MM-DD or a full ISO timestamp (leading date part wins); anything
 *  else passes through untouched. Text slicing, not Date(): parsing
 *  "2026-08-28" through Date() shifts a day west of UTC. */
export const fmtDate = (v: string | null | undefined): string => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : v;
};

/** Timestamped variant for audit/history rows: "YYYY-MM-DD HH:mm" (or ISO)
 *  → "MM/DD/YY HH:mm". Falls back to fmtDate when there is no time part. */
export const fmtDateTime = (v: string | null | undefined): string => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)} ${m[4]}` : fmtDate(v);
};
