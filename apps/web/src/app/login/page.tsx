'use client';

import * as React from 'react';
import { Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useSession } from '@/lib/session';
import { ApiError } from '@/lib/api-client';
import { CoachingArt } from '@/components/auth/coaching-art';
import { LogoMark } from '@/components/brand/logo-mark';

/**
 * Sign in.
 *
 * A single centred card over a full-page animated backdrop. The backdrop is
 * one hue — the brand blue — because a second colour in the atmosphere reads
 * as a different product.
 */
export default function LoginPage() {
  const { login, loading, user } = useSession();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      // SessionProvider redirects once /auth/me resolves.
    } catch (err) {
      // The API's message is deliberately identical for a wrong password and an
      // unknown address; passing it through verbatim keeps it that way.
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }

  if (loading || user) {
    return (
      <PageLoader />
    );
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-10">
      {/* Full-page backdrop; the card sits on top of it. */}
      <CoachingArt />

      <div className="relative w-full max-w-[420px]">
        <div className="rounded-2xl border border-[color-mix(in_oklch,var(--primary)_18%,var(--border))] bg-card/85 px-7 py-8 shadow-[0_30px_70px_-30px_color-mix(in_oklch,var(--primary)_55%,transparent)] backdrop-blur-xl sm:px-9 sm:py-10">
          <div className="mb-8 flex items-center gap-2.5">
            {/* drop-shadow, not shadow: box-shadow would draw a square behind
                the mark's rounded silhouette. */}
            <LogoMark className="h-9 w-9 drop-shadow-sm" decorative />
            <span className="leading-tight">
              <b className="block text-[14.5px] font-semibold tracking-[-0.01em]">AWR</b>
              <span className="block text-[11.5px] text-muted-foreground">Quality Coaching</span>
            </span>
          </div>

          <h1 className="text-[23px] font-semibold tracking-[-0.02em]">Welcome back</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Sign in to review audits and complete coaching.
          </p>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[11.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
                placeholder="name@awr.local"
                className="h-[42px] w-full rounded-md border border-input bg-background/70 px-3.5 text-[13.5px] outline-none transition-shadow placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/12"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[11.5px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="h-[42px] w-full rounded-md border border-input bg-background/70 pl-3.5 pr-11 text-[13.5px] outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 grid h-8 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-md bg-primary text-[13.5px] font-semibold text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.995] disabled:pointer-events-none disabled:opacity-60"
            >
              {busy
                ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Signing in…</>
                : <><LogIn className="h-4 w-4" /> Sign in</>}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
