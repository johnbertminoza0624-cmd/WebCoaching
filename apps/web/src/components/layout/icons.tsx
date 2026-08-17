import {
  LayoutGrid, FileText, PenLine, LineChart, Users, Archive,
  ClipboardCheck, FileUp, Settings, type LucideIcon,
} from 'lucide-react';
import type { NavItem } from './nav-items';

/**
 * One glyph per destination. `chart` used to be shared by Coaching status and
 * Audits, so the rail drew the same line-chart icon twice and the eye had only
 * the label to go on. Audits is a register of scored transactions, not a trend,
 * so it takes `audit` (a checked clipboard).
 *
 * `upload` replaces the old `list` (ListChecks) on Audit upload for two
 * reasons: a checklist describes the Audits register far better than it
 * describes an upload step, and leaving it in place would have put two
 * near-identical check-mark glyphs next to each other once Audits took one.
 */
export const NAV_ICONS: Record<NavItem['icon'], LucideIcon> = {
  grid: LayoutGrid,
  file: FileText,
  sign: PenLine,
  chart: LineChart,
  users: Users,
  repo: Archive,
  audit: ClipboardCheck,
  upload: FileUp,
  settings: Settings,
};
