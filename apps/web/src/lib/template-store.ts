import { TEMPLATES, type FormTemplate } from './mock-data';

/**
 * Shared template state across pages, without a backend yet.
 *
 * Without this, publishing a form in the Repository page would only ever
 * change that page's own React state — the Coaching page's picker reads a
 * separate copy and would never see it. Since there's no API to be the single
 * source of truth, localStorage plays that role for the duration of the
 * browser session: both pages read the same persisted list on mount, so an
 * action taken in one is visible in the other on next navigation.
 */
const KEY = 'awr:templates';

export function loadTemplates(): FormTemplate[] {
  if (typeof window === 'undefined') return TEMPLATES;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return TEMPLATES;
    const parsed = JSON.parse(raw) as FormTemplate[];
    return Array.isArray(parsed) && parsed.length ? parsed : TEMPLATES;
  } catch {
    return TEMPLATES;
  }
}

export function saveTemplates(templates: FormTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates));
  } catch {
    // Storage unavailable (private browsing, quota) — edits stay in memory
    // for this page load, which is a reasonable degradation.
  }
}
