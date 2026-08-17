'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';

/**
 * Themed date picker.
 *
 * Replaces `<input type="date">` because the native control's calendar is an
 * OS-drawn popup: it cannot be themed past `color-scheme`, cannot be animated,
 * and looks like a different application sitting on top of this one. This
 * renders the calendar itself, so it uses the app's own tokens and the same
 * motion language as `DropdownSelect` (y-offset entrance, staggered reveal,
 * spring on the selection) and therefore reads as one system with it.
 */

export interface DatePickerProps {
  /** `YYYY-MM-DD`. */
  value: string;
  onChange: (value: string) => void;
  /** `YYYY-MM-DD` bounds, both inclusive. */
  min?: string;
  max?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Right-aligns the popover — for the second field of a range, so it can't
   * overflow the card's edge. */
  align?: 'left' | 'right';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
/** Local-calendar `YYYY-MM-DD`. `toISOString()` would shift by the UTC offset
 * and silently land on the wrong day for anyone west of Greenwich. */
const toKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parseKey(s: string): { y: number; m: number; d: number } | null {
  const parts = s.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { y: parts[0]!, m: parts[1]! - 1, d: parts[2]! };
}
const displayDate = (s: string) => {
  const p = parseKey(s);
  return p ? `${pad(p.d)} ${MONTHS[p.m]!.slice(0, 3)} ${p.y}` : '';
};

export function DatePicker({
  value, onChange, min, max, label, id,
  disabled = false, className, triggerClassName, align = 'left',
}: DatePickerProps) {
  const reactId = React.useId();
  const baseId = id ?? reactId;

  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selected = parseKey(value);
  const toDate = (s?: string) => { const p = s ? parseKey(s) : null; return p ? new Date(p.y, p.m, p.d) : undefined; };
  const selectedDate = toDate(value);
  const minDate = toDate(min);
  const maxDate = toDate(max);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      {label && (
        <label
          htmlFor={baseId}
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground"
        >
          {label}
        </label>
      )}

      <motion.button
        ref={triggerRef}
        id={baseId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        whileTap={disabled ? undefined : { scale: 0.995 }}
        className={cn(
          'flex h-[38px] w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left',
          'text-[13px] transition-colors hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-55',
          triggerClassName,
        )}
      >
        <span className={cn('min-w-0 truncate font-medium tabular-nums', !selected && 'text-muted-foreground')}>
          {selected ? displayDate(value) : 'Pick a date'}
        </span>
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </motion.button>

      {/* Force chunk invalidation 2 */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={label ?? 'Choose a date'}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className={cn(
              'absolute z-50 mt-2 w-fit rounded-lg border border-border bg-popover shadow-lg',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <Calendar
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate}
              onSelect={(d) => {
                if (d) { onChange(toKey(d.getFullYear(), d.getMonth(), d.getDate())); setOpen(false); triggerRef.current?.focus(); }
              }}
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after: maxDate }] : []),
              ]}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default DatePicker;
