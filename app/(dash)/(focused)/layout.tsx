import { AppHeader } from '@/components/chrome/app-header';

// Data Inbox, Invoices and Weekly Review each get a route-specific header in
// Phases 4-6 of the redesign, which is why they live in their own group: a
// layout at the (dash) level would reach every route including More.
//
// Until each page's own header lands they keep the standard one rather than
// rendering with no chrome at all. The group split is what makes that swap
// possible one page at a time.
//
// <main> carries no width here — each of the three pages owns its container,
// because the spec gives them different widths (Invoices ~900-980px, Weekly
// ~980-1040px) and Data Inbox needs a full-bleed banner.
export default function FocusedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main">{children}</main>
    </>
  );
}
