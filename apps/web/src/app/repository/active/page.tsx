'use client';

import * as React from 'react';
import { Badge, Button, Field, Modal } from '@/components/ui/primitives';
import { FormsTable } from '@/components/repository/forms-table';
import { ChangeLogPanel } from '@/components/repository/change-log-panel';
import { TemplateDetail } from '@/components/repository/template-detail';
import { FormBuilder, type BuilderFields } from '@/components/repository/form-builder';
import { CURRENT_ACTOR, useTemplateRepository } from '@/lib/use-template-repository';

export default function ActiveRepositoryPage() {
  const { templates, archive, updateTemplate, createVersion } = useTemplateRepository();
  const active = React.useMemo(() => templates.filter((t) => t.status === 'PUBLISHED'), [templates]);
  const [selectedId, setSelectedId] = React.useState<string | null>(active[0]?.id ?? null);
  const [editing, setEditing] = React.useState(false);
  const [showNewVersion, setShowNewVersion] = React.useState(false);

  React.useEffect(() => {
    if (!active.some((t) => t.id === selectedId)) setSelectedId(active[0]?.id ?? null);
  }, [active, selectedId]);

  const selected = active.find((t) => t.id === selectedId) ?? null;

  /**
   * The API refuses an in-place edit of a published form once it has scored
   * anything: `templates.service.ts` throws "Create a new version instead of
   * editing it in place", because editing would change what those audits were
   * measured against. The button mirrors that rule rather than offering an
   * action the server will reject — a form that has scored audits gets the
   * fork instead.
   */
  const editable = selected !== null && selected.audits === 0;

  function handleSave(fields: BuilderFields) {
    if (!selected) return;
    updateTemplate(selected.id, {
      name: fields.name,
      lineOfBusiness: fields.lineOfBusiness,
      accountId: fields.global ? null : selected.accountId,
      scope: fields.global ? 'GLOBAL' : selected.scope,
      metadata: fields.metadata.trim() || undefined,
      metaFields: fields.metaFields.length ? fields.metaFields : undefined,
      params: fields.params,
    }, {
      who: CURRENT_ACTOR.name, role: CURRENT_ACTOR.role, when: new Date().toLocaleString(),
      action: 'template.updated',
      note: `Edited a published form — now ${fields.params.length} parameter${fields.params.length === 1 ? '' : 's'}.`,
    });
    setEditing(false);
  }

  if (editing && selected) {
    return <FormBuilder key={selected.id} existing={selected} onCancel={() => setEditing(false)} onSave={handleSave} />;
  }

  return (
    <>
      <FormsTable
        title="Forms"
        headerBadge={<Badge variant="outline">{active.length} active</Badge>}
        templates={active} activeId={selectedId} onSelect={setSelectedId}
        emptyMessage="No forms are published yet. Publish one from the New tab."
        rowAction={(t) => (
          <Button size="sm" variant="ghost" onClick={() => void archive(t)}>Archive</Button>
        )}
      />

      {selected && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.35fr_1fr]">
          <TemplateDetail
            template={selected}
            actions={<>
              <Button
                size="sm"
                disabled={!editable}
                title={editable ? undefined : `This form has scored ${selected.audits} audit(s) — create a new version instead.`}
                onClick={() => setEditing(true)}
              >
                Edit form
              </Button>
              <Button size="sm" onClick={() => setShowNewVersion(true)}>New version</Button>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => void archive(selected)}>Archive</Button>
            </>}
          />

          <ChangeLogPanel template={selected} />
        </div>
      )}

      {showNewVersion && selected && (
        <NewVersionModal
          current={selected.version}
          onClose={() => setShowNewVersion(false)}
          onCreate={async (version) => {
            const created = await createVersion(selected, version);
            if (!created) return;
            setShowNewVersion(false);
          }}
        />
      )}
    </>
  );
}

/** Forks a published form's parameters into a fresh draft, which is where the
 * revision is then edited and re-published. */
function NewVersionModal({ current, onClose, onCreate }: { current: string; onClose: () => void; onCreate: (version: string) => void }) {
  const [version, setVersion] = React.useState(`${current} (draft)`);
  return (
    <Modal
      title="Create a new version"
      subtitle={`Forks the parameters from v${current} into a new draft`}
      onClose={onClose}
      footer={<>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => version.trim() && onCreate(version.trim())}>Create version</Button>
      </>}
    >
      <Field label="Version label">
        <input autoFocus value={version} onChange={(e) => setVersion(e.target.value)}
          className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 text-[13px]" />
      </Field>
    </Modal>
  );
}
