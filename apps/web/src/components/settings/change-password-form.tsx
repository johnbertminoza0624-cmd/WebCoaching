'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Eye, EyeOff, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api-client';
import { useAuthedSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * The change-password form itself, with no opinion about what contains it —
 * the sidebar's modal and the `/settings/password` route both render this, so
 * the policy checklist and the submit behaviour cannot drift between the two.
 *
 * The rules below mirror the zod schema in `auth.controller.ts`. They exist to
 * tell the user what is wrong before they submit; the server check is what
 * actually enforces the policy, and this list going stale would weaken the
 * feedback, never the enforcement.
 */
const RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v) => /[0-9]/.test(v) },
];

function PasswordInput({
  id, value, onChange, autoComplete, autoFocus, invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1/2 grid h-7 w-8 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function ChangePasswordForm({
  onSuccess,
  onCancel,
  cancelLabel = 'Clear',
}: {
  /** Called after the API confirms the change — the modal uses this to close. */
  onSuccess?: () => void;
  /** When given, the secondary button calls this instead of clearing in place. */
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { user, refreshUser } = useAuthedSession();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const unmet = RULES.filter((r) => !r.test(next));
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && next === current;
  const canSubmit =
    current.length > 0 && next.length > 0 && confirm.length > 0
    && unmet.length === 0 && !mismatch && !sameAsCurrent && !busy;

  const touch = (set: (v: string) => void) => (v: string) => { set(v); setError(null); };

  function clear() {
    setCurrent(''); setNext(''); setConfirm(''); setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      // The API cleared `mustChangePassword`; re-read the session so nothing
      // keeps claiming a change is still outstanding.
      await refreshUser();
      clear();
      toast.success('Password changed', { description: 'Your other sessions have been signed out.' });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Present but hidden: password managers need a username field in the
          same form to associate the saved credential with an account, and
          without it they offer to save a bare password. */}
      <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />

      <Field label="Current password">
        <PasswordInput
          id="current-password"
          value={current}
          onChange={touch(setCurrent)}
          autoComplete="current-password"
          autoFocus
        />
      </Field>

      <Field label="New password">
        <PasswordInput
          id="new-password"
          value={next}
          onChange={touch(setNext)}
          autoComplete="new-password"
          invalid={sameAsCurrent}
        />
      </Field>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-muted/60 px-3 py-2.5">
        {RULES.map((r) => {
          const ok = r.test(next);
          // Neutral until the user starts typing — four red crosses against an
          // empty field reads as four errors they just made.
          const idle = next.length === 0;
          return (
            <div key={r.label} className="flex items-center gap-1.5 text-[11.5px]">
              <span
                className={cn(
                  'grid h-3.5 w-3.5 flex-none place-items-center rounded-full',
                  idle ? 'bg-[color-mix(in_oklch,var(--muted-foreground)_22%,transparent)] text-muted-foreground'
                    : ok ? 'bg-[var(--status-good-surface)] text-[var(--status-good)]'
                      : 'bg-[var(--status-critical-surface)] text-[var(--status-critical)]',
                )}
                aria-hidden="true"
              >
                {idle ? <span className="h-1 w-1 rounded-full bg-current" />
                  : ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    : <X className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span className={cn(idle || !ok ? 'text-muted-foreground' : 'text-foreground')}>{r.label}</span>
              <span className="sr-only">{idle ? '' : ok ? '— met' : '— not met'}</span>
            </div>
          );
        })}
      </div>

      <Field label="Confirm new password">
        <PasswordInput
          id="confirm-password"
          value={confirm}
          onChange={touch(setConfirm)}
          autoComplete="new-password"
          invalid={mismatch}
        />
      </Field>

      {sameAsCurrent && (
        <p className="-mt-1 text-[12px] text-destructive">
          The new password must be different from your current one.
        </p>
      )}
      {mismatch && (
        <p className="-mt-1 text-[12px] text-destructive">The two new passwords do not match.</p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel ?? clear} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {busy
            ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : <><ShieldCheck className="h-3.5 w-3.5" /> Change password</>}
        </Button>
      </div>
    </form>
  );
}
