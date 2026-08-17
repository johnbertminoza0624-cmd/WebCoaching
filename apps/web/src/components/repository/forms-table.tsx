'use client';

import * as React from 'react';
import { FileText } from 'lucide-react';
import { Card, CardHeader, Badge, Table, Th, Td, EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { weightTotal } from '@/lib/mock-data';
import type { FormTemplate } from '@/lib/mock-data';

function statusBadge(status: FormTemplate['status']) {
  if (status === 'PUBLISHED') return <Badge variant="good">Published</Badge>;
  if (status === 'DRAFT') return <Badge variant="warn">Draft</Badge>;
  return <Badge variant="muted">Archived</Badge>;
}

export function FormsTable({
  title, headerBadge, templates, activeId, onSelect, rowAction, emptyMessage,
}: {
  title: string;
  headerBadge?: React.ReactNode;
  templates: FormTemplate[];
  activeId: string | null;
  onSelect: (id: string) => void;
  rowAction?: (t: FormTemplate) => React.ReactNode;
  emptyMessage: string;
}) {
  return (
    <Card>
      <CardHeader title={title} action={headerBadge} />
      {templates.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing here yet" description={emptyMessage} compact />
      ) : (
        // This table used to carry its own header dialect — 11px labels at
        // 0.055em on px-3 — while the audits and performance tables used
        // 10.5px at 0.04em on px-2.5. Same app, two different table designs.
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th nowrap>Form</Th>
              <Th nowrap>Version</Th>
              <Th nowrap>Scope</Th>
              <Th align="right" nowrap>Parameters</Th>
              <Th align="right" nowrap>Audits scored</Th>
              <Th nowrap>Status</Th>
              <Th nowrap>Last edited</Th>
              {rowAction && <Th align="right" nowrap><span className="sr-only">Actions</span></Th>}
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const sum = weightTotal(t);
              const bad = t.params.length > 0 && sum !== 1;
              const active = t.id === activeId;
              return (
                <tr
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  aria-selected={active}
                  className={cn('cursor-pointer transition-colors', active ? 'bg-accent' : 'hover:bg-muted')}
                >
                  <Td>
                    <b className="text-[13px]">{t.name}</b>
                    <div className="font-mono text-[11.5px] text-muted-foreground">{t.slug}</div>
                  </Td>
                  <Td mono className="text-[13px]">{t.version}</Td>
                  <Td>
                    {t.accountId === null
                      ? <Badge variant="accent">All accounts</Badge>
                      : <span className="text-[13px] text-muted-foreground">{t.scope}</span>}
                  </Td>
                  <Td align="right" className="text-[13px]">
                    {t.params.length}
                    {bad && <Badge variant="critical" size="sm" className="ml-1.5">!</Badge>}
                  </Td>
                  <Td align="right" className="text-[13px]">{t.audits}</Td>
                  <Td>{statusBadge(t.status)}</Td>
                  <Td className="text-[12.5px] text-muted-foreground">{t.lastEdited}</Td>
                  {rowAction && (
                    <Td align="right" onClick={(e) => e.stopPropagation()}>
                      {rowAction(t)}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
