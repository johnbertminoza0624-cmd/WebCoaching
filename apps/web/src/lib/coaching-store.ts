'use client';

/**
 * Local store for Coaching records created by the Audit Upload flow.
 *
 * Each record snapshots the exact Coaching Form + version it was created from,
 * so later edits to the form never alter existing records (form-versioning rule).
 * This is the localStorage stand-in for what will become a real table; the shape
 * is deliberately the shape the API would return.
 */

import type { ParsedRecord } from './excel-template';
import { NEXT_STAGE, canAdvanceFrom, type FormStage, type Role } from '@awr/shared';
import type { FormTemplate } from './mock-data';
import type { CriticalType } from '@awr/shared';

const KEY = 'awr:coaching-records';

/**
 * Stages come from `@awr/shared` — the same definition the Prisma `FormStatus`
 * enum and the authorization model use. This module previously carried its own
 * four-value stage list, which could not express "Ops TL has started coaching"
 * and would have drifted from the canonical workflow.
 */
export type CoachingStage = FormStage;

/** Records saved before the workflow was unified carry the old stage names. */
const LEGACY_STAGE: Record<string, FormStage> = {
  QA_REVIEW: 'QA_REVIEW',
  PENDING_OPS_TL: 'RELEASED_TO_OPS',
  PENDING_AGENT: 'RELEASED_TO_AGENT',
  FINALIZED: 'FINALIZED',
};

export interface HoldAttempt {
  start: string;
  end: string;
  reason: string;
  valid: 'YES' | 'NO' | 'NA';
}

/** QA-owned "Section A — Operations-initiated audit findings", completed during
 * QA Review before the parameters. */
export interface SectionAData {
  ivrAuthed: string;      // Yes / No / N/A
  reverified: string;     // Yes / No / N/A
  nonIvr: string;         // Yes / No / N/A
  serviceCloud: string;   // Yes / No / N/A
  surveyed: string;       // Yes / No / N/A
  csat: string;           // 1..5 / Not surveyed
  controllable: string;   // Controllable / Non-controllable / N/A
  verbatim: string;       // free text
}

/** Row in Section C — Root Cause Analysis */
export interface RootCauseRow {
  parameterId: number | string; // sortOrder (1, 2, ...) or 'CSAT' | 'CRITICAL_ERRORS'
  parameterText: string;
  situation: string; // Default 'N/A'
  behavior: string;  // Default 'N/A'
  impact: string;    // Default 'N/A'
  priority: string;  // 'High' | 'Medium' | 'Low' | 'N/A' | ''
  rootCause: string; // Gap name or custom text
}

/** Ops TL-owned Section C — Root Cause Analysis */
export interface SectionCData {
  rows?: RootCauseRow[];
  rootCauses: string[];
  discussion?: string;
}

/** Item in Section D — SMART Action Plan (6 columns) */
export interface SmartActionItem {
  rootCause: string;
  activity: string;
  owner: string;
  deadline: string;
  successMeasure: string;
  goal: string;
}

export interface SectionDData {
  /** SMART action plan items authored by the Ops TL. */
  items: SmartActionItem[];
}

/** A captured signature: who signed, when, the signature image, and stage. */
export interface SignatureRecord {
  by: string;
  at: string;
  signatureImage?: string;
  source?: 'draw' | 'upload' | 'default' | 'profile';
}

export interface CoachingRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  stage: CoachingStage;
  /** Immutable snapshot — the form identity + structure this record was born from. */
  formId: string;
  formSlug: string;
  formName: string;
  formVersion: string;
  /** Includes `criticalType` so error-category analytics can be derived from
   *  the record itself, without re-reading the (mutable) template. */
  parameterSnapshot: { sortOrder: number; text: string; weight?: number; criticalType?: CriticalType }[];
  /** SOURCE OF TRUTH — imported from the .xlsx, never editable in the coaching UI. */
  standard: Record<string, string>;
  metaValues: Record<string, string>;
  params: Record<number, 'YES' | 'NO' | 'NA'>;
  /** QA-owned, added during QA Review. Keyed by parameter sortOrder. */
  qaObservations?: Record<number, string>;
  holdAttempts?: HoldAttempt[];
  sectionA?: SectionAData;
  /** Ops TL-owned, added at the Ops TL coaching stage. */
  sectionC?: SectionCData;
  sectionD?: SectionDData;
  opsSignature?: SignatureRecord;
  /** Agent-owned. Present only once the agent acknowledges. */
  agentSignature?: SignatureRecord;
  /**
   * When the record entered each stage, as ISO strings (localStorage cannot
   * hold Date objects). Mirrors the `qaReviewAt`/`releasedToOpsAt`/… columns on
   * the Prisma model; stage aging and time-in-stage are computed from these.
   */
  enteredAt: Partial<Record<FormStage, string>>;
  /** Workflow trail — who did what, when. */
  trail: { at: string; by: string; action: string }[];
}

export function loadCoachingRecords(): CoachingRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CoachingRecord[];
    // Normalise legacy stage names so records saved before the workflow was
    // unified still land in the right queue.
    return raw.map((r) => ({
      ...r,
      stage: LEGACY_STAGE[r.stage as string] ?? r.stage,
      enteredAt: r.enteredAt ?? { QA_REVIEW: r.createdAt },
    }));
  } catch { return []; }
}
export function saveCoachingRecords(records: CoachingRecord[]) {
  localStorage.setItem(KEY, JSON.stringify(records));
}

export function createRecordsFromUpload(
  form: FormTemplate,
  rows: ParsedRecord[],
  actor: string,
): CoachingRecord[] {
  const now = new Date().toISOString();
  const snapshot = [...form.params]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ sortOrder: p.sortOrder, text: p.text, weight: p.weight, criticalType: p.criticalType }));

  const created: CoachingRecord[] = rows.map((row) => ({
    id: crypto.randomUUID(),
    createdAt: now,
    createdBy: actor,
    stage: 'QA_REVIEW',
    enteredAt: { QA_REVIEW: now },
    formId: form.id,
    formSlug: form.slug,
    formName: form.name,
    formVersion: form.version,
    parameterSnapshot: snapshot,
    standard: row.standard,
    metaValues: row.metaValues,
    params: row.params,
    trail: [{ at: now, by: actor, action: `Uploaded from Excel · ${form.name} v${form.version}` }],
  }));

  saveCoachingRecords([...created, ...loadCoachingRecords()]);
  return created;
}

/** Patch a single record in place (used to save QA observations + hold attempts). */
export function updateRecord(id: string, patch: Partial<CoachingRecord>): void {
  saveCoachingRecords(loadCoachingRecords().map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

/**
 * Advance a record one stage, if this role is allowed to.
 *
 * The role check is not decoration: it is the same `canAdvanceFrom` the Audits
 * page and the API use, so a caller cannot move a record out of a stage it does
 * not own — including by tampering with a Call ID in the URL.
 *
 * Returns the new stage, or null when the move was refused.
 */
export function advanceStage(
  id: string,
  role: Role,
  actor: string,
  note?: string,
): FormStage | null {
  const records = loadCoachingRecords();
  const rec = records.find((r) => r.id === id);
  if (!rec) return null;

  if (!canAdvanceFrom(role, rec.stage)) return null;
  const next = NEXT_STAGE[rec.stage];
  if (!next) return null;

  const at = new Date().toISOString();
  saveCoachingRecords(records.map((r) => (
    r.id === id
      ? {
          ...r,
          stage: next,
          enteredAt: { ...r.enteredAt, [next]: at },
          trail: [...r.trail, { at, by: actor, action: note ?? `Moved to ${next}` }],
        }
      : r
  )));
  return next;
}

/** Advance a record from QA Review to the Ops TL stage. */
export function releaseToOpsTL(id: string, actor: string, role: Role = 'QA'): void {
  advanceStage(id, role, actor, 'Released to Ops TL');
}
