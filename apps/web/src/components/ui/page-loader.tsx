'use client';

import { LoaderGooeyBlobs } from './loaders-gooey-blobs';
import { cn } from '@/lib/utils';

/**
 * The full-screen wait state, used everywhere the app blocks on a load: the
 * shell's session bootstrap, the login route, and the audits Suspense
 * boundary.
 *
 * No reduced-motion fallback element is needed here any more — unlike the CSS
 * loader this replaced, `LoaderGooeyBlobs` degrades to a gentle opacity pulse
 * on its own rather than freezing on a keyframe.
 */
export function PageLoader({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('grid min-h-dvh place-items-center bg-background px-6', className)}>
      <div className="flex flex-col items-center gap-6">
        <LoaderGooeyBlobs />
        <span className="text-[12.5px] font-medium tracking-[0.04em] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

export default PageLoader;
