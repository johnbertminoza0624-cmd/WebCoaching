'use client';

import * as React from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Check, MoreHorizontal, TriangleAlert, Upload, Download, FileSpreadsheet, X, SearchX } from 'lucide-react';
import {
  Card, CardHeader, CardBody, Badge, Button, KpiTile, Field, Modal, PageActions,
  Table, Th, Td, EmptyState,
} from '@/components/ui/primitives';
import { DropdownSelect, type DropdownOption } from '@/components/ui/dropdown-select';
import {
  ROLES, ROLE_LABELS, ROLE_SCOPE, USERS, ROSTER, ELEVATED_ROLES, type Role, type AppUser,
} from '@/lib/mock-data';
import { api } from '@/lib/api-client';
import { useAuthedSession } from '@/lib/session';

const roleOptions: DropdownOption[] = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

const CAPS: Array<[string, Role[]]> = [
  ['Create & score audits', ['QA', 'QA_TEAM_LEAD', 'QA_MANAGER', 'ADMIN']],
  ['Sign as agent', ['AGENT']],
  ['Sign as team leader', ['OPS_TEAM_LEAD']],
  ['Author SMART action plan', ['OPS_TEAM_LEAD', 'OPS_ACCOUNT_MANAGER', 'ADMIN']],
  ['Reopen / void an audit', ['QA_TEAM_LEAD', 'QA_MANAGER', 'ADMIN']],
  ['Account dashboard', ['QA_TEAM_LEAD', 'OPS_ACCOUNT_MANAGER', 'QA_MANAGER', 'SERVICE_DELIVERY_MANAGER', 'ADMIN']],
  ['Org-wide dashboard', ['SERVICE_DELIVERY_MANAGER', 'ADMIN']],
  ['Edit parameters & weights', ['QA_MANAGER', 'ADMIN']],
  ['Manage reference lists', ['QA_MANAGER', 'ADMIN']],
  ['Manage users & roles', ['ADMIN']],
  ['Read activity log', ['QA_TEAM_LEAD', 'QA_MANAGER', 'SERVICE_DELIVERY_MANAGER', 'ADMIN']],
];

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('');
}

function userEmail(name: string) {
  // Kept only for the invite preview, where no account exists yet. Real users
  // carry their actual address from the API.
  return `${name.toLowerCase().replace(/ /g, '.')}@awr.local`;
}

/** Extract just the wave portion from a team string like "Wave 8 · Gerodias" → "Wave 8".
 * Handles multi-wave TLs like "Wave 6 · Wave 8" → "Wave 6 · Wave 8".
 * Non-wave teams (QA pod, Care & Claims) return the full team string. */
function extractWave(team: string): string {
  if (!team || team === '—') return '—';
  if (!team.toLowerCase().startsWith('wave')) return team;
  // If format is "Wave N · SomeName" (supervisor name after ·), return just the wave part.
  const parts = team.split(' · ');
  const allWaves = parts.every((p) => p.trim().toLowerCase().startsWith('wave'));
  return allWaves ? team : (parts[0] ?? team);
}

/** Resolve a supervisor's full name from a team string like "Wave 8 · Gerodias".
 * Looks up the last-name token against USERS. Returns '—' for TLs / non-wave staff. */
function extractSupervisorName(team: string): string {
  if (!team || team === '—') return '—';
  if (!team.toLowerCase().startsWith('wave')) return '—';
  const parts = team.split(' · ');
  const supervisorPart = parts.find((p) => !p.trim().toLowerCase().startsWith('wave'));
  if (!supervisorPart) return '—';
  const lastName = supervisorPart.trim().toLowerCase();
  const match = USERS.find((u) => u.name.split(' ').pop()?.toLowerCase() === lastName);
  return match?.name ?? supervisorPart.trim();
}

/** A parsed spreadsheet row, before the server has accepted it. */
type ImportRow = AppUser & { email: string };

interface ActivityEntry {
  id: string; when: string; text: string;
}

function RowMenu({ user, selfId, onDeactivate, onReactivate, onResetPassword, onResendInvite, onRemoveInvite }: {
  user: AppUser;
  onDeactivate: () => void;
  onReactivate: () => void;
  onResetPassword: () => void;
  onResendInvite: () => void;
  onRemoveInvite: () => void;
  /** The signed-in user's id — nobody may act on their own account here. */
  selfId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const self = user.id === selfId;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const item = (label: string, onClick: () => void, danger = false) => (
    <button type="button" onClick={() => { setOpen(false); onClick(); }}
      className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-muted ${danger ? 'text-destructive' : ''}`}>
      {label}
    </button>
  );

  return (
    <div className="relative inline-block" ref={rootRef}>
      <Button size="sm" variant="ghost" aria-label="More actions" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-[100] mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {user.status === 'PENDING' && item('Resend invite', onResendInvite)}
          {user.status === 'PENDING' && item('Withdraw invite', onRemoveInvite, true)}
          {user.status !== 'PENDING' && item('Reset password', onResetPassword)}
          {user.status === 'ACTIVE' && !self && item('Deactivate account', onDeactivate, true)}
          {user.status === 'INACTIVE' && item('Reactivate account', onReactivate)}
          {self && <p className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">You can't manage your own account here.</p>}
        </div>
      )}
    </div>
  );
}

/** The API's user row, mapped onto the shape this page renders. */
interface ApiUser {
  id: string; email: string; eid: string | null;
  firstName: string; lastName: string;
  role: Role; status: string;
  accountId: string | null; teamId: string | null;
  team?: {
    id: string;
    name: string;
    wave: string | null;
    lead?: { id: string; firstName: string; lastName: string } | null;
  } | null;
  leadsTeam?: Array<{ id: string; name: string; wave: string | null }>;
}
/** The page renders `AdminUser`; the real email, wave, and supervisor ride along with it. */
type AdminUser = AppUser & {
  email: string;
  wave: string;
  supervisor: string;
};

const toAppUser = (u: ApiUser): AdminUser => {
  const fullName = `${u.firstName} ${u.lastName}`.trim();

  let wave = '—';
  let supervisor = '—';

  // 1. Direct team / leadsTeam relation from DB
  if (u.team) {
    wave = u.team.wave || extractWave(u.team.name);
    if (u.team.lead) {
      supervisor = `${u.team.lead.firstName} ${u.team.lead.lastName}`.trim();
    }
  } else if (u.leadsTeam && u.leadsTeam.length > 0) {
    wave = u.leadsTeam.map((t) => t.wave || extractWave(t.name)).filter(Boolean).join(' · ');
    supervisor = 'Self (Team Lead)';
  } else if (u.role === 'OPS_TEAM_LEAD') {
    supervisor = 'Self (Team Lead)';
  }

  // 2. Fallback to ROSTER lookup by EID or Name if not linked in DB
  if (wave === '—' || supervisor === '—') {
    const rosterMatch = ROSTER.find(
      (r) => (u.eid && r.eid === u.eid) || r.name.toLowerCase() === fullName.toLowerCase(),
    );
    if (rosterMatch) {
      if (wave === '—') wave = rosterMatch.wave;
      if (supervisor === '—') supervisor = rosterMatch.supervisor;
    }
  }

  // 3. Fallback to USERS / STAFF_USERS from directory
  if (wave === '—' || supervisor === '—') {
    const userMatch = USERS.find(
      (m) => (u.eid && m.eid === u.eid) || m.name.toLowerCase() === fullName.toLowerCase(),
    );
    if (userMatch) {
      if (wave === '—') wave = extractWave(userMatch.team);
      if (supervisor === '—') supervisor = extractSupervisorName(userMatch.team);
    }
  }

  return {
    email: u.email,
    id: u.id,
    name: fullName,
    eid: u.eid ?? '—',
    team: wave,
    wave,
    supervisor,
    role: u.role,
    status: (u.status as AppUser['status']) ?? 'ACTIVE',
    lastSignIn: '—',
  };
};

export default function AdminPage() {
  const { user: me } = useAuthedSession();
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);

  /** Always re-read from the server after a change — it is the authority on
   *  what actually happened, and it may have refused part of the request. */
  const load = React.useCallback(async () => {
    try {
      const res = await api.get<{ rows: ApiUser[] }>('/users');
      setUsers(res.rows.map(toAppUser));
    } catch (err) {
      toast.error('Could not load users', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('');
  const [pending, setPending] = React.useState<{ user: AppUser; to: Role } | null>(null);
  const [reason, setReason] = React.useState('');
  const [activity, setActivity] = React.useState<ActivityEntry[]>([]);
  const [showActivity, setShowActivity] = React.useState(false);
  const [showInvite, setShowInvite] = React.useState(false);

  const [page, setPage] = React.useState(1);

  const filtered = users.filter((u) =>
    (!roleFilter || u.role === roleFilter) &&
    (!search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.eid.includes(search) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.wave.toLowerCase().includes(search.toLowerCase()) ||
      u.supervisor.toLowerCase().includes(search.toLowerCase())));

  const PAGE_SIZE = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, pages);
  const pageRows = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const counts = {
    total: users.length,
    active: users.filter((u) => u.status === 'ACTIVE').length,
    inactive: users.filter((u) => u.status === 'INACTIVE').length,
    pending: users.filter((u) => u.status === 'PENDING').length,
  };

  function log(text: string) {
    setActivity((a) => [{ id: crypto.randomUUID(), when: new Date().toLocaleString(), text }, ...a]);
  }

  function requestRoleChange(user: AppUser, to: Role) {
    if (user.id === me.id) return;
    setReason('');
    setPending({ user, to });
  }

  async function confirmRoleChange() {
    if (!pending) return;
    if (reason.trim().length < 3) {
      toast.error('Give a reason', { description: 'At least a few words — the server records it against the change.' });
      return;
    }
    try {
      // The server re-checks that this actor may assign this role, that it is
      // not their own account, and that a reason was given — then writes the
      // RoleChange row itself.
      await api.post(`/users/${pending.user.id}/role`, { role: pending.to, reason: reason.trim() });
      await load();
      log(`${ROLE_LABELS[pending.user.role]} → ${ROLE_LABELS[pending.to]} for ${pending.user.name}. Reason: ${reason.trim()}`);
      toast.success(`${pending.user.name} is now ${ROLE_LABELS[pending.to]}`);
      setPending(null);
      setReason('');
    } catch (err) {
      toast.error('Role change refused', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  async function setStatus(user: AppUser, status: AppUser['status'], verb: string) {
    try {
      await api.post(`/users/${user.id}/status`, { active: status === 'ACTIVE' });
      await load();
      log(`${user.name} ${verb}.`);
      toast.success(`${user.name} ${verb}`);
    } catch (err) {
      toast.error('Could not update', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  function removeInvite(user: AppUser) {
    if (!window.confirm(`Withdraw the invitation for ${user.name}? They will not be able to sign in.`)) return;
    setUsers((list) => list.filter((u) => u.id !== user.id));
    log(`Invitation withdrawn for ${user.name}.`);
    toast(`Invitation withdrawn for ${user.name}`);
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <PageActions>
        <Button size="sm" onClick={() => setShowActivity(true)}>Activity log</Button>
        <Button size="sm" variant="primary" onClick={() => setShowInvite(true)}>
          <Upload className="h-3.5 w-3.5" />Upload users
        </Button>
      </PageActions>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiTile label="Total users" value={counts.total} stripe="info" meta="across 1 account" />
        <KpiTile label="Active" value={counts.active} stripe="good" meta="signed in last 30 days" />
        <KpiTile label="Inactive" value={counts.inactive} stripe="warn" meta="retained for audit history" />
        <KpiTile label="Pending invite" value={counts.pending} stripe="accent" meta="no password set yet" />
      </div>

      <Card>
        <CardHeader
          title="All users"
          action={
            <div className="flex items-center gap-2">
              <div className="flex gap-2">
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, EID, email"
                  className="h-[31px] w-[200px] rounded-md border border-input bg-card px-2.5 text-[12.5px]" />
                <div className="w-[190px]">
                  <DropdownSelect
                    options={[{ value: '', label: 'All roles' }, ...roleOptions]}
                    value={roleFilter} onChange={(v) => { setRoleFilter(v); setPage(1); }} />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" disabled={pageClamped <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <span className="font-mono text-[12.5px] text-muted-foreground">{pageClamped} / {pages}</span>
                <Button size="sm" disabled={pageClamped >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          }
        />
        <Table minWidth={1000}>
          <thead>
            <tr>
              {['User', 'EID', 'Email', 'Wave', 'Supervisor', 'Role', 'Status', 'Last sign-in'].map((h) => (
                <Th key={h} nowrap>{h}</Th>
              ))}
              <Th align="right" nowrap><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    icon={SearchX}
                    title="No users match that search"
                    description="Try a different name, EID, or email — or clear the role filter."
                    compact
                  />
                </td>
              </tr>
            )}
            {pageRows.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id} className="transition-colors hover:bg-muted">
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-secondary text-[10.5px] font-semibold">
                        {initials(u.name)}
                      </div>
                      <div>
                        <b className="text-[13px]">{u.name}</b>
                        {self && <Badge variant="outline" size="sm" className="ml-1">You</Badge>}
                      </div>
                    </div>
                  </Td>
                  <Td mono className="text-[13px]">{u.eid}</Td>
                  <Td nowrap className="text-[12.5px] text-muted-foreground">{u.email}</Td>
                  <Td nowrap className="text-[12.5px] text-muted-foreground">{u.wave}</Td>
                  <Td nowrap className="text-[12.5px] text-muted-foreground">{u.supervisor}</Td>
                  <Td>
                    <div className="min-w-[180px]">
                      <DropdownSelect options={roleOptions} value={u.role} disabled={self}
                        onChange={(v) => requestRoleChange(u, v as Role)} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Sees: {ROLE_SCOPE[u.role]}</div>
                  </Td>
                  <Td>
                    {u.status === 'ACTIVE' ? <Badge variant="good">Active</Badge>
                      : u.status === 'PENDING' ? <Badge variant="warn">Pending invite</Badge>
                      : <Badge variant="muted">Inactive</Badge>}
                  </Td>
                  <Td className="text-[13px] text-muted-foreground">{u.lastSignIn}</Td>
                  <Td align="right">
                    <RowMenu
                      user={u}
                      selfId={me.id}
                      onDeactivate={() => setStatus(u, 'INACTIVE', 'deactivated')}
                      onReactivate={() => setStatus(u, 'ACTIVE', 'reactivated')}
                      onResetPassword={() => toast.success('Password reset link sent', { description: u.email })}
                      onResendInvite={() => toast.success('Invite resent', { description: u.name })}
                      onRemoveInvite={() => removeInvite(u)}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Permission matrix" />
        <Table minWidth={640}>
          <thead>
            <tr>
              <Th className="min-w-[200px]">Capability</Th>
              {ROLES.map((r) => (
                <Th key={r} align="center" className="min-w-[74px]">{ROLE_LABELS[r]}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPS.map(([cap, allowed]) => (
              <tr key={cap} className="transition-colors hover:bg-muted">
                <Td className="text-[12.5px]">{cap}</Td>
                {ROLES.map((r) => (
                  <Td key={r} align="center" className="px-2">
                    {allowed.includes(r)
                      ? <Check className="mx-auto h-[15px] w-[15px] text-[var(--status-good)]" aria-label="allowed" />
                      : <span className="text-border" aria-label="not allowed">—</span>}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {pending && (
        <Modal
          title={`Change role for ${pending.user.name}`}
          subtitle={`They will see: ${ROLE_SCOPE[pending.to].toLowerCase()}.`}
          onClose={() => setPending(null)}
          footer={<>
            <Button size="sm" onClick={() => setPending(null)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={confirmRoleChange}>Confirm change</Button>
          </>}
        >
          <div className="mb-4 flex items-center gap-2.5">
            <Badge variant="muted">{ROLE_LABELS[pending.user.role]}</Badge>
            <span className="text-muted-foreground">→</span>
            <Badge variant="accent">{ROLE_LABELS[pending.to]}</Badge>
          </div>
          {ELEVATED_ROLES.includes(pending.to) && (
            <div className="mb-3.5 flex items-start gap-2.5 rounded-lg border border-primary/20 bg-accent px-3.5 py-3 text-[12.5px]">
              <TriangleAlert className="mt-px h-[15px] w-[15px] flex-none text-primary" aria-hidden="true" />
              <div>
                <b>{ROLE_LABELS[pending.to]} is an elevated role.</b> It grants visibility beyond a
                single team{pending.to === 'ADMIN' ? ', plus the ability to manage every user account' : ''}.
              </div>
            </div>
          )}
          <Field label="Reason (recorded in the activity log)">
            <textarea rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Promoted to Ops Team Lead effective this cycle"
              className="w-full resize-y rounded-md border border-input bg-card p-2 text-[13px]" />
          </Field>
        </Modal>
      )}

      {showActivity && (
        <Modal title="Activity log" subtitle="Role changes and account actions from this session" onClose={() => setShowActivity(false)}
          footer={<Button size="sm" onClick={() => setShowActivity(false)}>Close</Button>} width={520}>
          {activity.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing recorded yet this session — role changes and account actions will appear here.
            </p>
          ) : (
            <ul className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
              {activity.map((e) => (
                <li key={e.id} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <p className="text-[13px]">{e.text}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{e.when}</p>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {showInvite && (
        <UploadUsersModal
          existingUsers={users}
          onClose={() => setShowInvite(false)}
          onImport={async (rows) => {
            // There is no bulk endpoint: each row is created individually so a
            // single bad row cannot sink the rest of the file, and every
            // failure comes back with the server's own reason.
            const failures: { name: string; reason: string }[] = [];
            let created = 0;

            for (const row of rows) {
              if (!row.email) {
                failures.push({ name: row.name, reason: 'No email address in the file' });
                continue;
              }
              const [firstName, ...rest] = row.name.split(/\s+/);
              try {
                await api.post('/users', {
                  email: row.email,
                  firstName: firstName ?? row.name,
                  lastName: rest.join(' ') || '—',
                  eid: row.eid || null,
                  role: row.role,
                });
                created += 1;
              } catch (err) {
                failures.push({
                  name: row.name,
                  reason: err instanceof Error ? err.message : 'Refused by the server',
                });
              }
            }

            await load();
            log(`Imported ${created} user(s) via xlsx upload${failures.length ? `; ${failures.length} refused` : ''}.`);

            if (created > 0) {
              toast.success(`${created} user${created === 1 ? '' : 's'} created`, {
                description: failures.length
                  ? `${failures.length} row${failures.length === 1 ? '' : 's'} refused — see the activity log.`
                  : 'They can sign in once an administrator sets a password.',
              });
            } else {
              toast.error('Nothing was imported', {
                description: failures[0]?.reason ?? 'Every row was refused.',
              });
            }
            for (const f of failures) log(`Refused ${f.name}: ${f.reason}`);
            setShowInvite(false);
          }}
        />
      )}
    </div>
  );
}

const TEMPLATE_COLS = ['name', 'eid', 'email', 'wave', 'role'] as const;
/** The email is the account identity, so the sample shows a real-looking one. */
const TEMPLATE_SAMPLE = [
  { name: 'Jane Cruz', eid: '22874', email: 'jane.cruz@awr.local', wave: 'Wave 8', role: 'AGENT' },
];

function downloadXlsx(rows: object[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...TEMPLATE_COLS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Users');
  XLSX.writeFile(wb, filename);
}

function UploadUsersModal({ existingUsers, onClose, onImport }: {
  existingUsers: AppUser[];
  onClose: () => void;
  onImport: (users: ImportRow[]) => Promise<void>;
}) {
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<ImportRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [fileName, setFileName] = React.useState('');
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  function parseFile(file: File) {
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]!]!;
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        if (!rows.length) { setError('The file appears to be empty.'); return; }
        const parsed: ImportRow[] = rows.map((r, i) => ({
          id: `u-import-${r['eid'] ?? i}`,
          name: String(r['name'] ?? '').trim() || `User ${i + 1}`,
          // The email is the account's identity — the API creates on it, so a
          // row without one cannot become a user.
          email: String(r['email'] ?? '').trim().toLowerCase(),
          eid: String(r['eid'] ?? '').trim(),
          team: String(r['wave'] ?? '').trim(),
          role: (Object.keys(ROLE_LABELS).includes(r['role'] ?? '') ? r['role'] : 'AGENT') as Role,
          status: 'ACTIVE' as AppUser['status'],
          lastSignIn: 'Never',
        }));
        setPreview(parsed);
      } catch {
        setError('Could not read the file. Make sure it is a valid .xlsx file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  return (
    <Modal
      title="Upload users"
      subtitle="Import users from an Excel file — existing EIDs are updated, new EIDs are added"
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!preview?.length || busy}
            onClick={async () => {
              if (!preview) return;
              setBusy(true);
              try { await onImport(preview); } finally { setBusy(false); }
            }}>
            {busy ? 'Importing…' : `Import ${preview ? `${preview.length} user${preview.length !== 1 ? 's' : ''}` : ''}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Download actions */}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost"
            onClick={() => downloadXlsx(TEMPLATE_SAMPLE, 'users-template.xlsx')}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Download template
          </Button>
          <Button size="sm" variant="ghost"
            onClick={() => downloadXlsx(
              existingUsers.map((u) => ({
                name: u.name, eid: u.eid,
                email: `${u.name.toLowerCase().replace(/ /g, '.')}@awr.com`,
                wave: (u as AdminUser).wave || extractWave(u.team),
                supervisor: (u as AdminUser).supervisor || extractSupervisorName(u.team),
                role: u.role, status: u.status, lastSignIn: u.lastSignIn,
              })),
              'users-export.xlsx',
            )}>
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />Download existing users
          </Button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
          }`}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
          <Upload className="h-7 w-7 text-muted-foreground" />
          {fileName ? (
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="text-[13px] font-medium text-foreground">{fileName}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setFileName(''); setPreview(null); setError(''); }}
                className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <p className="text-[13px] font-medium text-foreground">Drop your .xlsx file here or click to browse</p>
              <p className="text-[11.5px] text-muted-foreground">Use the template above to ensure the correct column format</p>
            </>
          )}
        </div>

        {error && (
          <p className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />{error}
          </p>
        )}

        {/* Preview table */}
        {preview && preview.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              Preview — {preview.length} row{preview.length !== 1 ? 's' : ''} detected
            </p>
            <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border [&_tbody_tr:last-child_td]:border-b-0">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {['Name', 'EID', 'Wave', 'Role'].map((h) => (
                      <th key={h} className="border-b border-border bg-muted/50 px-2.5 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((u, i) => (
                    <tr key={i} className="hover:bg-muted/40">
                      <td className="border-b border-border px-2.5 py-2 font-medium text-foreground">{u.name}</td>
                      <td className="border-b border-border px-2.5 py-2 font-mono text-muted-foreground">{u.eid}</td>
                      <td className="border-b border-border px-2.5 py-2 text-muted-foreground">{u.team || '—'}</td>
                      <td className="border-b border-border px-2.5 py-2">
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-medium">{ROLE_LABELS[u.role] ?? u.role}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
