'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { useAuditStore, type ApiForm } from '@/lib/audit-store';
import type {
  CoachingRecord, HoldAttempt, SectionCData, SectionDData, SignatureRecord,
} from '@/lib/coaching-store';
import type { AuditStatus } from '@/lib/mock-data';

/**
 * The Coaching page's data, served by the API.
 *
 * Replaces the localStorage draft store. The page is written against
 * `CoachingRecord`, so this maps the API's row and detail onto that shape
 * rather than rewriting a thousand lines of form — the projection is the
 * adapter, and every write goes straight to an endpoint.
 *
 * The list is deliberately shallow: `GET /forms` returns rows, not sections, so
 * only the *selected* record is fetched in full. Loading section C, section D,
 * the observations and the signatures for every row in a queue would be a lot
 * of round trips for a list that only shows names and Call IDs.
 */

/** `GET /api/forms/:id` — the row plus everything hanging off it. */
export interface ApiFormDetail extends ApiForm {
  revision: number;
  parameterResults: {
    sortOrder: number;
    textSnapshot: string;
    weightSnapshot: string | number;
    criticalType: string;
    answer: 'YES' | 'NO' | 'NA';
    observedBehavior: string | null;
  }[];
  holdAttempts: {
    attemptNo: number;
    durationSeconds: number;
    reasonValid: 'YES' | 'NO' | 'NA';
    holdReasonId: string | null;
  }[];
  signatures: {
    signerRole: 'AGENT' | 'SUPERVISOR';
    signedAt: string;
    signerId: string;
  }[];
  rootCauses?: {
    situation: string | null;
    behavior: string | null;
    impact: string;
    coachingPriority: number | null;
    parameterResultId: string | null;
  }[];
  actionPlan?: {
    priority: number;
    activity: string | null;
    deadline: string | null;
    successMeasure: string | null;
    goal: string | null;
  }[];
}

const person = (p: { firstName: string; lastName: string } | null) =>
  p ? `${p.firstName} ${p.lastName}`.trim() : '';

const hhmmss = (secs: number) =>
  [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');

/** The imported audit block, rebuilt from the API row. */
function standardOf(f: ApiForm): Record<string, string> {
  const dispo = f.callReason?.disposition?.name ?? '';
  const reason = f.callReason?.name ?? '';
  return {
    'Agent Name': person(f.agent),
    'EID': f.agent?.eid ?? '',
    'Supervisor': person(f.supervisor),
    'Quality Auditor': person(f.auditor),
    'Call Date': f.callDate?.slice(0, 10) ?? '',
    'Audit Date': f.auditDate?.slice(0, 10) ?? '',
    'Disposition': dispo,
    'Call Reason': reason,
    'Call ID': f.callId,
    'AHT': hhmmss(f.ahtSeconds ?? 0),
    'Total Hold Time': hhmmss(f.totalHoldSeconds ?? 0),
  };
}

/** A list row — enough for the queue and the agent panel, no sections. */
export function rowToRecord(f: ApiForm): CoachingRecord {
  return {
    id: f.id,
    createdAt: f.qaReviewAt ?? '',
    createdBy: person(f.auditor),
    stage: f.status,
    formId: '', formSlug: '', formName: 'Quality Coaching Form', formVersion: '',
    parameterSnapshot: [],
    standard: standardOf(f),
    metaValues: {},
    params: {},
    qaObservations: {},
    holdAttempts: [],
    enteredAt: {},
    trail: [],
  };
}

const signatureOf = (
  d: ApiFormDetail,
  role: 'AGENT' | 'SUPERVISOR',
  name: string,
): SignatureRecord | undefined => {
  const s = d.signatures?.find((x) => x.signerRole === role);
  return s ? { by: name, at: s.signedAt } : undefined;
};

/** The full record for the open form. */
export function detailToRecord(d: ApiFormDetail): CoachingRecord {
  const params: Record<number, 'YES' | 'NO' | 'NA'> = {};
  const qaObservations: Record<number, string> = {};
  for (const p of d.parameterResults ?? []) {
    params[p.sortOrder] = p.answer;
    if (p.observedBehavior) qaObservations[p.sortOrder] = p.observedBehavior;
  }

  const sectionC: SectionCData | undefined = d.rootCauses?.length
    ? {
        rows: d.rootCauses.map((r) => ({
          parameterId: r.coachingPriority ?? 0,
          parameterText: '',
          situation: r.situation ?? 'N/A',
          behavior: r.behavior ?? 'N/A',
          impact: r.impact,
          priority: String(r.coachingPriority ?? ''),
          rootCause: '',
        })),
        rootCauses: [],
      }
    : undefined;

  const sectionD: SectionDData | undefined = d.actionPlan?.length
    ? {
        items: d.actionPlan.map((a) => ({
          rootCause: '',
          activity: a.activity ?? '',
          owner: '',
          deadline: a.deadline?.slice(0, 10) ?? '',
          successMeasure: a.successMeasure ?? '',
          goal: a.goal ?? '',
        })),
      }
    : undefined;

  return {
    ...rowToRecord(d),
    parameterSnapshot: (d.parameterResults ?? []).map((p) => ({
      sortOrder: p.sortOrder,
      text: p.textSnapshot,
      weight: Number(p.weightSnapshot),
      criticalType: p.criticalType as never,
    })),
    params,
    qaObservations,
    holdAttempts: (d.holdAttempts ?? []).map((h) => ({
      start: '',
      end: hhmmss(h.durationSeconds),
      reason: '',
      valid: h.reasonValid,
    })),
    sectionC,
    sectionD,
    opsSignature: signatureOf(d, 'SUPERVISOR', person(d.supervisor)),
    agentSignature: signatureOf(d, 'AGENT', person(d.agent)),
  };
}

/** Seconds from "HH:MM:SS", "MM:SS" or a plain count — the form's inputs. */
function durationSeconds(v: string | undefined): number {
  const t = (v ?? '').trim();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function useCoachingApi() {
  const { audits, refresh: refreshList } = useAuditStore();

  // Queue rows come from the audits list, which the API already scoped.
  const records = React.useMemo(() => audits.map((a) => rowToRecord({
    id: a.id,
    reference: a.ref,
    status: a.status,
    callId: a.ref,
    callDate: a.callDate.toISOString(),
    auditDate: a.auditDate.toISOString(),
    ahtSeconds: a.aht,
    totalHoldSeconds: a.holdSec,
    qaScore: a.score / 100,
    customerCriticalCount: a.errs.customer,
    processCriticalCount: a.errs.process,
    businessCriticalCount: a.errs.business,
    wasSurveyed: a.surveyed,
    surveyScore: a.csat,
    respondentCategory: '',
    controllable: null,
    agent: { id: '', firstName: a.agent.split(' ')[0] ?? '', lastName: a.agent.split(' ').slice(1).join(' '), eid: a.eid },
    supervisor: { id: '', firstName: a.supervisor.split(' ')[0] ?? '', lastName: a.supervisor.split(' ').slice(1).join(' ') },
    auditor: { id: '', firstName: a.auditor.split(' ')[0] ?? '', lastName: a.auditor.split(' ').slice(1).join(' ') },
    qaReviewAt: a.enteredAt.QA_REVIEW?.toISOString() ?? null,
    releasedToOpsAt: a.enteredAt.RELEASED_TO_OPS?.toISOString() ?? null,
    opsCoachingAt: a.enteredAt.OPS_COACHING?.toISOString() ?? null,
    releasedToAgentAt: a.enteredAt.RELEASED_TO_AGENT?.toISOString() ?? null,
    awaitingSignatureAt: a.enteredAt.AWAITING_AGENT_SIGNATURE?.toISOString() ?? null,
    finalizedAt: a.enteredAt.FINALIZED?.toISOString() ?? null,
    voidedAt: a.enteredAt.VOIDED?.toISOString() ?? null,
  })), [audits]);

  const [detail, setDetail] = React.useState<CoachingRecord | null>(null);
  const [detailId, setDetailId] = React.useState<string>('');

  const loadDetail = React.useCallback(async (id: string) => {
    setDetailId(id);
    if (!id) { setDetail(null); return; }
    try {
      const d = await api.get<ApiFormDetail>(`/forms/${id}`);
      setDetail(detailToRecord(d));
    } catch {
      // Out of scope or gone — the page falls back to no selection.
      setDetail(null);
    }
  }, []);

  const reload = React.useCallback(async () => {
    await refreshList();
    if (detailId) await loadDetail(detailId);
  }, [refreshList, detailId, loadDetail]);

  /** QA-owned: observations and hold attempts. */
  const saveQaWork = React.useCallback(async (
    id: string,
    observations: Record<number, string>,
    holds: HoldAttempt[],
  ) => {
    await api.put(`/forms/${id}/observations`, {
      observations: Object.entries(observations).map(([sortOrder, text]) => ({
        sortOrder: Number(sortOrder),
        observedBehavior: text,
      })),
    });
    await api.put(`/forms/${id}/hold-attempts`, {
      attempts: holds
        .filter((h) => h.start || h.end || h.reason)
        .map((h, i) => ({
          attemptNo: i + 1,
          reason: h.reason || null,
          durationSeconds: Math.max(0, durationSeconds(h.end) - durationSeconds(h.start)),
          reasonValid: h.valid,
        })),
    });
  }, []);

  /** Ops TL-owned: sections C and D. */
  const saveCoachingWork = React.useCallback(async (
    id: string,
    sectionC: SectionCData,
    sectionD: SectionDData,
  ) => {
    await api.put(`/forms/${id}/root-causes`, {
      rows: (sectionC.rows ?? [])
        .filter((r) => (r.situation && r.situation !== 'N/A') || (r.behavior && r.behavior !== 'N/A'))
        .map((r, i) => ({
          sortOrder: typeof r.parameterId === 'number' ? r.parameterId : null,
          situation: r.situation,
          behavior: r.behavior,
          impact: 'PROCESS',
          priority: i + 1,
          gap: r.rootCause || null,
        })),
    });
    await api.put(`/forms/${id}/action-plan`, {
      items: (sectionD.items ?? [])
        .filter((it) => it.activity?.trim())
        .map((it, i) => ({
          priority: i + 1,
          activity: it.activity,
          deadline: it.deadline || null,
          successMeasure: it.successMeasure,
          goal: it.goal,
        })),
    });
  }, []);

  /** The role decides which block is signed — the request cannot. */
  const sign = React.useCallback(async (id: string, image: string) => {
    await api.post(`/forms/${id}/sign`, { image });
  }, []);

  const advance = React.useCallback(async (id: string) => {
    return api.post<{ from: AuditStatus; to: AuditStatus }>(`/forms/${id}/advance`);
  }, []);

  return { records, detail, loadDetail, reload, saveQaWork, saveCoachingWork, sign, advance };
}
