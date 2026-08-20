'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Highlights the current page so you always know where you are (nav-state-active).
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
      {links.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
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
