'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ShieldX } from 'lucide-react';
import { canAccessPage, ROLE_LABELS } from '@awr/shared';
import { ROUTE_PAGE, PAGE_TITLES } from './nav-items';
import { useAuthedSession } from '@/lib/session';

/**
 * Page-level access control for a directly-typed URL.
 *
 * Hiding a nav entry is not access control — it only stops the user being
 * *offered* the page. This guard refuses to render the page itself, so typing
 * `/admin` as an Agent shows a refusal rather than the administration screen.
 *
 * IMPORTANT: this is a client-side guard and it is not a security boundary. It
 * stops honest navigation mistakes; it does not stop anyone determined. Real
 * enforcement lives in the API — see `rbac.guard.ts` and `jwt-auth.guard.ts`,
 * which apply the same matrix from @awr/shared server-side.
 */
export function PageGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuthedSession();

  const page = ROUTE_PAGE[pathname];
  // Routes outside the matrix (e.g. "/") are not access-controlled surfaces.
  if (!page || canAccessPage(user.role, page)) return <>{children}</>;

  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-[440px] text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-destructive/12 text-destructive">
          <ShieldX className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[17px] font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">{PAGE_TITLES[pathname] ?? 'This page'}</b>{' '}
          is not available to the {ROLE_LABELS[user.role]} role.
        </p>
        <p className="mt-3 text-[12px] text-muted-foreground">
          If you believe you should have access, contact an administrator.
        </p>
      </div>
    </div>
  );
}
