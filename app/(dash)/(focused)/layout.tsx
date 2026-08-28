import { AppHeader } from '@/components/chrome/app-header';

// Data Inbox, Invoices and Weekly Review render the same global header as
// every other page (navigation-consistency: the redesign's route-specific
// headers dropped the primary nav and left these pages stranded, with no
// mobile nav at all). What still differs from (standard) is the <main>:
// these pages manage their own width and padding, so it stays full-bleed —
// a full-width banner cannot live inside a width-capped <main>.
export default function FocusedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main">{children}</main>
    </>
  );
}
