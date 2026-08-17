'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { validateWeights, type CriticalType } from '@awr/shared';
import { loadTemplates, saveTemplates } from './template-store';
import { TEMPLATES, type FormTemplate, type TemplateParam, type MetaField } from './mock-data';
import { api } from './api-client';

/** `GET /api/templates` — the repository row and its parameters. */
interface ApiTemplate {
  id: string; slug: string; name: string; version: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  accountId: string | null;
  lineOfBusiness?: string | null;
  updatedAt?: string;
  _count?: { forms?: number };
  parameters?: { sortOrder: number; criticalType: string; text: string; weight: string | number }[];
}

/** Projects an API template onto the shape the repository screens render. */
function toFormTemplate(t: ApiTemplate): FormTemplate {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    version: t.version,
    status: t.status,
    accountId: t.accountId,
    scope: t.accountId ? 'Account' : 'GLOBAL',
    lineOfBusiness: t.lineOfBusiness ?? '—',
    audits: t._count?.forms ?? 0,
    lastEdited: t.updatedAt ? new Date(t.updatedAt).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }) : '—',
    params: (t.parameters ?? []).map((p) => ({
      sortOrder: p.sortOrder,
      criticalType: p.criticalType as TemplateParam['criticalType'],
      text: p.text,
      weight: Number(p.weight),
    })),
    changeLog: [],
  };
}

export const TYPE_LABEL: Record<CriticalType, string> = {
  CUSTOMER: 'Customer', PROCESS: 'Process', BUSINESS: 'Business', COMPLIANCE: 'Compliance', NON_CRITICAL: 'Non-Critical',
};
export const TYPE_VAR: Record<CriticalType, string> = {
  CUSTOMER: 'var(--cat-customer)', PROCESS: 'var(--cat-process)', BUSINESS: 'var(--cat-business)',
  COMPLIANCE: 'var(--cat-compliance)', NON_CRITICAL: 'var(--muted-foreground)',
};
export const TYPE_OPTIONS = (['CUSTOMER', 'PROCESS', 'BUSINESS', 'COMPLIANCE', 'NON_CRITICAL'] as CriticalType[])
  .map((t) => ({ value: t, label: t === 'NON_CRITICAL' ? TYPE_LABEL[t] : `${TYPE_LABEL[t]} Critical` }));
export const criticalSuffix = (t: CriticalType) => (t === 'NON_CRITICAL' ? TYPE_LABEL[t] : `${TYPE_LABEL[t]} Critical`);

/** The signed-in QA Manager, per the existing seed data's change-log authors. */
export const CURRENT_ACTOR = { name: 'Melody Tagaytay', role: 'QA Manager' };

export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
export const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('');
const editedStamp = () => `${CURRENT_ACTOR.name} · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

export interface NewFormInput {
  name: string; lineOfBusiness: string; global: boolean; metadata?: string;
  metaFields?: MetaField[];
  params?: TemplateParam[];
}

/**
 * All coaching-form-repository mutation logic in one place, shared by the
 * New / Active / Archive subpages so the three don't drift out of sync on
 * what "publish" or "archive" actually does.
 */
export function useTemplateRepository() {
  // Seeded with the static TEMPLATES constant — exactly what the server
  // renders, since `localStorage` doesn't exist there. The real
  // (possibly-edited) list is loaded in an effect below, which only runs
  // after hydration, so the first client render always matches the server's
  // and React never has to reconcile mismatched text.
  const [templates, setTemplatesState] = React.useState<FormTemplate[]>(TEMPLATES);

  /**
   * Loaded from `GET /api/templates`, which returns the account's forms plus
   * the global ones. Falls back to local state only if the request fails, so a
   * dropped connection does not blank the repository mid-edit.
   */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.get<ApiTemplate[]>('/templates?includeUnpublished=true');
        if (!cancelled) setTemplatesState(rows.map(toFormTemplate));
      } catch {
        if (!cancelled) setTemplatesState(loadTemplates());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setTemplates: React.Dispatch<React.SetStateAction<FormTemplate[]>> = React.useCallback((updater) => {
    setTemplatesState((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: FormTemplate[]) => FormTemplate[])(prev) : updater;
      saveTemplates(next);
      return next;
    });
  }, []);

  const updateTemplate = React.useCallback((
    id: string, patch: Partial<FormTemplate>, logEntry?: FormTemplate['changeLog'][number],
  ) => {
    setTemplates((list) => list.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, ...patch, lastEdited: editedStamp() };
      if (logEntry) next.changeLog = [logEntry, ...t.changeLog];
      return next;
    }));
  }, [setTemplates]);

  /** Re-read after any write — the server is the authority on the result. */
  const reload = React.useCallback(async () => {
    try {
      const rows = await api.get<ApiTemplate[]>('/templates?includeUnpublished=true');
      setTemplatesState(rows.map(toFormTemplate));
    } catch {
      // Leave the current list in place rather than blanking the screen.
    }
  }, []);

  const saveParameters = React.useCallback(async (template: FormTemplate, params: TemplateParam[]) => {
    // These two checks stay client-side because they are about the form the
    // user is looking at, and catching them here avoids a round trip. The
    // server re-validates the weights before it will publish, so neither is
    // load-bearing.
    if (template.status === 'PUBLISHED' && template.audits > 0) {
      toast.error("Can't edit a published form that has scored audits", {
        description: 'Editing it in place would change what those audits were measured against — use "New version" instead.',
      });
      return false;
    }
    if (params.some((p) => !p.text.trim())) { toast.error('Every parameter needs text'); return false; }
    const { ok, total } = validateWeights(params.map((p) => p.weight));
    if (!ok) {
      toast.error(`Weights total ${(total * 100).toFixed(1)}%`, { description: 'They must total exactly 100% before this can be saved.' });
      return false;
    }

    try {
      await api.patch(`/templates/${template.id}`, {
        parameters: params.map((p) => ({
          sortOrder: p.sortOrder,
          criticalType: p.criticalType,
          text: p.text,
          weight: p.weight,
        })),
        note: `Edited parameters — now ${params.length}, weights total 100%.`,
      });
      await reload();
      toast.success('Parameters saved');
      return true;
    } catch (err) {
      toast.error('Could not save parameters', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      return false;
    }
  }, [reload]);

  const publish = React.useCallback(async (template: FormTemplate) => {
    if (template.params.length === 0) { toast.error('Add at least one parameter before publishing'); return false; }
    try {
      // The server refuses to publish unless the weights total exactly 1.0 —
      // this is only the early warning.
      await api.post(`/templates/${template.id}/publish`);
      await reload();
      toast.success('Published', { description: `${template.name} is now selectable in Coaching.` });
      return true;
    } catch (err) {
      toast.error('Could not publish', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      return false;
    }
  }, [reload]);

  const archive = React.useCallback(async (template: FormTemplate) => {
    if (!window.confirm(`Archive "${template.name}"? It will no longer be selectable for new audits.`)) return;
    try {
      await api.post(`/templates/${template.id}/archive`, { archived: true });
      await reload();
      toast('Archived', { description: template.name });
    } catch (err) {
      toast.error('Could not archive', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }, [reload]);

  const restore = React.useCallback(async (template: FormTemplate) => {
    try {
      await api.post(`/templates/${template.id}/archive`, { archived: false });
      await reload();
      toast.success('Restored to draft', { description: `${template.name} is back under New for review.` });
    } catch (err) {
      toast.error('Could not restore', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }, [reload]);

  const createVersion = React.useCallback(async (template: FormTemplate, version: string) => {
    try {
      // Forking copies the parameters server-side, so the new draft starts
      // identical to what the old version was scoring against.
      const created = await api.post<ApiTemplate>(`/templates/${template.id}/versions`, { version });
      await reload();
      toast.success('New version created', { description: `v${version}, still a draft.` });
      return toFormTemplate(created);
    } catch (err) {
      toast.error('Could not create version', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      return null;
    }
  }, [reload]);

  const createForm = React.useCallback(async (input: NewFormInput, fromAccountId: string | null = null) => {
    try {
      const created = await api.post<ApiTemplate>('/templates', {
        name: input.name,
        slug: slugify(input.name),
        version: '0.1 DRAFT',
        lineOfBusiness: input.lineOfBusiness,
        accountId: input.global ? null : fromAccountId,
      });
      // Parameters are a separate write: the form must exist before it can
      // have any.
      if (input.params?.length) {
        await api.patch(`/templates/${created.id}`, {
          parameters: input.params.map((p) => ({
            sortOrder: p.sortOrder, criticalType: p.criticalType, text: p.text, weight: p.weight,
          })),
        });
      }
      await reload();
      toast.success('Coaching form created', { description: 'Publish it once the parameters total 100% to make it selectable.' });
      return toFormTemplate(created);
    } catch (err) {
      toast.error('Could not create form', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      return null;
    }
  }, [reload]);

  return { templates, updateTemplate, saveParameters, publish, archive, restore, createVersion, createForm };
}
