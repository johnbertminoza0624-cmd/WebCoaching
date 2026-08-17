import { redirect } from 'next/navigation';

/**
 * The dashboard is now two separate surfaces — Performance (audit quality) and
 * Coaching (workflow status). The old combined route lands on Performance so
 * existing links and bookmarks keep working.
 */
export default function DashboardIndex() {
  redirect('/dashboard/performance');
}
