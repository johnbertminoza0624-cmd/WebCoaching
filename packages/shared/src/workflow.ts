import type { Role } from './rbac.js';

/**
 * The Coaching workflow — the one definition imported by BOTH sides.
 *
 * This mirrors the `FormStatus` enum in `packages/db/prisma/schema.prisma`
 * exactly, and exists for the same reason `scoring.ts` does: the stage a form
 * is in decides whose queue it sits in and which dashboard metric it feeds, so
 * the browser and the API must never hold two versions of that answer.
 *
 * If a stage is added here, add it to the Prisma enum in the same change.
 */
export const WORKFLOW_STAGES = [
  'QA_REVIEW',
  'RELEASED_TO_OPS',
  'OPS_COACHING',
  'RELEASED_TO_AGENT',
  'AWAITING_AGENT_SIGNATURE',
  'FINALIZED',
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

/**
 * Every state a form can hold. VOIDED sits outside the ordered sequence:
 * terminal, but never "completed", so it is excluded from both pending
 * workload and completion-rate denominators.
 */
export type FormStage = WorkflowStage | 'VOIDED';

export const STAGE_LABEL: Record<FormStage, string> = {
  QA_REVIEW: 'QA review',
  RELEASED_TO_OPS: 'Released to Ops TL',
  OPS_COACHING: 'Ops TL coaching',
  RELEASED_TO_AGENT: 'Released to agent',
  AWAITING_AGENT_SIGNATURE: 'Awaiting signature',
  FINALIZED: 'Finalized',
  VOIDED: 'Voided',
};

/** Position in the sequence; `-1` for VOIDED, which is not on it. */
export const stageIndex = (s: FormStage): number =>
  (WORKFLOW_STAGES as readonly FormStage[]).indexOf(s);

/** The one legal forward transition from each stage. `null` = terminal. */
export const NEXT_STAGE: Record<FormStage, FormStage | null> = {
  QA_REVIEW: 'RELEASED_TO_OPS',
  RELEASED_TO_OPS: 'OPS_COACHING',
  OPS_COACHING: 'RELEASED_TO_AGENT',
  RELEASED_TO_AGENT: 'AWAITING_AGENT_SIGNATURE',
  AWAITING_AGENT_SIGNATURE: 'FINALIZED',
  FINALIZED: null,
  VOIDED: null,
};

/**
 * Which role owns the next action at each stage. This is what makes the
 * dashboards trustworthy: a stage count can only change when the role
 * responsible for that stage acts.
 */
export const STAGE_OWNER: Record<FormStage, Role | null> = {
  QA_REVIEW: 'QA',
  RELEASED_TO_OPS: 'OPS_TEAM_LEAD',
  OPS_COACHING: 'OPS_TEAM_LEAD',
  RELEASED_TO_AGENT: 'AGENT',
  AWAITING_AGENT_SIGNATURE: 'AGENT',
  FINALIZED: null,
  VOIDED: null,
};

/** What the owning role's action button says at each stage. */
export const ACTION_LABEL: Record<FormStage, string | null> = {
  QA_REVIEW: 'Release audit to Ops TL',
  RELEASED_TO_OPS: 'Start coaching',
  OPS_COACHING: 'Sign and release to agent',
  RELEASED_TO_AGENT: 'Open for signature',
  AWAITING_AGENT_SIGNATURE: 'Acknowledge coaching',
  FINALIZED: null,
  VOIDED: null,
};

/**
 * Service-level target for each stage, in hours. A pending form older than its
 * target is overdue — the signal the bottleneck panel keys off.
 */
export const STAGE_SLA_HOURS: Record<FormStage, number> = {
  QA_REVIEW: 24,
  RELEASED_TO_OPS: 48,
  OPS_COACHING: 48,
  RELEASED_TO_AGENT: 72,
  AWAITING_AGENT_SIGNATURE: 72,
  FINALIZED: Infinity,
  VOIDED: Infinity,
};

/**
 * The `CoachingForm` column stamped when a form enters each stage. Keeping the
 * mapping here means aging queries and the UI agree on which column to read.
 */
export const STAGE_TIMESTAMP_FIELD: Record<WorkflowStage, string> = {
  QA_REVIEW: 'qaReviewAt',
  RELEASED_TO_OPS: 'releasedToOpsAt',
  OPS_COACHING: 'opsCoachingAt',
  RELEASED_TO_AGENT: 'releasedToAgentAt',
  AWAITING_AGENT_SIGNATURE: 'awaitingSignatureAt',
  FINALIZED: 'finalizedAt',
};

/** May this role advance a form out of `stage`? */
export function canAdvance(role: Role, stage: FormStage): boolean {
  const owner = STAGE_OWNER[stage];
  if (!owner || NEXT_STAGE[stage] === null) return false;
  // A QA Team Lead covers for QA on the review stage; nobody else may act on
  // another role's stage, so a stage count cannot move without its owner.
  if (owner === 'QA' && role === 'QA_TEAM_LEAD') return true;
  return role === owner;
}

export const isTerminal = (s: FormStage): boolean => NEXT_STAGE[s] === null;
/** Voided forms are neither pending nor complete. */
export const isLiveStage = (s: FormStage): boolean => s !== 'VOIDED';
export const isPendingStage = (s: FormStage): boolean => s !== 'VOIDED' && s !== 'FINALIZED';
