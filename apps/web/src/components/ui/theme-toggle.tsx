'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { SkyToggle } from '@/components/ui/sky-toggle';

/**
 * The app's theme control. `SkyToggle` stays presentational and controlled;
 * this is the only place that knows about next-themes.
 *
 * The mount guard is not optional. `resolvedTheme` is undefined on the server,
 * so rendering the real value straight away makes the server send "light" and
 * the client immediately render "dark" — React logs a hydration mismatch and
 * the switch visibly flips on load. We render a non-interactive placeholder of
 * identical size until mounted, so nothing shifts.
 */
export function ThemeToggle({ size = '22px' }: { size?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  if (!mounted) {
    // Same footprint as the real control: 5.625em x 2.5em at `size`.
    // `suppressHydrationWarning` because this node is *intended* to differ
    // between the server render and the client's first commit — the whole
    // point of the mount guard is to swap the placeholder for the real,
    // theme-aware control once `mounted` flips, and React would otherwise
    // flag that deliberate swap as a mismatch.
    return (
      <div
        aria-hidden="true"
        suppressHydrationWarning
        style={{
          width: `calc(${size} * 5.625)`,
          height: `calc(${size} * 2.5)`,
          borderRadius: '9999px',
          background: 'var(--muted)',
        }}
      />
    );
  }

  return (
    <SkyToggle
      size={size}
      checked={isDark}
      onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
      label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    />
  );
}

export default ThemeToggle;
