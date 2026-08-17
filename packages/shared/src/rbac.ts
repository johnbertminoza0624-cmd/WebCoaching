/**
 * RBAC — roles, permissions, and data scope.
 *
 * Two separate questions, deliberately kept separate:
 *   1. CAN this role perform this action at all?   -> PERMISSIONS
 *   2. WHICH rows may it touch?                    -> Scope
 *
 * Collapsing them into one check is the usual way these systems leak: a QA Team
 * Lead and a QA both "can read forms", but only one of them may read another
 * team's. Every list query must go through `buildFormScopeFilter`.
 */

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

/** Which side of the house a role sits on — drives default landing page. */
export const ROLE_DOMAIN: Record<Role, 'ops' | 'quality' | 'platform'> = {
  AGENT: 'ops',
  OPS_TEAM_LEAD: 'ops',
  OPS_ACCOUNT_MANAGER: 'ops',
  QA: 'quality',
  QA_TEAM_LEAD: 'quality',
  QA_MANAGER: 'quality',
  SERVICE_DELIVERY_MANAGER: 'platform',
  ADMIN: 'platform',
};

// ------------------------------------------------------------------
// Permissions
// ------------------------------------------------------------------

export const PERMISSIONS = [
  // coaching forms
  'form:create',
  'form:read',
  'form:update',          // edit an audit while it is a draft
  'form:submit',          // release a draft to the agent for acknowledgement
  'form:sign_agent',      // sign the agent block in section E
  'form:sign_supervisor', // sign the team-leader block in section E
  'form:export_pdf',
  'form:reopen',          // pull a submitted form back to draft
  'form:void',
  /**
   * Edit a form that is already COMPLETED / signed. Separate from `form:update`
   * on purpose: it always requires a reason, always writes a change-log entry,
   * and always supersedes the existing signatures.
   */
  'form:edit_completed',
  'form:changelog:read',

  // coaching follow-through
  'actionplan:manage',    // author section D
  'actionplan:complete',

  // analytics
  'dashboard:team',
  'dashboard:account',
  'dashboard:org',

  // configuration
  // the coaching-form repository
  'template:read',            // browse the repository, pick one for an audit
  'template:create',          // add a new form to the repository
  'template:manage',          // edit parameters, weights, acknowledgement copy
  'template:publish',         // move DRAFT -> PUBLISHED (makes it selectable)
  'template:archive',
  'template:changelog:read',
  'reference:manage',     // dispositions, call reasons, hold reasons, gaps

  // identity
  'user:read',
  'user:create',
  'user:update',
  'user:change_role',
  'user:deactivate',
  'user:reset_password',

  // compliance
  'activity_log:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ------------------------------------------------------------------
// Scope
// ------------------------------------------------------------------

/**
 * OWN     — rows where the user is the agent, auditor, or supervisor
 * TEAM    — rows for agents on the teams the user leads
 * ACCOUNT — rows within the user's account
 * ALL     — every row, every account
 */
export type Scope = 'OWN' | 'TEAM' | 'ACCOUNT' | 'ALL';

const SCOPE_RANK: Record<Scope, number> = { OWN: 0, TEAM: 1, ACCOUNT: 2, ALL: 3 };

export const FORM_SCOPE: Record<Role, Scope> = {
  AGENT: 'OWN',
  OPS_TEAM_LEAD: 'TEAM',
  QA: 'OWN',            // the audits this auditor authored
  QA_TEAM_LEAD: 'ACCOUNT',
  OPS_ACCOUNT_MANAGER: 'ACCOUNT',
  QA_MANAGER: 'ACCOUNT',
  SERVICE_DELIVERY_MANAGER: 'ALL',
  ADMIN: 'ALL',
};

// ------------------------------------------------------------------
// The matrix
// ------------------------------------------------------------------

const AGENT: Permission[] = [
  'form:read',
  'form:sign_agent',
  'form:export_pdf',
  'actionplan:complete',
];

const OPS_TEAM_LEAD: Permission[] = [
  'form:read',
  'form:sign_supervisor',
  'form:export_pdf',
  'actionplan:manage',
  'actionplan:complete',
  'dashboard:team',
  'template:read',
  'user:read',
];

const QA: Permission[] = [
  'form:create',
  'form:read',
  'form:update',
  'form:submit',
  'form:export_pdf',
  'form:changelog:read',
  'dashboard:team',
  // Reads the repository and chooses which coaching form an audit runs on.
  'template:read',
  'template:changelog:read',
  'user:read',
];

const QA_TEAM_LEAD: Permission[] = [
  ...QA,
  'form:reopen',
  'form:void',
  'form:edit_completed',
  'dashboard:account',
  'activity_log:read',
];

const OPS_ACCOUNT_MANAGER: Permission[] = [
  'form:read',
  'form:export_pdf',
  'actionplan:manage',
  'dashboard:team',
  'dashboard:account',
  'template:read',
  'user:read',
];

const QA_MANAGER: Permission[] = [
  ...QA_TEAM_LEAD,
  // Owns the coaching-form repository.
  'template:create',
  'template:manage',
  'template:publish',
  'template:archive',
  'reference:manage',
];

const SERVICE_DELIVERY_MANAGER: Permission[] = [
  'form:read',
  'form:export_pdf',
  'dashboard:team',
  'dashboard:account',
  'dashboard:org',
  'template:read',
  'user:read',
  'activity_log:read',
];

/**
 * Admin is the platform operator: full identity control and full visibility.
 * It deliberately does NOT get `form:sign_agent` / `form:sign_supervisor` —
 * a signature must belong to the person whose name is under it, and an
 * "admin can sign anything" hole would make every acknowledgement worthless.
 */
const ADMIN: Permission[] = PERMISSIONS.filter(
  (p) => p !== 'form:sign_agent' && p !== 'form:sign_supervisor',
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  AGENT,
  OPS_TEAM_LEAD,
  QA,
  QA_TEAM_LEAD,
  OPS_ACCOUNT_MANAGER,
  QA_MANAGER,
  SERVICE_DELIVERY_MANAGER,
  ADMIN,
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export interface Principal {
  id: string;
  role: Role;
  accountId: string | null;
  teamId: string | null;
  /** Team ids this user is the lead of. */
  ledTeamIds: string[];
}

export function can(principal: Principal, permission: Permission): boolean {
  return ROLE_PERMISSIONS[principal.role].includes(permission);
}

export function canAll(principal: Principal, permissions: Permission[]): boolean {
  return permissions.every((p) => can(principal, p));
}

export function hasScopeAtLeast(role: Role, minimum: Scope): boolean {
  return SCOPE_RANK[FORM_SCOPE[role]] >= SCOPE_RANK[minimum];
}

/**
 * Prisma `where` fragment restricting coaching forms to what this principal may
 * see. Returned as a fragment so callers can AND it with their own filters.
 *
 * Note the OWN case covers three relationships: an agent sees forms about them,
 * a QA sees forms they authored, and either may also appear as supervisor.
 */
export function buildFormScopeFilter(principal: Principal): Record<string, unknown> {
  switch (FORM_SCOPE[principal.role]) {
    case 'ALL':
      return {};

    case 'ACCOUNT':
      // An account manager with no account assigned sees nothing, not everything.
      return principal.accountId
        ? { agent: { accountId: principal.accountId } }
        : { id: '__none__' };

    case 'TEAM':
      return {
        OR: [
          { agent: { teamId: { in: principal.ledTeamIds } } },
          { supervisorId: principal.id },
        ],
      };

    case 'OWN':
    default:
      return {
        OR: [
          { agentId: principal.id },
          { auditorId: principal.id },
          { supervisorId: principal.id },
        ],
      };
  }
}

/**
 * Which roles may an actor assign? Only Admin may change roles at all, and it
 * may assign any role including Admin — but never to itself, so that a single
 * account cannot quietly widen its own access.
 */
export function assignableRoles(actor: Principal, targetUserId: string): Role[] {
  if (!can(actor, 'user:change_role')) return [];
  if (actor.id === targetUserId) return [];
  return [...ROLES];
}
