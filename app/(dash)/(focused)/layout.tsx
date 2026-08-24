// Data Inbox, Invoices and Weekly Review each get a route-specific header,
// which is why they live in their own group: a layout at the (dash) level
// would reach every route including the protected More section.
//
// The header is rendered by each page rather than here, because the three
// differ — Data Inbox has its own, and Invoices and Weekly Review still use
// the standard one until their phases land. One shared layout cannot express
// that, and a full-bleed banner cannot live inside a width-capped <main>.
export default function FocusedLayout({ children }: { children: React.ReactNode }) {
  return <main id="main">{children}</main>;
}
