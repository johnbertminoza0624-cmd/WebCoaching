/**
 * Scoring — the single implementation, imported by BOTH the API and the web app.
 *
 * The browser runs this for instant feedback as an auditor fills the form; the
 * API runs the same functions to produce the authoritative stored values. Two
 * implementations would eventually disagree, and the one users saw on screen is
 * not the one that got signed.
 *
 * Mirrors the workbook:
 *   score       = IF(answer="No", 0, weight)
 *   qaScore     = SUM(scores)
 *   errorCount  = COUNTIFS(criticalType, type, answer, "No")
 *   csatCategory= IF(>3,"SAT",IF(>2,"Neutral",IF(>0,"DSAT","Not Surveyed")))
 */

export type AnswerValue = 'YES' | 'NO' | 'NA';
/**
 * COMPLIANCE joins the original three (workbook-derived) categories as a
 * fourth genuine critical type — a regulatory/policy failure, distinct from a
 * business-outcome one. NON_CRITICAL is different in kind: it marks a
 * parameter as *not* carrying critical weight at all (a best-practice check,
 * not a failure severity), so it is deliberately excluded from every
 * "critical error" count below rather than being a fourth thing to tally.
 */
export type CriticalType = 'CUSTOMER' | 'PROCESS' | 'BUSINESS' | 'COMPLIANCE' | 'NON_CRITICAL';
export type ImpactType =
  | 'CUSTOMER_IMPACTING' | 'PROCESS_DEFECT' | 'BUSINESS_IMPACTING' | 'COMPLIANCE_IMPACTING' | 'NO_IMPACT';
export type RespondentCategory = 'SAT' | 'NEUTRAL' | 'DSAT' | 'NOT_SURVEYED';

export const IMPACT_BY_TYPE: Record<CriticalType, ImpactType> = {
  CUSTOMER: 'CUSTOMER_IMPACTING',
  PROCESS: 'PROCESS_DEFECT',
  BUSINESS: 'BUSINESS_IMPACTING',
  COMPLIANCE: 'COMPLIANCE_IMPACTING',
  NON_CRITICAL: 'NO_IMPACT',
};

export interface ScorableParameter {
  sortOrder: number;
  criticalType: CriticalType;
  weight: number;
  answer: AnswerValue;
  observedBehavior?: string | null;
}

export interface ScoreResult {
  /** 0..1, rounded to 4dp to match the Decimal(6,4) column. */
  qaScore: number;
  /** Same value as a display percentage, e.g. 91.4 */
  percentage: number;
  customerCriticalCount: number;
  processCriticalCount: number;
  businessCriticalCount: number;
  complianceCriticalCount: number;
  /** Tracked separately — never summed into a "critical errors" total. */
  nonCriticalFailCount: number;
  failedSortOrders: number[];
}

/** Floating-point sums of 0.05/0.15/0.2 drift (0.30000000000000004). Round hard. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function scoreForm(parameters: readonly ScorableParameter[]): ScoreResult {
  let total = 0;
  const counts: Record<CriticalType, number> = {
    CUSTOMER: 0, PROCESS: 0, BUSINESS: 0, COMPLIANCE: 0, NON_CRITICAL: 0,
  };
  const failed: number[] = [];

  for (const p of parameters) {
    if (p.answer === 'NO') {
      counts[p.criticalType] += 1;
      failed.push(p.sortOrder);
      // score contribution is 0
    } else {
      // NA scores the same as YES — the workbook only zeroes on an explicit "No".
      total += p.weight;
    }
  }

  const qaScore = round4(total);
  return {
    qaScore,
    percentage: round4(qaScore * 100),
    customerCriticalCount: counts.CUSTOMER,
    processCriticalCount: counts.PROCESS,
    businessCriticalCount: counts.BUSINESS,
    complianceCriticalCount: counts.COMPLIANCE,
    nonCriticalFailCount: counts.NON_CRITICAL,
    failedSortOrders: failed.sort((a, b) => a - b),
  };
}

/**
 * Template weights must total exactly 1. Enforced when a QA Manager saves a
 * template — a template summing to 0.95 silently caps every agent at 95%.
 */
export function validateWeights(weights: readonly number[]): { ok: boolean; total: number } {
  const total = round4(weights.reduce((a, b) => a + b, 0));
  return { ok: total === 1, total };
}

/**
 * Weights are STORED as fractions (0.05) — that is what the scoring maths and
 * the `Decimal(6,4)` column use — but they are always DISPLAYED as percentages.
 *
 * Keep this the only place that converts. Scattering `* 100` through the UI is
 * how a weight eventually gets persisted as `20` instead of `0.20`, which
 * validates as a 2000% template and is very hard to spot afterwards.
 *
 * Trailing zeros are trimmed: 0.05 -> "5%", 0.075 -> "7.5%".
 */
export function formatWeightPercent(weight: number): string {
  const n = Math.round(weight * 1000) / 10;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/** Inverse, for parsing a percentage typed into the template editor. */
export function parseWeightPercent(input: string): number {
  const n = Number(String(input).replace('%', '').trim());
  if (!Number.isFinite(n)) throw new Error(`Invalid weight "${input}"`);
  return round4(n / 100);
}

export function csatCategory(surveyed: boolean, score: number | null | undefined): RespondentCategory {
  if (!surveyed || score == null || score <= 0) return 'NOT_SURVEYED';
  if (score > 3) return 'SAT';
  if (score > 2) return 'NEUTRAL';
  return 'DSAT';
}

// ------------------------------------------------------------------
// Hold time
// ------------------------------------------------------------------

/**
 * Durations are integer seconds everywhere. A hold that crosses midnight would
 * otherwise come out negative, so wrap into the next day.
 */
export function holdDurationSeconds(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  let seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  if (seconds < 0) seconds += 24 * 60 * 60;
  return seconds;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [h, m, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

export function parseDuration(hhmmss: string): number {
  const parts = hhmmss.split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid duration "${hhmmss}" — expected HH:MM:SS`);
  }
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

// ------------------------------------------------------------------
// Section C — root cause rows derived from failures
// ------------------------------------------------------------------

export interface DerivedRootCause {
  sortOrder: number | null;
  syntheticSource: string | null;
  situation: string;
  behavior: string | null;
  impact: ImpactType;
}

/**
 * Section C in the workbook is entirely formula-driven: one row per failed
 * parameter, plus a CSAT row when the survey came back DSAT and a summary row
 * when three or more critical errors were observed. Reproduced here so the API
 * generates these rows rather than trusting the client to send them.
 */
export function deriveRootCauses(
  parameters: readonly ScorableParameter[],
  csat: { category: RespondentCategory; controllable?: boolean },
): DerivedRootCause[] {
  const rows: DerivedRootCause[] = [];

  for (const p of parameters) {
    if (p.answer !== 'NO') continue;
    rows.push({
      sortOrder: p.sortOrder,
      syntheticSource: null,
      situation: 'Markdown on Parameter',
      behavior: p.observedBehavior?.trim() || null,
      impact: IMPACT_BY_TYPE[p.criticalType],
    });
  }

  if (csat.category === 'DSAT') {
    rows.push({
      sortOrder: null,
      syntheticSource: 'CSAT_FEEDBACK',
      situation: 'DSAT',
      behavior: null,
      impact: 'CUSTOMER_IMPACTING',
    });
  }

  const totalErrors = rows.filter((r) => r.syntheticSource === null).length;
  if (totalErrors > 2) {
    // The workbook attributes the summary row to the most frequent error type.
    const tally: Record<CriticalType, number> = {
      CUSTOMER: 0, PROCESS: 0, BUSINESS: 0, COMPLIANCE: 0, NON_CRITICAL: 0,
    };
    for (const p of parameters) if (p.answer === 'NO') tally[p.criticalType] += 1;
    const dominant = (Object.keys(tally) as CriticalType[]).reduce((a, b) =>
      tally[b] > tally[a] ? b : a,
    );
    rows.push({
      sortOrder: null,
      syntheticSource: 'CRITICAL_ERROR_COUNT',
      situation: 'Multiple Critical Errors Observed',
      behavior: null,
      impact: IMPACT_BY_TYPE[dominant],
    });
  }

  return rows;
}
