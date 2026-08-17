'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, Field } from '@/components/ui/primitives';
import { DropdownSelect } from '@/components/ui/dropdown-select';
import { TYPE_OPTIONS } from '@/lib/use-template-repository';
import { META_FIELD_TYPES, type FormTemplate, type TemplateParam, type MetaField, type MetaFieldType } from '@/lib/mock-data';
import type { CriticalType } from '@awr/shared';

interface EditRow { key: string; criticalType: CriticalType; text: string; weightPct: string }
interface MetaRow { key: string; label: string; type: MetaFieldType; required: boolean }

export interface BuilderFields {
  name: string; lineOfBusiness: string; metadata: string; global: boolean;
  metaFields: MetaField[]; params: TemplateParam[];
}

const META_TYPE_OPTIONS = META_FIELD_TYPES.map((t) => ({ value: t.value, label: t.label, description: t.hint }));

/**
 * The coaching-form authoring experience — deliberately built to read like
 * the real Coaching audit form (lettered sections, the same parameter-row
 * shape and type coloring) rather than a generic settings form, since a QA
 * Manager authoring a form's parameters is doing the same kind of work an
 * auditor does scoring one.
 */
export function FormBuilder({
  existing, onCancel, onSave,
}: {
  existing: FormTemplate | null;
  onCancel: () => void;
  onSave: (fields: BuilderFields) => void;
}) {
  const [name, setName] = React.useState(existing?.name ?? '');
  const [lineOfBusiness, setLineOfBusiness] = React.useState(existing?.lineOfBusiness ?? '');
  const [metadata, setMetadata] = React.useState(existing?.metadata ?? '');
  const [metaRows, setMetaRows] = React.useState<MetaRow[]>(
    (existing?.metaFields ?? []).map((f) => ({ key: crypto.randomUUID(), label: f.label, type: f.type, required: f.required })),
  );
  const [global, setGlobal] = React.useState(existing?.accountId === null);
  const [rows, setRows] = React.useState<EditRow[]>(
    (existing?.params ?? []).map((p) => ({
      key: crypto.randomUUID(), criticalType: p.criticalType, text: p.text,
      weightPct: String(Math.round(p.weight * 1000) / 10),
    })),
  );

  function addRow() {
    setRows((r) => [...r, { key: crypto.randomUUID(), criticalType: 'PROCESS', text: '', weightPct: '0' }]);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }

  function addMetaField() {
    setMetaRows((m) => [...m, { key: crypto.randomUUID(), label: '', type: 'text', required: false }]);
  }
  function removeMetaField(key: string) {
    setMetaRows((m) => m.filter((row) => row.key !== key));
  }

  const total = React.useMemo(
    () => Math.round(rows.reduce((a, r) => a + (Number(r.weightPct) || 0), 0) * 10) / 10,
    [rows],
  );

  function save() {
    if (!name.trim()) { toast.error('Name the form first'); return; }
    if (rows.some((r) => !r.text.trim())) { toast.error('Every parameter needs text — remove any blank rows'); return; }
    if (metaRows.some((m) => !m.label.trim())) { toast.error('Every metadata field needs a label — remove any blank ones'); return; }
    const params: TemplateParam[] = rows.map((r, i) => ({
      sortOrder: i + 1, criticalType: r.criticalType, text: r.text.trim(), weight: (Number(r.weightPct) || 0) / 100,
    }));
    const metaFields: MetaField[] = metaRows.map((m) => ({
      id: m.key, label: m.label.trim(), type: m.type, required: m.required,
    }));
    onSave({ name: name.trim(), lineOfBusiness: lineOfBusiness.trim() || 'Uncategorized', metadata, global, metaFields, params });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button size="sm" variant="ghost" className="-ml-1.5 mb-2.5" onClick={onCancel}>
          <ArrowLeft className="h-[15px] w-[15px]" /> Back to drafts
        </Button>
        <h1 className="text-[21px] font-semibold">{existing ? 'Edit coaching form' : 'New coaching form'}</h1>
        <p className="mt-1 max-w-[62ch] text-[13px] text-muted-foreground">
          {existing
            ? 'Changes save to this draft. Publish it from the drafts list once the parameters total 100%.'
            : "Starts as a draft with no parameters. Publish it from the drafts list once it's ready."}
        </p>
      </div>

      <Card>
        <CardHeader title={<><span className="mr-2 font-mono text-[11.5px] text-primary">Section A</span>Form details</>} />
        <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Form name" className="sm:col-span-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Quality Coaching Form — AWR Leasing Audit"
              className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 text-[13px]" />
          </Field>
          <Field label="Line of business">
            <input value={lineOfBusiness} onChange={(e) => setLineOfBusiness(e.target.value)} placeholder="Leasing"
              className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 text-[13px]" />
          </Field>
          <Field label="Scope">
            <label className="flex h-[34px] items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              Available to all accounts
            </label>
          </Field>
          <Field label="Notes (optional)" hint="Free-form notes for other QA Managers — calibration references, scope caveats." className="sm:col-span-2">
            <textarea rows={2} value={metadata} onChange={(e) => setMetadata(e.target.value)}
              placeholder="e.g. Calibrated against Q3 2026 sample set. Excludes outbound retention save calls."
              className="w-full resize-y rounded-md border border-input bg-card p-2 text-[13px]" />
          </Field>

          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Custom metadata fields (optional)</span>
              {metaRows.length > 0 && <span className="text-[11.5px] text-muted-foreground">{metaRows.length} field{metaRows.length === 1 ? '' : 's'}</span>}
            </div>
            <p className="mb-2.5 text-[11.5px] text-muted-foreground">
              Extra capture fields the auditor fills in the first section alongside Call ID and AHT. Choose what each accepts.
            </p>

            {metaRows.length > 0 && (
              <div className="mb-2.5 flex flex-col gap-2">
                {metaRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_160px_auto_32px] items-center gap-2">
                    <input value={row.label}
                      onChange={(e) => setMetaRows((m) => m.map((x) => (x.key === row.key ? { ...x, label: e.target.value } : x)))}
                      placeholder="Field label — e.g. Ticket number"
                      className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 text-[12.5px]" />
                    <DropdownSelect options={META_TYPE_OPTIONS} value={row.type}
                      onChange={(v) => setMetaRows((m) => m.map((x) => (x.key === row.key ? { ...x, type: v as MetaFieldType } : x)))} />
                    <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-[12px] text-muted-foreground">
                      <input type="checkbox" checked={row.required}
                        onChange={(e) => setMetaRows((m) => m.map((x) => (x.key === row.key ? { ...x, required: e.target.checked } : x)))}
                        className="h-3.5 w-3.5 accent-primary" />
                      Required
                    </label>
                    <button type="button" onClick={() => removeMetaField(row.key)} aria-label="Remove field"
                      className="grid h-[34px] w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button size="sm" variant="ghost" className="self-start" onClick={addMetaField}>
              <Plus className="h-3.5 w-3.5" /> Add metadata field
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<><span className="mr-2 font-mono text-[11.5px] text-primary">Section B</span>Parameters</>} />
        <CardBody className="flex flex-col gap-2.5">
          {rows.length === 0 && (
            <p className="py-4 text-center text-[13px] text-muted-foreground">No parameters yet — add the first one below.</p>
          )}
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[150px_1fr_84px_32px] items-start gap-2">
              <DropdownSelect options={TYPE_OPTIONS} value={row.criticalType}
                onChange={(v) => setRows((r) => r.map((x) => (x.key === row.key ? { ...x, criticalType: v as CriticalType } : x)))} />
              <input value={row.text}
                onChange={(e) => setRows((r) => r.map((x) => (x.key === row.key ? { ...x, text: e.target.value } : x)))}
                placeholder="Did the agent…"
                className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 text-[12.5px]" />
              <div className="relative">
                <input value={row.weightPct} inputMode="decimal"
                  onChange={(e) => setRows((r) => r.map((x) => (x.key === row.key ? { ...x, weightPct: e.target.value } : x)))}
                  className="h-[34px] w-full rounded-md border border-input bg-card px-2.5 pr-6 text-right text-[12.5px] tabular-nums" />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11.5px] text-muted-foreground">%</span>
              </div>
              <button type="button" onClick={() => removeRow(row.key)} aria-label="Remove parameter"
                className="grid h-[34px] w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" /> Add parameter
          </Button>
        </CardBody>
        <div className="flex items-center gap-3 border-t border-border p-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">Weights</span>
          <span className={`font-mono text-[13px] tabular-nums ${total === 100 || rows.length === 0 ? 'text-muted-foreground' : 'text-destructive'} ${total === 100 && rows.length > 0 ? '!text-[var(--status-good)]' : ''}`}>
            {total}%
          </span>
          <div className="flex-1" />
          <Button size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={save}>{existing ? 'Save changes' : 'Save draft'}</Button>
        </div>
      </Card>
    </div>
  );
}

