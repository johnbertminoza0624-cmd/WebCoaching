'use client';

/**
 * The animated backdrop behind the sign-in card.
 *
 * It traces the coaching workflow itself — a pulse travelling the stages from
 * QA review to finalized — rather than generic decoration, so the page says
 * something about the tool before you are inside it.
 *
 * Strictly one hue: every colour here is `--primary` at varying strength.
 * A second brand hue in the atmosphere reads as a different product.
 *
 * All motion is disabled under `prefers-reduced-motion` — ambient movement
 * behind a login form is exactly the case that setting exists for.
 */

const STAGES = ['QA review', 'Ops TL', 'Coaching', 'Agent', 'Finalized'];

export function CoachingArt() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Two slow blue fields for depth. Same hue, different position. */}
      <div className="art-glow art-glow-a" />
      <div className="art-glow art-glow-b" />

      {/* Blueprint grid — reads as measurement, and stops the page being a
          bare gradient. Masked so it fades out well before the card. */}
      <div className="art-grid" />

      {/* The workflow, drifting across the upper area. */}
      <div className="art-rail-wrap">
        <div className="art-rail"><span className="art-pulse" /></div>
        <ol className="relative flex justify-between">
          {STAGES.map((label, i) => (
            <li key={label} className="flex flex-col items-center gap-2">
              <span className="art-node" style={{ animationDelay: `${i * 0.9}s` }} />
              <span className="text-[10px] font-medium tracking-[0.02em] text-[color-mix(in_oklch,var(--foreground)_55%,transparent)]">
                {label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <style>{`
        .art-glow {
          position: absolute; border-radius: 9999px;
          filter: blur(110px); opacity: 0.45; will-change: transform;
          background: color-mix(in oklch, var(--primary) 60%, transparent);
        }
        .art-glow-a {
          width: 620px; height: 620px; top: -220px; right: -160px;
          animation: art-drift-a 24s ease-in-out infinite;
        }
        .art-glow-b {
          width: 520px; height: 520px; bottom: -200px; left: -140px;
          opacity: 0.32;
          animation: art-drift-b 28s ease-in-out infinite;
        }
        @keyframes art-drift-a {
          0%, 100% { transform: translate3d(0,0,0) scale(1); }
          50%      { transform: translate3d(-60px, 60px, 0) scale(1.12); }
        }
        @keyframes art-drift-b {
          0%, 100% { transform: translate3d(0,0,0) scale(1); }
          50%      { transform: translate3d(70px, -50px, 0) scale(1.1); }
        }

        .art-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(to right, color-mix(in oklch, var(--primary) 14%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in oklch, var(--primary) 14%, transparent) 1px, transparent 1px);
          background-size: 54px 54px;
          mask-image: radial-gradient(ellipse 90% 80% at 50% 50%, #000 25%, transparent 92%);
        }

        /* Sits above the centred card. The card is ~430px tall, so the rail
           needs real clearance or its labels peek out from behind the card's
           top edge — which is what happened at 16%. */
        .art-rail-wrap {
          position: absolute; top: 8vh; left: 50%;
          width: min(460px, 40vw); transform: translateX(-50%);
        }
        .art-rail {
          position: absolute; left: 6px; right: 6px; top: 5px; height: 2px;
          background: color-mix(in oklch, var(--primary) 22%, transparent);
          border-radius: 2px; overflow: hidden;
        }
        .art-pulse {
          position: absolute; inset-block: 0; width: 90px;
          background: linear-gradient(90deg, transparent, var(--primary), transparent);
          animation: art-travel 4.5s linear infinite;
        }
        @keyframes art-travel {
          from { transform: translateX(-90px); }
          to   { transform: translateX(460px); }
        }

        .art-node {
          width: 12px; height: 12px; border-radius: 9999px;
          background: var(--background);
          border: 2px solid color-mix(in oklch, var(--primary) 70%, transparent);
          animation: art-ping 4.5s ease-out infinite;
        }
        @keyframes art-ping {
          0%, 70%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 55%, transparent); }
          12%           { box-shadow: 0 0 0 7px transparent; background: var(--primary); }
        }

        /* No room beside or above the card — drop the rail rather than let it
           collide with it. */
        @media (max-width: 1100px), (max-height: 760px) {
          .art-rail-wrap { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .art-glow-a, .art-glow-b, .art-pulse, .art-node { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
