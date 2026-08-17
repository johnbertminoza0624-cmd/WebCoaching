import { ROSTER, USERS, ROLE_LABELS, type Role } from './mock-data';

/**
 * People lookup: turns the names carried on a coaching record into real
 * profiles.
 *
 * A record's `standard` block holds an agent name, an EID and a supervisor
 * name — strings imported from the spreadsheet, not links to people. This
 * module resolves them against the roster and the user directory so the UI can
 * show who the agent actually is and who they report to, rather than repeating
 * two bare strings.
 *
 * Resolution is deliberately tolerant: an uploaded spreadsheet can name someone
 * not yet on the roster, and that must render as a plain profile rather than
 * crash or vanish.
 */

export interface Profile {
  name: string;
  eid: string | null;
  /** Wave for an agent; the waves they lead for a supervisor. */
  team: string | null;
  role: Role | null;
  roleLabel: string;
  initials: string;
  /** False when the person is not in the directory — shown as unverified. */
  known: boolean;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '')).toUpperCase();
}

/** Deterministic avatar tint, so the same person is the same colour everywhere. */
export function avatarTint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `var(--chart-${(h % 5) + 1})`;
}

/** The agent behind a coaching record, matched on EID first, then on name. */
export function agentProfile(name: string, eid?: string): Profile {
  const entry = ROSTER.find((r) => (eid && r.eid === eid) || r.name === name);
  const user = USERS.find((u) => u.name === (entry?.name ?? name));
  return {
    name: entry?.name ?? (name || 'Unknown agent'),
    eid: entry?.eid ?? eid ?? null,
    team: entry?.wave ?? null,
    role: user?.role ?? 'AGENT',
    roleLabel: ROLE_LABELS[user?.role ?? 'AGENT'],
    initials: initialsOf(entry?.name ?? (name || '?')),
    known: !!entry,
  };
}

/**
 * The supervisor a record names. Falls back to the roster relationship when the
 * spreadsheet left the column blank, which is what makes team scope work.
 */
export function supervisorProfile(supervisorName: string | undefined, agentEid?: string): Profile {
  const fromRoster = agentEid ? ROSTER.find((r) => r.eid === agentEid)?.supervisor : undefined;
  const name = (supervisorName ?? '').trim() || fromRoster || '';
  const user = USERS.find((u) => u.name === name);

  // Which waves this person supervises, straight from the roster relationship.
  const waves = Array.from(new Set(ROSTER.filter((r) => r.supervisor === name).map((r) => r.wave)));

  return {
    name: name || 'Unassigned',
    eid: user?.eid ?? null,
    team: waves.length ? waves.join(' · ') : (user?.team ?? null),
    role: user?.role ?? null,
    roleLabel: user ? ROLE_LABELS[user.role] : 'Supervisor',
    initials: initialsOf(name || '?'),
    known: !!user,
  };
}

/** How many agents this supervisor is responsible for, per the roster. */
export const directReportCount = (supervisorName: string): number =>
  ROSTER.filter((r) => r.supervisor === supervisorName).length;
