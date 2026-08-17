/**
 * Change-log diffing.
 *
 * Both the coaching-form repository and individual coaching forms are editable
 * at any point in their life, so every write has to answer three questions
 * afterwards: what changed, who changed it, and what was it before.
 *
 * The rule this file enforces: a change-log entry is derived from a real
 * before/after comparison, never supplied by the caller. A client that sends
 * its own "here's what I changed" list can lie, and an audit trail that can be
 * lied to is worse than none — it looks authoritative while being wrong.
 */

export interface ChangeEntry {
  /** Dotted path: "callId", "parameters.4.answer", "acknowledgement.agent". */
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Fields that are noise in an audit trail — timestamps the system maintains. */
const IGNORED = new Set(['updatedAt', 'createdAt', 'revision', 'qaScore']);

function normalize(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.trim() === '' ? null : s;
}

/**
 * Shallow diff of two records. Only keys present in `next` are considered, so
 * a PATCH that omits a field is not logged as clearing it.
 */
export function diffRecord(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix = '',
): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const [key, rawNext] of Object.entries(next)) {
    if (IGNORED.has(key)) continue;
    const before = normalize(previous[key]);
    const after = normalize(rawNext);
    if (before === after) continue;
    out.push({ field: prefix ? `${prefix}.${key}` : key, oldValue: before, newValue: after });
  }
  return out;
}

export interface Keyed {
  [key: string]: unknown;
}

/**
 * Diff two lists of records matched on a stable key (parameter id, attempt
 * number). Produces `.added` / `.removed` entries as well as field changes, so
 * removing a parameter from a template is recorded rather than inferred from a
 * gap in the numbering.
 */
export function diffList<T extends Keyed>(
  previous: readonly T[],
  next: readonly T[],
  options: { key: keyof T; prefix: string; label?: (item: T) => string },
): ChangeEntry[] {
  const { key, prefix, label } = options;
  const beforeMap = new Map(previous.map((p) => [String(p[key]), p]));
  const afterMap = new Map(next.map((n) => [String(n[key]), n]));
  const out: ChangeEntry[] = [];

  for (const [id, after] of afterMap) {
    const before = beforeMap.get(id);
    if (!before) {
      out.push({
        field: `${prefix}.${id}.added`,
        oldValue: null,
        newValue: label ? label(after) : JSON.stringify(after),
      });
      continue;
    }
    out.push(...diffRecord(before, after, `${prefix}.${id}`));
  }

  for (const [id, before] of beforeMap) {
    if (afterMap.has(id)) continue;
    out.push({
      field: `${prefix}.${id}.removed`,
      oldValue: label ? label(before) : JSON.stringify(before),
      newValue: null,
    });
  }

  return out;
}

/**
 * A change is "substantive" if it affects what was scored or acknowledged.
 * Only substantive changes bump the revision and supersede signatures —
 * otherwise fixing a typo in an observed-behavior note would force the agent
 * and their team leader to re-sign, and people would stop signing carefully.
 */
const NON_SUBSTANTIVE = [
  /^customerVerbatim$/,
  /^parameters\.[^.]+\.observedBehavior$/,
  /^actionPlan\./,
  /^rootCauses\.[^.]+\.(coachingPriority|gapId)$/,
];

export function isSubstantive(entry: ChangeEntry): boolean {
  return !NON_SUBSTANTIVE.some((re) => re.test(entry.field));
}

export function hasSubstantiveChange(entries: readonly ChangeEntry[]): boolean {
  return entries.some(isSubstantive);
}

/** Human-readable summary for the history panel. */
export function describeChange(entry: ChangeEntry): string {
  if (entry.field.endsWith('.added')) return `Added ${entry.newValue ?? 'item'}`;
  if (entry.field.endsWith('.removed')) return `Removed ${entry.oldValue ?? 'item'}`;
  const from = entry.oldValue ?? 'empty';
  const to = entry.newValue ?? 'empty';
  return `${entry.field}: ${from} → ${to}`;
}
