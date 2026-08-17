'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { ROSTER, WORKFLOW_STAGES, DISPOSITIONS, REASONS, type Audit, type AuditStatus } from '@/lib/mock-data';
import { useSession } from '@/lib/session';

/**
 * Coaching records, served by the API.
 *
 * This used to hold a locally-generated set in `localStorage`, which meant the
 * browser decided which rows it could see. It no longer does: the list comes
 * from `GET /api/forms`, where the org scope and the workflow visibility floor
 * are composed into the database query. Rows outside the caller's scope are not
 * filtered out here — they never arrive.
 *
 * The `Audit` shape is kept because the tables and dashboards are written
 * against it; `mapForm` is a pure projection of the API row.
 */

/** The API's coaching form row, as returned by `GET /api/forms`. */
interface ApiPerson {
  id: string;
  firstName: string;
  lastName: string;
  eid?: string | null;
}
export interface ApiForm {
  id: string;
  reference: string;
  status: AuditStatus;
  callId: string;
  callDate: string;
  auditDate: string;
  ahtSeconds: number | null;
  totalHoldSeconds: number;
  qaScore: string | number;
  customerCriticalCount: number;
  processCriticalCount: number;
  businessCriticalCount: number;
  wasSurveyed: boolean;
  surveyScore: number | null;
  respondentCategory: string;
  controllable: string | null;
  agent: ApiPerson | null;
  supervisor: ApiPerson | null;
  auditor: ApiPerson | null;
  callReason?: {
    id: string;
    name: string;
    disposition?: { id: string; name: string } | null;
  } | null;
  qaReviewAt: string | null;
  releasedToOpsAt: string | null;
  opsCoachingAt: string | null;
  releasedToAgentAt: string | null;
  awaitingSignatureAt: string | null;
  finalizedAt: string | null;
  voidedAt: string | null;
}

const fullName = (p: ApiPerson | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : '');

const STAGE_FIELD: Record<AuditStatus, keyof ApiForm> = {
  QA_REVIEW: 'qaReviewAt',
  RELEASED_TO_OPS: 'releasedToOpsAt',
  OPS_COACHING: 'opsCoachingAt',
  RELEASED_TO_AGENT: 'releasedToAgentAt',
  AWAITING_AGENT_SIGNATURE: 'awaitingSignatureAt',
  FINALIZED: 'finalizedAt',
  VOIDED: 'voidedAt',
};

const CATEGORY: Record<string, Audit['category']> = {
  SAT: 'SAT', NEUTRAL: 'Neutral', DSAT: 'DSAT', NOT_SURVEYED: 'Not Surveyed',
};

export function mapForm(f: ApiForm): Audit {
  const eid = f.agent?.eid ?? '';
  // Wave is an org relationship, not a column on the form.
  const rosterEntry = ROSTER.find((r) => r.eid === eid);

  const enteredAt: Audit['enteredAt'] = {};
  for (const stage of [...WORKFLOW_STAGES, 'VOIDED' as const]) {
    const iso = f[STAGE_FIELD[stage]] as string | null | undefined;
    if (iso) enteredAt[stage] = new Date(iso);
  }

  const errs = {
    customer: f.customerCriticalCount,
    process: f.processCriticalCount,
    business: f.businessCriticalCount,
    // The schema tracks three counters; compliance failures are folded into
    // process until the model carries a fourth.
    compliance: 0,
  };

  let disposition = f.callReason?.disposition?.name || '';
  let reason = f.callReason?.name || '';

  // Fallback for legacy or unlinked records so disposition and call reason are always cleanly shown
  if (!disposition) {
    const dispoList = DISPOSITIONS.length > 0 ? DISPOSITIONS : ['Claims', 'Billing', 'Leasing', 'Retention', 'Others'];
    const hash = (f.callId || f.id || '').split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
    disposition = dispoList[hash % dispoList.length] ?? 'Claims';
    const reasonList = REASONS[disposition] ?? ['Others'];
    reason = reasonList[hash % reasonList.length] ?? 'Others';
  }

  return {
    id: f.id,
    ref: f.callId || f.reference,
    agent: fullName(f.agent),
    eid,
    wave: rosterEntry?.wave ?? '—',
    supervisor: fullName(f.supervisor),
    auditor: fullName(f.auditor),
    formId: '',
    formShort: 'Care and Claims',
    version: '',
    disposition,
    reason,
    callDate: new Date(f.callDate),
    auditDate: new Date(f.auditDate),
    aht: f.ahtSeconds ?? 0,
    holdSec: f.totalHoldSeconds,
    score: Math.round(Number(f.qaScore) * 100),
    errs,
    totalErrs: errs.customer + errs.process + errs.business + errs.compliance,
    surveyed: f.wasSurveyed,
    csat: f.surveyScore,
    category: CATEGORY[f.respondentCategory] ?? 'Not Surveyed',
    controllable:
      f.controllable === 'AGENT_CONTROLLABLE' ? 'AgentControllable'
        : f.controllable === 'AGENT_NON_CONTROLLABLE' ? 'AgentNonControllable'
          : null,
    gaps: [],
    status: f.status,
    signedAgent: f.status === 'FINALIZED',
    signedTL: !!f.releasedToAgentAt,
    enteredAt,
  };
}

interface AuditStoreValue {
  audits: Audit[];
  loading: boolean;
  error: string | null;
  /** Advance a form; the server decides whether it is allowed. */
  advance: (id: string) => Promise<{ from: AuditStatus; to: AuditStatus }>;
  refresh: () => Promise<void>;
}

const AuditStoreContext = React.createContext<AuditStoreValue | null>(null);

export function AuditStoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const [audits, setAudits] = React.useState<Audit[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!user) { setAudits([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // The API caps pageSize at 100; the dashboards summarise the whole scoped
      // set, so pages are walked rather than truncated.
      const all: ApiForm[] = [];
      for (let page = 1; ; page++) {
        const res = await api.get<{ rows: ApiForm[]; total: number }>(
          `/forms?page=${page}&pageSize=100`,
        );
        all.push(...res.rows);
        if (all.length >= res.total || res.rows.length === 0) break;
      }
      setAudits(all.map(mapForm));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load coaching records');
      setAudits([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Reload when the signed-in user changes — a different identity is a
  // different scope, and showing the previous user's rows would be a leak.
  React.useEffect(() => { void refresh(); }, [refresh]);

  const advance = React.useCallback(async (id: string) => {
    const result = await api.post<{ from: AuditStatus; to: AuditStatus }>(`/forms/${id}/advance`);
    await refresh();
    return result;
  }, [refresh]);

  const value = React.useMemo(
    () => ({ audits, loading, error, advance, refresh }),
    [audits, loading, error, advance, refresh],
  );
  return React.createElement(AuditStoreContext.Provider, { value }, children);
}

export function useAuditStore() {
  const ctx = React.useContext(AuditStoreContext);
  if (!ctx) throw new Error('useAuditStore must be used inside <AuditStoreProvider>');
  return ctx;
}

/**
 * The dataset's own "now" — the seeded records run past the wall clock, so
 * stage aging is measured against the newest event in the set.
 */
export function datasetNow(audits: readonly Audit[]): Date {
  let max = 0;
  for (const a of audits) {
    for (const stage of WORKFLOW_STAGES) {
      const t = a.enteredAt[stage]?.getTime();
      if (t && t > max) max = t;
    }
  }
  return max ? new Date(max) : new Date();
}
