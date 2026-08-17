'use client';

import * as React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Three blobs that merge and separate through an SVG gooey filter.
 *
 * Adapted from the supplied `loaders-gooey-blobs`, with four changes:
 *
 *   1. Imports from `framer-motion`, not `motion/react`. They are the same
 *      library under its old and new names; `framer-motion@11` is already a
 *      dependency and already drives the dropdown and date-picker, so pulling
 *      in `motion` as well would ship a second copy of it for no gain.
 *   2. The filter id was the literal string "gooey". Two of these on one page
 *      would emit duplicate ids and the second would resolve `url(#gooey)` to
 *      the first instance's filter — which breaks once the loader appears
 *      anywhere alongside itself. It is `useId`-scoped now.
 *   3. `color` defaults to the brand `--primary` rather than `currentColor`,
 *      so it is on-brand wherever it is dropped and re-tones per theme.
 *   4. It honours `prefers-reduced-motion`. The app's global CSS collapses
 *      animation durations, but these are JS-driven transforms that rule
 *      cannot reach — without this the blobs would keep moving for a reader
 *      who asked them not to.
 */
export interface LoaderGooeyBlobsProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  size?: number;
  color?: string;
  duration?: number;
}

export function LoaderGooeyBlobs({
  className,
  size = 20,
  color = 'var(--primary)',
  duration = 1.5,
  ...props
}: LoaderGooeyBlobsProps) {
  const filterId = `gooey-${React.useId().replace(/:/g, '')}`;
  const reduced = useReducedMotion();

  return (
    // A `motion.div`, not a plain one: the exported props extend
    // `HTMLMotionProps<'div'>`, and the source destructured `...props` without
    // ever spreading them — so every prop that type advertised was silently
    // dropped. Either the type or the element had to change; the element is
    // the cheaper fix and keeps the documented surface working.
    <motion.div className={cn('flex items-center gap-2', className)} role="status" aria-label="Loading" {...props}>
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="gooey"
            />
            <feBlend in="SourceGraphic" in2="gooey" />
          </filter>
        </defs>
      </svg>

      <div style={{ filter: `url(#${filterId})` }} className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <motion.div
            key={index}
            className="rounded-full"
            style={{ width: size, height: size, backgroundColor: color }}
            animate={
              reduced
                ? { opacity: [0.45, 1, 0.45] }
                : { x: [0, 15, 0, -15, 0], scale: [1, 1.2, 1, 1.2, 1] }
            }
            transition={{
              duration: reduced ? 1.8 : duration,
              ease: 'easeInOut',
              repeat: Infinity,
              delay: index * 0.2,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export default LoaderGooeyBlobs;
