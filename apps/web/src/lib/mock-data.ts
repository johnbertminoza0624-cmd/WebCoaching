/**
 * Mock data for the six screens, until a real Postgres is available to seed
 * and query. Structured to match the Prisma schema's shape (Role, FormStatus,
 * CriticalType, etc.) so swapping this module for real API calls later is a
 * data-fetching change, not a component rewrite.
 */
import {
  formatWeightPercent, scoreForm, type CriticalType,
  WORKFLOW_STAGES, STAGE_LABEL, STAGE_OWNER, NEXT_STAGE, ACTION_LABEL,
  STAGE_SLA_HOURS, stageIndex, type FormStage,
} from '@awr/shared';

// ------------------------------------------------------------------
// Roles (packages/shared/src/rbac.ts)
// ------------------------------------------------------------------
export const ROLES = [
  'AGENT',
  'OPS_TEAM_LEAD',
  'QA',
  'QA_TEAM_LEAD',
  'OPS_ACCOUNT_MANAGER',
  'QA_MANAGER',
  'SERVICE_DELIVERY_MANAGER',
  'ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  AGENT: 'Agent',
  OPS_TEAM_LEAD: 'Ops Team Lead',
  QA: 'QA',
  QA_TEAM_LEAD: 'QA Team Lead',
  OPS_ACCOUNT_MANAGER: 'Ops Account Manager',
  QA_MANAGER: 'QA Manager',
  SERVICE_DELIVERY_MANAGER: 'Service Delivery Manager',
  ADMIN: 'Admin',
};

export const ROLE_SCOPE: Record<Role, string> = {
  AGENT: 'Own records',
  OPS_TEAM_LEAD: 'Their teams',
  QA: 'Own audits',
  QA_TEAM_LEAD: 'Whole account',
  OPS_ACCOUNT_MANAGER: 'Whole account',
  QA_MANAGER: 'Whole account',
  SERVICE_DELIVERY_MANAGER: 'All accounts',
  ADMIN: 'All accounts',
};

// ------------------------------------------------------------------
// Reference lists (from the workbook's Reference sheet)
// ------------------------------------------------------------------
export const REASONS: Record<string, string[]> = {
  Claims: [
    'Claims - Deemed Unit', 'No Technicians / NPPO', 'Escalation', 'Proposal',
    'Parts and Claims', 'Dispatch (No agent staff)', 'Update Unit', 'Reassignment',
    'Claim Modernization', 'Others',
  ],
  Billing: [
    'Proration', 'Charges - Paid in System', 'Service Due', 'Suspended',
    'Payment Reversal', 'Converted Charges', 'Dunning', 'Others',
  ],
  Leasing: ['Buy Out', 'Removal', 'Rewrite', 'Enrollment', 'Others'],
  Retention: ['Cancellation', 'Enrollment - New Property', 'Change (Multiple Address)', 'Others'],
  Others: ['SAR Approval', 'No Product Available', 'Checking Notes', 'Payment Update', 'Eligibility and Benefits', 'Others'],
};
export const DISPOSITIONS = Object.keys(REASONS);

export const ROOT_CAUSE_GAPS = [
  'Knowledge Gap - Product', 'Knowledge Gap - Navigation', 'Knowledge Gap - Policy',
  'Process Gap', 'Communication Gap - Agent', 'No Gap found',
];

export const HOLD_REASONS = [
  'Review account details', 'Review bundle proposal', 'Review bundle coverage',
  'Look for Supervisor', 'Transfer to another department', 'Other',
];

// ------------------------------------------------------------------
// Form templates (the repository)
// ------------------------------------------------------------------
export interface TemplateParam {
  sortOrder: number;
  criticalType: CriticalType;
  text: string;
  weight: number;
}
/** The input types a custom metadata field can accept. Drives both the
 * control rendered on the audit form and how its value is validated. */
export type MetaFieldType = 'text' | 'number' | 'integer' | 'date' | 'time';

export const META_FIELD_TYPES: { value: MetaFieldType; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'Any text' },
  { value: 'number', label: 'Number', hint: 'Decimals allowed' },
  { value: 'integer', label: 'Whole number', hint: 'No decimals' },
  { value: 'date', label: 'Date', hint: 'Calendar date' },
  { value: 'time', label: 'Time', hint: 'HH:MM' },
];

/** A custom capture field a QA Manager defines on a form. When the form is
 * used to audit, these render in the first section alongside Call ID / AHT. */
export interface MetaField {
  id: string;
  label: string;
  type: MetaFieldType;
  required: boolean;
}

/** Validate a captured value against a field's declared type. Returns an
 * error string, or null when the value is acceptable. */
export function validateMetaValue(field: MetaField, raw: string): string | null {
  const v = raw.trim();
  if (!v) return field.required ? `${field.label} is required` : null;
  switch (field.type) {
    case 'number':
      return Number.isFinite(Number(v)) ? null : `${field.label} must be a number`;
    case 'integer':
      return /^-?\d+$/.test(v) ? null : `${field.label} must be a whole number`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : `${field.label} must be a date`;
    case 'time':
      return /^\d{2}:\d{2}$/.test(v) ? null : `${field.label} must be a time (HH:MM)`;
    default:
      return null;
  }
}

export interface FormTemplate {
  id: string;
  slug: string;
  name: string;
  version: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  accountId: string | null;
  scope: string;
  lineOfBusiness: string;
  audits: number;
  lastEdited: string;
  /** Optional free-form metadata a QA Manager can attach when authoring a
   * form — audit scope notes, calibration references, anything that doesn't
   * warrant its own field. Never required. */
  metadata?: string;
  /** Custom capture fields defined on the form. They render in the audit
   * form's first section (with Call ID, AHT, …) whenever this template is used. */
  metaFields?: MetaField[];
  params: TemplateParam[];
  changeLog: Array<{
    who: string; role: string; when: string; action: string;
    field?: string; oldValue?: string | null; newValue?: string | null; note?: string;
  }>;
}

/** This app is single-account so far — every scoped (non-global) template
 * belongs to this account. Centralized here so a new form's scope checkbox
 * has a real account to attach to instead of silently falling back to null
 * (= global) when unchecked. */
export const CURRENT_ACCOUNT_ID = 'acc1';

export const TEMPLATES: FormTemplate[] = [
  {
    id: 't1', slug: 'awr-care-claims', name: 'Quality Coaching Form — AWR Care and Claims Audit',
    version: '1.3 S 2025', status: 'PUBLISHED', accountId: 'acc1', scope: 'AWR Care and Claims',
    lineOfBusiness: 'Care and Claims', audits: 128, lastEdited: 'Melody Tagaytay · 04 Oct 2026',
    params: [
      { sortOrder: 1, criticalType: 'CUSTOMER', text: 'Did the agent greet the customer warmly, introduce themselves and the company', weight: 0.05 },
      { sortOrder: 2, criticalType: 'CUSTOMER', text: 'Did the agent ask questions to understand the reason for the call and any additional needs', weight: 0.05 },
      { sortOrder: 3, criticalType: 'PROCESS', text: 'Did the agent follow the proper account authentication process?', weight: 0.05 },
      { sortOrder: 4, criticalType: 'PROCESS', text: 'Did the agent follow the probing questions in Salesforce', weight: 0.2 },
      { sortOrder: 5, criticalType: 'PROCESS', text: 'Did the agent maintain a professional tone and deliver the required disclosures?', weight: 0.05 },
      { sortOrder: 6, criticalType: 'PROCESS', text: 'Did the agent set up the claim correctly, including the correct provider', weight: 0.2 },
      { sortOrder: 7, criticalType: 'CUSTOMER', text: "Did the agent escalate the customer's issue to a supervisor if requested? Did the agent follow proper hold procedures?", weight: 0.15 },
      { sortOrder: 8, criticalType: 'BUSINESS', text: 'Did the agent offer an upsell after the issue was properly resolved', weight: 0.05 },
      { sortOrder: 9, criticalType: 'BUSINESS', text: 'Did the agent maintain control over the call and the call flow?', weight: 0.15 },
      { sortOrder: 10, criticalType: 'CUSTOMER', text: 'Did the agent recap all actions that took place during the call', weight: 0.05 },
    ],
    changeLog: [
      { who: 'Melody Tagaytay', role: 'QA Manager', when: '04 Oct 2026 09:14', action: 'parameter.changed', field: 'parameters.4.weight', oldValue: '15%', newValue: '20%', note: 'Salesforce probing re-weighted after Q3 calibration' },
      { who: 'Melody Tagaytay', role: 'QA Manager', when: '04 Oct 2026 09:14', action: 'parameter.changed', field: 'parameters.9.weight', oldValue: '20%', newValue: '15%' },
      { who: 'Melody Tagaytay', role: 'QA Manager', when: '02 Oct 2026 16:40', action: 'template.published', field: 'status', oldValue: 'DRAFT', newValue: 'PUBLISHED' },
      { who: 'Baby Jean Grecia', role: 'QA Team Lead', when: '28 Sep 2026 11:02', action: 'parameter.changed', field: 'parameters.5.text', oldValue: '…maitain a professional tone…', newValue: '…maintain a professional tone…', note: 'Typo carried over from the workbook' },
      { who: 'Melody Tagaytay', role: 'QA Manager', when: '27 Sep 2026 08:20', action: 'template.created', note: 'Forked from v1.2 S 2025' },
    ],
  },
  {
    id: 't2', slug: 'awr-billing', name: 'Quality Coaching Form — AWR Billing Audit',
    version: '2.0 S 2025', status: 'PUBLISHED', accountId: 'acc1', scope: 'AWR Billing',
    lineOfBusiness: 'Billing', audits: 74, lastEdited: 'Melody Tagaytay · 21 Sep 2026',
    params: [
      { sortOrder: 1, criticalType: 'CUSTOMER', text: 'Did the agent greet the customer and confirm the account holder', weight: 0.1 },
      { sortOrder: 2, criticalType: 'PROCESS', text: 'Did the agent verify the billing dispute against the ledger', weight: 0.25 },
      { sortOrder: 3, criticalType: 'PROCESS', text: 'Did the agent apply the correct adjustment code', weight: 0.25 },
      { sortOrder: 4, criticalType: 'BUSINESS', text: 'Did the agent explain the next invoice date and amount', weight: 0.2 },
      { sortOrder: 5, criticalType: 'CUSTOMER', text: 'Did the agent recap the resolution and confirm understanding', weight: 0.2 },
    ],
    changeLog: [
      { who: 'Melody Tagaytay', role: 'QA Manager', when: '21 Sep 2026 14:30', action: 'template.published', field: 'status', oldValue: 'DRAFT', newValue: 'PUBLISHED' },
      { who: 'Melody Tagaytay', role: 'QA Manager', when: '20 Sep 2026 10:05', action: 'template.created', note: 'New form for the Billing program' },
    ],
  },
  {
    id: 't3', slug: 'generic-voice', name: 'Generic Voice Quality Audit',
    version: '1.0', status: 'PUBLISHED', accountId: null, scope: 'GLOBAL',
    lineOfBusiness: 'Shared', audits: 12, lastEdited: 'Platform Admin · 12 Aug 2026',
    params: [
      { sortOrder: 1, criticalType: 'CUSTOMER', text: 'Did the agent open the call professionally', weight: 0.2 },
      { sortOrder: 2, criticalType: 'PROCESS', text: 'Did the agent follow the documented process for the call type', weight: 0.35 },
      { sortOrder: 3, criticalType: 'PROCESS', text: 'Did the agent document the interaction accurately', weight: 0.25 },
      { sortOrder: 4, criticalType: 'CUSTOMER', text: 'Did the agent close the call with a clear recap', weight: 0.2 },
    ],
    changeLog: [
      { who: 'Platform Admin', role: 'Admin', when: '12 Aug 2026 09:00', action: 'template.published', field: 'status', oldValue: 'DRAFT', newValue: 'PUBLISHED' },
    ],
  },
  {
    id: 't4', slug: 'awr-retention', name: 'Quality Coaching Form — AWR Retention Audit',
    version: '0.9 DRAFT', status: 'DRAFT', accountId: 'acc1', scope: 'AWR Care and Claims',
    lineOfBusiness: 'Retention', audits: 0, lastEdited: 'Baby Jean Grecia · 18 Oct 2026',
    params: [
      { sortOrder: 1, criticalType: 'CUSTOMER', text: 'Did the agent acknowledge the cancellation reason without arguing', weight: 0.25 },
      { sortOrder: 2, criticalType: 'PROCESS', text: 'Did the agent present the correct retention offer tier', weight: 0.3 },
      { sortOrder: 3, criticalType: 'BUSINESS', text: 'Did the agent attempt a save before processing the cancellation', weight: 0.25 },
    ],
    changeLog: [
      { who: 'Baby Jean Grecia', role: 'QA Team Lead', when: '18 Oct 2026 15:22', action: 'parameter.added', field: 'parameters.3', newValue: 'Did the agent attempt a save…' },
      { who: 'Baby Jean Grecia', role: 'QA Team Lead', when: '17 Oct 2026 09:41', action: 'template.created', note: 'Drafted for the Retention pilot' },
    ],
  },
];

export const weightTotal = (t: FormTemplate) =>
  Math.round(t.params.reduce((a, p) => a + p.weight, 0) * 1e4) / 1e4;
export { formatWeightPercent };

// ------------------------------------------------------------------
// Roster
// ------------------------------------------------------------------
export const ROSTER: Array<{ name: string; eid: string; wave: string; supervisor: string }> = [
  { name: 'Jenny Rey Cinco', eid: '21900', wave: 'Wave 8', supervisor: 'Filipinas Gerodias' },
  { name: 'Miko Ryan Caroz', eid: '24137', wave: 'Wave 8', supervisor: 'Ostel Remitar' },
  { name: 'Emaronnel Ganday', eid: '21845', wave: 'Wave 8', supervisor: 'Melody Tagaytay' },
  { name: 'Trizar Coronel', eid: '20375', wave: 'Wave 1', supervisor: 'Darwin Tamayo' },
  { name: 'Rhealyn Benitez', eid: '20004', wave: 'Wave 8', supervisor: 'Jennivie Buta' },
  { name: 'Marvin Medillo', eid: '21291', wave: 'Wave 3', supervisor: 'Filipinas Gerodias' },
  { name: 'Mary Joy Batonon', eid: '21300', wave: 'Wave 3', supervisor: 'Filipinas Gerodias' },
  { name: 'Herly Paran', eid: '21390', wave: 'Wave 6', supervisor: 'Dane Joesan Day' },
  { name: 'Kouichi Arkoncel', eid: '21285', wave: 'Wave 3', supervisor: 'Dane Joesan Day' },
  { name: 'Michael Belo', eid: '21923', wave: 'Wave 8', supervisor: 'Michelle Alpas' },
  { name: 'Nel Ben Layno', eid: '21533', wave: 'Wave 5', supervisor: 'Filipinas Gerodias' },
  { name: 'Venamie Batingal', eid: '21013', wave: 'Wave 2', supervisor: 'Darwin Tamayo' },
  { name: 'Shela Limpiado', eid: '22286', wave: 'Wave 11', supervisor: 'Darwin Tamayo' },
  { name: 'Jacel Macadumpis', eid: '22548', wave: 'Wave 13', supervisor: 'Boniconsilii Kim Catalan' },
  { name: 'Mark Dacillo', eid: '21850', wave: 'Wave 7', supervisor: 'Jennivie Buta' },
  { name: 'Gina Lyn Lascuña', eid: '21642', wave: 'Wave 6', supervisor: 'Filipinas Gerodias' },
];
export const AUDITORS = ['Melody Flores', 'Klyde Villagonzalo', 'Baby Jean Grecia', 'Elton Te'];

// ------------------------------------------------------------------
// Users & roles (admin screen)
// ------------------------------------------------------------------
export interface AppUser {
  id: string; name: string; eid: string; team: string; role: Role;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING'; lastSignIn: string;
}
export const CURRENT_USER_ID = 'u-melody';

/** Staff: QA line, Ops leadership, administration. */
const STAFF_USERS: AppUser[] = [
  { id: 'u-jenny', name: 'Jenny Rey Cinco', eid: '21900', team: 'Wave 8 · Gerodias', role: 'AGENT', status: 'ACTIVE', lastSignIn: '2 hours ago' },
  { id: 'u-miko', name: 'Miko Ryan Caroz', eid: '24137', team: 'Wave 8 · Remitar', role: 'AGENT', status: 'ACTIVE', lastSignIn: '1 hour ago' },
  { id: 'u-trizar', name: 'Trizar Coronel', eid: '20375', team: 'Wave 1 · Tamayo', role: 'AGENT', status: 'ACTIVE', lastSignIn: 'Yesterday' },
  { id: 'u-rhealyn', name: 'Rhealyn Benitez', eid: '20004', team: 'Wave 8 · Buta', role: 'AGENT', status: 'ACTIVE', lastSignIn: '3 days ago' },
  { id: 'u-marvin', name: 'Marvin Medillo', eid: '21291', team: 'Wave 3 · Gerodias', role: 'AGENT', status: 'INACTIVE', lastSignIn: '14 Aug 2026' },
  { id: 'u-fili', name: 'Filipinas Gerodias', eid: '20112', team: 'Wave 8', role: 'OPS_TEAM_LEAD', status: 'ACTIVE', lastSignIn: '20 min ago' },
  { id: 'u-darwin', name: 'Darwin Tamayo', eid: '20117', team: 'Wave 1 · Wave 11', role: 'OPS_TEAM_LEAD', status: 'ACTIVE', lastSignIn: 'Today' },
  { id: 'u-jenni', name: 'Jennivie Buta', eid: '20140', team: 'Wave 6 · Wave 8', role: 'OPS_TEAM_LEAD', status: 'ACTIVE', lastSignIn: 'Today' },
  // Every supervisor named on the roster must exist as a user, or agents in
  // their teams would show a supervisor the directory cannot resolve.
  { id: 'u-dane', name: 'Dane Joesan Day', eid: '20121', team: 'Wave 3 · Wave 6', role: 'OPS_TEAM_LEAD', status: 'ACTIVE', lastSignIn: 'Today' },
  { id: 'u-michelle', name: 'Michelle Alpas', eid: '20134', team: 'Wave 8', role: 'OPS_TEAM_LEAD', status: 'ACTIVE', lastSignIn: 'Yesterday' },
  { id: 'u-boni', name: 'Boniconsilii Kim Catalan', eid: '20147', team: 'Wave 13', role: 'OPS_TEAM_LEAD', status: 'ACTIVE', lastSignIn: '2 days ago' },
  { id: 'u-melody', name: 'Melody Flores', eid: '20301', team: 'QA pod A', role: 'ADMIN', status: 'ACTIVE', lastSignIn: 'Now' },
  { id: 'u-klyde', name: 'Klyde Villagonzalo', eid: '20302', team: 'QA pod A', role: 'QA', status: 'ACTIVE', lastSignIn: '45 min ago' },
  { id: 'u-elton', name: 'Elton Te', eid: '20303', team: 'QA pod A', role: 'QA', status: 'ACTIVE', lastSignIn: '10 min ago' },
  { id: 'u-baby', name: 'Baby Jean Grecia', eid: '20155', team: 'QA pod B', role: 'QA_TEAM_LEAD', status: 'ACTIVE', lastSignIn: 'Today' },
  { id: 'u-ostel', name: 'Ostel Remitar', eid: '20099', team: 'Care & Claims', role: 'OPS_ACCOUNT_MANAGER', status: 'ACTIVE', lastSignIn: 'Today' },
  { id: 'u-mtag', name: 'Melody Tagaytay', eid: '20166', team: 'Care & Claims', role: 'QA_MANAGER', status: 'ACTIVE', lastSignIn: 'Today' },
  { id: 'u-noland', name: 'Noland Ortiz', eid: '20010', team: 'Care & Claims', role: 'SERVICE_DELIVERY_MANAGER', status: 'ACTIVE', lastSignIn: 'Yesterday' },
];

/**
 * Every agent on the roster is a user.
 *
 * These are generated from `ROSTER` rather than hand-listed so the two can
 * never disagree: an agent who appears on a coaching record but not in `USERS`
 * could never sign their own acknowledgement, which would strand the record at
 * the final stage of the workflow.
 */
const ROSTER_AGENTS: AppUser[] = ROSTER.map((r) => ({
  id: `u-agent-${r.eid}`,
  name: r.name,
  eid: r.eid,
  team: `${r.wave} · ${r.supervisor}`,
  role: 'AGENT' as const,
  status: 'ACTIVE' as const,
  lastSignIn: 'Today',
}));

export const USERS: AppUser[] = [
  ...STAFF_USERS,
  // Skip anyone already listed by hand, matched on EID.
  ...ROSTER_AGENTS.filter((a) => !STAFF_USERS.some((u) => u.eid === a.eid)),
];

/** Elevated roles get an extra warning in the role-change confirmation. */
export const ELEVATED_ROLES: Role[] = ['ADMIN', 'SERVICE_DELIVERY_MANAGER', 'QA_MANAGER'];

// ------------------------------------------------------------------
// Historical audits (deterministic PRNG so the set is stable per reload)
// ------------------------------------------------------------------
/**
 * Workflow stages come from `@awr/shared` — the same definition the API and the
 * Prisma `FormStatus` enum are built against. These aliases keep the existing
 * `AuditStatus` / `STATUS_LABEL` names used across the web app while ensuring
 * there is only one place a stage can be added or renamed.
 */
export type AuditStatus = FormStage;
export { WORKFLOW_STAGES, STAGE_OWNER, NEXT_STAGE, ACTION_LABEL, STAGE_SLA_HOURS, stageIndex };
export const STATUS_LABEL = STAGE_LABEL;

export const STATUS_VARIANT: Record<AuditStatus, 'good' | 'warn' | 'critical' | 'muted' | 'info'> = {
  QA_REVIEW: 'muted',
  RELEASED_TO_OPS: 'info',
  OPS_COACHING: 'info',
  RELEASED_TO_AGENT: 'warn',
  AWAITING_AGENT_SIGNATURE: 'warn',
  FINALIZED: 'good',
  VOIDED: 'muted',
};

export interface Audit {
  id: string; ref: string;
  agent: string; eid: string; wave: string; supervisor: string; auditor: string;
  formId: string; formShort: string; version: string;
  disposition: string; reason: string;
  callDate: Date; auditDate: Date; aht: number; holdSec: number;
  score: number; errs: { customer: number; process: number; business: number; compliance: number };
  totalErrs: number;
  surveyed: boolean; csat: number | null; category: 'SAT' | 'Neutral' | 'DSAT' | 'Not Surveyed';
  controllable: 'AgentControllable' | 'AgentNonControllable' | null;
  gaps: string[]; status: AuditStatus;
  signedAgent: boolean; signedTL: boolean;
  /**
   * When the audit entered each stage it has reached so far. Absent keys mean
   * "not reached yet", so `enteredAt[status]` is always the timestamp of the
   * *current* stage — that is what stage aging measures from.
   */
  enteredAt: Partial<Record<AuditStatus, Date>>;
}

/** How long the audit has sat in its current stage, in whole hours. */
export function hoursInStage(a: Audit, now: Date = new Date()): number {
  const since = a.enteredAt[a.status];
  return since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / 36e5)) : 0;
}

export const isOverdue = (a: Audit, now?: Date): boolean =>
  hoursInStage(a, now) > STAGE_SLA_HOURS[a.status];



export const scoreBand = (s: number) => (s >= 95 ? '95–100%' : s >= 90 ? '90–94%' : s >= 80 ? '80–89%' : s >= 70 ? '70–79%' : 'Below 70%');
export const BAND_ORDER = ['95–100%', '90–94%', '80–89%', '70–79%', 'Below 70%'];

export const formatSecs = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
export const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export { scoreForm };

// ------------------------------------------------------------------
// CSV export — a real client-side download, not a placeholder. There is no
// export API yet, so this is the honest version of the feature: it exports
// exactly the rows on screen, from the same data the table renders.
// ------------------------------------------------------------------
export function auditsToCsv(rows: readonly Audit[]): string {
  const headers = [
    'Reference', 'Agent', 'EID', 'Wave', 'Team lead', 'QA auditor', 'Coaching form',
    'Disposition', 'Call reason', 'Call date', 'AHT (sec)', 'Hold (sec)', 'Score (%)',
    'Customer Critical', 'Process Critical', 'Business Critical', 'Compliance Critical', 'CSAT', 'Status',
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((a) => [
    a.ref, a.agent, a.eid, a.wave, a.supervisor, a.auditor, a.formShort,
    a.disposition, a.reason, a.callDate.toISOString().slice(0, 10), a.aht, a.holdSec, a.score,
    a.errs.customer, a.errs.process, a.errs.business, a.errs.compliance, a.category, STATUS_LABEL[a.status],
  ].map(escape).join(','));
  return [headers.join(','), ...lines].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
