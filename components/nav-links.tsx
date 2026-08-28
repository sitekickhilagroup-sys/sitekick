'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavLink {
  href: string;
  label: string;
  /** Optional count pill (her demo: open tasks on My Work). */
  badge?: number;
}

function isActive(href: string, pathname: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

// Desktop row — the five core work areas (spec §א), with everything else
// under a "More" dropdown. Highlights the current page (nav-state-active).
// Hidden below lg; MobileNav takes over there.
export function NavLinks({ links, more, moreLabel }: { links: NavLink[]; more?: NavLink[]; moreLabel?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the More menu on route change, Escape, and outside click.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const moreActive = (more ?? []).some((l) => isActive(l.href, pathname));

  return (
    // Centered like her demo's top bar.
    <nav className="hidden flex-1 items-center justify-center gap-1 text-sm lg:flex">
      {links.map((l) => {
        const active = isActive(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] leading-none transition-colors active:scale-[0.98] ${
              active
                ? 'bg-sk-green-soft font-[650] text-sk-green'
                : 'font-[450] text-sk-muted hover:bg-sk-surface-soft hover:text-sk-ink'
            }`}
          >
            {l.label}
            {l.badge != null && l.badge > 0 && (
              <span className={`rounded-full px-1.5 font-mono text-[10px] ${
                active ? 'bg-sage text-white' : 'bg-card2 text-ink3'
              }`}>{l.badge}</span>
            )}
          </Link>
        );
      })}
      {more && more.length > 0 && (
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((v) => !v)}
            className={`flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] leading-none transition-colors ${
              moreActive
                ? 'bg-sk-green-soft font-[650] text-sk-green'
                : 'font-[450] text-sk-muted hover:bg-sk-surface-soft hover:text-sk-ink'
            }`}
          >
            {moreLabel}
            <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {open && (
            <div role="menu" className="absolute start-0 top-full z-50 mt-1 min-w-40 origin-top rounded-(--radius-card) border border-line bg-card/90 py-1 shadow-card backdrop-blur-md motion-safe:animate-sk-pop reduce-transparency:bg-card reduce-transparency:backdrop-filter-none">
              {more.map((l) => {
                const active = isActive(l.href, pathname);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    role="menuitem"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-9 items-center px-3.5 text-sm ${
                      active ? 'font-medium text-sage' : 'text-ink2 hover:bg-card2 hover:text-ink'
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

// Mobile drawer — hamburger under lg opens a full-width panel below the
// header: the five primary areas, then a quiet divider group with the
// More links; `children` carries the sign-out form (server action).
export function MobileNav({
  links,
  more,
  menuLabel,
  children,
}: {
  links: NavLink[];
  more?: NavLink[];
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

  const renderLink = (l: NavLink, quiet = false) => {
    const active = isActive(l.href, pathname);
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={active ? 'page' : undefined}
        onClick={() => setOpen(false)}
        className={`flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm ${
          active
            ? 'bg-sage-soft font-medium text-sage'
            : quiet
              ? 'text-ink3 hover:bg-card2 hover:text-ink'
              : 'text-ink2 hover:bg-card2 hover:text-ink'
        }`}
      >
        {l.label}
        {l.badge != null && l.badge > 0 && (
          <span className={`rounded-full px-1.5 font-mono text-[10px] ${
            active ? 'bg-sage text-white' : 'bg-card2 text-ink3'
          }`}>{l.badge}</span>
        )}
      </Link>
    );
  };

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
            className="fixed inset-0 top-16 z-30 cursor-default bg-ink/20 motion-safe:animate-sk-fade"
          />
          <nav className="fixed inset-x-0 top-16 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-bg/85 px-3 py-2 shadow-card backdrop-blur-lg motion-safe:animate-sk-drop reduce-transparency:bg-bg reduce-transparency:backdrop-filter-none">
            {links.map((l) => renderLink(l))}
            {more && more.length > 0 && (
              <div className="mt-2 border-t border-line pt-2">
                {more.map((l) => renderLink(l, true))}
              </div>
            )}
            {children && <div className="mt-2 border-t border-line pt-2">{children}</div>}
          </nav>
        </>
      )}
    </div>
  );
}
