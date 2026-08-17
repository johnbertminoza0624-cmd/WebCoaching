import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button as UiButton } from './button';

/** Small composable primitives shared by every screen — the shadcn idiom
 * (bordered card, shadow-sm, token-driven) without pulling in the full
 * shadcn CLI scaffold, since these are the only handful of pieces this app
 * actually needs repeated.
 *
 * Everything here is written against the design tokens only. There is not a
 * single `dark:` variant in this file by design: each token is already
 * re-toned per mode in theme.css, so one class string is correct in both. */

export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Adds a hover lift. Only for cards that are themselves a link or button. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card shadow-sm overflow-hidden',
        interactive &&
          'transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-border px-4 py-3.5', className)}>
      <h3 className="min-w-0 text-[13.5px] font-semibold">{title}</h3>
      <div className="flex-1" />
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/**
 * The row of page-level actions ("Export CSV", "New audit") that sits above a
 * page's content.
 *
 * This was `PageHeader`, and it also rendered an `<h1>` and a description
 * paragraph. Both are gone: the app shell's top bar already prints the page
 * title from `PAGE_TITLES`, so the h1 restated it one line lower, and the
 * description restated what the screen itself was showing. What is left is
 * only the actions, so the component is named for that — a `PageHeader` that
 * renders no heading would be a trap for the next person.
 *
 * Pages with no actions render nothing here at all.
 */
export function PageActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-2', className)}>{children}</div>
  );
}

const badgeVariants = {
  good: 'bg-[var(--status-good-surface)] text-[var(--status-good)]',
  warn: 'bg-[var(--status-warn-surface)] text-[var(--status-warn)]',
  critical: 'bg-[var(--status-critical-surface)] text-[var(--status-critical)]',
  muted: 'bg-muted text-muted-foreground',
  outline: 'border border-border text-muted-foreground',
  accent: 'bg-accent text-accent-foreground',
  // Mid-workflow stages: in motion, but neither a warning nor a success.
  info: 'bg-primary/12 text-primary',
} as const;

export function Badge({
  variant = 'muted',
  size = 'default',
  dot = false,
  className,
  children,
}: {
  variant?: keyof typeof badgeVariants;
  /** `sm` is the in-table size — it replaces the `text-[10.5px] px-1.5 py-0.5`
   * override that was pasted onto roughly forty individual badges. */
  size?: 'sm' | 'default';
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'h-[19px] gap-1 px-1.5 text-[10.5px]' : 'h-[21px] gap-1.5 px-2 text-[11.5px]',
        badgeVariants[variant],
        className,
      )}
    >
      {dot && <span className={cn('rounded-full bg-current', size === 'sm' ? 'h-1 w-1' : 'h-1.5 w-1.5')} />}
      {children}
    </span>
  );
}

// Every variant carries a 1px border so all four line up on the same baseline
// and share identical box metrics. `ghost` has no surface, so it also drops the
// shadow — a shadow under a transparent background renders as a stray smudge
// floating beneath bare text.
const buttonVariants = {
  default: 'border border-input bg-card shadow-xs hover:bg-muted hover:border-input/80',
  primary:
    'border border-primary bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 hover:border-primary/90',
  ghost: 'border border-transparent shadow-none text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'border border-input text-destructive shadow-xs hover:bg-destructive/10 hover:border-destructive',
} as const;

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof buttonVariants;
    size?: 'sm' | 'default' | 'icon';
  }
>(({ className, variant = 'default', size = 'default', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium',
      // Colour and elevation animate; layout never does, so a hover can't
      // nudge a toolbar's metrics.
      'transition-[background-color,border-color,color,box-shadow] duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'active:translate-y-px disabled:pointer-events-none disabled:opacity-55',
      size === 'sm'
        ? 'h-[29px] px-2.5 text-[12.5px]'
        : size === 'icon'
          ? 'h-[34px] w-[34px] px-0'
          : 'h-[34px] px-3.5',
      buttonVariants[variant],
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';

const toneColor = {
  good: 'var(--status-good)',
  warn: 'var(--status-warn)',
  critical: 'var(--status-critical)',
  info: 'var(--chart-1)',
  accent: 'var(--chart-5)',
} as const;

export type KpiTone = keyof typeof toneColor;

export function KpiTile({
  label,
  value,
  unit,
  meta,
  stripe,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  meta?: React.ReactNode;
  stripe?: KpiTone;
}) {
  // Every tile carries an accent, not just the ones with a semantic status.
  // good/warn/critical carry real meaning (target met, needs attention,
  // failing) and must stay reserved for that. info/accent are plain counts
  // with no status to report — they borrow two --chart-* hues (decorative,
  // not the reserved --cat-* critical-error or --status-* semantic tokens)
  // just so a row of tiles doesn't read as half-finished when only some of
  // them have something to warn about.
  //
  // The accent used to be a 3px left border on a 16px-radius card, which meant
  // the bar bent around the corner and tapered to nothing at both ends. It is
  // now a dot on the label plus a very low-alpha wash bleeding in from the top
  // -left — the same hue, but placed where a rounded box can actually hold it.
  const color = stripe ? toneColor[stripe] : 'var(--muted-foreground)';
  return (
    <Card className="relative p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 100% at 0% 0%, color-mix(in oklch, ${color} 12%, transparent) 0%, transparent 62%)`,
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-2 font-mono text-[29px] font-semibold leading-none tracking-tight tabular-nums">
          {value}
          {unit && <span className="text-[17px] text-muted-foreground">{unit}</span>}
        </div>
        {meta && <div className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{meta}</div>}
      </div>
    </Card>
  );
}

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.055em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The canonical text control. Focus styling comes from the base layer in
 * theme.css, so this is only about metrics — the four different heights the
 * inline inputs had drifted into collapse to two named sizes. */
const inputBase =
  'w-full rounded-md border border-input bg-card text-foreground disabled:cursor-not-allowed disabled:opacity-55 read-only:opacity-70';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { inputSize?: 'sm' | 'default' }
>(({ className, inputSize = 'default', ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      inputBase,
      inputSize === 'sm' ? 'h-[29px] px-2 text-[12.5px]' : 'h-[34px] px-2.5 text-[13px]',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputBase, 'resize-y p-2 text-[13px] leading-relaxed', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export function ReadonlyValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[34px] items-center rounded-md bg-muted px-2.5 font-mono text-[12.5px] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The "nothing here" state. Every screen had its own: a bare centred
 * paragraph on one, a 220px dashed box on another, a `py-9` table row on a
 * third. Same idea, same weight, one component — and each one can offer the
 * action that would fix it (clear the filters, create the first record).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Inline variant for use inside an already-small panel. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'px-4 py-8' : 'px-4 py-14',
        className,
      )}
    >
      {Icon && (
        <span className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      )}
      <b className="text-[13.5px] font-semibold">{title}</b>
      {description && (
        <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Loading placeholder. `animate-pulse` alone reads as a dead grey block on
 * the dark theme, so this is a travelling sheen over a token-coloured base —
 * visible on both surfaces. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite]',
        'after:bg-gradient-to-r after:from-transparent after:via-[color-mix(in_oklch,var(--foreground)_7%,transparent)] after:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

/** Yes / No / N/A segmented control, used throughout section A/B/hold rows. */
export function SegmentedAnswer({
  value,
  onChange,
  options = ['Yes', 'No', 'N/A'],
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: string[];
  disabled?: boolean;
}) {
  // Joined "segmented" button group (the shadcn -space-x-px pattern): each cell
  // is a Button; the selected one is filled with its semantic color and lifted
  // above its neighbours' overlapping borders.
  const activeClass = (opt: string) =>
    opt === 'Yes'
      ? 'z-10 border-[var(--status-good)] bg-[var(--status-good-surface)] text-[var(--status-good)] hover:bg-[var(--status-good-surface)] hover:text-[var(--status-good)]'
      : opt === 'No'
        ? 'z-10 border-destructive bg-[var(--status-critical-surface)] text-destructive hover:bg-[var(--status-critical-surface)] hover:text-destructive'
        : 'z-10 border-primary bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground';
  return (
    <div className="isolate inline-flex flex-none -space-x-px">
      {options.map((opt, i) => {
        const active = opt === value;
        return (
          <UiButton
            key={opt}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={cn(
              'h-8 min-w-[42px] px-3 text-xs font-semibold focus-visible:z-10',
              i === 0 ? 'rounded-r-none' : i === options.length - 1 ? 'rounded-l-none' : 'rounded-none',
              active && activeClass(opt),
            )}
          >
            {opt}
          </UiButton>
        );
      })}
    </div>
  );
}

/* ── Table ──────────────────────────────────────────────────────────────────
   The two data screens between them repeated the same 90-character header-cell
   class string forty times, and the same `border-b border-border px-2.5 py-2.5`
   on every body cell. Any change to table density meant a find-and-replace, and
   the two screens had already drifted apart. These four components are that
   markup, once.

   `Table` also owns horizontal overflow: the audits table is twelve columns
   wide and simply ran off the edge of the viewport below about 1200px. */

export function Table({
  className,
  containerClassName,
  minWidth,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  containerClassName?: string;
  /** Width below which the table scrolls instead of compressing. A twelve-column
   * table given only `w-full` does not overflow — it crushes every column until
   * the headers ellipsize, which is what "DISPOSIT…" was. */
  minWidth?: number;
}) {
  return (
    <div className={cn('w-full overflow-x-auto', containerClassName)}>
      <table
        className={cn(
          'w-full border-collapse text-[12px]',
          // The last row's border doubles up with the card edge otherwise.
          '[&_tbody_tr:last-child_td]:border-b-0',
          className,
        )}
        style={minWidth ? { minWidth } : undefined}
        {...props}
      />
    </div>
  );
}

type Align = 'left' | 'right' | 'center';
const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function Th({
  align = 'left',
  sortable = false,
  sorted = false,
  nowrap = false,
  className,
  children,
  onSort,
  ...props
}: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> & {
  align?: Align;
  sortable?: boolean;
  /** `false` when this column is not the active sort. */
  sorted?: 'asc' | 'desc' | false;
  nowrap?: boolean;
  onSort?: () => void;
}) {
  // The sort state used to be a literal ' ↑' appended to the label text, which
  // screen readers read out as part of the column name and which shifted the
  // header's width every time the direction changed. It's an icon in a fixed
  // slot now, and the state is announced through aria-sort instead.
  const content = (
    <>
      <span>{children}</span>
      {sortable &&
        (sorted === 'asc' ? (
          <ChevronUp className="h-3 w-3 flex-none" aria-hidden="true" />
        ) : sorted === 'desc' ? (
          <ChevronDown className="h-3 w-3 flex-none" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 flex-none opacity-0 transition-opacity group-hover/th:opacity-40" aria-hidden="true" />
        ))}
    </>
  );

  return (
    <th
      scope="col"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : sortable ? 'none' : undefined}
      className={cn(
        'border-b border-border bg-card px-2.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]',
        alignClass[align],
        nowrap && 'whitespace-nowrap',
        sorted ? 'text-primary' : 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'group/th -mx-1 inline-flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 uppercase',
            'transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

export function Td({
  align = 'left',
  nowrap = false,
  mono = false,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  nowrap?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        'border-b border-border px-2.5 py-2.5 align-top',
        alignClass[align],
        nowrap && 'whitespace-nowrap',
        mono && 'font-mono tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function StripeRow({
  tone,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { tone?: 'good' | 'warn' | 'critical' }) {
  // Was referencing --good/--warn/--critical, which don't exist in the theme
  // (the real tokens are --status-good etc) — every row stripe silently
  // rendered transparent since the day this shipped.
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warn'
        ? 'var(--status-warn)'
        : tone === 'critical'
          ? 'var(--status-critical)'
          : 'transparent';
  return (
    <tr
      className={cn('transition-colors hover:bg-muted', className)}
      style={{ borderLeft: `3px solid ${color}` }}
      {...props}
    />
  );
}

/**
 * Minimal modal shell shared by every dialog that isn't the coaching
 * page's bespoke confirmations — invite user, activity log, name-a-new-form.
 * Closes on Escape and on backdrop click; focuses nothing automatically
 * (callers put autoFocus on their first field).
 */
export function Modal({
  title, subtitle, onClose, children, footer, width = 430,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // A dialog that leaves the page scrollable behind it lets a trackpad
    // gesture drift the content out from under the modal.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[color-mix(in_oklch,var(--background)_55%,#000)]/70 p-5 backdrop-blur-[3px] animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(var(--w),100%)] rounded-lg border border-border bg-card shadow-xl animate-in fade-in zoom-in-95 duration-150"
        style={{ ['--w' as string]: `${width}px` }}
      >
        <div className="border-b border-border px-4 py-3.5">
          <h3 className="text-[13.5px] font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <CardBody>{children}</CardBody>
        {footer && <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>}
      </div>
    </div>
  );
}
