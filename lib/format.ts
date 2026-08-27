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
