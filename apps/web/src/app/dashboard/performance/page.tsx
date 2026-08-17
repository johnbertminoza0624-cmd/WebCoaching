'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AreaChart, Area, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { SearchX } from 'lucide-react';
import {
  Card, CardHeader, CardBody, KpiTile, Badge, Button, Field, StripeRow,
  PageActions, EmptyState, Table, Th, Td,
} from '@/components/ui/primitives';
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
  const funnel = React.useMemo(() => buildFunnel(filteredAudits, now), [filteredAudits, now]);
  const rates = React.useMemo(() => stageRates(filteredAudits), [filteredAudits]);
  const dwell = React.useMemo(() => avgTimeInStage(filteredAudits), [filteredAudits]);
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

      {/* Quality analytics sit below the workload tiles — relevant to everyone
          who scores or oversees, but they are not "what needs my attention". */}
      {user.role !== 'AGENT' && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <KpiTile label="Average QA score" value={avgScore.toFixed(1)} unit="%" stripe="good"
            meta={scoreTrendDelta === null ? 'Not enough data in range' : (
              <><span className={`font-semibold ${scoreTrendDelta >= 0 ? 'text-[var(--status-good)]' : 'text-destructive'}`}>
                {scoreTrendDelta >= 0 ? '▲' : '▼'} {Math.abs(scoreTrendDelta).toFixed(1)} pts
              </span> vs. earlier in range</>
            )} />
          <KpiTile label="Total coaching created" value={String(filteredAudits.length)} stripe="info"
            meta={`${liveCount} live · ${filteredAudits.length - liveCount} voided · not a completion count`} />
          <KpiTile label="Critical errors" value={String(criticalErrors)} stripe="critical"
            meta={`across ${scored.length} scored audits`} />
          <KpiTile label="DSAT rate" value={dsatRate.toFixed(1)} unit="%" stripe="warn"
            meta={`${dsat.length} of ${surveyed.length} surveyed · ${dsatControllable.length} agent-controllable`} />
        </div>
      )}

      {/* Quality analytics — an agent's dashboard stays deliberately simple:
          what needs signing, what is done. Programme-level trend analysis is
          not their view. */}
      {user.role !== 'AGENT' && (
      <>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader title="QA score trend"
            action={<Badge variant="muted">{trend.length} week{trend.length === 1 ? '' : 's'} in range</Badge>} />
          <CardBody>
            {trend.length === 0 ? (
              <div className="grid h-[220px] place-items-center"><EmptyState compact title="No scored audits in range" description="Nothing to plot with the current filters." /></div>
            ) : (
              <ChartContainer config={trendConfig} className="aspect-auto h-[220px] w-full">
                <AreaChart accessibilityLayer data={trend} margin={{ left: -10, right: 8, top: 12, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    yAxisId="audits"
                    domain={[0, 'dataMax + 4']}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    allowDecimals={false}
                    tickFormatter={(value) => String(value)}
                  />
                  <YAxis
                    yAxisId="score"
                    orientation="right"
                    domain={[60, 100]}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <ReferenceLine yAxisId="score" y={90} stroke="var(--muted-foreground)" strokeDasharray="3 4" strokeOpacity={0.6}
                    label={{ value: 'Target 90', position: 'insideTopLeft', fill: 'var(--muted-foreground)', fontSize: 10 }} />
                  <ChartTooltip cursor={false} content={
                    <ChartTooltipContent
                      indicator="line"
                      className="min-w-[11rem] px-4 py-3 gap-3 [&>div]:gap-2.5"
                    />
                  } />
                  <defs>
                    <linearGradient id="fillAudits" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-audits)" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="var(--color-audits)" stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="fillScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-score)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-score)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <Area yAxisId="audits" dataKey="audits" name="Audits" type="natural" isAnimationActive={false}
                    fill="url(#fillAudits)" fillOpacity={0.4} stroke="var(--color-audits)" strokeWidth={1.5} />
                  <Area yAxisId="score" dataKey="score" name="Avg. score" unit="%" type="natural" isAnimationActive={false}
                    fill="url(#fillScore)" fillOpacity={0.4} stroke="var(--color-score)" strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--color-score)', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ChartContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Critical errors by type" />
          <CardBody>
            {errorTypes.every((e) => e.count === 0) ? (
              <EmptyState compact title="No critical errors" description="Not a single failed parameter across the filtered audits." />
            ) : (
              <HBar data={errorTypes.map((e) => ({ key: e.key, label: e.label, value: e.count, display: String(e.count), color: e.color }))} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Highest-risk call reasons" />
          <CardBody>
            {topReasons.length === 0 ? (
              <EmptyState compact title="Not enough data" description="A call reason needs at least three audits in range before it is ranked." />
            ) : (
              <HBar data={topReasons.map((m) => ({ key: m.label, label: m.label, value: m.pct, display: `${m.pct}%`, color: 'var(--cat-process)' }))} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Root cause mix" />
          <CardBody>
            {rootCauseMix.length === 0 ? (
              <EmptyState compact title="No root causes logged" description="Coaching gaps appear here once they are recorded on failed audits." />
            ) : (
              <HBar data={rootCauseMix.map((r) => ({ key: r.label, label: r.label, value: r.count, display: String(r.count), color: 'var(--primary)' }))} />
            )}
          </CardBody>
        </Card>
      </div>
      </>
      )}

      <Card>
        <CardHeader title="Recent audits"
          action={<Button size="sm" variant="ghost" onClick={() => router.push('/audits')}>View all {filteredAudits.length}</Button>} />
        {recent.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No audits match these filters"
            description="Widen the date range or clear a filter above to bring records back into view."
            compact
          />
        ) : (
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Supervisor</Th>
                <Th>Disposition</Th>
                <Th>Call reason</Th>
                <Th align="right" nowrap>AHT</Th>
                <Th align="right" nowrap>Score</Th>
                <Th nowrap>Errors</Th>
                <Th nowrap>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => (
                <StripeRow
                  key={a.id}
                  tone={a.totalErrs >= 2 ? 'critical' : a.status === 'FINALIZED' ? 'good' : 'warn'}
                >
                  <Td>
                    <b className="block text-[12.5px] leading-snug text-foreground">{a.agent}</b>
                    <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{a.eid}</div>
                  </Td>
                  <Td className="text-[11.5px] leading-snug text-foreground">{a.supervisor}</Td>
                  <Td className="text-[11.5px] leading-snug text-foreground">{a.disposition}</Td>
                  <Td className="text-[11.5px] leading-snug text-foreground">{a.reason}</Td>
                  <Td align="right" mono nowrap className="text-[12px]">{formatSecs(a.aht)}</Td>
                  <Td align="right" mono nowrap className="text-[12px] font-semibold">{a.score}%</Td>
                  <Td nowrap>
                    {a.totalErrs
                      ? <Badge variant="critical" size="sm" dot>{a.totalErrs} err{a.totalErrs > 1 ? 's' : ''}</Badge>
                      : <Badge variant="muted" size="sm">None</Badge>}
                  </Td>
                  <Td nowrap>
                    <Badge variant={STATUS_VARIANT[a.status]} size="sm">{STATUS_LABEL[a.status]}</Badge>
                  </Td>
                </StripeRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
