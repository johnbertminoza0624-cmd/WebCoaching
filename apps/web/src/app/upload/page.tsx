'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ShieldAlert, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardBody, Button, Badge } from '@/components/ui/primitives';
import { DropdownSelect, type DropdownOption } from '@/components/ui/dropdown-select';
import { ROLE_LABELS } from '@awr/shared';
import { useTemplateRepository } from '@/lib/use-template-repository';
import {
  downloadTemplate, parseAndValidate, templateColumns, STANDARD_FIELDS,
  metaColumns, parameterColumns, type ValidationResult,
} from '@/lib/excel-template';
import { api } from '@/lib/api-client';
import { useAuditStore } from '@/lib/audit-store';
import { useAuthedSession } from '@/lib/session';

const UPLOAD_ROLES = new Set(['QA', 'QA_TEAM_LEAD', 'QA_MANAGER', 'ADMIN']);

export default function UploadPage() {
  const router = useRouter();
  const { templates } = useTemplateRepository();
  const { user: me } = useAuthedSession();
  const { refresh } = useAuditStore();
  const allowed = !!me && UPLOAD_ROLES.has(me.role);

  const published = React.useMemo(() => templates.filter((t) => t.status === 'PUBLISHED'), [templates]);
  const [formId, setFormId] = React.useState('');
  /** Rows the server declined, with its reason — shown after an import. */
  const [skipped, setSkipped] = React.useState<{ callId: string; reason: string }[]>([]);
  const form = published.find((t) => t.id === formId) ?? null;

  const [result, setResult] = React.useState<ValidationResult | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Reset any prior upload result whenever the selected form changes.
  React.useEffect(() => { setResult(null); setFileName(''); }, [formId]);

  if (!allowed) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-8 w-8 text-destructive" />
          <h1 className="text-[18px] font-semibold">You don&rsquo;t have access to Audit upload</h1>
          <p className="max-w-[46ch] text-[13px] text-muted-foreground">
            This page is limited to QA, QA Team Lead, QA Manager, and Admin. You&rsquo;re signed in as {me ? ROLE_LABELS[me.role] : 'an unknown role'}.
          </p>
        </CardBody>
      </Card>
    );
  }

  const options: DropdownOption[] = published.map((t) => ({
    value: t.id, label: t.name,
    description: `v${t.version} · ${t.params.length} parameter${t.params.length === 1 ? '' : 's'} · ${t.lineOfBusiness}`,
  }));

  async function onFile(file: File) {
    if (!form) return;
    setBusy(true); setFileName(file.name);
    try {
      const r = await parseAndValidate(file, form);
      setResult(r);
      if (r.ok) toast.success(`${r.records.length} audit row${r.records.length === 1 ? '' : 's'} validated`);
      else toast.error(`${r.errors.length} issue${r.errors.length === 1 ? '' : 's'} found — nothing was imported`);
    } catch {
      toast.error('Could not read that file');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Import the validated rows.
   *
   * Parsing stays in the browser — it generated the template, so it knows the
   * columns — but the server re-resolves the parameter set, recomputes each
   * score, matches people by EID and rejects duplicates. Nothing about what is
   * created is taken from the file on trust.
   */
  async function createRecords() {
    if (!form || !result?.ok) return;
    setBusy(true);
    try {
      const res = await api.post<{ created: number; skipped: { callId: string; reason: string }[] }>(
        '/uploads/audits',
        {
          templateId: form.id,
          rows: result.records.map((r) => ({ standard: r.standard, params: r.params })),
        },
      );

      await refresh();
      setResult(null); setFileName('');

      if (res.created > 0) {
        toast.success(`${res.created} coaching record${res.created === 1 ? '' : 's'} created`, {
          description: res.skipped.length
            ? `${res.skipped.length} row${res.skipped.length === 1 ? '' : 's'} skipped — see below.`
            : 'They’ve entered QA Review.',
        });
      } else {
        toast.error('Nothing was imported', {
          description: res.skipped[0]?.reason ?? 'Every row was skipped.',
        });
      }
      setSkipped(res.skipped);
    } catch (err) {
      toast.error('Import failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Step 1 — select form */}
      <Card>
        <CardHeader title={<><span className="mr-2 font-mono text-[11.5px] text-primary">1</span>Select Coaching Form</>} />
        <CardBody className="flex flex-col gap-4">
          <div className="max-w-[440px]">
            <DropdownSelect options={options} value={formId} onChange={setFormId}
              placeholder={published.length ? 'Select Coaching Form' : 'No published forms available'} />
          </div>

          {form && (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{form.name}</span>
                <Badge variant="outline" className="font-mono">v{form.version}</Badge>
                <Badge variant="muted">{form.lineOfBusiness}</Badge>
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Template columns generated from this form ({templateColumns(form).length})
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STANDARD_FIELDS.map((c) => (
                  <span key={c} className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">{c}</span>
                ))}
                {metaColumns(form).map((c) => (
                  <span key={c} className="rounded-md border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/10 px-2 py-1 text-[11px] text-[var(--chart-4)]">{c}</span>
                ))}
                {parameterColumns(form).map((c) => (
                  <span key={c} className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary" title={c}>
                    {c.length > 42 ? c.slice(0, 40) + '…' : c}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-sm bg-muted-foreground/40 align-middle" /> standard &nbsp;
                <span className="inline-block h-2 w-2 rounded-sm bg-[var(--chart-4)] align-middle" /> custom fields &nbsp;
                <span className="inline-block h-2 w-2 rounded-sm bg-primary align-middle" /> parameters (Yes / No / N/A)
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Step 2 — download */}
      <Card>
        <CardHeader title={<><span className="mr-2 font-mono text-[11.5px] text-primary">2</span>Download Excel template</>} />
        <CardBody>
          <Button size="sm" variant="primary" disabled={!form} onClick={() => form && downloadTemplate(form)}>
            <Download className="h-[15px] w-[15px]" /> Download template{form ? ` — ${form.name}` : ''}
          </Button>
          {!form && <p className="mt-2 text-[12px] text-muted-foreground">Select a Coaching Form first.</p>}
        </CardBody>
      </Card>

      {/* Step 3 — upload */}
      <Card>
        <CardHeader title={<><span className="mr-2 font-mono text-[11.5px] text-primary">3</span>Upload completed template</>} />
        <CardBody className="flex flex-col gap-4">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <div>
            <Button size="sm" disabled={!form || busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-[15px] w-[15px]" /> {busy ? 'Reading…' : 'Choose Excel file'}
            </Button>
            {fileName && (
              <span className="ml-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" /> {fileName}
              </span>
            )}
            {!form && <p className="mt-2 text-[12px] text-muted-foreground">Select a Coaching Form first.</p>}
          </div>

          {result?.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-lg border border-[var(--status-warn)]/40 bg-[var(--status-warn-surface)] p-3 text-[12.5px] text-[var(--status-warn)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /> {w}
            </div>
          ))}

          {result && !result.ok && (
            <div className="overflow-hidden rounded-lg border border-destructive/40">
              <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-[13px] font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" /> {result.errors.length} issue{result.errors.length === 1 ? '' : 's'} — nothing was imported
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
                      <th className="border-b border-border px-4 py-2 font-semibold">Row</th>
                      <th className="border-b border-border px-4 py-2 font-semibold">Column</th>
                      <th className="border-b border-border px-4 py-2 font-semibold">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="border-b border-border px-4 py-2 font-mono tabular-nums text-muted-foreground">{e.row ?? '—'}</td>
                        <td className="border-b border-border px-4 py-2">{e.column ?? '—'}</td>
                        <td className="border-b border-border px-4 py-2">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result?.ok && (
            <div className="overflow-hidden rounded-lg border border-[var(--status-good)]/40">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--status-good)]/30 bg-[var(--status-good-surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--status-good)]">
                <CheckCircle2 className="h-4 w-4" /> {result.records.length} audit row{result.records.length === 1 ? '' : 's'} passed validation
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void createRecords()}>
                    Create {result.records.length} coaching record{result.records.length === 1 ? '' : 's'} <ArrowRight className="h-[14px] w-[14px]" />
                  </Button>
                </span>
              </div>
              <div className="max-h-[360px] overflow-auto">
                <table className="w-max min-w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
                      <th className="sticky left-0 z-10 whitespace-nowrap border-b border-border bg-[var(--status-good-surface)] px-4 py-2 font-semibold">Agent</th>
                      <th className="whitespace-nowrap border-b border-border px-4 py-2 font-semibold">EID</th>
                      <th className="whitespace-nowrap border-b border-border px-4 py-2 font-semibold">Call date</th>
                      <th className="whitespace-nowrap border-b border-border px-4 py-2 font-semibold">Disposition</th>
                      {form && [...form.params].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => (
                        <th key={p.sortOrder} className="whitespace-nowrap border-b border-border px-3 py-2 text-center font-semibold" title={p.text}>
                          P{p.sortOrder}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.records.slice(0, 25).map((r) => (
                      <tr key={r.rowNumber} className="group">
                        <td className="sticky left-0 z-10 whitespace-nowrap border-b border-border bg-card px-4 py-2">{r.standard['Agent Name']}</td>
                        <td className="whitespace-nowrap border-b border-border px-4 py-2 font-mono text-muted-foreground">{r.standard['EID']}</td>
                        <td className="whitespace-nowrap border-b border-border px-4 py-2 text-muted-foreground">{r.standard['Call Date']}</td>
                        <td className="whitespace-nowrap border-b border-border px-4 py-2 text-muted-foreground">{r.standard['Disposition']}</td>
                        {form && [...form.params].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => {
                          const v = r.params[p.sortOrder];
                          const color = v === 'YES' ? 'text-[var(--status-good)]' : v === 'NO' ? 'text-destructive' : 'text-muted-foreground';
                          return <td key={p.sortOrder} className={`border-b border-border px-3 py-2 text-center font-mono text-[11px] ${color}`}>{v === 'NA' ? 'N/A' : v === 'YES' ? 'Yes' : 'No'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.records.length > 25 && (
                <div className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">Showing 25 of {result.records.length} rows.</div>
              )}
            </div>
          )}

          <p className="text-[11.5px] text-muted-foreground">
            QA remarks and observed behavior are <b>not</b> entered in Excel &mdash; you&rsquo;ll add those on the website during QA Review, after the records are created.
          </p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => router.push('/audits')}>View audits</Button>
          </div>
        </CardBody>
      </Card>

      {skipped.length > 0 && (
        <Card>
          <CardHeader
            title="Rows the server declined"
            action={<Badge variant="warn">{skipped.length}</Badge>}
          />
          <CardBody className="flex flex-col gap-1.5">
            {skipped.map((s) => (
              <div key={`${s.callId}-${s.reason}`} className="flex items-baseline gap-3 text-[12.5px]">
                <span className="font-mono text-muted-foreground">{s.callId}</span>
                <span>{s.reason}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}