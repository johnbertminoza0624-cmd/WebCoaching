'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Animated select.
 *
 * Adapted from the supplied `dropdown-01`. That file was a full-page demo, not
 * a component — it owned `min-h-screen`, a grid background, a page title, a
 * hardcoded "Premium Plan" list, and its own `isDark` state. Dropped into
 * /components/ui unchanged it could only ever render as an entire page, and its
 * private theme toggle would fight the app's next-themes provider (two sources
 * of truth for one setting, neither aware of the other).
 *
 * What was kept: the visual language and the motion — chevron rotation, the
 * menu's y-offset entrance, staggered option reveal, spring on the check.
 *
 * What was added, because a custom listbox without them is unusable:
 *   - full keyboard support (Up/Down/Home/End/Enter/Space/Escape, type-ahead)
 *   - roving focus and `aria-activedescendant`
 *   - `role="listbox"` / `role="option"` / `aria-selected`
 *   - closes on outside click and on Escape, and restores focus to the trigger
 *   - design tokens instead of hardcoded black/white, so it themes with the app
 *   - portal rendering so the list escapes overflow:hidden parent containers
 */

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface DropdownSelectProps {
  options: DropdownOption[];
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Extra classes for the trigger button itself — e.g. to match its height
   * to a neighboring input when the two sit side by side in a filter bar. */
  triggerClassName?: string;
  /** Renders the invalid state — pair with a message next to the field. */
  invalid?: boolean;
}

export function DropdownSelect({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  label,
  id,
  disabled = false,
  className,
  triggerClassName,
  invalid = false,
}: DropdownSelectProps) {
  const reactId = React.useId();
  const baseId = id ?? reactId;
  const listId = `${baseId}-listbox`;

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [listStyle, setListStyle] = React.useState<React.CSSProperties>({});
  const [mounted, setMounted] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const typeAhead = React.useRef({ query: '', timer: 0 });

  React.useEffect(() => { setMounted(true); }, []);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const enabledIndexes = React.useMemo(
    () => options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0),
    [options],
  );

  // Measure trigger position and update portal list coordinates.
  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setListStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Reposition on scroll / resize while open.
  React.useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  // Close on outside pointer-down (checks both the trigger root and the portal list).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the active option in view — scroll only within the list container,
  // never the page (scrollIntoView on a portal element would jump the page).
  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const item = list?.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | null;
    if (!list || !item) return;
    const listTop = list.scrollTop;
    const listBottom = listTop + list.clientHeight;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < listTop) {
      list.scrollTop = itemTop;
    } else if (itemBottom > listBottom) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
  }, [open, activeIndex]);

  const openMenu = (startAt?: number) => {
    if (disabled) return;
    setActiveIndex(startAt ?? (selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? -1)));
    setOpen(true);
  };

  const closeMenu = (refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu();
  };

  const step = (delta: number) => {
    if (enabledIndexes.length === 0) return;
    const pos = enabledIndexes.indexOf(activeIndex);
    const next =
      pos === -1
        ? enabledIndexes[0]!
        : enabledIndexes[(pos + delta + enabledIndexes.length) % enabledIndexes.length]!;
    setActiveIndex(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        open ? step(1) : openMenu();
        break;
      case 'ArrowUp':
        e.preventDefault();
        open ? step(-1) : openMenu(enabledIndexes.at(-1));
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActiveIndex(enabledIndexes[0] ?? -1); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActiveIndex(enabledIndexes.at(-1) ?? -1); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        open ? commit(activeIndex) : openMenu();
        break;
      case 'Escape':
        if (open) { e.preventDefault(); closeMenu(); }
        break;
      case 'Tab':
        if (open) closeMenu(false);
        break;
      default: {
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
        if (!open) openMenu();
        window.clearTimeout(typeAhead.current.timer);
        typeAhead.current.query += e.key.toLowerCase();
        typeAhead.current.timer = window.setTimeout(() => {
          typeAhead.current.query = '';
        }, 600);
        const q = typeAhead.current.query;
        const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(q));
        if (hit >= 0) setActiveIndex(hit);
      }
    }
  };

  const list = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label ?? placeholder}
          tabIndex={-1}
          initial={{ opacity: 0, scaleY: 0.92 }}
          animate={{ opacity: 1, scaleY: 1 }}
          exit={{ opacity: 0, scaleY: 0.92 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...listStyle, transformOrigin: 'top' }}
          className="max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        >
          {options.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No options available.</p>
          )}

          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <motion.div
                key={option.value}
                id={`${baseId}-opt-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.16, delay: Math.min(index, 6) * 0.03 }}
                onPointerEnter={() => !option.disabled && setActiveIndex(index)}
                onClick={() => commit(index)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 px-3 py-2',
                  'border-b border-border last:border-b-0',
                  isActive && 'bg-accent text-accent-foreground',
                  option.disabled && 'pointer-events-none opacity-50',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{option.label}</div>
                  {option.description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="shrink-0 text-primary"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </motion.span>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );

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
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onKeyDown}
        whileTap={disabled ? undefined : { scale: 0.995 }}
        className={cn(
          'flex h-[38px] w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 text-left',
          'text-[13px] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-55',
          invalid ? 'border-destructive' : 'border-input hover:bg-muted',
          triggerClassName,
        )}
      >
        <span className={cn('min-w-0 truncate font-medium', !selected && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </motion.span>
      </motion.button>

      {mounted ? createPortal(list, document.body) : list}
    </div>
  );
}

export default DropdownSelect;
