import type { Role } from './rbac.js';
import { stageIndex, type FormStage } from './workflow.js';

/**
 * The authorization model, in one place.
 *
 *   USER -> ROLE -> ORG SCOPE -> RECORD ACCESS -> WORKFLOW STAGE
 *        -> FIELD PERMISSIONS -> AVAILABLE ACTIONS -> DASHBOARD METRICS
 *
 * Four independent questions, deliberately kept separate — collapsing any two
 * of them is how these systems leak:
 *
 *   1. PAGE   — may this role open this page at all?      `canAccessPage`
 *   2. RECORD — which rows may it see?                    `buildFormScopeFilter` (rbac.ts)
 *   3. FIELD  — which sections/fields, given the stage?   `sectionAccess`
 *   4. ACTION — what may it do, given the stage?          `auditAction`, `canAdvanceFrom`
 *
 * Page access never implies record access, and record access never implies the
 * right to act: an Agent may open the Coaching page, but only to sign their own
 * coaching, and only once it has actually reached them.
 *
 * This module is imported by BOTH the web app and the API so the two cannot
 * drift. The API is the enforcement point; the web app uses it to avoid
 * offering actions that would be refused server-side.
 */

// ------------------------------------------------------------------
// 1. Page access
// ------------------------------------------------------------------

export const PAGES = [
  'performance-dashboard',
  'coaching-dashboard',
  'audits',
  'coaching',
  'audits-upload',
  'signature',
  'users-roles',
  'repository',
  'settings',
] as const;

export type Page = (typeof PAGES)[number];

export const PAGE_LABELS: Record<Page, string> = {
  'performance-dashboard': 'Performance dashboard',
  'coaching-dashboard': 'Coaching dashboard',
  'audits': 'Audits',
  'coaching': 'Coaching',
  'audits-upload': 'Audit upload',
  'signature': 'Signatures',
  'users-roles': 'Users & roles',
  'repository': 'Form repository',
  'settings': 'Settings',
};

/**
 * Which roles may open each page.
 *
 * SERVICE_DELIVERY_MANAGER is not in the specified matrix; it is an
 * organisation-wide *read* role, so it is granted the two dashboards, the
 * audit list and its own signature page — never upload, administration or
 * coaching participation.
 *
 * ADMIN is deliberately excluded from `coaching`: administration must not be
 * able to participate in a coaching conversation or sign on anyone's behalf.
 * It keeps `audits` for oversight.
 */
export const PAGE_ACCESS: Record<Page, readonly Role[]> = {
  'performance-dashboard': [
    'ADMIN', 'QA_MANAGER', 'QA_TEAM_LEAD', 'QA',
    'OPS_ACCOUNT_MANAGER', 'OPS_TEAM_LEAD', 'AGENT', 'SERVICE_DELIVERY_MANAGER',
  ],
  'coaching-dashboard': [
    'ADMIN', 'QA_MANAGER', 'QA_TEAM_LEAD', 'QA',
    'OPS_ACCOUNT_MANAGER', 'OPS_TEAM_LEAD', 'AGENT', 'SERVICE_DELIVERY_MANAGER',
  ],
  'audits': [
    'ADMIN', 'QA_MANAGER', 'QA_TEAM_LEAD', 'QA',
    'OPS_ACCOUNT_MANAGER', 'OPS_TEAM_LEAD', 'AGENT', 'SERVICE_DELIVERY_MANAGER',
  ],
  'coaching': [
    'QA_MANAGER', 'QA_TEAM_LEAD', 'QA', 'OPS_ACCOUNT_MANAGER', 'OPS_TEAM_LEAD', 'AGENT',
  ],
  'audits-upload': ['ADMIN', 'QA_MANAGER', 'QA_TEAM_LEAD', 'QA'],
  'signature': [
    'ADMIN', 'QA_MANAGER', 'QA_TEAM_LEAD', 'QA',
    'OPS_ACCOUNT_MANAGER', 'OPS_TEAM_LEAD', 'AGENT', 'SERVICE_DELIVERY_MANAGER',
  ],
  'users-roles': ['ADMIN', 'QA_MANAGER'],
  'repository': ['ADMIN', 'QA_MANAGER'],
  // Every role, unconditionally. Settings holds only the signed-in user's own
  // account controls — changing your own password is not a privileged action,
  // and a role that could not reach it would have no way to rotate a
  // credential it is required to rotate on first sign-in.
  'settings': [
    'ADMIN', 'QA_MANAGER', 'QA_TEAM_LEAD', 'QA',
    'OPS_ACCOUNT_MANAGER', 'OPS_TEAM_LEAD', 'AGENT', 'SERVICE_DELIVERY_MANAGER',
  ],
};

export const canAccessPage = (role: Role, page: Page): boolean =>
  PAGE_ACCESS[page].includes(role);

export const pagesFor = (role: Role): Page[] =>
  PAGES.filter((p) => canAccessPage(role, p));

// ------------------------------------------------------------------
// 2. Workflow participation — which stage does a role own?
// ------------------------------------------------------------------

/**
 * The stages each role may actively work on. This is what filters the Call ID
 * selector: a role is offered exactly the records currently sitting at a stage
 * it owns, so a Call ID typed or tampered into the request is rejected rather
 * than loaded.
 *
 * QA_MANAGER and QA_TEAM_LEAD cover the QA stage; nobody covers another role's.
 */
export const OWNED_STAGES: Record<Role, readonly FormStage[]> = {
  QA: ['QA_REVIEW'],
  QA_TEAM_LEAD: ['QA_REVIEW'],
  QA_MANAGER: ['QA_REVIEW'],
  OPS_TEAM_LEAD: ['RELEASED_TO_OPS', 'OPS_COACHING'],
  AGENT: ['RELEASED_TO_AGENT', 'AWAITING_AGENT_SIGNATURE'],
  // Monitoring and administration roles participate in no stage.
  OPS_ACCOUNT_MANAGER: [],
  SERVICE_DELIVERY_MANAGER: [],
  ADMIN: [],
};

/**
 * The earliest stage at which a record becomes visible to each role.
 *
 * Separate from scope and from stage ownership: an Ops TL is *in scope* for
 * their team's audits from the moment QA creates one, but the coaching has not
 * reached them yet and is none of their business until QA releases it. The same
 * applies to an agent before their team lead releases.
 *
 * `null` means "no floor" — oversight roles see the whole pipeline, which is
 * the point of an oversight role.
 */
export const VISIBLE_FROM_STAGE: Record<Role, FormStage | null> = {
  // The QA line owns the record from creation.
  QA: 'QA_REVIEW',
  QA_TEAM_LEAD: 'QA_REVIEW',
  QA_MANAGER: 'QA_REVIEW',
  // Nothing exists for the Ops TL until QA releases it.
  OPS_TEAM_LEAD: 'RELEASED_TO_OPS',
  // Nothing exists for the agent until their team lead releases it.
  AGENT: 'RELEASED_TO_AGENT',
  // Oversight and administration see every stage.
  OPS_ACCOUNT_MANAGER: null,
  SERVICE_DELIVERY_MANAGER: null,
  ADMIN: null,
};

/**
 * May this role see a record at this stage at all?
 *
 * This gates whether the row is *listed*, which is stronger than hiding its
 * action button: a record the workflow has not reached must not appear in the
 * audits table, the coaching queue, or any dashboard count.
 */
export function canSeeRecord(role: Role, stage: FormStage): boolean {
  const floor = VISIBLE_FROM_STAGE[role];
  if (floor === null) return true;

  // A voided record never reaches anyone downstream, so it stays with the QA
  // line and oversight rather than surfacing to a team lead or agent who was
  // never going to act on it.
  if (stage === 'VOIDED') return floor === 'QA_REVIEW';

  return stageIndex(stage) >= stageIndex(floor);
}

/** May this role act on a record at this stage? Governs the Call ID selector. */
export const canWorkStage = (role: Role, stage: FormStage): boolean =>
  OWNED_STAGES[role].includes(stage);

/**
 * May this role advance a record out of this stage?
 *
 * Identical to `canWorkStage` except that terminal stages can never be
 * advanced — a finalized coaching is fully read-only, for everyone.
 */
export function canAdvanceFrom(role: Role, stage: FormStage): boolean {
  if (stage === 'FINALIZED' || stage === 'VOIDED') return false;
  return canWorkStage(role, stage);
}

// ------------------------------------------------------------------
// 3. Field / section access
// ------------------------------------------------------------------

/**
 * The coaching form's sections, in the order they appear. The QA stage ends at
 * HOLD_ATTEMPTS; everything after it belongs to a later stage.
 */
export const COACHING_SECTIONS = [
  'AUDIT_INFO',      // imported from the .xlsx — never editable by anyone
  'PARAMETERS',      // imported scores (read-only) + QA observations (editable at QA stage)
  'HOLD_ATTEMPTS',   // QA-owned
  'SECTION_C',       // Ops TL — root cause
  'SECTION_D',       // Ops TL — action plan
  'OPS_SIGNATURE',
  'AGENT_SIGNATURE',
] as const;

export type CoachingSection = (typeof COACHING_SECTIONS)[number];

/**
 * HIDDEN is materially different from READ: a section a role must not see is
 * not rendered at all, rather than rendered disabled. Disabled fields still
 * leak their contents.
 */
export type Access = 'HIDDEN' | 'READ' | 'EDIT';

/** Sections that are never editable by anyone — imported audit data is truth. */
const IMPORTED_SECTIONS: readonly CoachingSection[] = ['AUDIT_INFO'];

const sectionIndex = (s: CoachingSection) => COACHING_SECTIONS.indexOf(s);

/**
 * What may this role do with this section, on a record at this stage?
 *
 * The rules, in precedence order:
 *   1. Imported audit data is read-only always, for everyone.
 *   2. Finalized/voided coaching is read-only always, for everyone.
 *   3. During QA review, everything after Hold Attempt Details is HIDDEN —
 *      those sections do not exist yet and must not be previewed.
 *   4. A role may only edit the sections it owns, and only while the record
 *      sits at a stage it owns. Everything else it can see is READ.
 *   5. Nobody may ever edit another party's signature.
 */
export function sectionAccess(role: Role, stage: FormStage, section: CoachingSection): Access {
  // (3) Later stages have not happened yet — hide, do not disable.
  if (stage === 'QA_REVIEW' && sectionIndex(section) > sectionIndex('HOLD_ATTEMPTS')) {
    return 'HIDDEN';
  }
  // Section C/D do not exist until the Ops TL stage opens.
  if (
    (stage === 'RELEASED_TO_OPS' || stage === 'OPS_COACHING')
    && section === 'AGENT_SIGNATURE'
  ) {
    // Visible to the Ops TL as a placeholder, but never editable by them.
    return 'READ';
  }

  // (1) + (2) Read-only conditions that override any role's edit rights.
  if (IMPORTED_SECTIONS.includes(section)) return 'READ';
  if (stage === 'FINALIZED' || stage === 'VOIDED') return 'READ';

  // (4) Stage ownership.
  if (!canWorkStage(role, stage)) return 'READ';

  switch (section) {
    // QA owns observations and hold attempts, only during QA review.
    case 'PARAMETERS':
    case 'HOLD_ATTEMPTS':
      return stage === 'QA_REVIEW' ? 'EDIT' : 'READ';

    // The Ops TL owns section C/D and their own signature.
    case 'SECTION_C':
    case 'SECTION_D':
    case 'OPS_SIGNATURE':
      return role === 'OPS_TEAM_LEAD' ? 'EDIT' : 'READ';

    // (5) Only the agent signs the agent block.
    case 'AGENT_SIGNATURE':
      return role === 'AGENT' ? 'EDIT' : 'READ';

    default:
      return 'READ';
  }
}

/** Sections this role should actually render, at this stage. */
export const visibleSections = (role: Role, stage: FormStage): CoachingSection[] =>
  COACHING_SECTIONS.filter((s) => sectionAccess(role, stage, s) !== 'HIDDEN');

/**
 * Parameter scores are imported and always read-only; the QA observation beside
 * them is editable only by QA, only during QA review.
 */
export const canEditObservation = (role: Role, stage: FormStage): boolean =>
  stage === 'QA_REVIEW' && canWorkStage(role, stage);

/**
 * A parameter scored NO requires an observation before the audit may be
 * released. YES and N/A are optional.
 */
export const observationRequired = (score: 'YES' | 'NO' | 'NA'): boolean => score === 'NO';

// ------------------------------------------------------------------
// 4. Action access — what the Audits page offers per row
// ------------------------------------------------------------------

/**
 * The single action a row offers, given who is looking and where the record is.
 * `NONE` means the row is not actionable for this user — a record still in QA
 * review is not an Ops TL's or an Agent's business yet.
 */
export type AuditAction = 'REVIEW' | 'COACH' | 'SIGN' | 'QUICK_VIEW' | 'NONE';

export const ACTION_LABELS: Record<AuditAction, string> = {
  REVIEW: 'Review',
  COACH: 'Coach',
  SIGN: 'Sign',
  QUICK_VIEW: 'Quick View',
  NONE: '',
};

/**
 * Rows are offered the owning role's verb, and everyone else who may see the
 * record gets Quick View. Once finalized, everyone gets Quick View — including
 * the agent who just signed it.
 */
export function auditAction(role: Role, stage: FormStage): AuditAction {
  if (stage === 'FINALIZED' || stage === 'VOIDED') return 'QUICK_VIEW';

  if (canWorkStage(role, stage)) {
    if (stage === 'QA_REVIEW') return 'REVIEW';
    if (stage === 'RELEASED_TO_OPS' || stage === 'OPS_COACHING') return 'COACH';
    return 'SIGN';
  }

  // Not this role's stage. An agent has no business seeing a coaching that has
  // not reached them yet, even one of their own; everyone else may look.
  if (role === 'AGENT') return 'NONE';
  return 'QUICK_VIEW';
}

// ------------------------------------------------------------------
// 5. Dashboards
// ------------------------------------------------------------------

/**
 * The two dashboards are separate surfaces with separate purposes: one measures
 * quality, the other measures flow. Metrics must never be mixed between them.
 */
export type DashboardKind = 'PERFORMANCE' | 'COACHING';

/**
 * How each role's data scope reads to the user. Shown on both dashboards so the
 * numbers are never mistaken for organisation-wide figures — an Ops TL's "62
 * records" means their team's 62, and the header says so.
 */
export const SCOPE_LABEL: Record<Role, string> = {
  AGENT: 'own records',
  OPS_TEAM_LEAD: 'team',
  QA: 'QA',
  QA_TEAM_LEAD: 'QA team',
  QA_MANAGER: 'QA management',
  OPS_ACCOUNT_MANAGER: 'account',
  SERVICE_DELIVERY_MANAGER: 'organisation',
  ADMIN: 'organisation',
};

/**
 * Aggregates that would describe people outside the viewer's scope are not
 * shown. An Agent scoped to their own records must not be handed an
 * organisation average, because that is a fact about everyone else.
 *
 * Comparative aggregates are therefore limited to roles whose scope covers more
 * than one person.
 */
export const canSeeComparativeAggregates = (role: Role): boolean => role !== 'AGENT';

/** Breakdown dimensions a role may see. An Agent gets none — they are one person. */
export function allowedBreakdowns(role: Role): ('wave' | 'supervisor' | 'auditor' | 'agent')[] {
  switch (role) {
    case 'AGENT':
      return [];
    case 'OPS_TEAM_LEAD':
      return ['agent'];
    case 'QA':
      return ['agent', 'wave'];
    case 'OPS_ACCOUNT_MANAGER':
    case 'QA_TEAM_LEAD':
      return ['agent', 'wave', 'supervisor'];
    case 'QA_MANAGER':
    case 'SERVICE_DELIVERY_MANAGER':
    case 'ADMIN':
      return ['agent', 'wave', 'supervisor', 'auditor'];
  }
}
