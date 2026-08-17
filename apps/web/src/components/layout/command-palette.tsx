'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, Command as CommandIcon, X } from 'lucide-react';
import { WORKSPACE_NAV, ADMIN_NAV } from './nav-items';
import { NAV_ICONS } from './icons';

const ALL_PAGES = [...WORKSPACE_NAV, ...ADMIN_NAV];

/**
 * ⌘K quick switcher. The source component's search box opened a static "Type
 * a command..." placeholder that did nothing — here it actually jumps to a
 * page, since that's the only thing worth searching in a six-page app with no
 * command registry yet.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (open) { setQuery(''); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  const results = ALL_PAGES.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()));

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-background/50 px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Search className="h-[15px] w-[15px] flex-none" strokeWidth={1.5} aria-hidden="true" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="hidden items-center justify-center rounded border border-border bg-card px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[15vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Quick navigation"
            className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="h-[17px] w-[17px] flex-none text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
              <input
                ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a page…"
                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0].href); }}
                className="flex-1 bg-transparent py-3.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-[15px] w-[15px]" strokeWidth={1.5} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                  <CommandIcon className="h-5 w-5 text-muted-foreground/40" strokeWidth={1.5} />
                  <p className="text-[12.5px] text-muted-foreground">No page matches "{query}"</p>
                </div>
              ) : results.map((p) => {
                const Icon = NAV_ICONS[p.icon];
                return (
                  <button key={p.href} type="button" onClick={() => go(p.href)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-muted">
                    <Icon className="h-4 w-4 flex-none" style={{ color: p.color }} aria-hidden="true" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
