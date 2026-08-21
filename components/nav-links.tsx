'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavLink {
  href: string;
  label: string;
}

function isActive(href: string, pathname: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

// Desktop row — highlights the current page so you always know where you are
// (nav-state-active). Hidden below lg; MobileNav takes over there.
export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden flex-1 items-center gap-1 overflow-x-auto text-sm lg:flex">
      {links.map((l) => {
        const active = isActive(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1 transition-colors ${
              active
                ? 'bg-sage-soft font-medium text-sage'
                : 'text-ink2 hover:bg-card2 hover:text-ink'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Mobile drawer — hamburger under lg opens a full-width panel below the
// header with stacked 44px link targets; `children` carries the sign-out
// form (server action) so it stays reachable on small screens.
export function MobileNav({
  links,
  menuLabel,
  children,
}: {
  links: NavLink[];
  menuLabel: string;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on route change (link tapped) and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-label={menuLabel}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-ink2 transition-colors hover:bg-card2 hover:text-ink"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={menuLabel}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-14 z-30 cursor-default bg-ink/20"
          />
          <nav className="fixed inset-x-0 top-14 z-40 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-line bg-bg px-3 py-2 shadow-card">
            {links.map((l) => {
              const active = isActive(l.href, pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center rounded-lg px-3 text-sm ${
                    active
                      ? 'bg-sage-soft font-medium text-sage'
                      : 'text-ink2 hover:bg-card2 hover:text-ink'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            {children && <div className="mt-2 border-t border-line pt-2">{children}</div>}
          </nav>
        </>
      )}
    </div>
  );
}
