'use client';

import * as React from 'react';
import { ChevronUp, KeyRound, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/primitives';
import { ChangePasswordForm } from '@/components/settings/change-password-form';

/**
 * The sidebar footer's Settings control.
 *
 * Replaces the expand/collapse group that used to live here. A footer item is
 * the worst place in the rail for an accordion: it is pinned to the bottom, so
 * expanding it has to grow *upwards* into the nav's space, which shoves the
 * scrolling region around every time it is opened. A popover leaves the layout
 * completely untouched — it is painted over the top — and the form itself opens
 * in a modal rather than as a route, so changing a password never costs the
 * user the page they were on.
 *
 * The popover is absolutely positioned rather than portalled: `<aside>` sets no
 * overflow of its own (only the inner `<nav>` scrolls), so it can escape the
 * 51px collapsed rail without being clipped.
 */
export function SettingsMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={collapsed ? 'Settings' : undefined}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex w-full items-center rounded-md px-2.5 py-[9px] text-[13px] transition-colors',
            collapsed ? 'gap-0' : 'gap-2.5',
            open
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {/* The gear turns a quarter-turn clockwise while the popover is open
              and unwinds counter-clockwise when it closes. Both directions come
              from one declaration: a transition interpolates to whatever the
              current transform is, so removing `rotate-90` runs the same
              movement in reverse rather than snapping back. `ease-out` on a
              300ms turn lets it arrive rather than stop dead.

              `prefers-reduced-motion` is already collapsed to 0.01ms globally
              in theme.css, so this degrades to an instant state change. */}
          <Settings
            className={cn(
              'h-[15px] w-[15px] flex-none transition-transform duration-300 ease-out',
              open && 'rotate-90',
            )}
            style={{ color: open ? 'currentColor' : 'var(--muted-foreground)' }}
            aria-hidden="true"
          />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">Settings</span>
              <ChevronUp
                className={cn('h-3.5 w-3.5 flex-none text-muted-foreground/60 transition-transform duration-150', open && 'rotate-180')}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </>
          )}
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Settings"
            // Opens upward: this sits at the bottom of the viewport, so a
            // downward menu would be clipped by the window edge every time.
            className={cn(
              'absolute bottom-full z-50 mb-2 min-w-[208px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg',
              'animate-in fade-in slide-in-from-bottom-1 duration-150',
              collapsed ? 'left-0' : 'left-0 right-0',
            )}
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); setShowPassword(true); }}
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              <KeyRound className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden="true" />
              Change password
            </button>
          </div>
        )}
      </div>

      {showPassword && (
        <Modal
          title="Change password"
          subtitle="Changing it signs out every other device you are signed in on."
          width={460}
          onClose={() => setShowPassword(false)}
        >
          <ChangePasswordForm
            onSuccess={() => setShowPassword(false)}
            onCancel={() => setShowPassword(false)}
            cancelLabel="Cancel"
          />
        </Modal>
      )}
    </>
  );
}
