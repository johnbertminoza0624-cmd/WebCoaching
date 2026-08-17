'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { X, Lock, SearchX, Search } from 'lucide-react';
import {
  Card, CardHeader, CardBody, Badge, Button, StripeRow, KpiTile,
  PageActions, EmptyState, Table, Th, Td, Field, Input, Skeleton,
} from '@/components/ui/primitives';
import { PageLoader } from '@/components/ui/page-loader';
import { MultiSelectFacet, type FacetOption } from '@/components/ui/multi-select-facet';
import {
  STATUS_LABEL, STATUS_VARIANT, WORKFLOW_STAGES, STAGE_OWNER, NEXT_STAGE, ACTION_LABEL,
  ROLE_LABELS, scoreBand, BAND_ORDER, formatSecs, formatDate,
  auditsToCsv, downloadCsv, TEMPLATES, type Audit, type AuditStatus,
} from '@/lib/mock-data';
import { useAuditStore } from '@/lib/audit-store';
import type { CoachingRecord } from '@/lib/coaching-store';
import { api } from '@/lib/api-client';
import { useAuthedSession } from '@/lib/session';
import { getProfileSignature } from '@/lib/signature-store';
import { auditAction, ACTION_LABELS } from '@awr/shared';

const PAGE_SIZE = 20;

type FacetKey =
  | 'agent' | 'supervisor' | 'wave' | 'auditor' | 'form' | 'disposition' | 'reason'
  | 'status' | 'band' | 'errType' | 'category' | 'controllable' | 'gap' | 'signature' | 'hold';

interface FacetDef {
  key: FacetKey;
  label: string;
  get: (a: Audit) => string | string[];
  order?: string[];
}

const FACETS: FacetDef[] = [
  { key: 'agent', label: 'Agent', get: (a) => a.agent },
  { key: 'supervisor', label: 'Team lead', get: (a) => a.supervisor },
  { key: 'wave', label: 'Wave', get: (a) => a.wave },
  { key: 'auditor', label: 'QA auditor', get: (a) => a.auditor },
  { key: 'form', label: 'Coaching form', get: (a) => a.formShort },
  { key: 'disposition', label: 'Disposition', get: (a) => a.disposition },
  { key: 'reason', label: 'Call reason', get: (a) => a.reason },
  // Ordered by the workflow itself, so the facet reads as a pipeline rather
  // than alphabetically. Values are labels, not raw enum names.
  {
    key: 'status', label: 'Workflow stage', get: (a) => STATUS_LABEL[a.status],
    order: [...WORKFLOW_STAGES.map((s) => STATUS_LABEL[s]), STATUS_LABEL.VOIDED],
  },
  { key: 'band', label: 'Score band', get: (a) => scoreBand(a.score), order: BAND_ORDER },
  {
    key: 'errType', label: 'Critical error', get: (a) => {
      const t: string[] = [];
      if (a.errs.customer) t.push('Customer Critical');
      if (a.errs.process) t.push('Process Critical');
      if (a.errs.business) t.push('Business Critical');
      if (a.errs.compliance) t.push('Compliance Critical');
      if (!t.length) t.push('No critical errors');
      return t;
    },
  },
  { key: 'category', label: 'CSAT', get: (a) => a.category },
  { key: 'controllable', label: 'Controllable', get: (a) => a.controllable ?? 'Not applicable' },
  { key: 'gap', label: 'Root cause', get: (a) => (a.gaps.length ? a.gaps : ['No gap logged']) },
  {
    key: 'signature', label: 'Signatures',
    get: (a) => (a.signedAgent && a.signedTL ? 'Fully signed' : a.signedAgent ? 'Awaiting team lead' : 'Awaiting agent'),
  },
  { key: 'hold', label: 'Hold time', get: (a) => (a.holdSec > 0 ? 'Had holds' : 'No holds') },
];

type FilterState = Record<FacetKey, Set<string>>;
const emptyFilters = (): FilterState =>
  Object.fromEntries(FACETS.map((f) => [f.key, new Set<string>()])) as FilterState;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      <span className="text-[13px]">{value}</span>
    </div>
  );
}

const CRIT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  CUSTOMER:   { bg: 'bg-[var(--cat-customer)]/15',   text: 'text-[var(--cat-customer)]',   label: 'Customer' },
  PROCESS:    { bg: 'bg-[var(--cat-process)]/15',    text: 'text-[var(--cat-process)]',    label: 'Process' },
  BUSINESS:   { bg: 'bg-[var(--cat-business)]/15',   text: 'text-[var(--cat-business)]',   label: 'Business' },
  COMPLIANCE: { bg: 'bg-[var(--cat-compliance)]/15', text: 'text-[var(--cat-compliance)]', label: 'Compliance' },
};


/** `GET /api/forms/:id` — the list row plus its scored parameters and holds. */
interface FormDetail {
  id: string;
  parameterResults: {
    sortOrder: number;
    textSnapshot: string;
    weightSnapshot: string | number;
    criticalType: string;
    answer: 'YES' | 'NO' | 'NA';
    observedBehavior: string | null;
  }[];
  holdAttempts: { attemptNo: number; reason: string | null; durationSeconds: number }[];
}

/**
 * Projects the API detail into the shape the drawer renders.
 *
 * Section C and D are deliberately absent: they live in the `RootCause` and
 * `ActionPlanItem` tables, which no endpoint exposes yet. Leaving them
 * undefined makes those panels show their empty state, which is honest —
 * filling them from local drafts would show data the server has never seen.
 */
function detailToRecord(d: FormDetail): CoachingRecord {
  const qaObservations: Record<number, string> = {};
  const params: Record<number, 'YES' | 'NO' | 'NA'> = {};
  for (const p of d.parameterResults) {
    params[p.sortOrder] = p.answer;
    if (p.observedBehavior) qaObservations[p.sortOrder] = p.observedBehavior;
  }
  return {
    id: d.id,
    createdAt: '', createdBy: '', stage: 'QA_REVIEW',
    formId: '', formSlug: '', formName: '', formVersion: '',
    parameterSnapshot: d.parameterResults.map((p) => ({
      sortOrder: p.sortOrder,
      text: p.textSnapshot,
      weight: Number(p.weightSnapshot),
    })),
    standard: {}, metaValues: {}, params, qaObservations,
    holdAttempts: d.holdAttempts.map((h) => ({
      start: '', end: '', reason: h.reason ?? '', valid: 'NA' as const,
    })),
    enteredAt: {}, trail: [],
  };
}

// ─── Full-detail drawer ─────────────────────────────────────────────────────────

function AuditDrawer({ audit, onClose }: { audit: Audit | null; onClose: () => void }) {
  const open = audit !== null;

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const a = audit;

  /**
   * Full detail is a separate fetch: the list endpoint returns rows, not the
   * parameter results and hold attempts this panel shows.
   *
   * The request is scoped server-side, so opening a record the user may not
   * see returns 404 rather than data — the drawer simply shows nothing.
   */
  const [rec, setRec] = React.useState<CoachingRecord | null>(null);

  React.useEffect(() => {
    if (!a) { setRec(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await api.get<FormDetail>(`/forms/${a.id}`);
        if (!cancelled) setRec(detailToRecord(detail));
      } catch {
        if (!cancelled) setRec(null);
      }
    })();
    return () => { cancelled = true; };
  }, [a]);
  const template = a ? TEMPLATES.find((t) => t.id === a.formId) ?? null : null;

  const scoreColor = !a ? '' : a.score >= 90 ? 'text-[var(--status-good)]' : a.score >= 80 ? 'text-[var(--status-warn)]' : 'text-destructive';
  const scoreBg   = !a ? '' : a.score >= 90 ? 'bg-[var(--status-good-surface)]' : a.score >= 80 ? 'bg-[var(--status-warn-surface)]' : 'bg-[var(--status-critical-surface)]';
  const scoreBar  = !a ? 'var(--muted)' : a.score >= 90 ? 'var(--status-good)' : a.score >= 80 ? 'var(--status-warn)' : 'var(--status-critical)';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      {/* Drawer panel — 680 px wide for full detail */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Audit full detail"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[680px] flex-col bg-card shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {!a ? null : (
          <>
            {/* ── Header ── */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11.5px] text-muted-foreground">{a.ref.toUpperCase()}</span>
                  <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  {template && <Badge variant="outline">{template.name.replace('Quality Coaching Form — ', '')}</Badge>}
                </div>
                <h2 className="mt-1 text-[17px] font-semibold leading-snug">{a.agent}</h2>
                <p className="text-[12px] text-muted-foreground">{a.eid} · {a.wave} · Supervised by {a.supervisor}</p>
              </div>
              <button
                onClick={onClose}
                id="audit-drawer-close"
                className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close detail panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Score hero ── */}
              <div className={`flex flex-wrap items-center gap-5 px-5 py-5 ${scoreBg}`}>
                <div className={`text-[48px] font-bold tabular-nums leading-none ${scoreColor}`}>
                  {a.score}<span className="text-[26px]">%</span>
                </div>
                <div>
                  <p className={`text-[14px] font-semibold ${scoreColor}`}>{scoreBand(a.score)}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {a.totalErrs === 0 ? 'No critical errors' : `${a.totalErrs} critical error${a.totalErrs > 1 ? 's' : ''}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {a.errs.customer > 0 && (
                    <span className="rounded-md bg-[var(--cat-customer)]/20 px-2.5 py-1 text-[12px] font-semibold text-[var(--cat-customer)]">Customer x{a.errs.customer}</span>
                  )}
                  {a.errs.process > 0 && (
                    <span className="rounded-md bg-[var(--cat-process)]/20 px-2.5 py-1 text-[12px] font-semibold text-[var(--cat-process)]">Process x{a.errs.process}</span>
                  )}
                  {a.errs.business > 0 && (
                    <span className="rounded-md bg-[var(--cat-business)]/20 px-2.5 py-1 text-[12px] font-semibold text-[var(--cat-business)]">Business x{a.errs.business}</span>
                  )}
                  {a.errs.compliance > 0 && (
                    <span className="rounded-md bg-[var(--cat-compliance)]/20 px-2.5 py-1 text-[12px] font-semibold text-[var(--cat-compliance)]">Compliance x{a.errs.compliance}</span>
                  )}
                  {a.totalErrs === 0 && (
                    <span className="rounded-md bg-[var(--status-good-surface)] px-2.5 py-1 text-[12px] font-semibold text-[var(--status-good)]">All passed</span>
                  )}
                </div>
                {/* Score bar */}
                <div className="w-full">
                  <div className="h-2 overflow-hidden rounded-full bg-black/10">
                    <div className="h-full rounded-full transition-[width]" style={{ width: `${a.score}%`, background: scoreBar }} />
                  </div>
                </div>
              </div>

              <div className="px-5 py-5 flex flex-col gap-6">

                {/* ── Audit information (read-only) ── */}
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Audit information</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg border border-border bg-muted/30 px-4 py-4 sm:grid-cols-3">
                    <DetailRow label="Agent name" value={<b>{a.agent}</b>} />
                    <DetailRow label="Employee ID" value={<span className="font-mono">{a.eid}</span>} />
                    <DetailRow label="Wave / Team" value={a.wave} />
                    <DetailRow label="Supervisor" value={a.supervisor} />
                    <DetailRow label="QA Auditor" value={a.auditor} />
                    <DetailRow label="Audit date" value={formatDate(a.auditDate)} />
                    <DetailRow label="Coaching form" value={<Badge variant="outline">{a.formShort}</Badge>} />
                    <DetailRow label="Form version" value={<span className="font-mono">{a.version}</span>} />
                    <DetailRow label="Disposition" value={a.disposition} />
                    <DetailRow label="Call reason" value={a.reason} />
                    <DetailRow label="Call date" value={formatDate(a.callDate)} />
                    <DetailRow label="AHT" value={<span className="font-mono">{formatSecs(a.aht)}</span>} />
                    <DetailRow label="Hold time" value={a.holdSec > 0 ? <span className="font-mono">{formatSecs(a.holdSec)}</span> : <span className="text-muted-foreground">No holds</span>} />
                    <DetailRow label="Reference" value={<span className="font-mono">{a.ref.toUpperCase()}</span>} />
                    <DetailRow label="Status" value={<Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABEL[a.status]}</Badge>} />
                  </div>
                </section>

                {/* ── Audit parameters table ── */}
                {template && (
                  <section>
                    <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Audit parameters
                      <span className="ml-2 font-normal normal-case text-muted-foreground/70">— {template.params.length} parameters · {a.totalErrs} critical error{a.totalErrs !== 1 ? 's' : ''}</span>
                    </h3>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="w-8 border-b border-border bg-muted/40 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">#</th>
                            <th className="border-b border-border bg-muted/40 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Parameter</th>
                            <th className="w-24 border-b border-border bg-muted/40 px-3 py-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Type</th>
                            <th className="w-16 border-b border-border bg-muted/40 px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Weight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {template.params.map((p) => {
                            const style: { bg: string; text: string; label: string } = CRIT_STYLES[p.criticalType] ?? CRIT_STYLES.PROCESS!;
                            return (
                              <tr key={p.sortOrder} className="align-top">
                                <td className="border-b border-border px-3 py-2.5 font-mono text-[11px] text-muted-foreground">P{p.sortOrder}</td>
                                <td className="border-b border-border px-3 py-2.5 text-[12.5px]">{p.text}</td>
                                <td className="border-b border-border px-3 py-2.5 text-center">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${style.bg} ${style.text}`}>
                                    {style.label}
                                  </span>
                                </td>
                                <td className="border-b border-border px-3 py-2.5 text-right font-mono text-[12px] text-muted-foreground">
                                  {Math.round(p.weight * 100)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* ── CSAT / Survey ── */}
                <section>
                  <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Survey / CSAT</h3>
                  {!a.surveyed ? (
                    <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">This call was not surveyed.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-x-8 gap-y-4 rounded-lg border border-border bg-muted/30 px-4 py-4">
                      <DetailRow label="Surveyed" value={<Badge variant="good">Yes</Badge>} />
                      <DetailRow label="CSAT score" value={<span className="font-mono font-semibold text-[14px]">{a.csat} / 5</span>} />
                      <DetailRow label="Category" value={
                        <Badge variant={a.category === 'SAT' ? 'good' : a.category === 'DSAT' ? 'critical' : 'muted'}>
                          {a.category}
                        </Badge>
                      } />
                      {a.controllable && (
                        <DetailRow label="Agent controllable" value={
                          a.controllable === 'AgentControllable'
                            ? <Badge variant="warn">Agent Controllable</Badge>
                            : <Badge variant="muted">Non-Controllable</Badge>
                        } />
                      )}
                    </div>
                  )}
                </section>

                {/* ── Hold time ── */}
                <section>
                  <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Hold time</h3>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-4">
                    {a.holdSec === 0 ? (
                      <p className="text-[13px] text-muted-foreground">No hold time recorded for this call.</p>
                    ) : (
                      <div className="flex items-center gap-6">
                        <DetailRow label="Total hold time" value={<span className="font-mono font-semibold text-[14px]">{formatSecs(a.holdSec)}</span>} />
                        <Badge variant="warn">Had holds</Badge>
                      </div>
                    )}
                  </div>
                </section>

                {/* ── Section C: Root cause analysis ── */}
                {rec?.sectionC?.rows && rec.sectionC.rows.length > 0 && (
                  <section>
                    <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">C. Root Cause Analysis</h3>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="bg-muted/50 text-muted-foreground border-b border-border">
                            <th className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Parameter</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Situation</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Behavior</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Impact</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Priority</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Root Cause</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card">
                          {rec.sectionC.rows.map((row, idx) => (
                            <tr key={idx} className="align-top text-[11.5px]">
                              <td className="p-2 font-medium text-foreground">{row.parameterText}</td>
                              <td className="p-2 text-muted-foreground">{row.situation || '—'}</td>
                              <td className="p-2 text-muted-foreground">{row.behavior || '—'}</td>
                              <td className="p-2 text-muted-foreground">{row.impact || '—'}</td>
                              <td className="p-2 font-medium">
                                <span className={row.priority === 'High' ? 'text-destructive font-semibold' : row.priority === 'Medium' ? 'text-[var(--status-warn)]' : 'text-muted-foreground'}>
                                  {row.priority || '—'}
                                </span>
                              </td>
                              <td className="p-2 font-medium text-foreground">{row.rootCause || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* ── Section D: SMART Action Plan ── */}
                {rec?.sectionD?.items && rec.sectionD.items.length > 0 && (
                  <section>
                    <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">D. SMART Action Plan</h3>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="bg-muted/50 text-muted-foreground border-b border-border">
                            <th className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Root Cause</th>
                            <th className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Activity</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Owner</th>
                            <th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Deadline</th>
                            <th className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Success Measurement</th>
                            <th className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.055em]">Goal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card">
                          {rec.sectionD.items.map((it, idx) => (
                            <tr key={idx} className="align-top text-[11.5px]">
                              <td className="p-2 font-medium text-foreground">{it.rootCause || '—'}</td>
                              <td className="p-2 text-foreground">{it.activity || '—'}</td>
                              <td className="p-2 text-muted-foreground">{it.owner || '—'}</td>
                              <td className="p-2 font-mono text-muted-foreground">{it.deadline || '—'}</td>
                              <td className="p-2 text-muted-foreground">{it.successMeasure || '—'}</td>
                              <td className="p-2 text-muted-foreground">{it.goal || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* ── Section E: Acknowledgement & Commitment (Signatures) ── */}
                <section>
                  <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">E. Acknowledgement and Commitment</h3>
                  <div className="grid grid-cols-1 border border-border sm:grid-cols-2 rounded-lg overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border">
                    {/* Agent Block */}
                    <div className="flex flex-col justify-between p-4 gap-4 bg-card">
                      <div className="flex flex-col gap-2">
                        <span className="text-[11.5px] font-semibold uppercase tracking-wider text-foreground">
                          Agent Acknowledgement
                        </span>
                        <p className="text-[11px] italic text-muted-foreground leading-relaxed">
                          I acknowledge that the behaviors and performance items discussed during this coaching session were based on observations from Quality Monitoring.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 pt-2 border-t border-border/80 text-[11.5px]">
                        <span className="text-[11px] font-medium text-foreground">Agent&apos;s Signature</span>
                        {rec?.agentSignature?.at ? (
                          <div className="py-1">
                            <img
                              src={rec.agentSignature.signatureImage || getProfileSignature(rec.agentSignature.by, rec.agentSignature.by).src}
                              alt="Agent Signature"
                              className="h-10 max-w-[180px] object-contain rounded-md border border-border/80 bg-white p-1 shadow-sm"
                            />
                          </div>
                        ) : (
                          <span className="italic text-muted-foreground text-[11px]">Signature pending</span>
                        )}
                        <div className="flex justify-between gap-2 text-[11px] pt-1">
                          <span className="text-muted-foreground">Name: <b className="text-foreground font-medium">{rec?.agentSignature?.by || a.agent}</b></span>
                          <span className="text-muted-foreground">Date: <b className="text-foreground font-medium">{rec?.agentSignature?.at ? new Date(rec.agentSignature.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</b></span>
                        </div>
                      </div>
                    </div>

                    {/* Supervisor Block */}
                    <div className="flex flex-col justify-between p-4 gap-4 bg-card">
                      <div className="flex flex-col gap-2">
                        <span className="text-[11.5px] font-semibold uppercase tracking-wider text-foreground">
                          Team Leader Acknowledgement
                        </span>
                        <p className="text-[11px] italic text-muted-foreground leading-relaxed">
                          I acknowledge the observations and findings from the Quality Monitoring results and commit to creating and executing SMART action plans.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 pt-2 border-t border-border/80 text-[11.5px]">
                        <span className="text-[11px] font-medium text-foreground">Supervisor&apos;s Signature</span>
                        {rec?.opsSignature?.at ? (
                          <div className="py-1">
                            <img
                              src={rec.opsSignature.signatureImage || getProfileSignature(rec.opsSignature.by, rec.opsSignature.by).src}
                              alt="Supervisor Signature"
                              className="h-10 max-w-[180px] object-contain rounded-md border border-border/80 bg-white p-1 shadow-sm"
                            />
                          </div>
                        ) : (
                          <span className="italic text-muted-foreground text-[11px]">Signature pending</span>
                        )}
                        <div className="flex justify-between gap-2 text-[11px] pt-1">
                          <span className="text-muted-foreground">Name: <b className="text-foreground font-medium">{rec?.opsSignature?.by || a.supervisor}</b></span>
                          <span className="text-muted-foreground">Date: <b className="text-foreground font-medium">{rec?.opsSignature?.at ? new Date(rec.opsSignature.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</b></span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

              </div>
            </div>

            <WorkflowActionBar audit={a} />
          </>
        )}
      </div>
    </>
  );
}

/**
 * Moves the record to the next workflow stage.
 *
 * Only the role that owns the current stage may advance it, which is what makes
 * the dashboards trustworthy: a stage count can only change when the person
 * responsible for that stage acts. The transition writes straight to the shared
 * store, so every dashboard recomputes from the new stage immediately.
 */
function WorkflowActionBar({ audit }: { audit: Audit }) {
  const { user } = useAuthedSession();
  const { advance } = useAuditStore();

  const next = NEXT_STAGE[audit.status];
  const owner = STAGE_OWNER[audit.status];
  const canAct = next !== null && owner !== null
    && (user.role === owner || (owner === 'QA' && user.role === 'QA_TEAM_LEAD'));

  if (!next || !owner) {
    return (
      <div className="shrink-0 border-t border-border px-5 py-3.5 text-[12.5px] text-muted-foreground">
        {audit.status === 'FINALIZED'
          ? 'Finalized — acknowledged by the agent. No further action.'
          : 'Voided. This record is excluded from all workflow metrics.'}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border px-5 py-3.5">
      <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
        {canAct
          ? <>Next: <b className="font-semibold text-foreground">{ACTION_LABEL[audit.status]}</b></>
          : <>Waiting on the <b className="font-semibold text-foreground">{ROLE_LABELS[owner]}</b> to {ACTION_LABEL[audit.status]!.toLowerCase()}.</>}
      </p>
      <Button size="sm" variant="primary" disabled={!canAct}
        onClick={async () => {
          try {
            // The server re-checks stage ownership and the observation rule;
            // `canAct` only decides whether to offer the button.
            const moved = await advance(audit.id);
            toast.success(ACTION_LABEL[audit.status], {
              description: `${audit.agent} · now at ${STATUS_LABEL[moved.to]}.`,
            });
          } catch (err) {
            toast.error('Could not release', {
              description: err instanceof Error ? err.message : 'Please try again.',
            });
          }
        }}>
        {ACTION_LABEL[audit.status]}
      </Button>
    </div>
  );
}

/**
 * One action per row, decided by the viewer's role and the record's stage.
 *
 * `NONE` renders a dash rather than a disabled button: an agent has no business
 * knowing a coaching exists before it reaches them, so there is nothing to grey
 * out. Coach and Sign route into the Coaching page for that record; Quick View
 * opens the read-only drawer.
 */
function RowAction({ audit, onQuickView }: { audit: Audit; onQuickView: () => void }) {
  const { user } = useAuthedSession();
  const router = useRouter();
  const action = auditAction(user.role, audit.status);

  if (action === 'NONE') {
    return <span className="text-[12px] text-muted-foreground" aria-label="No action available">—</span>;
  }

  if (action === 'QUICK_VIEW') {
    return (
      <Button id={`audit-view-${audit.id}`} size="sm" onClick={onQuickView}
        aria-label={`Quick view audit ${audit.ref}`}>
        {ACTION_LABELS.QUICK_VIEW}
      </Button>
    );
  }

  // REVIEW / COACH / SIGN — this row is the viewer's to work.
  return (
    <Button id={`audit-action-${audit.id}`} size="sm" variant="primary"
      onClick={() => router.push(`/coaching?callId=${encodeURIComponent(audit.ref)}`)}
      aria-label={`${ACTION_LABELS[action]} audit ${audit.ref}`}>
      {ACTION_LABELS[action]}
    </Button>
  );
}

function AuditsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthedSession();
  const { audits: allAudits } = useAuditStore();

  // No client-side scoping: `GET /api/forms` already applied the org scope and
  // the workflow visibility floor in the query, so rows this user may not see
  // never reach the browser. Re-filtering here would only hide a bug.
  const audits = allAudits;

  const [q, setQ] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [filters, setFilters] = React.useState<FilterState>(emptyFilters);
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<{ key: keyof Audit | 'formShort'; dir: 1 | -1 }>({ key: 'callDate', dir: -1 });
  const [selectedAudit, setSelectedAudit] = React.useState<Audit | null>(null);

  // Dashboard KPI tiles link here as ?stage=RELEASED_TO_OPS,OPS_COACHING —
  // landing on exactly the rows behind the number the user clicked, including
  // tiles that sum two stages. Applied on mount; the user can then clear it
  // like any other facet.
  const stageParam = searchParams.get('stage');
  React.useEffect(() => {
    if (!stageParam) return;
    const labels = stageParam
      .split(',')
      .map((s) => STATUS_LABEL[s.trim() as AuditStatus])
      .filter(Boolean);
    if (!labels.length) return;
    setFilters((f) => ({ ...f, status: new Set(labels) }));
    setPage(1);
  }, [stageParam]);

  const passes = React.useCallback((a: Audit, exceptKey: FacetKey | null) => {
    if (q) {
      const s = q.toLowerCase();
      if (!(a.agent.toLowerCase().includes(s) || a.eid.includes(s) || a.ref.includes(s) || a.reason.toLowerCase().includes(s))) return false;
    }
    if (from && a.callDate < new Date(from)) return false;
    if (to && a.callDate > new Date(to + 'T23:59:59')) return false;
    for (const f of FACETS) {
      if (f.key === exceptKey) continue;
      const sel = filters[f.key];
      if (sel.size === 0) continue;
      const vals = ([] as string[]).concat(f.get(a));
      if (!vals.some((v) => sel.has(v))) return false;
    }
    return true;
  }, [q, from, to, filters]);

  const filtered = React.useMemo(() => audits.filter((a) => passes(a, null)), [audits, passes]);

  const facetOptions = React.useMemo(() => {
    const out: Record<FacetKey, FacetOption[]> = {} as any;
    for (const f of FACETS) {
      const pool = audits.filter((a) => passes(a, f.key));
      const counts = new Map<string, number>();
      for (const a of pool) for (const v of ([] as string[]).concat(f.get(a))) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const v of filters[f.key]) if (!counts.has(v)) counts.set(v, 0);
      let values = [...counts.keys()];
      values.sort(f.order ? (a, b) => f.order!.indexOf(a) - f.order!.indexOf(b) : (a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
      out[f.key] = values.map((v) => ({ value: v, label: v, count: counts.get(v)! }));
    }
    return out;
  }, [audits, passes, filters]);

  const sorted = React.useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const x = sort.key === 'formShort' ? a.formShort : (a as any)[sort.key];
      const y = sort.key === 'formShort' ? b.formShort : (b as any)[sort.key];
      if (x instanceof Date) return sort.dir * (+x - +y);
      if (typeof x === 'string') return sort.dir * x.localeCompare(y);
      return sort.dir * (x - y);
    });
    return rows;
  }, [filtered, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, pages);
  const pageRows = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const avg = filtered.length ? filtered.reduce((a, r) => a + r.score, 0) / filtered.length : null;
  const errs = filtered.reduce((a, r) => a + r.totalErrs, 0);
  const surveyed = filtered.filter((r) => r.surveyed);
  const dsat = surveyed.filter((r) => r.category === 'DSAT');

  const activeChips: Array<{ label: string; onRemove: () => void }> = [];
  if (q) activeChips.push({ label: `Search: "${q}"`, onRemove: () => setQ('') });
  if (from) activeChips.push({ label: `From ${from}`, onRemove: () => setFrom('') });
  if (to) activeChips.push({ label: `To ${to}`, onRemove: () => setTo('') });
  for (const f of FACETS) for (const v of filters[f.key]) {
    activeChips.push({
      label: `${f.label}: ${v}`,
      onRemove: () => setFilters((s) => { const next = new Set(s[f.key]); next.delete(v); return { ...s, [f.key]: next }; }),
    });
  }

  function clearAll() {
    setQ(''); setFrom(''); setTo(''); setFilters(emptyFilters()); setPage(1);
  }

  function toggleSort(key: keyof Audit | 'formShort') {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  const stripeFor = (a: Audit): 'good' | 'warn' | 'critical' => (a.score >= 90 ? 'good' : a.score >= 80 ? 'warn' : 'critical');

  // This array was declared and then never read — the header was twelve
  // hand-written <th> elements instead, each repeating the same ~90-character
  // class string plus its own copy of the sort-state ternary. It now actually
  // drives the header, so a column's alignment and its sortability are stated
  // once, in one place.
  const columns: Array<{
    key?: keyof Audit | 'formShort';
    label: string;
    align?: 'left' | 'right';
    nowrap?: boolean;
  }> = [
    { key: 'ref', label: 'Ref', nowrap: true },
    { key: 'agent', label: 'Agent' },
    { label: 'Team' },
    { key: 'auditor', label: 'Auditor' },
    { key: 'formShort', label: 'Form', nowrap: true },
    { key: 'disposition', label: 'Disposition' },
    { key: 'callDate', label: 'Call date', nowrap: true },
    { key: 'aht', label: 'AHT', align: 'right', nowrap: true },
    { key: 'score', label: 'Score', align: 'right', nowrap: true },
    { label: 'Errors', nowrap: true },
    { key: 'status', label: 'Status', nowrap: true },
    { label: 'Action', align: 'right', nowrap: true },
  ];

  return (
    <>
      <AuditDrawer audit={selectedAudit} onClose={() => setSelectedAudit(null)} />

      <div className="flex flex-col gap-[18px]">
        <PageActions>
          <Button size="sm" onClick={() => {
            downloadCsv(`awr-audits-${new Date().toISOString().slice(0, 10)}.csv`, auditsToCsv(filtered));
            toast.success(`Exported ${filtered.length} audit${filtered.length === 1 ? '' : 's'}`, {
              description: activeChips.length ? 'Matches the filters currently applied.' : 'All audits, no filters applied.',
            });
          }}>Export CSV</Button>
          <Button size="sm" variant="primary" onClick={() => router.push('/coaching')}>New audit</Button>
        </PageActions>

        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <KpiTile label="Audits shown" value={filtered.length} stripe="info" meta={`of ${audits.length} total`} />
          <KpiTile label="Average score" stripe="good"
            value={avg == null ? '—' : avg.toFixed(1)} unit={avg != null ? '%' : undefined}
            meta="weighted transaction score" />
          <KpiTile label="Critical errors" value={errs} stripe="critical" meta="across the filtered set" />
          <KpiTile label="DSAT" stripe="warn"
            value={surveyed.length ? (dsat.length / surveyed.length * 100).toFixed(1) : '—'}
            unit={surveyed.length > 0 ? '%' : undefined}
            meta={surveyed.length ? `${dsat.length} of ${surveyed.length} surveyed` : 'no surveyed calls'} />
        </div>

        <Card>
          <CardHeader title="Filters"
            action={<Button size="sm" variant="ghost" onClick={clearAll}>Clear all</Button>} />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Agent, EID, call ID or reference"
                    aria-label="Search audits"
                    className="pl-8"
                  />
                </div>
              </Field>
              <Field label="Call date from">
                <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
              </Field>
              <Field label="Call date to">
                <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {FACETS.map((f) => (
                <MultiSelectFacet key={f.key} label={f.label} options={facetOptions[f.key] ?? []}
                  selected={filters[f.key]}
                  onChange={(next) => { setFilters((s) => ({ ...s, [f.key]: next })); setPage(1); }} />
              ))}
            </div>

            {activeChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-2.5">
                {activeChips.map((c, i) => (
                  <button key={i} onClick={c.onRemove}
                    className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent px-2 text-[11.5px] font-medium text-primary hover:opacity-80">
                    {c.label}<X className="h-3 w-3 opacity-65" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Results"
            action={
              <div className="flex items-center gap-1.5">
                <Button size="sm" disabled={pageClamped <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <span className="font-mono text-[12.5px] text-muted-foreground">{pageClamped} / {pages}</span>
                <Button size="sm" disabled={pageClamped >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            } />
          <Table minWidth={1080}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th
                    key={c.label}
                    align={c.align}
                    nowrap={c.nowrap}
                    sortable={!!c.key}
                    sorted={c.key && sort.key === c.key ? (sort.dir > 0 ? 'asc' : 'desc') : false}
                    onSort={c.key ? () => toggleSort(c.key!) : undefined}
                  >
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      icon={SearchX}
                      title="No audits match these filters"
                      description="Every filter is combined with AND — widening or clearing one of them will bring records back."
                      action={<Button size="sm" onClick={clearAll}>Clear all filters</Button>}
                    />
                  </td>
                </tr>
              ) : pageRows.map((a) => (
                <StripeRow key={a.id} tone={stripeFor(a)}>
                  <Td mono nowrap className="text-[11px]">
                    <span title={a.ref}>{a.ref.length > 8 ? `${a.ref.slice(0, 8)}…` : a.ref}</span>
                  </Td>
                  <Td>
                    <b className="block text-[12.5px] leading-snug text-foreground">{a.agent}</b>
                    <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{a.eid}</div>
                  </Td>
                  <Td className="text-[11.5px] text-muted-foreground">
                    <div className="font-medium leading-snug text-foreground">{a.wave || '—'}</div>
                    <div className="text-[10.5px] leading-snug">{a.supervisor}</div>
                  </Td>
                  <Td className="text-[11.5px] leading-snug text-muted-foreground">{a.auditor}</Td>
                  <Td nowrap>
                    <Badge variant="outline" size="sm">{a.formShort}</Badge>
                  </Td>
                  <Td className="text-[11.5px]">
                    <div className="font-medium leading-snug text-foreground">{a.disposition}</div>
                    <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{a.reason}</div>
                  </Td>
                  <Td mono nowrap className="text-[11px]">{formatDate(a.callDate)}</Td>
                  <Td align="right" mono nowrap className="text-[12px]">{formatSecs(a.aht)}</Td>
                  <Td align="right" mono nowrap className="text-[12px] font-semibold">{a.score}%</Td>
                  <Td nowrap>
                    {a.totalErrs
                      ? <Badge variant="critical" size="sm" dot>{a.totalErrs}</Badge>
                      : <Badge variant="muted" size="sm">None</Badge>}
                  </Td>
                  <Td nowrap>
                    <Badge variant={STATUS_VARIANT[a.status]} size="sm">{STATUS_LABEL[a.status]}</Badge>
                  </Td>
                  <Td align="right" nowrap>
                    <RowAction audit={a} onQuickView={() => setSelectedAudit(a)} />
                  </Td>
                </StripeRow>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}

export default function AuditsPage() {
  return (
    <React.Suspense fallback={<PageLoader label="Loading audits…" />}>
      <AuditsPageContent />
    </React.Suspense>
  );
}
