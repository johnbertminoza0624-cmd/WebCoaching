'use client';

export interface SavedSignature {
  src: string;
  source: 'draw' | 'upload' | 'default';
  at: string;
}

const STORAGE_PREFIX = 'awr:user-signature:';

/** Generates a stylish, natural-looking SVG signature data URL from a name. */
export function generateDefaultSignature(name: string): string {
  const parts = name.trim().split(/\s+/);
  const initials = parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
  const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const displayName = `${initials.slice(0, 1)}. ${lastName}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 130" width="420" height="130">
    <defs>
      <filter id="smooth" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="0.4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <style>
      .sig-text {
        font-family: 'Brush Script MT', 'Dancing Script', 'Caveat', 'Segoe Script', cursive, sans-serif;
        font-size: 54px;
        fill: #1e293b;
        font-style: italic;
      }
      .flourish {
        stroke: #1e293b;
        stroke-width: 2.2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    </style>
    <g transform="rotate(-3 210 65)">
      <text x="35" y="72" class="sig-text" filter="url(#smooth)">${displayName}</text>
      <path d="M 28 84 Q 130 96 240 86 T 380 88 Q 395 89 360 102 Q 260 114 140 106" class="flourish" />
      <path d="M 310 50 Q 345 35 370 65 Q 355 85 330 75" class="flourish" />
    </g>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getProfileSignature(userId: string, userName?: string): SavedSignature {
  if (typeof window === 'undefined') {
    return {
      src: generateDefaultSignature(userName ?? 'User Signature'),
      source: 'default',
      at: new Date().toISOString(),
    };
  }

  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedSignature;
      if (parsed?.src) return parsed;
    }
  } catch {
    // Ignore JSON errors and fallback
  }

  // Generate and persist a natural default signature for the user
  const generated: SavedSignature = {
    src: generateDefaultSignature(userName ?? 'User Signature'),
    source: 'default',
    at: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(generated));
  } catch {
    // Ignore storage write errors
  }

  return generated;
}

export function saveProfileSignature(
  userId: string,
  sig: { src: string; source: 'draw' | 'upload' | 'default'; at?: string },
): void {
  if (typeof window === 'undefined') return;
  const data: SavedSignature = {
    src: sig.src,
    source: sig.source,
    at: sig.at ?? new Date().toISOString(),
  };
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}
