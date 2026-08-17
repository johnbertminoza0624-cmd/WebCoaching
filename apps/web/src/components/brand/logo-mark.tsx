import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The AWR mark — a rounded tile carrying a check whose stroke rises to the
 * right, so the one glyph reads as both "audit passed" and "trending up",
 * which is what the product is: quality scoring plus coaching improvement.
 *
 * It replaces the literal "QA" text badge, which could not survive being
 * shrunk to a 16px browser tab.
 *
 * Deliberately drawn from `--primary` / `--primary-foreground` rather than
 * fixed hexes, so it re-tones with the theme exactly as the old badge did
 * (the brand blue is lighter on the dark surface). `app/icon.svg` is the same
 * artwork with those two tokens resolved to their light-mode values, because a
 * favicon is rendered by the browser chrome where no app CSS exists.
 */
export function LogoMark({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  // Two of these render at once (rail + mobile drawer), and a hardcoded
  // gradient id would make the second one reference the first one's def.
  const id = React.useId().replace(/:/g, '');
  const sheenId = `awr-sheen-${id}`;

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('flex-none', className)}
      {...(decorative
        ? { 'aria-hidden': true as const }
        : { role: 'img' as const, 'aria-label': 'AWR Quality Coaching' })}
    >
      <defs>
        {/* A light wash across the top-left corner. Kept as a separate overlay
            rect rather than a two-stop gradient of mixed colours so the base
            stays exactly --primary and only the highlight is synthetic. */}
        <linearGradient id={sheenId} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="var(--primary-foreground)" stopOpacity="0.26" />
          <stop offset="62%" stopColor="var(--primary-foreground)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <rect width="32" height="32" rx="9" fill={`url(#${sheenId})`} />
      <path
        d="M8.8 16.6 L13.5 21.3 L23.4 9.6"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
