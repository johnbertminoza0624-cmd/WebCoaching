'use client';

import { Card, CardHeader, CardBody } from '@/components/ui/primitives';
import { initials } from '@/lib/use-template-repository';
import type { FormTemplate } from '@/lib/mock-data';

/** Full-width change-log card — used alone (no parameter panel beside it) on
 * the Active and Archive subpages, and beside the editor on New. */
export function ChangeLogPanel({ template }: { template: FormTemplate | null }) {
  return (
    <Card>
      <CardHeader title="Change log" />
      <CardBody className="flex flex-col gap-0">
        {!template ? (
          <p className="text-[13px] text-muted-foreground">Select a form above to see its history.</p>
        ) : template.changeLog.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No changes recorded yet.</p>
        ) : (
          template.changeLog.map((c, i) => (
            <div key={i} className="flex gap-2.5 border-b border-border py-2.5 last:border-b-0">
              <div className="grid h-6 w-6 flex-none place-items-center rounded-full bg-secondary text-[9.5px] font-semibold">
                {initials(c.who)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px]"><b>{c.who}</b> <span className="text-muted-foreground">· {c.role}</span></div>
                <div className="my-0.5 font-mono text-[11px] text-muted-foreground">{c.when} · {c.action}</div>
                {c.field && (
                  <div className="text-xs">
                    <span className="font-mono text-muted-foreground">{c.field}</span><br />
                    <span className="text-muted-foreground line-through">{c.oldValue ?? 'empty'}</span>
                    <span className="text-muted-foreground"> → </span>
                    <span className="font-medium">{c.newValue ?? 'empty'}</span>
                  </div>
                )}
                {c.note && (
                  <div className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">{c.note}</div>
                )}
              </div>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
