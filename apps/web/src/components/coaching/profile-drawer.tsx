'use client';

import * as React from 'react';
import { X, UserCheck, ArrowRight } from 'lucide-react';
import { Badge, Button } from '@/components/ui/primitives';
import { STAGE_LABEL, type FormStage } from '@awr/shared';
import { agentProfile, supervisorProfile, avatarTint, directReportCount, type Profile } from '@/lib/directory';
import type { CoachingRecord } from '@/lib/coaching-store';

/**
 * The profile behind a name on a coaching record.
 *
 * Shows the agent, the supervisor they report to, and every coaching record the
 * agent has that the viewer may see, broken down by workflow stage.
 */

function Avatar({ profile, size }: { profile: Profile; size: number }) {
  return (
    <span aria-hidden="true"
      className="grid flex-none place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: avatarTint(profile.name) }}>
      {profile.initials}
    </span>
  );
}

function PersonCard({ profile, caption, onViewAs }: {
  profile: Profile;
  caption: string;
  onViewAs?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/25 p-4">
      <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">{caption}</p>
      <div className="flex items-center gap-3">
        <Avatar profile={profile} size={44} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[14px] font-semibold">{profile.name}</b>
          <p className="truncate text-[12px] text-muted-foreground">{profile.roleLabel}</p>
        </div>
        {onViewAs && (
          <Button size="sm" onClick={onViewAs}>
            <UserCheck className="h-3.5 w-3.5" /> View as
          </Button>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.05em] text-muted-foreground">EID</dt>
          <dd className="font-mono text-[12.5px]">{profile.eid ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.05em] text-muted-foreground">
            {profile.role === 'AGENT' ? 'Wave' : 'Teams'}
          </dt>
          <dd className="truncate text-[12.5px]">{profile.team ?? '—'}</dd>
        </div>
      </dl>
      {!profile.known && (
        <p className="mt-3 text-[11px] text-[var(--status-warn)]">
          Not in the user directory — imported from the spreadsheet only.
        </p>
      )}
    </div>
  );
}

export function ProfileDrawer({ agentName, agentEid, records, onClose, onOpenRecord }: {
  agentName: string | null;
  agentEid: string;
  /** All records for this agent that the viewer may see. */
  records: CoachingRecord[];
  onClose: () => void;
  onOpenRecord: (id: string) => void;
}) {
  const open = agentName !== null;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const agent = agentProfile(agentName, agentEid);
  const supervisor = supervisorProfile(records[0]?.standard['Supervisor'], agentEid);

  // Where this agent's coaching sits, by stage.
  const byStage = new Map<FormStage, CoachingRecord[]>();
  for (const r of records) {
    byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r]);
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
      <div role="dialog" aria-modal="true" aria-label={`Profile — ${agent.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col bg-card shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[17px] font-semibold">Profile</h2>
            <p className="text-[12px] text-muted-foreground">
              {records.length} coaching record{records.length === 1 ? '' : 's'} visible to you
            </p>
          </div>
          <button onClick={onClose} aria-label="Close profile"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          {/* "View as" is gone: identity now comes from an httpOnly session
              cookie, so the client cannot become another person. To follow a
              coaching through the workflow, sign in as that user. */}
          <PersonCard profile={agent} caption="Agent" />
          <PersonCard profile={supervisor}
            caption={`Reports to · ${directReportCount(supervisor.name)} direct report${directReportCount(supervisor.name) === 1 ? '' : 's'}`} />

          <div>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
              Coaching by stage
            </p>
            <div className="flex flex-col gap-2">
              {Array.from(byStage.entries()).map(([stage, rs]) => (
                <div key={stage} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <Badge variant="muted">{STAGE_LABEL[stage]}</Badge>
                    <span className="text-[11.5px] text-muted-foreground">{rs.length}</span>
                  </div>
                  <ul>
                    {rs.map((r) => (
                      <li key={r.id}>
                        <button onClick={() => { onOpenRecord(r.id); onClose(); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-muted">
                          <span className="font-mono">{r.standard['Call ID']}</span>
                          <span className="truncate text-muted-foreground">{r.standard['Call Reason']}</span>
                          <ArrowRight className="ml-auto h-3.5 w-3.5 flex-none text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
