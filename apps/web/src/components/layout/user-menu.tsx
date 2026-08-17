'use client';

import * as React from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useAuthedSession, initials } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

/**
 * Identity in the header.
 *
 * This used to be a "view as role" switcher — a stand-in for authentication
 * that let the browser choose who it was. That is gone: identity now comes from
 * an httpOnly session cookie the client cannot read or forge, so the only way
 * to become another user is to sign out and sign in as them.
 */
export function UserMenu() {
  const { user, principal, logout } = useAuthedSession();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full border border-border bg-card py-1 pl-1 pr-2.5 transition-colors hover:bg-muted"
      >
        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {initials(user.name)}
        </span>
        <span className="text-left leading-tight">
          <b className="block text-[12.5px] font-semibold text-foreground">{user.name}</b>
          <span className="block text-[10.5px] text-muted-foreground">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[268px] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div className="border-b border-border px-3 py-2.5">
            <b className="block truncate text-[12.5px] font-semibold">{user.name}</b>
            <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {ROLE_LABELS[user.role]}
              {user.eid ? ` · ${user.eid}` : ''}
              {principal.ledTeamIds.length > 0
                ? ` · leads ${principal.ledTeamIds.length} team${principal.ledTeamIds.length === 1 ? '' : 's'}`
                : ''}
            </span>
          </div>
          <button role="menuitem" onClick={() => void logout()}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] transition-colors hover:bg-muted">
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
