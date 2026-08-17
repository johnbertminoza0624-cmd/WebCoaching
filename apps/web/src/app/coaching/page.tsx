'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Plus, Trash2, Lock, Search, PenLine } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Field, ReadonlyValue, SegmentedAnswer } from '@/components/ui/primitives';
import { DropdownSelect, type DropdownOption } from '@/components/ui/dropdown-select';
import { HOLD_REASONS, ROOT_CAUSE_GAPS } from '@/lib/mock-data';
import { STANDARD_FIELDS } from '@/lib/excel-template';
import {
  updateRecord,
  type CoachingRecord, type HoldAttempt, type SectionAData,
  type SectionCData, type SectionDData, type RootCauseRow, type SmartActionItem,
} from '@/lib/coaching-store';
import { useCoachingApi } from '@/lib/coaching-api';
import { useAuthedSession } from '@/lib/session';
import { getProfileSignature } from '@/lib/signature-store';
import { PendingAgents } from '@/components/coaching/pending-agents';
import { ProfileDrawer } from '@/components/coaching/profile-drawer';
import { cn } from '@/lib/utils';
import {
  OWNED_STAGES, sectionAccess, canWorkStage, canSeeRecord, STAGE_LABEL, STAGE_OWNER,
  SCOPE_LABEL, ROLE_LABELS, type FormStage, type Role,
} from '@awr/shared';

const emptySectionA = (): SectionAData => ({
  ivrAuthed: '', reverified: '', nonIvr: '', serviceCloud: '',
  surveyed: '', csat: '', controllable: '', verbatim: '',
});
const CSAT_OPTIONS = ['Not surveyed', '5', '4', '3', '2', '1'].map((v) => ({ value: v, label: v }));

const PRIORITY_OPTIONS: DropdownOption[] = [
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
  { value: 'N/A', label: 'N/A' },
];

const ROOT_CAUSE_OPTIONS: DropdownOption[] = [
  { value: 'N/A', label: 'N/A' },
  ...ROOT_CAUSE_GAPS.filter((g) => g !== 'No Gap found').map((g) => ({ value: g, label: g })),
];

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  readOnly,
  className,
}: {
  value: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.max(34, ref.current.scrollHeight)}px`;
    }
  }, [value]);

  if (readOnly) {
    return (
      <div className="whitespace-pre-wrap break-words text-[12.5px] text-foreground leading-relaxed">
        {value || <span className="text-muted-foreground italic">—</span>}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-full resize-none overflow-hidden rounded-md border border-input bg-card px-2.5 py-1.5 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
        className,
      )}
    />
  );
}

const scoreLabel = (s: 'YES' | 'NO' | 'NA') => (s === 'NA' ? 'N/A' : s === 'YES' ? 'Yes' : 'No');
const scoreVariant = (s: 'YES' | 'NO' | 'NA'): 'good' | 'critical' | 'muted' =>
  (s === 'YES' ? 'good' : s === 'NO' ? 'critical' : 'muted');

/** Seconds from "HH:MM:SS", "MM:SS", or a plain number of seconds. */
function durationSeconds(v: string): number {
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

const emptyHold = (): HoldAttempt => ({ start: '', end: '', reason: '', valid: 'NA' });

const emptySmartItem = (owner = ''): SmartActionItem => ({
  rootCause: '',
  activity: '',
  owner,
  deadline: '',
  successMeasure: '',
  goal: '',
});

function buildDefaultRootCauseRows(rec: CoachingRecord): RootCauseRow[] {
  if (rec.sectionC?.rows && rec.sectionC.rows.length > 0) {
    return rec.sectionC.rows;
  }
  const rows: RootCauseRow[] = rec.parameterSnapshot.map((p) => {
    return {
      parameterId: p.sortOrder,
      parameterText: p.text,
      situation: '',
      behavior: '',
      impact: '',
      priority: '',
      rootCause: '',
    };
  });

  rows.push({
    parameterId: 'CSAT',
    parameterText: 'CSAT Feedback',
    situation: '',
    behavior: '',
    impact: '',
    priority: '',
    rootCause: '',
  });

  rows.push({
    parameterId: 'CRITICAL_ERRORS',
    parameterText: 'Critical Error Count',
    situation: '',
    behavior: '',
    impact: '',
    priority: '',
    rootCause: '',
  });

  return rows;
}

function buildDefaultSmartItems(rec: CoachingRecord): SmartActionItem[] {
  if (rec.sectionD?.items && rec.sectionD.items.length > 0) {
    return rec.sectionD.items;
  }
  return [emptySmartItem(rec.standard['Agent Name'] || '')];
}

const emptySectionC = (): SectionCData => ({ rows: [], rootCauses: [], discussion: '' });
const emptySectionD = (): SectionDData => ({ items: [emptySmartItem()] });

const EMPTY_HINT: Record<Role, string> = {
  QA: 'Upload an audit file on the Audit upload page — its Call IDs will appear here.',
  QA_TEAM_LEAD: 'Upload an audit file on the Audit upload page — its Call IDs will appear here.',
  QA_MANAGER: 'Upload an audit file on the Audit upload page — its Call IDs will appear here.',
  OPS_TEAM_LEAD: 'Nothing has been released to you yet. Audits appear here once QA releases them.',
  AGENT: 'No coaching is waiting for your signature. Records appear here once your team lead releases them.',
  OPS_ACCOUNT_MANAGER: 'No coaching records in your account scope yet.',
  SERVICE_DELIVERY_MANAGER: 'No coaching records yet.',
  ADMIN: 'Administration does not take part in coaching.',
};

const STAGE_ACTION: Partial<Record<FormStage, { label: string; done: string; trail: string }>> = {
  QA_REVIEW: { label: 'Release Audit to Ops TL', done: 'Released to Ops TL', trail: 'Released to Ops TL' },
  RELEASED_TO_OPS: { label: 'Start coaching', done: 'Coaching started', trail: 'Started coaching' },
  OPS_COACHING: { label: 'Sign and release to Agent', done: 'Released to agent', trail: 'Signed and released to agent' },
  RELEASED_TO_AGENT: { label: 'Open for signature', done: 'Opened', trail: 'Opened for signature' },
  AWAITING_AGENT_SIGNATURE: { label: 'Acknowledge Coaching', done: 'Coaching acknowledged', trail: 'Agent acknowledged' },
};

function CoachingPageContent() {
  const searchParams = useSearchParams();
  const { user } = useAuthedSession();
  const me = user;
  const role = user.role;

  // Same store the audits table and dashboards read — a record released here
  // moves on every surface at once.
  const {
    records, detail, loadDetail, reload,
    saveQaWork, saveCoachingWork, sign: signForm, advance,
  } = useCoachingApi();

  /**
   * The Call ID selector offers only records at a stage this role owns.
   *
   * This is the enforcement point for "a user cannot bypass the workflow by
   * entering a Call ID": the selection is looked up *within* the queue, so an
   * id for a record at someone else's stage simply does not resolve. An Ops TL
   * cannot open something still in QA review, and an Agent cannot open
   * something the Ops TL has not released.
   *
   * Monitoring roles (Ops Account Manager) own no stage, so they get a
   * read-only view of everything in their scope instead of a work queue.
   */
  const isMonitor = OWNED_STAGES[role].length === 0;

  /**
   * Data scope is applied BEFORE stage, using the same `scopeAudits` the Audits
   * page and both dashboards use. Filtering only by stage would have shown an
   * Ops TL every agent at their stage across the whole account rather than the
   * agents on their own team.
   */
  /**
   * Drafts are local, so the server cannot scope them. This mirrors the API's
   * rules in the browser as a convenience — it is not a control, and it goes
   * away with this whole module once the write endpoints exist.
   */
  const inScopeIds = React.useMemo(() => {
    const visible = records.filter((r) => canSeeRecord(role, r.stage));
    const mine = visible.filter((r) => {
      switch (role) {
        case 'AGENT': return r.standard['EID'] === user.eid;
        case 'QA': return r.standard['Quality Auditor'] === user.name;
        case 'OPS_TEAM_LEAD': return r.standard['Supervisor'] === user.name;
        default: return true;
      }
    });
    return new Set(mine.map((r) => r.id));
  }, [records, role, user.eid, user.name]);
  /** In scope, at any stage — what a profile may show about a person. */
  const scopedRecords = React.useMemo(
    () => records.filter((r) => inScopeIds.has(r.id)),
    [records, inScopeIds],
  );
  /** In scope AND at a stage this role owns — the actual work queue. */
  const queue = React.useMemo(
    () => (isMonitor ? scopedRecords : scopedRecords.filter((r) => canWorkStage(role, r.stage))),
    [scopedRecords, role, isMonitor],
  );

  const [selId, setSelId] = React.useState('');
  const [profile, setProfile] = React.useState<{ name: string; eid: string } | null>(null);
  /**
   * The open record is the API's detail, not the list row: sections, scored
   * parameters, observations and signatures only exist on `GET /forms/:id`.
   * Falls back to the row while the fetch is in flight so the header does not
   * flash empty.
   */
  const row = queue.find((r) => r.id === selId) ?? null;
  const rec = detail && detail.id === selId ? detail : row;

  React.useEffect(() => { void loadDetail(selId); }, [selId, loadDetail]);

  /**
   * Deep link from the Audits page (`/coaching?callId=…`).
   *
   * The lookup runs against `queue`, never against all records, so a Call ID
   * for someone else's stage — typed, guessed, or edited in the URL — resolves
   * to nothing and the page stays on the selector. This is the same rule the
   * selector enforces; the URL is not a way around it.
   */
  const callIdParam = searchParams.get('callId');
  React.useEffect(() => {
    if (!callIdParam || !queue.length) return;
    const match = queue.find((r) => r.standard['Call ID'] === callIdParam);
    if (match) {
      setSelId(match.id);
    } else {
      toast.error('That coaching is not available to you', {
        description: `Call ${callIdParam} is not currently at a stage you can work on.`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callIdParam, queue.length]);

  // The stage of the selected record decides every field permission below.
  const stage: FormStage = rec?.stage ?? 'QA_REVIEW';
  const access = React.useCallback(
    (section: Parameters<typeof sectionAccess>[2]) => sectionAccess(role, stage, section),
    [role, stage],
  );
  const canEdit = React.useCallback(
    (section: Parameters<typeof sectionAccess>[2]) => access(section) === 'EDIT',
    [access],
  );

  const [obs, setObs] = React.useState<Record<number, string>>({});
  const [holds, setHolds] = React.useState<HoldAttempt[]>([emptyHold()]);
  const [secA, setSecA] = React.useState<SectionAData>(emptySectionA());
  const [secC, setSecC] = React.useState<SectionCData>(emptySectionC());
  const [secD, setSecD] = React.useState<SectionDData>(emptySectionD());
  const [attempted, setAttempted] = React.useState(false);

  // Load the selected record's saved work (or fresh state).
  React.useEffect(() => {
    setAttempted(false);
    if (!rec) {
      setObs({}); setHolds([emptyHold()]); setSecA(emptySectionA());
      setSecC(emptySectionC()); setSecD(emptySectionD());
      return;
    }
    setObs(rec.qaObservations ?? {});
    setHolds(rec.holdAttempts?.length ? rec.holdAttempts : [emptyHold()]);
    setSecA(rec.sectionA ?? emptySectionA());
    setSecC({
      rows: buildDefaultRootCauseRows(rec),
      rootCauses: rec.sectionC?.rootCauses?.length ? rec.sectionC.rootCauses : [],
      discussion: rec.sectionC?.discussion ?? '',
    });
    setSecD({
      items: buildDefaultSmartItems(rec),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const setA = <K extends keyof SectionAData>(k: K, v: SectionAData[K]) => setSecA((s) => ({ ...s, [k]: v }));

  function updateSectionCRow(idx: number, field: keyof RootCauseRow, value: string) {
    setSecC((prev) => {
      const rows = [...(prev.rows ?? [])];
      if (!rows[idx]) return prev;
      rows[idx] = { ...rows[idx]!, [field]: value };
      const distinctGaps = Array.from(new Set(rows.map((r) => r.rootCause).filter(Boolean)));
      return { ...prev, rows, rootCauses: distinctGaps };
    });
  }

  function updateSectionDItem(idx: number, field: keyof SmartActionItem, value: string) {
    setSecD((prev) => {
      const items = [...prev.items];
      if (!items[idx]) return prev;
      items[idx] = { ...items[idx]!, [field]: value };
      return { ...prev, items };
    });
  }

  /**
   * Both signature buttons call the same endpoint. Which block the signature
   * lands on is decided by the server from the caller's role — the request
   * cannot ask for the other party's slot.
   */
  async function attachSignature(label: 'Supervisor' | 'Agent') {
    if (!rec) return;
    const sig = getProfileSignature(me.id, me.name);
    try {
      await signForm(rec.id, sig.src);
      await reload();
      toast.success(`${label} signature attached`, {
        description: `Signed as ${me.name} on ${formatDateTime(new Date().toISOString())}`,
      });
    } catch (err) {
      toast.error('Could not sign', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  const handleAttachSupervisorSignature = () => void attachSignature('Supervisor');
  const handleAttachAgentSignature = () => void attachSignature('Agent');

  // Overall QA score — weighted where the form carried weights, otherwise a
  // simple share of scorable parameters. N/A parameters are excluded.
  const score = React.useMemo(() => {
    if (!rec) return null;
    const ps = rec.parameterSnapshot;
    const weighted = ps.length > 0 && ps.every((p) => typeof p.weight === 'number');
    let earned = 0, possible = 0, yes = 0, no = 0, na = 0;
    for (const p of ps) {
      const r = rec.params[p.sortOrder] ?? 'NA';
      if (r === 'NA') { na += 1; continue; }
      const w = weighted ? (p.weight as number) : 1;
      possible += w;
      if (r === 'YES') { earned += w; yes += 1; } else { no += 1; }
    }
    const pct = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
    return { pct, yes, no, na, weighted, scorable: yes + no };
  }, [rec]);

  const isPerfectScore = score?.pct === 100;

  /** Distinct people in the queue — a queue of 12 records may be 4 agents. */
  const agentCount = React.useMemo(
    () => new Set(queue.map((r) => r.standard['EID'] || r.standard['Agent Name'])).size,
    [queue],
  );

  const callIdOptions: DropdownOption[] = queue.map((r) => ({
    value: r.id,
    label: r.standard['Call ID'] || '(no Call ID)',
    description: `${r.standard['Agent Name'] || 'Unknown agent'} · ${r.formName} v${r.formVersion}`,
  }));

  const holdSeconds = rec ? durationSeconds(rec.standard['Total Hold Time'] ?? '') : 0;
  const holdRequired = holdSeconds > 0;

  // Observation is required for every parameter scored "No".
  const missingObservations = rec
    ? rec.parameterSnapshot.filter((p) => rec.params[p.sortOrder] === 'NO' && !(obs[p.sortOrder] ?? '').trim())
    : [];
  const holdIncomplete = holdRequired && !holds.some((h) => h.reason.trim());

  /**
   * What still stands between this role and the next stage. Only the owning
   * role is ever blocked — a viewer has nothing to complete.
   */
  const blockers = React.useMemo((): { blocked: boolean; message: React.ReactNode } => {
    if (!rec) return { blocked: true, message: null };
    if (!canWorkStage(role, stage)) {
      return { blocked: true, message: <>Waiting on the <b className="font-semibold text-foreground">{ROLE_LABELS[STAGE_OWNER[stage] ?? role]}</b> at the {STAGE_LABEL[stage]} stage.</> };
    }
    if (stage === 'QA_REVIEW') {
      if (missingObservations.length) {
        return { blocked: false, message: <span className="text-destructive">{missingObservations.length} “No” parameter{missingObservations.length === 1 ? '' : 's'} still need an observation.</span> };
      }
      if (holdIncomplete) {
        return { blocked: false, message: <span className="text-[var(--status-warn)]">Add a hold attempt with a reason before releasing.</span> };
      }
      return { blocked: false, message: <span className="text-[var(--status-good)]">Ready to release — all required observations are in.</span> };
    }
    if (stage === 'OPS_COACHING') {
      const missing: string[] = [];
      if (!rec.opsSignature) missing.push('supervisor signature in Section E');
      return missing.length
        ? { blocked: false, message: <span className="text-[var(--status-warn)]">Please attach {missing.join(' and ')} before releasing to the agent.</span> }
        : { blocked: false, message: <span className="text-[var(--status-good)]">Ready to release to the agent.</span> };
    }
    if (stage === 'AWAITING_AGENT_SIGNATURE') {
      return {
        blocked: false,
        message: !rec.agentSignature
          ? <span className="text-[var(--status-warn)]">Please click to attach your Agent signature in Section E before acknowledging.</span>
          : <span className="text-[var(--status-good)]">Signature attached. Click Acknowledge Coaching to finalize.</span>,
      };
    }
    return { blocked: false, message: <>Open this coaching to continue.</> };
  }, [rec, role, stage, missingObservations.length, holdIncomplete]);

  /**
   * "Save progress" — writes whichever sections this role owns at this stage.
   * The server re-checks each one, so sending a section the role does not own
   * is refused rather than silently ignored.
   */
  async function persist() {
    if (!rec) return;
    try {
      if (canEdit('PARAMETERS')) await saveQaWork(rec.id, obs, holds);
      if (canEdit('SECTION_C') || canEdit('SECTION_D')) {
        await saveCoachingWork(rec.id, secC, secD);
      }
      await reload();
      toast('Progress saved');
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  /**
   * Advance the record to the next stage.
   */
  async function submitStage() {
    if (!rec) return;
    setAttempted(true);

    try {
      // Save this role's work first, then ask the server to advance. The
      // server re-validates both, so a stale browser cannot skip either.
      if (stage === 'QA_REVIEW') {
        if (missingObservations.length) {
          toast.error(`${missingObservations.length} parameter${missingObservations.length === 1 ? '' : 's'} scored “No” still need an observation`, {
            description: missingObservations.map((p) => `P${p.sortOrder}`).join(', '),
          });
          return;
        }
        if (holdIncomplete) {
          toast.error('Hold Attempt Details required', {
            description: 'This call had hold time — add at least one hold attempt with a reason.',
          });
          return;
        }
        await saveQaWork(rec.id, obs, holds);
      }

      if (stage === 'OPS_COACHING') {
        if (!rec.opsSignature) {
          toast.error('Supervisor signature required', {
            description: 'Please attach your signature in Section E before releasing to the agent.',
          });
          return;
        }
        await saveCoachingWork(rec.id, secC, secD);
      }

      if (stage === 'AWAITING_AGENT_SIGNATURE' && !rec.agentSignature) {
        toast.error('Agent signature required', {
          description: 'Please attach your signature in Section E before acknowledging.',
        });
        return;
      }

      const moved = await advance(rec.id);
      await reload();

      // Opening a coaching or a signature is a step within the same sitting;
      // the others hand the record on, so the queue selection is cleared.
      const staysOpen = stage === 'RELEASED_TO_OPS' || stage === 'RELEASED_TO_AGENT';
      if (!staysOpen) setSelId('');

      toast.success(STAGE_ACTION[stage]?.done ?? 'Advanced', {
        description: `${rec.standard['Agent Name']} · Call ${rec.standard['Call ID']} → ${STAGE_LABEL[moved.to as FormStage]}`,
      });
    } catch (err) {
      toast.error('Could not continue', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Call ID selector */}
      <Card>
        <CardHeader title="Select Call ID" />
        <CardBody>
          {queue.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Search className="h-6 w-6 text-muted-foreground" />
              <b className="text-[13px]">Nothing waiting on you</b>
              <p className="max-w-[46ch] text-[12.5px] text-muted-foreground">{EMPTY_HINT[role]}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="max-w-[460px]">
                <DropdownSelect options={callIdOptions} value={selId} onChange={setSelId}
                  placeholder="Search or select Call ID" />
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  {queue.length} record{queue.length === 1 ? '' : 's'} {isMonitor ? 'in scope' : 'in your queue'}
                  {' · '}{agentCount} agent{agentCount === 1 ? '' : 's'}.
                </p>
              </div>

              {!rec && (
                <div className="border-t border-border pt-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
                    {isMonitor ? 'Agents in scope' : 'Agents waiting on you'}
                  </p>
                  <PendingAgents records={queue} selectedId={selId} onSelect={setSelId}
                    onOpenProfile={(name, eid) => setProfile({ name, eid })} />
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <ProfileDrawer
        agentName={profile?.name ?? null}
        agentEid={profile?.eid ?? ''}
        records={profile ? scopedRecords.filter((r: CoachingRecord) => (r.standard['EID'] || r.standard['Agent Name']) === (profile.eid || profile.name)) : []}
        onClose={() => setProfile(null)}
        onOpenRecord={setSelId}
      />

      {rec && (
        <>
          {/* Read-only audit information */}
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-muted-foreground" /> Audit information</span>}
              action={<span className="flex items-center gap-2"><Badge variant="muted">{rec.formName}</Badge><Badge variant="outline" className="font-mono">v{rec.formVersion}</Badge></span>} />
            <CardBody className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {STANDARD_FIELDS.map((f) => (
                <Field key={f} label={f}><ReadonlyValue>{rec.standard[f] || '—'}</ReadonlyValue></Field>
              ))}
              {Object.entries(rec.metaValues).map(([k, v]) => (
                <Field key={k} label={k}><ReadonlyValue>{v || '—'}</ReadonlyValue></Field>
              ))}
            </CardBody>
          </Card>

          {/* Score — sums the agent's parameter results */}
          {score && (
            <Card>
              <CardHeader title="Score" />
              <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-4">
                <div className="flex items-end gap-2">
                  <span className="text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums"
                    style={{ color: score.pct === null ? 'var(--muted-foreground)' : score.pct >= 90 ? 'var(--status-good)' : score.pct >= 80 ? 'var(--status-warn)' : 'var(--status-critical)' }}>
                    {score.pct === null ? '—' : score.pct}{score.pct !== null && <span className="text-[20px]">%</span>}
                  </span>
                  <span className="mb-1 text-[12px] text-muted-foreground">
                    {score.pct === null ? 'no scorable parameters' : `${score.yes} of ${score.scorable} passed`}
                  </span>
                </div>
                <div className="h-9 w-px bg-border" aria-hidden="true" />
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md bg-[var(--status-good-surface)] px-2.5 py-1 text-[12px] font-semibold text-[var(--status-good)]">Yes · {score.yes}</span>
                  <span className="rounded-md bg-[var(--status-critical-surface)] px-2.5 py-1 text-[12px] font-semibold text-destructive">No · {score.no}</span>
                  <span className="rounded-md bg-muted px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">N/A · {score.na}</span>
                </div>
                {score.pct !== null && (
                  <div className="min-w-[180px] flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-[width]"
                        style={{ width: `${score.pct}%`, background: score.pct >= 90 ? 'var(--status-good)' : score.pct >= 80 ? 'var(--status-warn)' : 'var(--status-critical)' }} />
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* Section A — QA-owned */}
          {access('PARAMETERS') !== 'HIDDEN' && (
          <Card>
            <CardHeader title={<><span className="mr-2 font-mono text-[11.5px] text-primary">Section A</span>Operations-initiated audit findings</>}
              action={canEdit('PARAMETERS') ? undefined : <Badge variant="muted"><Lock className="h-3 w-3" /> Read-only</Badge>} />
            <CardBody className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">IVR authentication process check</p>
                  <div className="flex flex-col gap-2.5">
                    {([['ivrAuthed', 'IVR authenticated'], ['reverified', 'Did the agent reverify?'], ['nonIvr', 'Verified for non-IVR account?']] as const).map(([k, label]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <span className="text-[12.5px]">{label}</span>
                        <SegmentedAnswer value={secA[k] || 'N/A'} onChange={(v) => setA(k, v)} disabled={!canEdit('PARAMETERS')} />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Service Cloud utilization</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12.5px]">Used Service Cloud correctly</span>
                    <SegmentedAnswer value={secA.serviceCloud || 'N/A'} onChange={(v) => setA('serviceCloud', v)} disabled={!canEdit('PARAMETERS')} />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">CSAT survey details</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px]">Was the call surveyed?</span>
                  <SegmentedAnswer value={secA.surveyed || 'N/A'} onChange={(v) => setA('surveyed', v)} disabled={!canEdit('PARAMETERS')} />
                </div>
                <div className="grid grid-cols-2 gap-3.5">
                  <Field label="CSAT score">
                    <DropdownSelect options={CSAT_OPTIONS} value={secA.csat} onChange={(v) => setA('csat', v)} placeholder="Select" disabled={!canEdit('PARAMETERS')} />
                  </Field>
                  <Field label="Agent controllable">
                    <DropdownSelect
                      options={['N/A', 'Agent controllable', 'Agent non-controllable'].map((v) => ({ value: v, label: v }))}
                      value={secA.controllable} onChange={(v) => setA('controllable', v)} placeholder="Select" disabled={!canEdit('PARAMETERS')} />
                  </Field>
                </div>
                <Field label="Customer verbatim" hint="Optional — paste the survey comment if any">
                  <textarea rows={3} value={secA.verbatim} onChange={(e) => setA('verbatim', e.target.value)} readOnly={!canEdit('PARAMETERS')}
                    placeholder="Customer's survey comment…"
                    className="w-full resize-y rounded-md border border-input bg-card p-2 text-[12.5px]" />
                </Field>
              </div>
            </CardBody>
          </Card>
          )}

          {/* Parameters */}
          <Card>
            <CardHeader title="Audit parameters" />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="w-[46%] border-b border-border px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Parameter</th>
                    <th className="w-[90px] border-b border-border px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Score</th>
                    <th className="border-b border-border px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">QA observation</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.parameterSnapshot.map((p) => {
                    const paramScore = rec.params[p.sortOrder] ?? 'NA';
                    const required = paramScore === 'NO';
                    const empty = !(obs[p.sortOrder] ?? '').trim();
                    const invalid = required && empty && attempted;
                    return (
                      <tr key={p.sortOrder} className="align-top">
                        <td className="border-b border-border px-4 py-3 text-[13px]">
                          <span className="font-mono text-[11px] text-muted-foreground">P{p.sortOrder}</span> {p.text}
                        </td>
                        <td className="border-b border-border px-3 py-3 text-center">
                          <Badge variant={scoreVariant(paramScore)}>{scoreLabel(paramScore)}</Badge>
                        </td>
                        <td className="border-b border-border px-4 py-3">
                          {canEdit('PARAMETERS') ? (
                            <>
                              <textarea
                                rows={2}
                                value={obs[p.sortOrder] ?? ''}
                                onChange={(e) => setObs((o) => ({ ...o, [p.sortOrder]: e.target.value }))}
                                placeholder={required ? 'Observation required — the score is “No”' : 'Optional observation'}
                                className={`w-full resize-y rounded-md border bg-card p-2 text-[12.5px] ${invalid ? 'border-destructive' : 'border-input'}`}
                              />
                              {required && (
                                <span className={`mt-1 block text-[11px] ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {invalid ? 'Observation required before releasing.' : 'Required (scored No).'}
                                </span>
                              )}
                            </>
                          ) : (
                            <p className="text-[12.5px] text-muted-foreground">
                              {(obs[p.sortOrder] ?? '').trim() || <span className="italic">No observation recorded.</span>}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Hold Attempt Details */}
          {access('HOLD_ATTEMPTS') !== 'HIDDEN' && (
          <Card>
            <CardHeader title="Hold Attempt Details"
              action={!canEdit('HOLD_ATTEMPTS')
                ? <Badge variant="muted"><Lock className="h-3 w-3" /> Read-only</Badge>
                : holdRequired ? <Badge variant="warn">Required</Badge> : <Badge variant="muted">Optional</Badge>} />
            <CardBody className="flex flex-col gap-2.5">
              <div className="hidden grid-cols-[1fr_1fr_1.4fr_150px_32px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground sm:grid">
                <span>Start</span><span>End</span><span>Reason</span><span>Valid</span><span />
              </div>
              {holds.map((h, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_150px_32px] sm:items-center">
                  <input value={h.start} placeholder="00:00:00" readOnly={!canEdit('HOLD_ATTEMPTS')}
                    onChange={(e) => setHolds((hs) => hs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                    className="h-[34px] rounded-md border border-input bg-card px-2.5 font-mono text-[12.5px] read-only:opacity-70" />
                  <input value={h.end} placeholder="00:00:00" readOnly={!canEdit('HOLD_ATTEMPTS')}
                    onChange={(e) => setHolds((hs) => hs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                    className="h-[34px] rounded-md border border-input bg-card px-2.5 font-mono text-[12.5px] read-only:opacity-70" />
                  <DropdownSelect
                    options={[{ value: '', label: 'Select reason' }, ...HOLD_REASONS.map((r) => ({ value: r, label: r }))]}
                    value={h.reason}
                    onChange={(v) => setHolds((hs) => hs.map((x, j) => (j === i ? { ...x, reason: v } : x)))}
                    disabled={!canEdit('HOLD_ATTEMPTS')} />
                  <SegmentedAnswer value={scoreLabel(h.valid)} disabled={!canEdit('HOLD_ATTEMPTS')}
                    onChange={(v) => setHolds((hs) => hs.map((x, j) => (j === i ? { ...x, valid: v === 'N/A' ? 'NA' : v === 'Yes' ? 'YES' : 'NO' } : x)))} />
                  <button type="button" aria-label="Remove attempt" disabled={!canEdit('HOLD_ATTEMPTS')}
                    onClick={() => setHolds((hs) => (hs.length > 1 ? hs.filter((_, j) => j !== i) : [emptyHold()]))}
                    className="grid h-[34px] w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {canEdit('HOLD_ATTEMPTS') && (
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setHolds((hs) => [...hs, emptyHold()])}>
                  <Plus className="h-3.5 w-3.5" /> Add hold attempt
                </Button>
              )}
            </CardBody>
          </Card>
          )}

          {/* ── Section C: Root Cause Analysis ── */}
          {access('SECTION_C') !== 'HIDDEN' && (
            <Card>
              <CardHeader
                title={<><span className="mr-2 font-mono text-[11.5px] text-primary">Section C</span>Root cause analysis</>}
                action={
                  <div className="flex items-center gap-2">
                    {isPerfectScore && <Badge variant="good">Optional (100% Score)</Badge>}
                    {!canEdit('SECTION_C') && <Badge variant="muted"><Lock className="h-3 w-3 inline mr-1" /> Read-only</Badge>}
                  </div>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="w-[26%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Parameter</th>
                      <th className="w-[18%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Situation / Symptom</th>
                      <th className="w-[18%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Behavior</th>
                      <th className="w-[18%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Impact</th>
                      <th className="w-[10%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Priority</th>
                      <th className="w-[10%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Root Cause</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {secC.rows?.map((row, idx) => (
                      <tr key={String(row.parameterId)} className="align-top hover:bg-muted/30">
                        <td className="border-b border-border px-3.5 py-2.5 text-[12.5px] text-foreground font-medium">
                          {row.parameterText}
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          <AutoGrowTextarea
                            value={row.situation}
                            onChange={(v) => updateSectionCRow(idx, 'situation', v)}
                            placeholder="Enter situation / symptom…"
                            readOnly={!canEdit('SECTION_C')}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          <AutoGrowTextarea
                            value={row.behavior}
                            onChange={(v) => updateSectionCRow(idx, 'behavior', v)}
                            placeholder="Enter observed behavior…"
                            readOnly={!canEdit('SECTION_C')}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          <AutoGrowTextarea
                            value={row.impact}
                            onChange={(v) => updateSectionCRow(idx, 'impact', v)}
                            placeholder="Enter business / customer impact…"
                            readOnly={!canEdit('SECTION_C')}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px] min-w-[130px]">
                          {canEdit('SECTION_C') ? (
                            <DropdownSelect
                              options={PRIORITY_OPTIONS}
                              value={row.priority || ''}
                              onChange={(v) => updateSectionCRow(idx, 'priority', v)}
                              placeholder="Priority"
                            />
                          ) : (
                            <span className={row.priority === 'High' ? 'font-semibold text-destructive' : row.priority === 'Medium' ? 'font-medium text-[var(--status-warn)]' : 'text-muted-foreground'}>
                              {row.priority || '—'}
                            </span>
                          )}
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px] min-w-[170px]">
                          {canEdit('SECTION_C') ? (
                            <DropdownSelect
                              options={ROOT_CAUSE_OPTIONS}
                              value={row.rootCause || ''}
                              onChange={(v) => updateSectionCRow(idx, 'rootCause', v)}
                              placeholder="Root Cause"
                            />
                          ) : (
                            <span className="font-medium text-foreground">{row.rootCause || '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── Section D: SMART Action Plan ── */}
          {access('SECTION_D') !== 'HIDDEN' && (
            <Card>
              <CardHeader
                title={<><span className="mr-2 font-mono text-[11.5px] text-primary">Section D</span>SMART Action Plan</>}
                action={
                  <div className="flex items-center gap-2">
                    {isPerfectScore && <Badge variant="good">Optional (100% Score)</Badge>}
                    {canEdit('SECTION_D') && (
                      <Button size="sm" variant="ghost" onClick={() => setSecD((d) => ({ ...d, items: [...d.items, emptySmartItem(rec.standard['Agent Name'] || '')] }))}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Action Item
                      </Button>
                    )}
                  </div>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="w-[18%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Root Cause</th>
                      <th className="w-[24%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Activity</th>
                      <th className="w-[14%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Owner</th>
                      <th className="w-[12%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Deadline</th>
                      <th className="w-[16%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Success Measurement</th>
                      <th className="w-[16%] border-b border-border px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Goal</th>
                      {canEdit('SECTION_D') && <th className="w-10 border-b border-border px-2 py-2.5 text-center"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {secD.items.map((it, idx) => (
                      <tr key={idx} className="align-top hover:bg-muted/30">
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px] min-w-[170px]">
                          {canEdit('SECTION_D') ? (
                            <DropdownSelect
                              options={ROOT_CAUSE_OPTIONS}
                              value={it.rootCause || ''}
                              onChange={(v) => updateSectionDItem(idx, 'rootCause', v)}
                              placeholder="Root Cause"
                            />
                          ) : (
                            it.rootCause || '—'
                          )}
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          <AutoGrowTextarea
                            value={it.activity}
                            onChange={(v) => updateSectionDItem(idx, 'activity', v)}
                            placeholder="Enter developmental activity…"
                            readOnly={!canEdit('SECTION_D')}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          {canEdit('SECTION_D') ? (
                            <input
                              value={it.owner}
                              onChange={(e) => updateSectionDItem(idx, 'owner', e.target.value)}
                              placeholder="Owner"
                              className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground focus:ring-1 focus:ring-primary"
                            />
                          ) : (
                            it.owner || '—'
                          )}
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          {canEdit('SECTION_D') ? (
                            <input
                              type="date"
                              value={it.deadline}
                              onChange={(e) => updateSectionDItem(idx, 'deadline', e.target.value)}
                              className="h-8 w-full rounded-md border border-input bg-card px-2 text-[12.5px] font-mono text-foreground focus:ring-1 focus:ring-primary"
                            />
                          ) : (
                            it.deadline || '—'
                          )}
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          <AutoGrowTextarea
                            value={it.successMeasure}
                            onChange={(v) => updateSectionDItem(idx, 'successMeasure', v)}
                            placeholder="How success is measured…"
                            readOnly={!canEdit('SECTION_D')}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-2 text-[12.5px]">
                          <AutoGrowTextarea
                            value={it.goal}
                            onChange={(v) => updateSectionDItem(idx, 'goal', v)}
                            placeholder="Target goal…"
                            readOnly={!canEdit('SECTION_D')}
                          />
                        </td>
                        {canEdit('SECTION_D') && (
                          <td className="border-b border-border p-2 text-center align-middle">
                            <button
                              type="button"
                              aria-label="Remove item"
                              onClick={() => setSecD((d) => ({
                                ...d,
                                items: d.items.length > 1 ? d.items.filter((_, j) => j !== idx) : [emptySmartItem(rec?.standard['Agent Name'] || '')],
                              }))}
                              className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── Section E: Acknowledgement and Commitment ── */}
          {(access('OPS_SIGNATURE') !== 'HIDDEN' || access('AGENT_SIGNATURE') !== 'HIDDEN') && (
            <Card>
              <CardHeader
                title={<><span className="mr-2 font-mono text-[11.5px] text-primary">Section E</span>Acknowledgement and Commitment</>}
              />
              <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Left: Agent */}
                <div className="flex flex-col justify-between gap-5 rounded-lg border border-border bg-card p-5">
                  <div className="flex flex-col gap-3">
                    <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wider">
                      Agent Acknowledgement & Commitment
                    </h3>
                    <div className="flex flex-col gap-3 text-[12.5px] italic text-muted-foreground leading-relaxed">
                      <p>
                        I acknowledge that the behaviors and performance items discussed during this coaching session were based on observations from Quality Monitoring. I understand the specific areas identified for improvement and how they impact customer experience, compliance, and overall team performance.
                      </p>
                      <p>
                        I commit to applying the guidance provided, practicing the required behaviors, and completing all agreed-upon action steps within the set timelines. I will proactively seek clarification or support when needed and take accountability for demonstrating consistent and measurable improvement.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 pt-4 border-t border-border">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12px] font-medium text-foreground">Agent&apos;s Signature</span>
                      {rec.agentSignature?.at ? (
                        <div className="flex items-center gap-4 py-1">
                          <img
                            src={rec.agentSignature.signatureImage || getProfileSignature(rec.agentSignature.by, rec.agentSignature.by).src}
                            alt="Agent Signature"
                            className="h-12 max-w-[220px] object-contain rounded-md border border-border/80 bg-white p-1.5 shadow-sm"
                          />
                          <Badge variant="good">Attached</Badge>
                        </div>
                      ) : canEdit('AGENT_SIGNATURE') ? (
                        <button
                          type="button"
                          onClick={handleAttachAgentSignature}
                          className="flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/60 bg-primary/5 px-4 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                          <PenLine className="h-4 w-4" /> Click to attach saved signature
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground italic">
                          <Lock className="h-3.5 w-3.5" /> Signature pending
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                      <div>
                        <span className="text-muted-foreground block text-[11px] uppercase font-semibold">Name of Agent</span>
                        <span className="font-medium text-foreground">{rec.agentSignature?.by || rec.standard['Agent Name'] || '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px] uppercase font-semibold">Date of Acknowledgement</span>
                        <span className="font-medium text-foreground">{rec.agentSignature?.at ? formatDateTime(rec.agentSignature.at) : '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Supervisor / Team Leader */}
                <div className="flex flex-col justify-between gap-5 rounded-lg border border-border bg-card p-5">
                  <div className="flex flex-col gap-3">
                    <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wider">
                      Team Leader Acknowledgement & Commitment
                    </h3>
                    <div className="flex flex-col gap-3 text-[12.5px] italic text-muted-foreground leading-relaxed">
                      <p>
                        I acknowledge the observations and findings from the Quality Monitoring results and understand the behaviors identified for development. I recognize my responsibility to provide clear direction, coaching, and support to ensure the agent is equipped to succeed.
                      </p>
                      <p>
                        I commit to creating and executing SMART, actionable, and timely development plans aligned with the coaching discussion. I will closely monitor progress, provide feedback and resources as needed, and ensure follow-through on all actions until the expected behavioral improvement is achieved and sustained.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 pt-4 border-t border-border">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12px] font-medium text-foreground">Supervisor&apos;s Signature</span>
                      {rec.opsSignature?.at ? (
                        <div className="flex items-center gap-4 py-1">
                          <img
                            src={rec.opsSignature.signatureImage || getProfileSignature(rec.opsSignature.by, rec.opsSignature.by).src}
                            alt="Supervisor Signature"
                            className="h-12 max-w-[220px] object-contain rounded-md border border-border/80 bg-white p-1.5 shadow-sm"
                          />
                          <Badge variant="good">Attached</Badge>
                        </div>
                      ) : canEdit('OPS_SIGNATURE') ? (
                        <button
                          type="button"
                          onClick={handleAttachSupervisorSignature}
                          className="flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/60 bg-primary/5 px-4 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                          <PenLine className="h-4 w-4" /> Click to attach saved signature
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground italic">
                          <Lock className="h-3.5 w-3.5" /> Signature pending
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                      <div>
                        <span className="text-muted-foreground block text-[11px] uppercase font-semibold">Name of Supervisor</span>
                        <span className="font-medium text-foreground">{rec.opsSignature?.by || rec.standard['Supervisor'] || '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px] uppercase font-semibold">Date of Coaching</span>
                        <span className="font-medium text-foreground">{rec.opsSignature?.at ? formatDateTime(rec.opsSignature.at) : '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Stage action */}
          <Card>
            <CardBody className="flex flex-wrap items-center gap-3">
              <div className="text-[12.5px] text-muted-foreground">{blockers.message}</div>
              {STAGE_ACTION[stage] && canWorkStage(role, stage) && (
                <div className="ml-auto flex gap-2">
                  {canEdit('PARAMETERS') || canEdit('SECTION_D') || canEdit('SECTION_C') ? (
                    <Button size="sm" onClick={() => void persist()}>Save progress</Button>
                  ) : null}
                  <Button size="sm" variant="primary" onClick={() => void submitStage()} disabled={blockers.blocked}>
                    {STAGE_ACTION[stage]!.label} <ArrowRight className="h-[14px] w-[14px]" />
                  </Button>
                </div>
              )}
              {isMonitor && (
                <span className="ml-auto text-[11.5px] text-muted-foreground">
                  <Lock className="mr-1 inline h-3 w-3 align-[-1px]" />
                  Monitoring view — no actions available to {ROLE_LABELS[role]}.
                </span>
              )}
              {stage === 'QA_REVIEW' && canWorkStage(role, stage) && (
                <p className="w-full text-[11px] text-muted-foreground">
                  <Lock className="mr-1 inline h-3 w-3 align-[-1px]" />
                  Sections after Hold Attempt Details (Ops TL, signatures, acknowledgement) are hidden during QA Review and open only at their stage.
                </p>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

export default function CoachingPage() {
  return (
    <React.Suspense fallback={<div className="p-8 text-center text-[13px] text-muted-foreground">Loading coaching workspace…</div>}>
      <CoachingPageContent />
    </React.Suspense>
  );
}
