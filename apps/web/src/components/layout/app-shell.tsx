'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar, useSidebarCollapsed } from './sidebar';
import { PAGE_TITLES } from './nav-items';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { UserMenu } from './user-menu';
import { PageGuard } from './page-guard';
import { useSession } from '@/lib/session';
import { PageLoader } from '@/components/ui/page-loader';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle, mounted } = useSidebarCollapsed();
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'Dashboard';
  const { user, loading } = useSession();

  // Below `lg` the rail is an overlay rather than a column — at 224px fixed it
  // was taking a third of a phone's width and squeezing every table.
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => setMobileOpen(false), [pathname]);
  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // The chrome reads the session, so it cannot render before one exists.
  // `/login` renders bare; everywhere else waits, and SessionProvider redirects
  // if there is no session once the check settles.
  if (pathname === '/login') return <>{children}</>;
  if (loading || !user) return <PageLoader />;

  return (
    <div className="flex min-h-dvh">
      {/* Avoid a collapsed->expanded flash before localStorage is read. */}
      <div className="hidden lg:block" style={{ visibility: mounted ? 'visible' : 'hidden' }}>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-150"
          />
          <div className="relative h-full w-[248px] animate-in slide-in-from-left duration-200">
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} variant="overlay" />
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[62px] items-center gap-2 border-b border-border bg-card/85 px-4 backdrop-blur-md sm:gap-3.5 sm:px-6 lg:px-7">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="-ml-1.5 grid h-9 w-9 flex-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <b className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</b>
          <div className="flex-1" />
          <ThemeToggle size="10px" />
          <UserMenu />
        </header>

        <main className="mx-auto w-full max-w-[1240px] px-4 py-6 pb-16 sm:px-6 lg:px-7">
          <PageGuard>{children}</PageGuard>
        </main>
      </div>
    </div>
  );
}
