'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, ChevronDown, Hash, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WORKSPACE_NAV, ADMIN_NAV, SETTINGS_NAV, type NavItem } from './nav-items';
import { canAccessPage } from '@awr/shared';
import { useAuthedSession } from '@/lib/session';
import { NAV_ICONS } from './icons';
import { SettingsMenu } from './settings-menu';
import { LogoMark } from '@/components/brand/logo-mark';

const STORAGE_KEY = 'awr:rail-collapsed';

/** Where the logo points. Every role can open the performance dashboard, so
 * this is the one destination the mark can always offer. */
const HOME_HREF = '/dashboard/performance';

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
    setMounted(true);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  // Global ⌘B / Ctrl+B shortcut.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { collapsed: mounted && collapsed, toggle, mounted };
}

/**
 * Collapses its content to zero width via a CSS grid-track animation instead
 * of an opacity/display swap. This is what stops icons "jumping": every row
 * keeps constant padding and constant icon position always — only this one
 * sibling track shrinks — so collapsing the rail never re-flows an icon from
 * one alignment mode to another mid-transition.
 */
function CollapsibleLabel({ collapsed, className, children }: { collapsed: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn('grid overflow-hidden transition-[grid-template-columns] duration-200 ease-out', className)}
      style={{
        gridTemplateColumns: collapsed ? 'minmax(0,0fr)' : 'minmax(0,1fr)',
        // Passed-in `flex-1` (used by NavGroup so the chevron sits at the
        // row's right edge when expanded) would otherwise still grab
        // whatever row space is left over even while collapsed — this
        // element's grid track goes to 0, but the flex item's own box
        // wouldn't, letting its clipped content peek out at the edge. Force
        // it out of the flex-grow distribution entirely while collapsed.
        flexGrow: collapsed ? 0 : undefined,
      }}
    >
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function NavLink({
  href, label, icon, color, collapsed,
}: { href: string; label: string; icon: keyof typeof NAV_ICONS; color: string; collapsed: boolean }) {
  const pathname = usePathname();
  const active = pathname === href;
  const Icon = NAV_ICONS[icon];
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center rounded-md px-2.5 py-[9px] text-[13px] transition-colors',
        collapsed ? 'gap-0' : 'gap-2.5',
        active
          ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {/* The icon's own offset from the row's left edge never changes between
          collapsed and expanded (still justify-start either way) — only the
          gap reserved for the label disappears, so nothing shifts the icon;
          the rail's own width is what's tuned to make that offset read as
          centered once collapsed. */}
      <Icon className="h-[15px] w-[15px] flex-none" style={{ color: active ? 'currentColor' : color }} aria-hidden="true" />
      <CollapsibleLabel collapsed={collapsed}>
        <span className="block truncate">{label}</span>
      </CollapsibleLabel>
    </Link>
  );
}

/**
 * An expandable nav item with nested children — e.g. Form repository's
 * New / Active / Archive. The parent row toggles expand/collapse only; each
 * child is its own real route, hash-marked and indented with a connecting
 * rail, matching the reference sidebar's group pattern.
 */
function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const Icon = NAV_ICONS[item.icon];
  const children = item.children!;
  const childActive = children.some((c) => pathname === c.href);

  const [manualOpen, setManualOpen] = React.useState<boolean | null>(null);
  const open = manualOpen ?? childActive;

  // Re-expand whenever navigation lands on one of this group's own pages,
  // even if the user had manually collapsed it earlier.
  React.useEffect(() => {
    if (childActive) setManualOpen(true);
  }, [childActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => (collapsed ? router.push(item.href) : setManualOpen((o) => !(o ?? childActive)))}
        title={collapsed ? item.label : undefined}
        aria-expanded={collapsed ? undefined : open}
        className={cn(
          'flex w-full items-center rounded-md px-2.5 py-[9px] text-[13px] transition-colors',
          collapsed ? 'gap-0' : 'gap-2.5',
          childActive
            ? 'font-semibold text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Icon className="h-[15px] w-[15px] flex-none" style={{ color: item.color }} aria-hidden="true" />
        <CollapsibleLabel collapsed={collapsed} className="flex-1">
          <span className="flex items-center gap-2.5">
            <span className="flex-1 truncate text-left">{item.label}</span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 flex-none text-muted-foreground/60 transition-transform duration-150', open && 'rotate-180')}
              strokeWidth={1.75} aria-hidden="true"
            />
          </span>
        </CollapsibleLabel>
      </button>

      {!collapsed && open && (
        <div className="relative mt-0.5 flex flex-col gap-0.5 py-0.5 pl-[13px]">
          <div className="absolute bottom-1.5 left-[13px] top-0.5 w-px bg-border" aria-hidden="true" />
          {children.map((child) => {
            const active = pathname === child.href;
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-sm py-[7px] pl-3 pr-2.5 text-[13px] transition-colors',
                  active ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Hash className="h-3 w-3 flex-none text-muted-foreground/50" strokeWidth={2} aria-hidden="true" />
                <span className="truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A small square tab straddling the sidebar's right edge, vertically centered
 * on the page header's border line — rides the same "seam" the sidebar and
 * header borders already share, so it reads as one connected piece of chrome
 * rather than a button floating inside either panel.
 */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={(collapsed ? 'Expand sidebar' : 'Collapse sidebar') + '  (⌘B)'}
      className="group absolute right-0 top-[62.5px] z-30 flex h-7 w-7 flex-none -translate-y-1/2 translate-x-1/2 items-center justify-center bg-sidebar text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
    >
      {/* Only the right half — the half sitting outside the sidebar's own
          bounds — draws a border, so it reads as a notch cut into the
          sidebar's edge rather than a separate floating chip. The left half
          shares the sidebar's exact background with no border of its own,
          so it visually fuses with the sidebar body. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 right-0 w-1/2 rounded-r-[7px] border border-l-0 border-sidebar-border bg-sidebar transition-colors group-hover:bg-muted"
      />
      {collapsed
        ? <PanelLeftOpen className="relative h-[13px] w-[13px]" strokeWidth={1.75} aria-hidden="true" />
        : <PanelLeftClose className="relative h-[13px] w-[13px]" strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

/** "Workspace" / "Admin" section labels. Collapsed to a plain divider rather
 * than hidden outright, so the two groups of icons stay visually separated. */
function SectionLabel({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  // Both branches share one fixed height so toggling collapsed never
  // reflows the rows below — only what's drawn inside this row changes.
  if (collapsed) {
    return (
      <div className="flex h-[22px] items-center px-2" aria-hidden="true">
        <div className="h-px w-full bg-sidebar-border" />
      </div>
    );
  }
  return (
    <div className="flex h-[22px] items-end px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/50">
      {children}
    </div>
  );
}

/**
 * The rail's sticky footer — a sibling of `<nav>`, not a row inside it.
 *
 * That distinction is the whole point. `<nav>` is the scrolling region
 * (`flex-1` + `overflow-y-auto`), so anything placed inside it scrolls away
 * with the workspace and admin groups no matter how it is aligned. Sitting
 * outside `<nav>`, this stays put: the nav absorbs the leftover height and the
 * footer is always the last thing visible at the bottom of the sidebar.
 *
 * The divider is pulled out to the sidebar's own edges with `-mx-2` (undoing
 * the `px-2` on `<aside>`) so it reads as a seam across the full width rather
 * than a short line floating between two padded columns.
 */
function SidebarFooter({ collapsed, show }: { collapsed: boolean; show: boolean }) {
  if (!show) return null;
  return (
    <div className="-mx-2 flex flex-none flex-col gap-0.5 border-t border-sidebar-border px-2 pt-3">
      <SettingsMenu collapsed={collapsed} />
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  variant = 'rail',
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** `overlay` is the mobile drawer: full height of its own fixed parent, no
   * sticky positioning, and the edge notch becomes a plain close button. */
  variant?: 'rail' | 'overlay';
}) {
  // The rail is built from the same page-access matrix the route guard uses, so
  // it can never offer a destination that would refuse the user on arrival.
  const { user } = useAuthedSession();
  const workspace = WORKSPACE_NAV.filter((i) => canAccessPage(user.role, i.page));
  const admin = ADMIN_NAV.filter((i) => canAccessPage(user.role, i.page));
  const settings = SETTINGS_NAV.filter((i) => canAccessPage(user.role, i.page));
  const overlay = variant === 'overlay';

  const pathname = usePathname();

  /**
   * The mark is a "home" affordance, and on the home route itself it becomes a
   * hard refresh — the conventional behaviour for clicking a logo on the page
   * it already points at. A client-side `router.push` to the current route is a
   * no-op, so without this the click would appear dead. `location.reload()`
   * re-runs the whole document, which also re-fetches the session and the audit
   * store rather than just re-rendering with the same cached data.
   *
   * Modifier-clicks are left alone so "open in new tab" still works.
   */
  const onLogoClick = React.useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (pathname === HOME_HREF) {
        e.preventDefault();
        window.location.reload();
      }
    },
    [pathname],
  );

  return (
    <aside
      className={cn(
        'z-30 flex flex-col gap-4 border-r border-sidebar-border bg-sidebar px-2 py-[18px]',
        overlay
          ? 'h-full w-full shadow-xl'
          : cn('sticky top-0 h-dvh transition-[width] duration-[180ms] ease-out', collapsed ? 'w-[51px]' : 'w-[224px]'),
      )}
    >
      {overlay ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close navigation"
          className="absolute right-2 top-3 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <CollapseToggle collapsed={collapsed} onToggle={onToggle} />
      )}

      {/* Constant padding and constant child order always — the mark never
          moves; only the text block beside it collapses. `-my-1 py-1` gives the
          hover surface some height without changing the row's contribution to
          the sidebar's flex layout. */}
      <Link
        href={HOME_HREF}
        onClick={onLogoClick}
        title={collapsed ? 'Performance dashboard' : undefined}
        aria-label="AWR Quality Coaching — go to Performance dashboard"
        className={cn(
          '-my-1 flex items-center rounded-md py-1 transition-colors hover:bg-accent',
          collapsed ? 'gap-0 px-[3.5px]' : 'gap-1.5 px-2',
        )}
      >
        <LogoMark className="h-7 w-7" decorative />
        <CollapsibleLabel collapsed={collapsed} className="flex-1">
          <div className="min-w-0 leading-tight">
            <b className="block truncate text-[13px] font-semibold">AWR</b>
            <span className="block truncate text-[11px] text-muted-foreground">Quality Coaching</span>
          </div>
        </CollapsibleLabel>
      </Link>

      <nav className="flex flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          <SectionLabel collapsed={collapsed}>Workspace</SectionLabel>
          {workspace.map((item) => (
            <NavLink key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>
        {admin.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
            {admin.map((item) => (
              item.children
                ? <NavGroup key={item.href} item={item} collapsed={collapsed} />
                : <NavLink key={item.href} {...item} collapsed={collapsed} />
            ))}
          </div>
        )}
      </nav>

      <SidebarFooter collapsed={collapsed} show={settings.length > 0} />
    </aside>
  );
}
