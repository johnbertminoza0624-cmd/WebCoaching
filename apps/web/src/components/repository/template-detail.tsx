'use client';

import * as React from 'react';
import { Badge, Card, CardHeader, Table, Th, Td, EmptyState } from '@/components/ui/primitives';
import { formatWeightPercent, weightTotal } from '@/lib/mock-data';
import { criticalSuffix, TYPE_VAR } from '@/lib/use-template-repository';
import type { FormTemplate } from '@/lib/mock-data';

/**
 * The selected form's parameter breakdown, with an actions row supplied by the
 * page.
 *
 * This lived inline in the New (drafts) route, which meant Active had no detail
 * panel at all — so a published form offered nothing but "Archive" and there
 * was no route to a revision anywhere in the app. Extracting it lets Active
 * render the same panel with its own actions.
 */
export function TemplateDetail({
  template,
  actions,
}: {
  template: FormTemplate;
  actions?: React.ReactNode;
}) {
  const total = weightTotal(template);
  return (
    <Card>
      <CardHeader
        title={template.name}
        action={
          <Badge
            variant={template.params.length === 0 ? 'muted' : total === 1 ? 'good' : 'critical'}
            className="font-mono"
          >
            weights {template.params.length === 0 ? '—' : formatWeightPercent(total)}
          </Badge>
        }
      />
      {template.params.length === 0 ? (
        <EmptyState title="No parameters yet" description="Edit this form to add some." compact />
      ) : (
        <Table minWidth={420}>
          <thead>
            <tr>
              <Th className="w-[150px]">Type</Th>
              <Th>Parameter</Th>
              <Th align="right" nowrap>Weight</Th>
            </tr>
          </thead>
          <tbody>
            {template.params.map((p) => (
              <tr key={p.sortOrder} className="transition-colors hover:bg-muted">
                <Td>
                  <span
                    className="flex items-center gap-1.5 text-[12px] font-semibold"
                    style={{ color: TYPE_VAR[p.criticalType] }}
                  >
                    <i className="h-2 w-2 flex-none rounded-sm" style={{ background: TYPE_VAR[p.criticalType] }} />
                    {criticalSuffix(p.criticalType)}
                  </span>
                </Td>
                <Td className="text-[12.5px]">{p.text}</Td>
                <Td align="right" className="text-[13px]">{formatWeightPercent(p.weight)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {template.metadata && (
        <div className="border-t border-border px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
            Metadata
          </span>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{template.metadata}</p>
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2 border-t border-border p-4">{actions}</div>}
    </Card>
  );
}
