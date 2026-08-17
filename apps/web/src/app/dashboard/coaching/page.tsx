'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AreaChart, Area, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Card, CardHeader, CardBody, KpiTile, Badge, Button, Field, StripeRow, PageActions } from '@/components/ui/primitives';
import { DropdownSelect, type DropdownOption } from '@/components/ui/dropdown-select';
import { DatePicker } from '@/components/ui/date-picker';
import {
  STATUS_LABEL, STATUS_VARIANT, DISPOSITIONS, ROOT_CAUSE_GAPS,
  ROLE_LABELS, STAGE_OWNER, STAGE_SLA_HOURS, formatSecs, hoursInStage,
  auditsToCsv, downloadCsv, type Audit, type AuditStatus,
} from '@/lib/mock-data';
import { useAuditStore, datasetNow } from '@/lib/audit-store';
import { useAuthedSession } from '@/lib/session';
import {
  kpisForRole, buildFunnel, avgTimeInStage, stageRates, volumeBy,
  countByStage, isLive, isPending, isManagement, type FunnelStage,
} from '@/lib/coaching-metrics';

const CAT_COLOR: Record<'customer' | 'process' | 'business' | 'compliance', string> = {
  customer: 'var(--cat-customer)', process: 'var(--cat-process)',
  business: 'var(--cat-business)', compliance: 'var(--cat-compliance)',
};
const CAT_LABEL: Record<keyof typeof CAT_COLOR, string> = {
  customer: 'Customer Critical', process: 'Process Critical',
  business: 'Business Critical', compliance: 'Compliance Critical',
};

/** `YYYY-MM-DD` in the browser's local calendar, not UTC — a plain
 * `toISOString().slice(0,10)` shifts dates by the local UTC offset, which
 * would quietly move audits into the wrong day near midnight. */
function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromInputDate(s: string, endOfDay: boolean): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}
/**
 * The store seeds after mount, so the first render legitimately sees an empty
 * set. Returning today's date for both bounds keeps the date pickers valid
 * until the records arrive, instead of dereferencing `dates[0]` and crashing.
 */
function minMax(dates: Date[]): [Date, Date] {
  if (!dates.length) { const now = new Date(); return [now, now]; }
  let min = dates[0]!, max = dates[0]!;
  for (const d of dates) { if (d < min) min = d; if (d > max) max = d; }
  return [min, max];
}

/** ISO-8601 week label, e.g. "W31" — matches how the trend chart's original
 * hand-written mock data was labeled, but computed from real audit dates. */
function weekLabel(d: Date): string {
  const t = new Date(d.getTime());
  const dayNr = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  const diff = t.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diff / (7 * 864e5));
  return `W${week}`;
}

function uniqueOptions(values: (string | null | undefined)[], allLabel: string): DropdownOption[] {
  const set = Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
  return [{ value: '', label: allLabel }, ...set.map((v) => ({ value: v, label: v }))];
}

/** Config drives the gradient area colors via ChartContainer's injected
 * --color-<key> custom properties. */
const trendConfig = {
  audits: { label: 'Audits', color: 'var(--muted-foreground)' },
  score: { label: 'Avg. score', color: 'var(--primary)' },
} satisfies ChartConfig;

const hbarConfig = {
  value: { label: 'Value' },
  label: { color: 'var(--background)' },
} satisfies ChartConfig;

interface HBarDatum { key: string; label: string; value: number; display: string; color: string }

/** Horizontal (shadcn) bar chart. The category sits on the left axis (our
 * labels are long, unlike the template's short month names) and each bar keeps
 * its own category color via Cells; the value is a right-aligned LabelList. */
function HBar({ data }: { data: HBarDatum[] }) {
  const height = Math.max(120, data.length * 44 + 16);

  // Custom left-aligned tick: Recharts default is textAnchor="end" (right-aligned).
  // We anchor at x=12 (left edge of the 168px axis column) with textAnchor="start"
  // so every label's first letter lines up at the same horizontal position.
  const LeftAlignedTick = ({ y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    if (!payload || y === undefined) return null;
    const label = payload.value.length > 26 ? payload.value.slice(0, 25) + '…' : payload.value;
    return (
      <text x={12} y={y} textAnchor="start" dominantBaseline="middle" fontSize={11.5} fill="var(--muted-foreground)">
        {label}
      </text>
    );
  };

  return (
    <ChartContainer config={hbarConfig} className="aspect-auto w-full" style={{ height }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} />
        <YAxis dataKey="label" type="category" width={168} tickLine={false} axisLine={false} tickMargin={0}
          tick={<LeftAlignedTick />} />
        <XAxis dataKey="value" type="number" hide domain={[0, 'dataMax']} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" hideLabel />} />
        <Bar dataKey="value" radius={5} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.key} fill={d.color} />)}
          <LabelList dataKey="display" position="right" offset={8} className="fill-foreground" fontSize={12} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const fmtHours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)}d` : `${Math.round(h)}h`);

/**
 * The workflow funnel — how many Coaching records are sitting at each stage
 * right now. This is the panel that answers "where is work piling up": the
 * stage holding the most pending records is called out explicitly rather than
 * left for the reader to spot by comparing bar lengths.
 */
function WorkflowFunnel({ stages, total, onSelect }: {
  stages: FunnelStage[];
  total: number;
  onSelect: (s: AuditStatus) => void;
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div className="flex flex-col">
      {stages.map((s) => (
        <button key={s.stage} onClick={() => onSelect(s.stage)}
          className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted">
          <span className="w-[152px] flex-none truncate text-[12.5px] text-muted-foreground group-hover:text-foreground">
            {s.label}
          </span>
          <span className="relative h-[22px] flex-1 overflow-hidden rounded-[5px] bg-muted/50">
            <span
              className="absolute inset-y-0 left-0 rounded-[5px] transition-[width]"
              style={{
                width: `${(s.count / max) * 100}%`,
                background: s.stage === 'FINALIZED' ? 'var(--status-good)'
                  : s.isBottleneck ? 'var(--status-critical)'
                  : 'var(--primary)',
                opacity: s.count ? 0.85 : 0,
              }}
            />
          </span>
          <span className="w-[44px] flex-none text-right font-mono text-[13px] font-semibold tabular-nums">{s.count}</span>
          <span className="w-[52px] flex-none text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {total ? `${s.pct.toFixed(0)}%` : '—'}
          </span>
          <span className="w-[92px] flex-none text-right text-[11px] text-muted-foreground">
            {s.stage === 'FINALIZED'
              ? 'closed'
              : s.count ? `avg ${fmtHours(s.avgHours)} waiting` : '—'}
          </span>
          <span className="w-[74px] flex-none text-right">
            {s.overdue > 0
              ? <Badge variant="critical" dot>{s.overdue} late</Badge>
              : <span className="text-[11px] text-muted-foreground">on track</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Stage completion rates, each against its own denominator. */
function RateBar({ label, done, total, pct }: { label: string; done: number; total: number; pct: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[13px] font-semibold tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[var(--status-good)]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{done} of {total} that reached this stage</p>
    </div>
  );
}

interface Filters {
  auditFrom: string;
  auditTo: string;
  callFrom: string;
  callTo: string;
  wave: string;
  supervisor: string;
  auditor: string;
  lineOfBusiness: string;
  disposition: string;
  status: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthedSession();
  const { audits: allAudits } = useAuditStore();

  // The API already applied the org scope and the workflow visibility floor, so
  // these are exactly the records this user may see. Re-filtering in the browser
  // would only mask a server-side bug.
  const audits = allAudits;
  const now = React.useMemo(() => datasetNow(allAudits), [allAudits]);

  const [minAuditDate, maxAuditDate] = React.useMemo(() => minMax(audits.map((a) => a.auditDate)), [audits]);
  const [minCallDate, maxCallDate] = React.useMemo(() => minMax(audits.map((a) => a.callDate)), [audits]);

  const defaultFilters = React.useMemo((): Filters => ({
    auditFrom: toInputDate(minAuditDate), auditTo: toInputDate(maxAuditDate),
    callFrom: toInputDate(minCallDate), callTo: toInputDate(maxCallDate),
    wave: '', supervisor: '', auditor: '', lineOfBusiness: '', disposition: '', status: '',
  }), [minAuditDate, maxAuditDate, minCallDate, maxCallDate]);

  const [filters, setFilters] = React.useState<Filters>(defaultFilters);

  // Switching role changes which records are in scope, and with them the date
  // bounds. Without this the previous role's range sticks around and silently
  // filters out part of the new scope — the dashboard would under-report.
  React.useEffect(() => { setFilters(defaultFilters); }, [defaultFilters]);

  const options = React.useMemo(() => ({
    wave: uniqueOptions(audits.map((a) => a.wave), 'All waves'),
    supervisor: uniqueOptions(audits.map((a) => a.supervisor), 'All team leads'),
    auditor: uniqueOptions(audits.map((a) => a.auditor), 'All QA auditors'),
    lineOfBusiness: uniqueOptions(audits.map((a) => a.formShort), 'All lines of business'),
    disposition: uniqueOptions(DISPOSITIONS, 'All dispositions'),
    status: [{ value: '', label: 'All statuses' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))],
  }), [audits]);

  const filteredAudits = React.useMemo(() => {
    const auditFrom = fromInputDate(filters.auditFrom, false);
    const auditTo = fromInputDate(filters.auditTo, true);
    const callFrom = fromInputDate(filters.callFrom, false);
    const callTo = fromInputDate(filters.callTo, true);
    return audits.filter((a) => (
      a.auditDate >= auditFrom && a.auditDate <= auditTo
      && a.callDate >= callFrom && a.callDate <= callTo
      && (!filters.wave || a.wave === filters.wave)
      && (!filters.supervisor || a.supervisor === filters.supervisor)
      && (!filters.auditor || a.auditor === filters.auditor)
      && (!filters.lineOfBusiness || a.formShort === filters.lineOfBusiness)
      && (!filters.disposition || a.disposition === filters.disposition)
      && (!filters.status || a.status === (filters.status as AuditStatus))
    ));
  }, [audits, filters]);

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v !== (defaultFilters as any)[k]).length;

  const recent = React.useMemo(
    () => [...filteredAudits].sort((a, b) => +b.auditDate - +a.auditDate).slice(0, 5),
    [filteredAudits],
  );

  // Every record carries its imported .xlsx score, so "scored" is simply the
  // live set — only voided records drop out of quality analytics.
  const scored = React.useMemo(() => filteredAudits.filter(isLive), [filteredAudits]);
  const completed = React.useMemo(() => filteredAudits.filter((a) => a.status === 'FINALIZED'), [filteredAudits]);

  // ---- Workflow-derived state: the whole role-based dashboard hangs off this ----
  const kpis = React.useMemo(() => kpisForRole(filteredAudits, user.role, now), [filteredAudits, user.role, now]);
  const funnel = React.useMemo(() => buildFunnel(filteredAudits, now, user.role), [filteredAudits, now, user.role]);
  const rates = React.useMemo(() => stageRates(filteredAudits, user.role), [filteredAudits, user.role]);
  const dwell = React.useMemo(() => avgTimeInStage(filteredAudits, user.role), [filteredAudits, user.role]);
  const stageCounts = React.useMemo(() => countByStage(filteredAudits), [filteredAudits]);
  const liveCount = React.useMemo(() => filteredAudits.filter(isLive).length, [filteredAudits]);
  const pendingCount = React.useMemo(() => filteredAudits.filter(isPending).length, [filteredAudits]);
  const bottleneck = funnel.find((s) => s.isBottleneck) ?? null;
  const management = isManagement(user.role);

  const overdueRows = React.useMemo(
    () => filteredAudits
      .filter((a) => isPending(a) && hoursInStage(a, now) > 0)
      .sort((a, b) => hoursInStage(b, now) - hoursInStage(a, now))
      .slice(0, 6),
    [filteredAudits, now],
  );

  const volumes = React.useMemo(() => ({
    wave: volumeBy(filteredAudits, 'wave'),
    supervisor: volumeBy(filteredAudits, 'supervisor'),
    auditor: volumeBy(filteredAudits, 'auditor'),
  }), [filteredAudits]);

  const goToStages = React.useCallback(
    (stages: AuditStatus[]) => router.push(`/audits?stage=${stages.join(',')}`),
    [router],
  );
  const goToStage = React.useCallback((s: AuditStatus) => goToStages([s]), [goToStages]);
  const surveyed = React.useMemo(() => filteredAudits.filter((a) => a.surveyed), [filteredAudits]);
  const dsat = React.useMemo(() => surveyed.filter((a) => a.category === 'DSAT'), [surveyed]);
  const dsatControllable = React.useMemo(() => dsat.filter((a) => a.controllable === 'AgentControllable'), [dsat]);

  const avgScore = scored.length ? scored.reduce((s, a) => s + a.score, 0) / scored.length : 0;
  const scoreTrendDelta = React.useMemo(() => {
    if (scored.length < 4) return null;
    const sorted = [...scored].sort((a, b) => +a.auditDate - +b.auditDate);
    const mid = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, mid);
    const late = sorted.slice(mid);
    const avg = (rows: Audit[]) => rows.reduce((s, a) => s + a.score, 0) / rows.length;
    return avg(late) - avg(early);
  }, [scored]);

  const criticalErrors = scored.reduce((s, a) => s + a.totalErrs, 0);
  const dsatRate = surveyed.length ? (dsat.length / surveyed.length) * 100 : 0;

  const trend = React.useMemo(() => {
    const buckets = new Map<string, { week: string; sortKey: number; total: number; count: number }>();
    for (const a of scored) {
      const label = weekLabel(a.auditDate);
      const sortKey = Math.floor(a.auditDate.getTime() / (7 * 864e5));
      const bucket = buckets.get(label) ?? { week: label, sortKey, total: 0, count: 0 };
      bucket.total += a.score;
      bucket.count += 1;
      buckets.set(label, bucket);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((b) => ({ week: b.week, audits: b.count, score: Math.round((b.total / b.count) * 10) / 10 }));
  }, [scored]);

  const errorTypes = React.useMemo(() => {
    const sums = { customer: 0, process: 0, business: 0, compliance: 0 };
    for (const a of scored) {
      sums.customer += a.errs.customer;
      sums.process += a.errs.process;
      sums.business += a.errs.business;
      sums.compliance += a.errs.compliance;
    }
    const rows = (Object.keys(sums) as (keyof typeof sums)[])
      .map((k) => ({ key: k, label: CAT_LABEL[k], count: sums[k], color: CAT_COLOR[k] }))
      .sort((a, b) => b.count - a.count);
    return rows;
  }, [scored]);

  const topReasons = React.useMemo(() => {
    const byReason = new Map<string, { total: number; failed: number }>();
    for (const a of scored) {
      const row = byReason.get(a.reason) ?? { total: 0, failed: 0 };
      row.total += 1;
      if (a.totalErrs > 0) row.failed += 1;
      byReason.set(a.reason, row);
    }
    return Array.from(byReason.entries())
      .filter(([, v]) => v.total >= 3)
      .map(([label, v]) => ({ label, pct: Math.round((v.failed / v.total) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
  }, [scored]);

  const rootCauseMix = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of scored) {
      for (const gap of a.gaps) {
        if (gap === 'No Gap found') continue;
        counts.set(gap, (counts.get(gap) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [scored]);

  function exportDataset() {
    downloadCsv(`awr-dataset-${new Date().toISOString().slice(0, 10)}.csv`, auditsToCsv(filteredAudits));
    toast.success(`Exported ${filteredAudits.length} audits`, { description: 'Downloaded as CSV, matching the current filters.' });
  }

  function setFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <PageActions>
        <Button size="sm" onClick={exportDataset}>Export dataset</Button>
        <Button size="sm" variant="primary" onClick={() => router.push('/coaching')}>New audit</Button>
      </PageActions>

      <Card>
        <CardHeader
          title="Filters"
          action={activeFilterCount > 0
            ? <Button size="sm" onClick={() => setFilters(defaultFilters)}>Reset ({activeFilterCount})</Button>
            : undefined}
        />
        <CardBody>
          <div className="flex flex-wrap gap-x-3 gap-y-4">
            <Field label="Audit date" className="shrink-0">
              <div className="flex items-end gap-1.5">
                <DatePicker className="w-[136px]" value={filters.auditFrom}
                  min={toInputDate(minAuditDate)} max={filters.auditTo}
                  onChange={(v) => setFilter('auditFrom', v)} />
                <span className="pb-[10px] text-muted-foreground">–</span>
                <DatePicker className="w-[136px]" align="right" value={filters.auditTo}
                  min={filters.auditFrom} max={toInputDate(maxAuditDate)}
                  onChange={(v) => setFilter('auditTo', v)} />
              </div>
            </Field>
            <Field label="Call date" className="shrink-0">
              <div className="flex items-end gap-1.5">
                <DatePicker className="w-[136px]" value={filters.callFrom}
                  min={toInputDate(minCallDate)} max={filters.callTo}
                  onChange={(v) => setFilter('callFrom', v)} />
                <span className="pb-[10px] text-muted-foreground">–</span>
                <DatePicker className="w-[136px]" align="right" value={filters.callTo}
                  min={filters.callFrom} max={toInputDate(maxCallDate)}
                  onChange={(v) => setFilter('callTo', v)} />
              </div>
            </Field>
            <DropdownSelect className="min-w-[168px] flex-1 basis-[168px]" triggerClassName="h-[38px] py-0" label="Wave" options={options.wave} value={filters.wave} onChange={(v) => setFilter('wave', v)} placeholder="All waves" />
            <DropdownSelect className="min-w-[200px] flex-1 basis-[200px]" triggerClassName="h-[38px] py-0" label="Team lead" options={options.supervisor} value={filters.supervisor} onChange={(v) => setFilter('supervisor', v)} placeholder="All team leads" />
            <DropdownSelect className="min-w-[190px] flex-1 basis-[190px]" triggerClassName="h-[38px] py-0" label="QA auditor" options={options.auditor} value={filters.auditor} onChange={(v) => setFilter('auditor', v)} placeholder="All QA auditors" />
            <DropdownSelect className="min-w-[190px] flex-1 basis-[190px]" triggerClassName="h-[38px] py-0" label="Line of business" options={options.lineOfBusiness} value={filters.lineOfBusiness} onChange={(v) => setFilter('lineOfBusiness', v)} placeholder="All lines of business" />
            <DropdownSelect className="min-w-[190px] flex-1 basis-[190px]" triggerClassName="h-[38px] py-0" label="Disposition" options={options.disposition} value={filters.disposition} onChange={(v) => setFilter('disposition', v)} placeholder="All dispositions" />
            <DropdownSelect className="min-w-[170px] flex-1 basis-[170px]" triggerClassName="h-[38px] py-0" label="Status" options={options.status} value={filters.status} onChange={(v) => setFilter('status', v)} placeholder="All statuses" />
          </div>
        </CardBody>
      </Card>

      {/* Role-based KPIs. The same record contributes to different tiles for
          different roles — an audit in QA review is the QA's workload and
          nobody else's. Each tile deep-links to the rows behind its number. */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <button key={k.label} onClick={() => k.stages && goToStages(k.stages)}
            disabled={!k.stages}
            className="text-left transition-transform enabled:hover:-translate-y-px enabled:cursor-pointer">
            <KpiTile label={k.label} value={k.value} unit={k.unit} stripe={k.stripe} meta={k.meta} />
          </button>
        ))}
      </div>

      {/* ── Workflow funnel + bottleneck ── */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Coaching workflow"
            action={<Badge variant="muted">{pendingCount} pending</Badge>} />
          <CardBody>
            {liveCount === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">No live coaching records in this range.</p>
            ) : (
              <>
                <WorkflowFunnel stages={funnel} total={liveCount} onSelect={goToStage} />
                {bottleneck && (
                  <p className="mt-3 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
                    Most records are accumulating at{' '}
                    <b className="font-semibold text-foreground">{bottleneck.label}</b>
                    {' '}({bottleneck.count} record{bottleneck.count === 1 ? '' : 's'},
                    {' '}avg {fmtHours(bottleneck.avgHours)} waiting
                    {bottleneck.overdue > 0 && <>, <span className="text-destructive">{bottleneck.overdue} past target</span></>})
                    {' — '}the current bottleneck.
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Stage completion rates" />
          <CardBody className="flex flex-col gap-4">
            {rates.qa && <RateBar label="QA → released to Ops TL" {...rates.qa} />}
            {rates.ops && <RateBar label="Ops TL → released to agent" {...rates.ops} />}
            {rates.agent && <RateBar label="Agent acknowledgement" {...rates.agent} />}
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
                Average time in stage
              </p>
              <div className="flex flex-col gap-1">
                {dwell.filter((d) => d.n > 0).map((d) => (
                  <div key={d.stage} className="flex items-baseline justify-between text-[12px]">
                    <span className="truncate text-muted-foreground">{d.label}</span>
                    <span className="font-mono tabular-nums">{fmtHours(d.hours)}</span>
                  </div>
                ))}
                {dwell.every((d) => d.n === 0) && (
                  <p className="text-[12px] text-muted-foreground">No completed transitions in this range yet.</p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── Longest-waiting records: the concrete "what is stuck" list ── */}
      {overdueRows.length > 0 && (
        <Card>
          <CardHeader title="Longest waiting"
            action={<Button size="sm" variant="ghost" onClick={() => router.push('/audits')}>Open audits</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Agent', 'Stage', 'Owner action', 'Waiting', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-border px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overdueRows.map((a) => {
                  const waited = hoursInStage(a, now);
                  const late = waited > STAGE_SLA_HOURS[a.status];
                  return (
                    <StripeRow key={a.id} tone={late ? 'critical' : 'warn'} className="hover:bg-muted">
                      <td className="border-b border-border px-3 py-2.5">
                        <b className="text-[13px]">{a.agent}</b>
                        <div className="font-mono text-[11.5px] text-muted-foreground">{a.eid}</div>
                      </td>
                      <td className="border-b border-border px-3 py-2.5 text-[13px]">{STATUS_LABEL[a.status]}</td>
                      <td className="border-b border-border px-3 py-2.5 text-[13px] text-muted-foreground">
                        {STAGE_OWNER[a.status] ? ROLE_LABELS[STAGE_OWNER[a.status]!] : '—'}
                      </td>
                      <td className="border-b border-border px-3 py-2.5 font-mono text-[13px] tabular-nums">
                        {fmtHours(waited)}
                      </td>
                      <td className="border-b border-border px-3 py-2.5">
                        {late ? <Badge variant="critical" dot>Past target</Badge> : <Badge variant="muted">On track</Badge>}
                      </td>
                    </StripeRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Management-only volume breakdowns ── */}
      {management && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {([
            ['Volume by wave', volumes.wave],
            ['Volume by supervisor', volumes.supervisor],
            ['Volume by QA auditor', volumes.auditor],
          ] as const).map(([title, rows]) => (
            <Card key={title}>
              <CardHeader title={title} />
              <CardBody>
                {rows.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-muted-foreground">Nothing in this range.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {rows.map((r) => (
                      <div key={r.label}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12.5px]">{r.label}</span>
                          <span className="flex-none font-mono text-[12px] tabular-nums text-muted-foreground">
                            {r.finalized}/{r.total}
                          </span>
                        </div>
                        <div className="mt-1 flex h-[5px] overflow-hidden rounded-full bg-muted">
                          <div className="bg-[var(--status-good)]" style={{ width: `${(r.finalized / r.total) * 100}%` }} />
                          <div className="bg-[var(--status-warn)]" style={{ width: `${(r.pending / r.total) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

    </div>
  );
}
