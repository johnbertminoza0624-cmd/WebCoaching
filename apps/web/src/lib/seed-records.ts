import {
  REASONS, ROSTER, AUDITORS, ROOT_CAUSE_GAPS, TEMPLATES, HOLD_REASONS,
  WORKFLOW_STAGES, stageIndex, type AuditStatus,
} from './mock-data';
import type { CoachingRecord } from './coaching-store';

/**
 * The seeded history, generated as canonical `CoachingRecord`s.
 *
 * This replaces the old `generateAudits()`, which produced a flat analytics
 * shape the coaching workflow could not open. Everything now starts life as the
 * same record type the upload flow creates, so a seeded audit and an uploaded
 * one are the same kind of thing — the audits table, the dashboards and the
 * coaching page all read one store.
 *
 * Deterministic (fixed seed), so the set is stable across reloads.
 */

function makeRng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmmss = (secs: number) =>
  [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');

/** Dwell hours per stage, used to space the stage timestamps realistically. */
const DWELL: Partial<Record<AuditStatus, [number, number]>> = {
  QA_REVIEW: [2, 30], RELEASED_TO_OPS: [4, 60], OPS_COACHING: [1, 20],
  RELEASED_TO_AGENT: [2, 40], AWAITING_AGENT_SIGNATURE: [1, 36],
};

function buildEnteredAt(stage: AuditStatus, auditDate: Date, rng: () => number) {
  const out: Partial<Record<AuditStatus, string>> = {};
  if (stage === 'VOIDED') return { VOIDED: iso(auditDate) };
  let cursor = auditDate.getTime();
  const upTo = stageIndex(stage);
  for (let i = 0; i <= upTo; i++) {
    const st = WORKFLOW_STAGES[i]!;
    out[st] = iso(new Date(cursor));
    const [lo, hi] = DWELL[st] ?? [0, 0];
    cursor += (lo + rng() * (hi - lo)) * 36e5;
  }
  return out;
}

export function seedCoachingRecords(count = 214): CoachingRecord[] {
  const rng = makeRng(20260723);
  const dispoNames = Object.keys(REASONS);
  const published = TEMPLATES.filter((t) => t.status === 'PUBLISHED');

  // Weighted so the funnel looks like a real programme: most records have made
  // it through, with a visible backlog pooling at the Ops TL stages.
  const statuses: AuditStatus[] = [
    'FINALIZED', 'FINALIZED', 'FINALIZED', 'FINALIZED', 'FINALIZED',
    'QA_REVIEW', 'QA_REVIEW',
    'RELEASED_TO_OPS', 'RELEASED_TO_OPS', 'RELEASED_TO_OPS',
    'OPS_COACHING', 'OPS_COACHING',
    'RELEASED_TO_AGENT',
    'AWAITING_AGENT_SIGNATURE',
    'VOIDED',
  ];

  const out: CoachingRecord[] = [];

  for (let i = 0; i < count; i++) {
    const roster = pick(rng, ROSTER);
    const tpl = pick(rng, published);
    const disposition = pick(rng, dispoNames);
    const reason = pick(rng, REASONS[disposition]!);
    const stage = pick(rng, statuses);
    let auditor = pick(rng, AUDITORS);

    /**
     * Elton Te owns the QA review queue for Wave 3.
     *
     * QA workload is assigned by wave in this programme, so a wave's pending
     * audits belong to one auditor rather than being scattered across the pod.
     * Without this, records at QA review are spread over every auditor and no
     * single QA has a queue big enough to work — or to test the workflow with.
     */
    if (stage === 'QA_REVIEW' && roster.wave === 'Wave 3') auditor = 'Elton Te';

    // Settled work spreads across the window; anything still moving is recent,
    // the way a real backlog is.
    const settled = stage === 'FINALIZED' || stage === 'VOIDED';
    const day = settled ? 1 + Math.floor(rng() * 55) : 56 + Math.floor(rng() * 5);
    const callDate = new Date(2026, 7, 1 + day);
    const auditDate = new Date(callDate.getTime() + (1 + Math.floor(rng() * 5)) * 864e5);

    const aht = 180 + Math.floor(rng() * 1200);
    const holdSec = rng() > 0.5 ? Math.floor(rng() * 400) : 0;

    const snapshot = [...tpl.params]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({ sortOrder: p.sortOrder, text: p.text, weight: p.weight, criticalType: p.criticalType }));

    // Most calls pass outright; failures skew to a single parameter. Scores are
    // now *derived* from these results rather than assigned, so the mix here is
    // what sets the score distribution — three failures against the heavier
    // weights drags a call well below 70, which should stay uncommon.
    const roll = rng();
    const failCount = roll > 0.94 ? 3 : roll > 0.78 ? 2 : roll > 0.5 ? 1 : 0;
    const failing = new Set<number>();
    while (failing.size < Math.min(failCount, snapshot.length)) {
      failing.add(pick(rng, snapshot).sortOrder);
    }

    const params: Record<number, 'YES' | 'NO' | 'NA'> = {};
    for (const p of snapshot) {
      params[p.sortOrder] = failing.has(p.sortOrder) ? 'NO' : rng() > 0.93 ? 'NA' : 'YES';
    }

    const pastQa = stageIndex(stage) > stageIndex('QA_REVIEW');
    const pastOps = stageIndex(stage) > stageIndex('OPS_COACHING');
    const signedByAgent = stage === 'FINALIZED';

    // A "No" always carries the observation QA is required to leave, so the
    // seeded history satisfies the same rule the UI enforces.
    const qaObservations: Record<number, string> = {};
    if (pastQa) {
      for (const p of snapshot) {
        if (params[p.sortOrder] === 'NO') {
          qaObservations[p.sortOrder] = `Agent missed this on the call — coached on the correct approach.`;
        }
      }
    }

    const surveyed = rng() > 0.55;
    const csat = surveyed ? (() => {
      const r = rng();
      return r > 0.55 ? 5 : r > 0.3 ? 4 : r > 0.18 ? 3 : r > 0.08 ? 2 : 1;
    })() : null;

    const enteredAt = buildEnteredAt(stage, auditDate, rng);
    const createdAt = enteredAt.QA_REVIEW ?? iso(auditDate);

    out.push({
      id: `seed-${i}`,
      createdAt,
      createdBy: auditor,
      stage,
      formId: tpl.id,
      formSlug: tpl.slug,
      formName: tpl.name,
      formVersion: tpl.version,
      parameterSnapshot: snapshot,
      standard: {
        'Agent Name': roster.name,
        'EID': roster.eid,
        'Supervisor': roster.supervisor,
        'Quality Auditor': auditor,
        'Call Date': ymd(callDate),
        'Audit Date': ymd(auditDate),
        'Disposition': disposition,
        'Call Reason': reason,
        'Call ID': String(90000000 + i * 7919),
        'AHT': hhmmss(aht),
        'Total Hold Time': hhmmss(holdSec),
      },
      metaValues: {},
      params,
      qaObservations: pastQa ? qaObservations : {},
      holdAttempts: pastQa && holdSec > 0
        ? [{ start: '00:00:30', end: hhmmss(30 + holdSec), reason: pick(rng, HOLD_REASONS), valid: rng() > 0.25 ? 'YES' : 'NO' }]
        : [],
      sectionA: pastQa ? {
        ivrAuthed: 'Yes', reverified: rng() > 0.3 ? 'Yes' : 'No', nonIvr: 'N/A',
        serviceCloud: rng() > 0.2 ? 'Yes' : 'No',
        surveyed: surveyed ? 'Yes' : 'No',
        csat: csat === null ? 'Not surveyed' : String(csat),
        controllable: csat !== null && csat <= 2
          ? (rng() > 0.4 ? 'Agent controllable' : 'Agent non-controllable')
          : 'N/A',
        verbatim: '',
      } : undefined,
      sectionC: pastOps ? {
        rows: [
          ...snapshot.map((p) => ({
            parameterId: p.sortOrder,
            parameterText: p.text,
            situation: params[p.sortOrder] === 'NO' ? (qaObservations[p.sortOrder] || 'Opportunity observed on call') : 'N/A',
            behavior: params[p.sortOrder] === 'NO' ? 'Did not adhere to required quality standard' : 'N/A',
            impact: params[p.sortOrder] === 'NO' ? 'Customer satisfaction and compliance' : 'N/A',
            priority: params[p.sortOrder] === 'NO' ? 'High' : 'N/A',
            rootCause: params[p.sortOrder] === 'NO' ? pick(rng, ROOT_CAUSE_GAPS.filter((g) => g !== 'No Gap found')) : '',
          })),
          {
            parameterId: 'CSAT',
            parameterText: 'CSAT Feedback',
            situation: surveyed ? (csat !== null && csat <= 3 ? `Customer survey score: ${csat}/5` : 'Positive CSAT survey') : 'N/A',
            behavior: surveyed && csat !== null && csat <= 3 ? 'Survey score below target' : 'N/A',
            impact: surveyed && csat !== null && csat <= 3 ? 'Customer retention and satisfaction' : 'N/A',
            priority: surveyed && csat !== null && csat <= 3 ? 'Medium' : 'N/A',
            rootCause: surveyed && csat !== null && csat <= 3 ? 'Communication Gap - Agent' : '',
          },
          {
            parameterId: 'CRITICAL_ERRORS',
            parameterText: 'Critical Error Count',
            situation: failCount > 0 ? `${failCount} parameter error(s) logged` : 'N/A',
            behavior: failCount > 0 ? 'Quality deviation identified during QA review' : 'N/A',
            impact: failCount > 0 ? 'Program quality and customer trust' : 'N/A',
            priority: failCount > 0 ? 'High' : 'N/A',
            rootCause: failCount > 0 ? 'Process Gap' : '',
          },
        ],
        rootCauses: [pick(rng, ROOT_CAUSE_GAPS.filter((g) => g !== 'No Gap found'))],
        discussion: 'Reviewed the call together and agreed on the corrective approach.',
      } : undefined,
      sectionD: pastOps ? {
        items: [{
          rootCause: pick(rng, ROOT_CAUSE_GAPS.filter((g) => g !== 'No Gap found')),
          activity: 'Review knowledge base standard operating procedure and complete mock scenario practice',
          owner: roster.name,
          deadline: ymd(new Date(auditDate.getTime() + 14 * 864e5)),
          successMeasure: 'Zero compliance errors in next 5 audits',
          goal: 'Achieve and sustain 100% quality score in subsequent audits',
        }],
      } : undefined,
      opsSignature: pastOps ? {
        by: roster.supervisor,
        at: enteredAt.RELEASED_TO_AGENT ?? createdAt,
        source: 'default',
      } : undefined,
      agentSignature: signedByAgent ? {
        by: roster.name,
        at: enteredAt.FINALIZED ?? createdAt,
        source: 'default',
      } : undefined,
      enteredAt,
      trail: [{ at: createdAt, by: auditor, action: `Uploaded from Excel · ${tpl.name} v${tpl.version}` }],
    });
  }

  return out;
}
