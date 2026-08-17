import type { Page } from '@awr/shared';

export interface NavChild {
  href: string;
  label: string;
}

export interface NavItem {
  href: string;
  label: string;
  /** Which authorization page this entry maps to. The sidebar renders an entry
   * only when the current role may open it, so the rail never advertises a
   * destination that would refuse the user on arrival. */
  page: Page;
  icon: 'grid' | 'file' | 'sign' | 'chart' | 'users' | 'repo' | 'audit' | 'upload' | 'settings';
  /** Token driving the icon's color — decorative only, not a status encoding,
   * so reuse of the general-purpose --chart-* ramp (rather than the reserved
   * --cat-* critical-error hues or --status-* semantic colors) is fine here. */
  color: string;
  /** Nested routes shown indented under the parent, expandable in the rail. */
  children?: NavChild[];
}

export const WORKSPACE_NAV: NavItem[] = [
  { href: '/dashboard/performance', label: 'Performance', page: 'performance-dashboard', icon: 'grid', color: 'var(--chart-1)' },
  { href: '/dashboard/coaching', label: 'Coaching status', page: 'coaching-dashboard', icon: 'chart', color: 'var(--chart-3)' },
  { href: '/coaching', label: 'Coaching', page: 'coaching', icon: 'file', color: 'var(--chart-5)' },
  { href: '/upload', label: 'Audit upload', page: 'audits-upload', icon: 'upload', color: 'var(--chart-2)' },
  { href: '/audits', label: 'Audits', page: 'audits', icon: 'audit', color: 'var(--chart-2)' },
  { href: '/signatures', label: 'Signatures', page: 'signature', icon: 'sign', color: 'var(--chart-4)' },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Users & roles', page: 'users-roles', icon: 'users', color: 'var(--primary)' },
  {
    href: '/repository/active', label: 'Form repository', page: 'repository', icon: 'repo', color: 'var(--chart-3)',
    children: [
      { href: '/repository/new', label: 'New' },
      { href: '/repository/active', label: 'Active' },
      { href: '/repository/archive', label: 'Archive' },
    ],
  },
];

/**
 * Pinned to the bottom of the rail, below a spacer. Account-level settings are
 * not workspace navigation and not administration — they belong to the signed-
 * in person, so they sit apart from both groups rather than competing with them
 * for attention at the top.
 *
 * The footer renders `<SettingsMenu>` rather than mapping these, so there are
 * deliberately no `children` here — the items live in the popover. This entry
 * exists so the footer is still gated by the same `canAccessPage` check as
 * every other part of the rail.
 */
export const SETTINGS_NAV: NavItem[] = [
  { href: '/settings/password', label: 'Settings', page: 'settings', icon: 'settings', color: 'var(--muted-foreground)' },
];

/** Route -> authorization page, so a directly-typed URL is guarded too. */
export const ROUTE_PAGE: Record<string, Page> = {
  '/dashboard': 'performance-dashboard',
  '/dashboard/performance': 'performance-dashboard',
  '/dashboard/coaching': 'coaching-dashboard',
  '/coaching': 'coaching',
  '/upload': 'audits-upload',
  '/audits': 'audits',
  '/signatures': 'signature',
  '/admin': 'users-roles',
  '/repository': 'repository',
  '/repository/new': 'repository',
  '/repository/active': 'repository',
  '/repository/archive': 'repository',
  '/settings': 'settings',
  '/settings/password': 'settings',
};

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/performance': 'Performance dashboard',
  '/dashboard/coaching': 'Coaching dashboard',
  '/coaching': 'Coaching',
  '/upload': 'Audit upload',
  '/audits': 'Audits',
  '/signatures': 'Signatures',
  '/admin': 'Users & roles',
  '/repository/new': 'Form repository — New',
  '/repository/active': 'Form repository — Active',
  '/repository/archive': 'Form repository — Archive',
  '/settings': 'Settings',
  '/settings/password': 'Settings — Change password',
};
