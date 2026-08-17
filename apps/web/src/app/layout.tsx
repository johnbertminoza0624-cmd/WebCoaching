import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { SessionProvider } from '@/lib/session';
import { AuditStoreProvider } from '@/lib/audit-store';
import './globals.css';

export const metadata: Metadata = {
  title: 'AWR Quality Coaching',
  description: 'Quality coaching forms, scoring and dashboards for AWR programs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes: it writes the theme
    // class onto <html> before React hydrates, which is by design.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* Session first: the store only fetches once there is a session,
              and refetches when the signed-in user changes. */}
          <SessionProvider>
            <AuditStoreProvider>
              <AppShell>{children}</AppShell>
            </AuditStoreProvider>
          </SessionProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--popover)',
                color: 'var(--popover-foreground)',
                border: '1px solid var(--border)',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
