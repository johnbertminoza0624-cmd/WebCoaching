'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/primitives';
import { ChangePasswordForm } from '@/components/settings/change-password-form';
import { useAuthedSession } from '@/lib/session';

/**
 * The standalone route. The sidebar's Settings popover opens the same form in a
 * modal, which is the primary path; this exists so `/settings/password` stays a
 * real, linkable destination — the place a "you must change your password"
 * message can point at.
 */
export default function ChangePasswordPage() {
  const { user } = useAuthedSession();

  return (
    <div className="flex flex-col gap-[18px]">
      {user.mustChangePassword && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-[color-mix(in_oklch,var(--status-warn)_35%,transparent)] bg-[var(--status-warn-surface)] px-3.5 py-3"
        >
          <TriangleAlert className="mt-px h-4 w-4 flex-none text-[var(--status-warn)]" aria-hidden="true" />
          <div className="text-[12.5px] leading-relaxed text-[var(--status-warn)]">
            <b className="font-semibold">Your account is still on its issued password.</b>{' '}
            Set one only you know before continuing to use the workspace.
          </div>
        </div>
      )}

      <Card className="max-w-[520px]">
        <CardHeader title="Password" />
        <CardBody>
          <ChangePasswordForm />
        </CardBody>
      </Card>
    </div>
  );
}
