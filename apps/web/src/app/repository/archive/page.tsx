'use client';

import * as React from 'react';
import { Badge, Button } from '@/components/ui/primitives';
import { FormsTable } from '@/components/repository/forms-table';
import { ChangeLogPanel } from '@/components/repository/change-log-panel';
import { useTemplateRepository } from '@/lib/use-template-repository';

export default function ArchiveRepositoryPage() {
  const { templates, restore } = useTemplateRepository();
  const archived = React.useMemo(() => templates.filter((t) => t.status === 'ARCHIVED'), [templates]);
  const [selectedId, setSelectedId] = React.useState<string | null>(archived[0]?.id ?? null);

  React.useEffect(() => {
    if (!archived.some((t) => t.id === selectedId)) setSelectedId(archived[0]?.id ?? null);
  }, [archived, selectedId]);

  const selected = archived.find((t) => t.id === selectedId) ?? null;

  return (
    <>
      <FormsTable
        title="Forms"
        headerBadge={<Badge variant="outline">{archived.length} archived</Badge>}
        templates={archived} activeId={selectedId} onSelect={setSelectedId}
        emptyMessage="Nothing archived yet."
        rowAction={(t) => (
          <Button size="sm" variant="ghost" onClick={() => void restore(t)}>Restore to draft</Button>
        )}
      />

      <ChangeLogPanel template={selected} />
    </>
  );
}
