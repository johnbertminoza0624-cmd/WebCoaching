'use client';

import * as React from 'react';
import { ChevronDown, Search, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { agentProfile, supervisorProfile, avatarTint, directReportCount, type Profile } from '@/lib/directory';
import type { CoachingRecord } from '@/lib/coaching-store';

/**
 * The people waiting on this stage, grouped by agent.
 *
 * The Call ID dropdown answers "which record", but not "whose coaching is this
 * and who runs their team" — which is what a QA actually works from. Records
 * are grouped by agent so one person with three pending audits reads as one
 * person, and each group carries the supervisor the coaching will be released
 * to next.
 *
 * The list is built from the caller's already-scoped queue, so it can never
 * surface an agent outside the viewer's stage or data scope.
 */

/**
 * Past this many agents the list scrolls instead of pushing the rest of the
 * page down.
 */
const SCROLL_AFTER_ROWS = 7;
/** Matches the `gap-2` between rows. */
const ROW_GAP_PX = 8;

export function Avatar({ profile, size = 34 }: { profile: Profile; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-full font-semibold text-white"
      style={{
        width: size, height: size,
        fontSize: size * 0.36,
        background: avatarTint(profile.name),
      }}
    >
      {profile.initials}
    </span>
  );
}

interface AgentGroup {
  agent: Profile;
  supervisor: Profile;
  reports: number;
  records: CoachingRecord[];
}

function groupByAgent(records: readonly CoachingRecord[]): AgentGroup[] {
  const map = new Map<string, AgentGroup>();
  for (const r of records) {
    const name = r.standard['Agent Name'] ?? '';
    const eid = r.standard['EID'] ?? '';
    const key = eid || name;
    let g = map.get(key);
    if (!g) {
      const agent = agentProfile(name, eid);
      const supervisor = supervisorProfile(r.standard['Supervisor'], eid);
      g = { agent, supervisor, reports: directReportCount(supervisor.name), records: [] };
      map.set(key, g);
    }
    g.records.push(r);
  }
  // Busiest first — the queue should lead with whoever needs the most attention.
  return Array.from(map.values()).sort(
    (a, b) => b.records.length - a.records.length || a.agent.name.localeCompare(b.agent.name),
  );
}

export function PendingAgents({ records, selectedId, onSelect, onOpenProfile }: {
  records: readonly CoachingRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Opens the full profile for an agent (and their supervisor). */
  onOpenProfile: (name: string, eid: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  const groups = React.useMemo(() => groupByAgent(records), [records]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      g.agent.name.toLowerCase().includes(q)
      || (g.agent.eid ?? '').includes(q)
      || g.supervisor.name.toLowerCase().includes(q)
      || (g.agent.team ?? '').toLowerCase().includes(q)
      || g.records.some((r) => (r.standard['Call ID'] ?? '').includes(q)),
    );
  }, [groups, query]);

  // Keep the group holding the current selection open, so choosing a Call ID
  // from elsewhere (a deep link, say) does not leave the list collapsed.
  React.useEffect(() => {
    if (!selectedId) return;
    const owner = groups.find((g) => g.records.some((r) => r.id === selectedId));
    if (owner) setOpenKey(owner.agent.eid ?? owner.agent.name);
  }, [selectedId, groups]);

  const scrolls = filtered.length > SCROLL_AFTER_ROWS;

  /**
   * Cap the list at exactly seven rows.
   *
   * The height is taken from the seventh row's own position rather than from a
   * per-row constant: a hardcoded guess broke immediately (60px assumed against
   * a 45px row, so nothing scrolled), and the row height genuinely changes with
   * viewport width because the supervisor column is hidden on narrow screens.
   *
   * Only the collapsed header buttons are measured, so expanding a group does
   * not change where the cutoff sits.
   */
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    /**
     * Clamp the list to the bottom edge of the seventh row.
     *
     * Measured from the row's real position rather than from a per-row
     * constant. Row height is not fixed — the supervisor column is hidden below
     * `sm`, so a row is ~47px narrow and ~61px wide — and earlier attempts that
     * cached a single height produced a clamp that was stale the moment the
     * layout changed, leaving the list either unscrollable or cut short.
     */
    const measure = () => {
      const list = listRef.current;
      if (!list) return;
      const rows = list.querySelectorAll<HTMLElement>(':scope > li');
      if (rows.length <= SCROLL_AFTER_ROWS) {
        list.style.maxHeight = '';
        return;
      }
      const seventh = rows[SCROLL_AFTER_ROWS - 1];
      if (!seventh) return;
      // Clear first so the measurement is of the unclamped layout.
      list.style.maxHeight = '';
      const height = seventh.getBoundingClientRect().bottom - list.getBoundingClientRect().top;
      if (height > 0) list.style.maxHeight = `${Math.round(height)}px`;
    };

    measure();

    // Width drives the breakpoint that changes row height. Observing the
    // parent rather than the list avoids reacting to the height we just set.
    const parent = el.parentElement;
    const ro = new ResizeObserver(measure);
    if (parent) ro.observe(parent);
    return () => ro.disconnect();
  });

  if (!groups.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-[420px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agent, EID, supervisor, wave or Call ID"
          aria-label="Search pending agents"
          className="h-[34px] w-full rounded-md border border-input bg-card pl-8 pr-2.5 text-[12.5px]"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          No agent matches “{query}”.
        </p>
      ) : (
        <ul
          // Only constrain the height once the list is actually long enough to
          // need it; a short queue should size to its content.
          className={cn(
            'flex flex-col gap-2',
            // `scrollbar-gutter: stable` reserves the scrollbar's width so the
            // rows do not reflow at the moment the list becomes scrollable.
            scrolls && 'overflow-y-auto pr-1 [scrollbar-gutter:stable]',
          )}
          ref={listRef}
          // A scrollable region needs to be reachable by keyboard, or the rows
          // below the fold cannot be scrolled to without a mouse.
          tabIndex={scrolls ? 0 : undefined}
          role={scrolls ? 'group' : undefined}
          aria-label={scrolls ? `${filtered.length} agents, scrollable list` : undefined}
        >
          {filtered.map((g) => {
            const key = g.agent.eid ?? g.agent.name;
            const open = openKey === key;
            const selectedHere = g.records.some((r) => r.id === selectedId);

            return (
              <li key={key}
                className={cn(
                  // `shrink-0` is required: this is a flex column, and once the
                  // list has a max-height the rows would otherwise compress to
                  // fit it — nine rows silently squashing into the space for
                  // seven instead of overflowing and scrolling.
                  'shrink-0 overflow-hidden rounded-lg border transition-colors',
                  selectedHere ? 'border-primary bg-primary/5' : 'border-border bg-card',
                )}>
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : key)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted"
                >
                  <Avatar profile={g.agent} />
                  <span className="min-w-0 flex-1">
                    {/* Opening the profile must not also toggle the row. */}
                    <b
                      role="link"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenProfile(g.agent.name, g.agent.eid ?? ''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault(); e.stopPropagation();
                          onOpenProfile(g.agent.name, g.agent.eid ?? '');
                        }
                      }}
                      className="block truncate text-[13px] font-semibold underline-offset-2 hover:text-primary hover:underline"
                    >
                      {g.agent.name}
                    </b>
                    <span className="block truncate font-mono text-[11.5px] text-muted-foreground">
                      {g.agent.eid ?? '—'}{g.agent.team ? ` · ${g.agent.team}` : ''}
                    </span>
                  </span>

                  {/* The supervisor this coaching will be released to next. */}
                  <span className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
                    <Avatar profile={g.supervisor} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium">{g.supervisor.name}</span>
                      <span className="flex items-center gap-1 truncate text-[10.5px] text-muted-foreground">
                        {g.supervisor.roleLabel}
                        {g.supervisor.known && <ShieldCheck className="h-3 w-3 text-[var(--status-good)]" aria-label="In directory" />}
                        {g.reports > 0 && <span>· {g.reports} report{g.reports === 1 ? '' : 's'}</span>}
                      </span>
                    </span>
                  </span>

                  <Badge variant={g.records.length > 1 ? 'warn' : 'muted'}>
                    {g.records.length} pending
                  </Badge>
                  <ChevronDown className={cn('h-4 w-4 flex-none text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>

                {open && (
                  <ul className="border-t border-border">
                    {g.records.map((r) => {
                      const active = r.id === selectedId;
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(r.id)}
                            aria-current={active}
                            className={cn(
                              'flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[12.5px] transition-colors hover:bg-muted',
                              active && 'bg-primary/10',
                            )}
                          >
                            <span className="font-mono text-[12px]">{r.standard['Call ID'] || '(no Call ID)'}</span>
                            <span className="truncate text-muted-foreground">
                              {r.standard['Disposition']}
                              {r.standard['Call Reason'] ? ` · ${r.standard['Call Reason']}` : ''}
                            </span>
                            <span className="ml-auto flex-none font-mono text-[11.5px] text-muted-foreground">
                              {r.standard['Call Date'] || ''}
                            </span>
                            {active && <Badge variant="accent">Open</Badge>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
