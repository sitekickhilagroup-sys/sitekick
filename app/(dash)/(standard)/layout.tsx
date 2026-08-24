import { AppHeader } from '@/components/chrome/app-header';

// Portfolio, My Work, Project Process and every More destination render the
// standard global header. The More section is regression-protected: its header
// and page chrome must stay exactly as approved.
export default function StandardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-4 sm:py-6">{children}</main>
    </>
  );
}
