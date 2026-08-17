'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Badge, Button, Field, Modal, PageActions } from '@/components/ui/primitives';
import { FormsTable } from '@/components/repository/forms-table';
import { ChangeLogPanel } from '@/components/repository/change-log-panel';
import { TemplateDetail } from '@/components/repository/template-detail';
import { FormBuilder, type BuilderFields } from '@/components/repository/form-builder';
import { CURRENT_ACCOUNT_ID } from '@/lib/mock-data';
import { useTemplateRepository } from '@/lib/use-template-repository';

export default function NewRepositoryPage() {
  const { templates, updateTemplate, publish, createVersion, createForm } = useTemplateRepository();
  const drafts = React.useMemo(() => templates.filter((t) => t.status === 'DRAFT'), [templates]);
  const [selectedId, setSelectedId] = React.useState<string | null>(drafts[0]?.id ?? null);

  React.useEffect(() => {
    if (!drafts.some((t) => t.id === selectedId)) setSelectedId(drafts[0]?.id ?? null);
  }, [drafts, selectedId]);

  const selected = drafts.find((t) => t.id === selectedId) ?? null;

  const [mode, setMode] = React.useState<'list' | 'builder'>('list');
  const [builderTargetId, setBuilderTargetId] = React.useState<string | null>(null);
  const [showNewVersion, setShowNewVersion] = React.useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  async function handleBuilderSave(fields: BuilderFields) {
    if (builderTargetId) {
      const target = templates.find((t) => t.id === builderTargetId);
      updateTemplate(builderTargetId, {
        name: fields.name, lineOfBusiness: fields.lineOfBusiness,
        accountId: fields.global ? null : (target?.accountId ?? null),
        scope: fields.global ? 'GLOBAL' : (target?.scope ?? 'AWR Care and Claims'),
        metadata: fields.metadata.trim() || undefined,
        metaFields: fields.metaFields.length ? fields.metaFields : undefined,
        params: fields.params,
      }, {
        who: 'Melody Tagaytay', role: 'QA Manager', when: new Date().toLocaleString(),
        action: 'template.updated', note: `Edited form details and parameters — now ${fields.params.length} parameter${fields.params.length === 1 ? '' : 's'}.`,
      });
      setSelectedId(builderTargetId);
      toast.success('Draft updated');
    } else {
      const created = await createForm({
        name: fields.name, lineOfBusiness: fields.lineOfBusiness, global: fields.global, metadata: fields.metadata,
        metaFields: fields.metaFields, params: fields.params,
      }, CURRENT_ACCOUNT_ID);
      // A refused create returns null; stay on the form rather than selecting
      // something that does not exist.
      if (!created) return;
      setSelectedId(created.id);
    }
    setMode('list');
  }

  if (mode === 'builder') {
    const target = builderTargetId ? templates.find((t) => t.id === builderTargetId) ?? null : null;
    return (
      <FormBuilder
        key={builderTargetId ?? 'new'}
        existing={target}
        onCancel={() => setMode('list')}
        onSave={handleBuilderSave}
      />
    );
  }

  return (
    <>
      <PageActions>
        <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            toast(`Selected ${file.name}`, { description: 'Import parsing isn’t wired to a backend yet — this needs the API’s template-import endpoint.' });
            e.target.value = '';
          }} />
        <Button size="sm" onClick={() => importInputRef.current?.click()}>Import from Excel</Button>
        <Button size="sm" variant="primary" onClick={() => { setBuilderTargetId(null); setMode('builder'); }}>
          New coaching form
        </Button>
      </PageActions>

      <FormsTable
        title="Drafts"
        headerBadge={<Badge variant="outline">{drafts.length} draft{drafts.length === 1 ? '' : 's'}</Badge>}
        templates={drafts} activeId={selectedId} onSelect={setSelectedId}
        emptyMessage='No drafts right now — click "New coaching form" to start one.'
      />

      {selected && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.35fr_1fr]">
          <TemplateDetail
            template={selected}
            actions={<>
              <Button size="sm" onClick={() => { setBuilderTargetId(selected.id); setMode('builder'); }}>Edit form</Button>
              <Button size="sm" onClick={() => setShowNewVersion(true)}>New version</Button>
              <Button size="sm" variant="primary" onClick={() => void publish(selected)}>Publish</Button>
            </>}
          />

          <ChangeLogPanel template={selected} />
        </div>
      )}

      {showNewVersion && selected && (
        <NewVersionModal current={selected.version}
          onClose={() => setShowNewVersion(false)}
          onCreate={async (version) => {
            const created = await createVersion(selected, version);
            if (!created) return;
            setSelectedId(created.id);
            setShowNewVersion(false);
          }} />
      )}
    </>
  );
}

function NewVersionModal({ current, onClose, onCreate }: { current: string; onClose: () => void; onCreate: (version: string) => void }) {
  const [version, setVersion] = React.useState(`${current} (draft)`);
  return (
    <Modal title="Create a new version" subtitle={`Forks the parameters from v${current} into a new draft`} onClose={onClose}
      footer={<>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => version.trim() && onCreate(version.trim())}>Create version</Button>
      </>}>
      <Field label="Version label">
        <input autoFocus value={version} onChange={(e) => setVersion(e.target.value)}
          className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 text-[13px]" />
      </Field>
    </Modal>
  );
}
