'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FacetOption { value: string; label: string; count: number }

/**
 * Multi-select facet control for the Audits filter bar.
 *
 * The counts passed in must already be computed against every OTHER active
 * filter (see `passesExcept` in the audits page) — that's what makes a
 * facet's numbers tell you what selecting it WOULD add, rather than what
 * already matches itself, which is what makes combinations never dead-end.
 */
export function MultiSelectFacet({
  label, options, selected, onChange,
}: {
  label: string;
  options: FacetOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const visible = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  function toggle(value: string) {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next);
  }

  const valueLabel =
    selected.size === 0 ? 'All'
      : selected.size === 1 ? (options.find((o) => o.value === [...selected][0])?.label ?? [...selected][0])
      : `${selected.size} selected`;

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border px-2.5 text-[12.5px] transition-colors',
          selected.size > 0
            ? 'border-primary bg-accent font-medium text-primary'
            : 'border-input bg-card hover:bg-muted',
        )}
      >
        <span className="min-w-0 truncate">{valueLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 flex-none text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[220] mt-1.5 flex max-h-[340px] w-[230px] flex-col rounded-lg border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${label.toLowerCase()}…`}
              className="h-[29px] w-full rounded-md border border-input bg-card px-2 text-[12.5px]" />
          </div>
          <div className="overflow-y-auto p-1">
            {visible.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[12.5px] hover:bg-muted">
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)}
                  className="h-3.5 w-3.5 flex-none accent-primary" />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className="flex-none font-mono text-[11.5px] text-muted-foreground">{o.count}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1.5 border-t border-border p-1.5">
            <button type="button" className="rounded px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-muted"
              onClick={() => onChange(new Set(options.map((o) => o.value)))}>Select all</button>
            <div className="flex-1" />
            <button type="button" className="rounded px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-muted"
              onClick={() => onChange(new Set())}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
