import type { CoachingRecord } from './coaching-store';
import { ROSTER, TEMPLATES, type Audit, type AuditStatus } from './mock-data';

/**
 * Projects a canonical `CoachingRecord` into the flat `Audit` shape the audits
 * table and the dashboards consume.
 *
 * There is exactly one stored record type. `Audit` is a *view* of it, computed
 * on read — not a second dataset. Before this existed the audits list and the
 * coaching page read two unrelated stores, so a coaching record could never be
 * opened from the audits table and the dashboards summarised rows the coaching
 * workflow had never heard of.
 *
 * Everything here is derived. Nothing is stored twice, so the two cannot drift.
 */

/** Seconds from "HH:MM:SS", "MM:SS", or a plain seconds count. */
export function durationSeconds(v: string | undefined): number {
  const t = (v ?? '').trim();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Tolerates the several date shapes an uploaded spreadsheet can carry. */
function parseDate(v: string | undefined): Date {
  const t = (v ?? '').trim();
  if (!t) return new Date(0);
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso);
  // DD/MM/YYYY or MM/DD/YYYY — assume the US order the workbook uses.
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return new Date(0);
}

/** Weighted where the form carried weights, otherwise a share of scorables. */
export function scoreOf(rec: CoachingRecord): number {
  const ps = rec.parameterSnapshot;
  const weighted = ps.length > 0 && ps.every((p) => typeof p.weight === 'number');
  let earned = 0;
  let possible = 0;
  for (const p of ps) {
    const r = rec.params[p.sortOrder] ?? 'NA';
    if (r === 'NA') continue;
    const w = weighted ? (p.weight as number) : 1;
    possible += w;
    if (r === 'YES') earned += w;
  }
  return possible > 0 ? Math.round((earned / possible) * 100) : 100;
}

const CSAT_CATEGORY = (score: number | null, surveyed: boolean): Audit['category'] => {
  if (!surveyed || score === null) return 'Not Surveyed';
  return score > 3 ? 'SAT' : score > 2 ? 'Neutral' : 'DSAT';
};

export function toAudit(rec: CoachingRecord): Audit {
  const std = rec.standard;
  const eid = std['EID'] ?? '';

  // Wave is not a spreadsheet column — it comes from the roster relationship
  // (agent -> wave -> supervisor), which is what drives team-level scope.
  const rosterEntry = ROSTER.find((r) => r.eid === eid);

  // Critical-error counts, bucketed by the parameter's critical type. Only
  // failures count; N/A and passes do not.
  const errs = { customer: 0, process: 0, business: 0, compliance: 0 };
  for (const p of rec.parameterSnapshot) {
    if ((rec.params[p.sortOrder] ?? 'NA') !== 'NO') continue;
    switch (p.criticalType) {
      case 'CUSTOMER': errs.customer += 1; break;
      case 'PROCESS': errs.process += 1; break;
      case 'BUSINESS': errs.business += 1; break;
      case 'COMPLIANCE': errs.compliance += 1; break;
      default: break; // NON_CRITICAL and unknown types are not critical errors
    }
  }

  // CSAT and controllability are QA-entered in section A, so they only exist
  // once QA has worked the record.
  const a = rec.sectionA;
  const surveyed = a?.surveyed === 'Yes';
  const csatRaw = Number(a?.csat);
  const csat = surveyed && Number.isFinite(csatRaw) && csatRaw > 0 ? csatRaw : null;

  const template = TEMPLATES.find((t) => t.id === rec.formId);

  const enteredAt: Audit['enteredAt'] = {};
  for (const [stage, iso] of Object.entries(rec.enteredAt ?? {})) {
    if (iso) enteredAt[stage as AuditStatus] = new Date(iso);
  }

  return {
    id: rec.id,
    ref: std['Call ID'] || rec.id.slice(0, 8),
    agent: std['Agent Name'] ?? '',
    eid,
    wave: rosterEntry?.wave ?? '—',
    supervisor: std['Supervisor'] ?? rosterEntry?.supervisor ?? '',
    auditor: std['Quality Auditor'] ?? '',
    formId: rec.formId,
    formShort: template?.lineOfBusiness ?? rec.formName,
    version: rec.formVersion,
    disposition: std['Disposition'] ?? '',
    reason: std['Call Reason'] ?? '',
    callDate: parseDate(std['Call Date']),
    auditDate: parseDate(std['Audit Date']),
    aht: durationSeconds(std['AHT']),
    holdSec: durationSeconds(std['Total Hold Time']),
    score: scoreOf(rec),
    errs,
    totalErrs: errs.customer + errs.process + errs.business + errs.compliance,
    surveyed,
    csat,
    category: CSAT_CATEGORY(csat, surveyed),
    controllable:
      a?.controllable === 'Agent controllable' ? 'AgentControllable'
        : a?.controllable === 'Agent non-controllable' ? 'AgentNonControllable'
          : null,
    gaps: rec.sectionC?.rootCauses ?? [],
    status: rec.stage,
    signedAgent: !!rec.agentSignature,
    signedTL: !!rec.opsSignature,
    enteredAt,
  };
}

export const toAudits = (records: readonly CoachingRecord[]): Audit[] => records.map(toAudit);
