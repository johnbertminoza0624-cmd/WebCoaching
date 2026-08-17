import { canSeeRecord } from '@awr/shared';
import {
  WORKFLOW_STAGES, STATUS_LABEL, STAGE_SLA_HOURS, stageIndex, hoursInStage,
  type Audit, type AuditStatus, type AppUser, type Role,
} from '@/lib/mock-data';

/**
 * Every Dashboard number in the app is computed here, from one input: the
 * Coaching records as they currently stand on the Audits page, plus the role of
 * whoever is looking. Nothing in this module keeps its own counters, and no
 * metric is derived from "how many audits were uploaded" — a record is only
 * counted as complete once it actually reaches FINALIZED.
 */

// ------------------------------------------------------------------
// 1. Scope — which records may this user see at all?
// ------------------------------------------------------------------

/**
 * Mirrors the Audits page's access rules exactly. The Dashboard is a
 * visualisation layer over the same rows, never a second permission system, so
 * both screens call this and neither can widen the other's visibility.
 */
export function scopeAudits(audits: readonly Audit[], user: AppUser): Audit[] {
  // Two independent gates. Scope answers "whose rows", the visibility floor
  // answers "has the workflow reached this role yet" — an Ops TL is in scope
  // for their team's audits long before QA releases one to them, and must not
  // see it until then.
  const reached = audits.filter((a) => canSeeRecord(user.role, a.status));
  return scopeByOrg(reached, user);
}

function scopeByOrg(audits: readonly Audit[], user: AppUser): Audit[] {
  switch (user.role) {
    // Own records only, matched on employee ID rather than display name —
    // two agents can share a name, they cannot share an EID.
    case 'AGENT':
      return audits.filter((a) => a.eid === user.eid);

    // Their own teams. `AppUser.team` lists waves joined by "·".
    case 'OPS_TEAM_LEAD': {
      const waves = user.team.split('·').map((w) => w.trim()).filter(Boolean);
      return audits.filter((a) => a.supervisor === user.name || waves.includes(a.wave));
    }

    // An individual QA sees the audits they scored.
    case 'QA':
      return audits.filter((a) => a.auditor === user.name);

    // Account-wide and platform-wide roles see everything in the set.
    case 'QA_TEAM_LEAD':
    case 'QA_MANAGER':
    case 'OPS_ACCOUNT_MANAGER':
    case 'SERVICE_DELIVERY_MANAGER':
    case 'ADMIN':
      return [...audits];
  }
}

// ------------------------------------------------------------------
// 2. Stage classification
// ------------------------------------------------------------------

/** Records at each stage. Drives the funnel, the bottleneck panel and the KPIs. */
export function countByStage(audits: readonly Audit[]): Record<AuditStatus, number> {
  const out = {
    QA_REVIEW: 0, RELEASED_TO_OPS: 0, OPS_COACHING: 0,
    RELEASED_TO_AGENT: 0, AWAITING_AGENT_SIGNATURE: 0, FINALIZED: 0, VOIDED: 0,
  } satisfies Record<AuditStatus, number>;
  for (const a of audits) out[a.status] += 1;
  return out;
}

/** Voided records are neither pending nor complete; they leave the denominator. */
export const isLive = (a: Audit) => a.status !== 'VOIDED';
export const isPending = (a: Audit) => isLive(a) && a.status !== 'FINALIZED';

/**
 * Has the record *reached* a stage — i.e. is it at or past it? Completion rates
 * for a stage must divide by the records that actually got that far, otherwise
 * a fresh upload would drag down the Ops TL's rate before they ever saw it.
 */
export const hasReached = (a: Audit, stage: AuditStatus) =>
  isLive(a) && stageIndex(a.status) >= stageIndex(stage);

const rate = (num: number, den: number) => (den ? (num / den) * 100 : 0);

// ------------------------------------------------------------------
// 3. Funnel, aging and bottlenecks
// ------------------------------------------------------------------

export interface FunnelStage {
  stage: AuditStatus;
  label: string;
  count: number;
  /** Share of the live (non-voided) set sitting here right now. */
  pct: number;
  overdue: number;
  avgHours: number;
  isBottleneck: boolean;
}

/**
 * @param role omit for a full-pipeline funnel; pass a role to drop the stages
 *        that role can never see. Rendering "QA review — 0" to an Ops TL who is
 *        not shown pre-release records states something false: there are
 *        upstream records, they are just not theirs to see.
 */
export function buildFunnel(audits: readonly Audit[], now: Date, role?: Role): FunnelStage[] {
  const live = audits.filter(isLive);
  const counts = countByStage(audits);

  const stages = role
    ? WORKFLOW_STAGES.filter((stage) => canSeeRecord(role, stage))
    : WORKFLOW_STAGES;

  const rows = stages.map((stage) => {
    const inStage = live.filter((a) => a.status === stage);
    const overdue = inStage.filter((a) => hoursInStage(a, now) > STAGE_SLA_HOURS[stage]).length;
    const avgHours = inStage.length
      ? inStage.reduce((s, a) => s + hoursInStage(a, now), 0) / inStage.length
      : 0;
    return {
      stage,
      label: STATUS_LABEL[stage],
      count: counts[stage],
      pct: rate(counts[stage], live.length),
      overdue,
      avgHours,
      isBottleneck: false,
    };
  });

  // The bottleneck is the *pending* stage holding the most records — FINALIZED
  // is excluded because a large finalized pile is the goal, not a problem.
  const pending = rows.filter((r) => r.stage !== 'FINALIZED');
  const worst = pending.reduce((a, b) => (b.count > a.count ? b : a), pending[0]!);
  if (worst && worst.count > 0) worst.isBottleneck = true;

  return rows;
}

/**
 * Average hours records spent *passing through* each stage, measured from the
 * completed transitions in the set. Distinct from a funnel row's `avgHours`,
 * which is how long the records currently parked there have been waiting.
 */
export function avgTimeInStage(
  audits: readonly Audit[],
  role?: Role,
): { stage: AuditStatus; label: string; hours: number; n: number }[] {
  const stages = WORKFLOW_STAGES.slice(0, -1)
    .filter((stage) => !role || canSeeRecord(role, stage));
  return stages.map((stage) => {
    const i = WORKFLOW_STAGES.indexOf(stage);
    const next = WORKFLOW_STAGES[i + 1]!;
    const spans: number[] = [];
    for (const a of audits) {
      const from = a.enteredAt[stage];
      const to = a.enteredAt[next];
      if (from && to) spans.push((to.getTime() - from.getTime()) / 36e5);
    }
    return {
      stage,
      label: STATUS_LABEL[stage],
      hours: spans.length ? spans.reduce((s, h) => s + h, 0) / spans.length : 0,
      n: spans.length,
    };
  });
}

// ------------------------------------------------------------------
// 4. Role-based KPI sets
// ------------------------------------------------------------------

export interface Kpi {
  label: string;
  value: string;
  unit?: string;
  meta: string;
  stripe: 'good' | 'warn' | 'critical' | 'info';
  /**
   * Clicking the tile deep-links to the Audits page pre-filtered to these
   * stages. A tile that sums two stages must list both, or the row count the
   * user lands on would contradict the number they just clicked.
   */
  stages?: AuditStatus[];
}

const n = (x: number) => String(x);
const pct = (x: number) => x.toFixed(1);

/**
 * The role decides which slice of the workflow is "my workload". The same
 * record contributes to different tiles for different people, and to nobody's
 * pending count once it is finalized.
 */
export function kpisForRole(audits: readonly Audit[], role: Role, now: Date): Kpi[] {
  const c = countByStage(audits);
  const live = audits.filter(isLive);
  const finalized = c.FINALIZED;
  const overdue = live.filter((a) => isPending(a) && hoursInStage(a, now) > STAGE_SLA_HOURS[a.status]).length;

  const opsPending = c.RELEASED_TO_OPS;
  const opsActive = c.OPS_COACHING;
  const agentPending = c.RELEASED_TO_AGENT + c.AWAITING_AGENT_SIGNATURE;

  switch (role) {
    // ---- Agent: their own coaching only, and only two questions matter ----
    case 'AGENT': {
      // "Received" means actually released to the agent — a record still in QA
      // review has never reached them, so counting it would understate their
      // acknowledgement rate for work they were never given.
      const received = live.filter((a) => hasReached(a, 'RELEASED_TO_AGENT')).length;
      const upstream = live.length - received;
      return [
        { label: 'Pending signature', value: n(agentPending), stripe: 'warn', stages: ['RELEASED_TO_AGENT', 'AWAITING_AGENT_SIGNATURE'],
          meta: agentPending ? 'Waiting on your acknowledgement' : 'Nothing waiting on you' },
        { label: 'Completed coaching', value: n(finalized), stripe: 'good', stages: ['FINALIZED'],
          meta: 'Acknowledged and closed' },
        { label: 'Total received', value: n(received), stripe: 'info',
          meta: upstream ? `${upstream} more still upstream with QA or your TL` : 'Coaching released to you to date' },
        { label: 'Acknowledgement rate', value: pct(rate(finalized, received)), unit: '%', stripe: 'good',
          meta: `${finalized} of ${received} released to you` },
      ];
    }

    // ---- Ops TL: the queue they personally have to work ----
    case 'OPS_TEAM_LEAD': {
      const reachedOps = live.filter((a) => hasReached(a, 'RELEASED_TO_OPS')).length;
      const clearedOps = live.filter((a) => hasReached(a, 'RELEASED_TO_AGENT')).length;
      return [
        { label: 'Pending coaching', value: n(opsPending), stripe: 'warn', stages: ['RELEASED_TO_OPS'],
          meta: 'Released to you, not yet started' },
        { label: 'Active coaching', value: n(opsActive), stripe: 'info', stages: ['OPS_COACHING'],
          meta: 'In progress with you now' },
        { label: 'Awaiting agent', value: n(agentPending), stripe: 'warn', stages: ['RELEASED_TO_AGENT', 'AWAITING_AGENT_SIGNATURE'],
          meta: 'You released these — pending acknowledgement' },
        { label: 'Ops TL completion rate', value: pct(rate(clearedOps, reachedOps)), unit: '%', stripe: 'good',
          meta: `${clearedOps} of ${reachedOps} that reached your stage` },
      ];
    }

    // ---- Individual QA: their own audits, up to the hand-off ----
    case 'QA': {
      const reviewed = live.filter((a) => hasReached(a, 'RELEASED_TO_OPS')).length;
      const qaOverdue = live.filter((a) => a.status === 'QA_REVIEW' && hoursInStage(a, now) > STAGE_SLA_HOURS.QA_REVIEW).length;
      return [
        { label: 'Pending QA review', value: n(c.QA_REVIEW), stripe: 'warn', stages: ['QA_REVIEW'],
          meta: qaOverdue ? `${qaOverdue} past the 24h target` : 'All within the 24h target' },
        { label: 'Released to Ops TL', value: n(reviewed), stripe: 'info',
          meta: 'Your part of the workflow is done' },
        { label: 'QA completion rate', value: pct(rate(reviewed, live.length)), unit: '%', stripe: 'good',
          meta: `${reviewed} of ${live.length} of your audits released` },
        { label: 'Finalized', value: n(finalized), stripe: 'good', stages: ['FINALIZED'],
          meta: 'Acknowledged by the agent' },
      ];
    }

    // ---- Management: whole-pipeline view ----
    default: {
      return [
        { label: 'Pending QA review', value: n(c.QA_REVIEW), stripe: 'warn', stages: ['QA_REVIEW'],
          meta: 'Not yet released to Ops TL' },
        { label: 'Pending Ops TL', value: n(opsPending + opsActive), stripe: 'warn', stages: ['RELEASED_TO_OPS', 'OPS_COACHING'],
          meta: `${opsPending} queued · ${opsActive} in progress` },
        { label: 'Pending agent', value: n(agentPending), stripe: 'warn', stages: ['RELEASED_TO_AGENT', 'AWAITING_AGENT_SIGNATURE'],
          meta: 'Awaiting acknowledgement' },
        { label: 'Overall completion', value: pct(rate(finalized, live.length)), unit: '%', stripe: 'good',
          meta: `${finalized} finalized of ${live.length} live · ${overdue} overdue` },
      ];
    }
  }
}

/**
 * Stage completion rates, each measured only against the records that actually
 * reached that stage — never mixed across stages.
 */
export function stageRates(audits: readonly Audit[], role?: Role) {
  const live = audits.filter(isLive);
  const reached = (s: AuditStatus) => live.filter((a) => hasReached(a, s)).length;

  // A rate is only meaningful to someone who can see the stage it starts from.
  // An Ops TL never sees a record before it is released, so a "QA completion
  // rate" over their visible set would always read 100% and mean nothing.
  const shows = (from: AuditStatus) => !role || canSeeRecord(role, from);

  return {
    qa: shows('QA_REVIEW')
      ? { done: reached('RELEASED_TO_OPS'), total: live.length, pct: rate(reached('RELEASED_TO_OPS'), live.length) }
      : null,
    ops: shows('RELEASED_TO_OPS')
      ? { done: reached('RELEASED_TO_AGENT'), total: reached('RELEASED_TO_OPS'), pct: rate(reached('RELEASED_TO_AGENT'), reached('RELEASED_TO_OPS')) }
      : null,
    agent: shows('RELEASED_TO_AGENT')
      ? { done: reached('FINALIZED'), total: reached('RELEASED_TO_AGENT'), pct: rate(reached('FINALIZED'), reached('RELEASED_TO_AGENT')) }
      : null,
  };
}

/** Volume breakdowns for the manager-level dashboards. */
export function volumeBy(audits: readonly Audit[], key: 'wave' | 'supervisor' | 'auditor', limit = 6) {
  const map = new Map<string, { total: number; pending: number; finalized: number }>();
  for (const a of audits) {
    if (!isLive(a)) continue;
    const row = map.get(a[key]) ?? { total: 0, pending: 0, finalized: 0 };
    row.total += 1;
    if (a.status === 'FINALIZED') row.finalized += 1; else row.pending += 1;
    map.set(a[key], row);
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** Roles that get the broad management dashboard rather than a personal queue. */
export const MANAGEMENT_ROLES: Role[] = [
  'QA_TEAM_LEAD', 'QA_MANAGER', 'OPS_ACCOUNT_MANAGER', 'SERVICE_DELIVERY_MANAGER', 'ADMIN',
];
export const isManagement = (r: Role) => MANAGEMENT_ROLES.includes(r);
