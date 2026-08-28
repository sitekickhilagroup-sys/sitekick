import { resolvePresetKey } from '@/lib/avatar-presets';

/**
 * Designed avatar set — small self-contained SVGs (gradient + site/graphic
 * motif), stored as `preset:<key>` in profiles.avatar. Shared by the server
 * header and the client picker; no hooks, no directives. The key registry
 * (incl. legacy color-key mapping) lives in lib/avatar-presets.ts.
 */
export function PresetAvatar({ preset, size }: { preset: string; size: number }) {
  const key = resolvePresetKey(preset) ?? 'stone';
  const id = `av-${key}-${size}`;
  const common = { width: size, height: size, viewBox: '0 0 64 64', 'aria-hidden': true as const };
  const round = { clipPath: `url(#${id}-clip)` };

  const clip = (
    <clipPath id={`${id}-clip`}>
      <circle cx="32" cy="32" r="32" />
    </clipPath>
  );

  switch (key) {
    case 'skyline':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f2b56b" /><stop offset="0.55" stopColor="#d97b5f" /><stop offset="1" stopColor="#7d4a5e" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <circle cx="22" cy="22" r="7" fill="#fde8c8" opacity="0.95" />
            <rect x="6" y="34" width="9" height="30" fill="#4a2e44" />
            <rect x="17" y="27" width="11" height="37" fill="#3b2438" />
            <rect x="30" y="38" width="8" height="26" fill="#4a2e44" />
            <rect x="40" y="30" width="12" height="34" fill="#352036" />
            <rect x="54" y="41" width="8" height="23" fill="#4a2e44" />
            <g fill="#f8d9a0" opacity="0.85">
              <rect x="19" y="31" width="2" height="2" /><rect x="24" y="31" width="2" height="2" />
              <rect x="19" y="37" width="2" height="2" /><rect x="43" y="34" width="2" height="2" />
              <rect x="47" y="40" width="2" height="2" /><rect x="43" y="46" width="2" height="2" />
            </g>
          </g>
        </svg>
      );
    case 'blueprint':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#1f4e79" /><stop offset="1" stopColor="#123152" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <g stroke="#7db3e0" strokeWidth="0.6" opacity="0.45">
              {[8, 16, 24, 32, 40, 48, 56].map((p) => (
                <g key={p}><line x1={p} y1="0" x2={p} y2="64" /><line x1="0" y1={p} x2="64" y2={p} /></g>
              ))}
            </g>
            <g fill="none" stroke="#eaf4ff" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
              <path d="M18 40 L32 26 L46 40" />
              <path d="M22 38 V50 H42 V38" />
              <rect x="29" y="42" width="6" height="8" />
            </g>
            <circle cx="46" cy="20" r="1.8" fill="#eaf4ff" />
          </g>
        </svg>
      );
    case 'crane':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f6c46a" /><stop offset="1" stopColor="#dd8b3e" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <circle cx="47" cy="17" r="6" fill="#fff3d6" opacity="0.9" />
            <g stroke="#5a3a1c" strokeWidth="3" strokeLinecap="round">
              <line x1="20" y1="58" x2="20" y2="18" />
              <line x1="12" y1="18" x2="47" y2="18" />
              <line x1="20" y1="26" x2="34" y2="18" />
            </g>
            <line x1="42" y1="18" x2="42" y2="32" stroke="#5a3a1c" strokeWidth="1.8" />
            <path d="M38 32 h8 v7 h-8 z" fill="#5a3a1c" />
            <rect x="8" y="56" width="48" height="8" fill="#5a3a1c" opacity="0.85" />
          </g>
        </svg>
      );
    case 'topo':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#1d6d64" /><stop offset="1" stopColor="#0f4a46" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <g fill="none" stroke="#9fd8cd" strokeWidth="1.6" opacity="0.85">
              <path d="M-4 50 C 12 40, 20 54, 36 46 S 60 50, 70 42" />
              <path d="M-4 40 C 12 30, 22 44, 38 36 S 60 40, 70 32" opacity="0.7" />
              <path d="M-4 30 C 12 20, 24 34, 40 26 S 60 30, 70 22" opacity="0.5" />
              <ellipse cx="24" cy="18" rx="10" ry="5.5" opacity="0.9" />
              <ellipse cx="24" cy="18" rx="5" ry="2.6" opacity="0.9" />
            </g>
            <circle cx="24" cy="18" r="1.6" fill="#e8fff8" />
          </g>
        </svg>
      );
    case 'sage-hills':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#cfe3c4" /><stop offset="1" stopColor="#8fb287" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <circle cx="44" cy="18" r="7" fill="#fbf6e3" opacity="0.95" />
            <path d="M-6 44 Q 14 26 30 44 T 70 44 V70 H-6 Z" fill="#5c7f63" />
            <path d="M-6 52 Q 18 36 36 52 T 70 50 V70 H-6 Z" fill="#3f5f4a" />
            <path d="M-6 60 Q 22 48 44 60 T 70 58 V70 H-6 Z" fill="#2e4d3f" />
          </g>
        </svg>
      );
    case 'terracotta':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e8a87c" /><stop offset="1" stopColor="#b85c38" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <g fill="#8a3e22" opacity="0.9">
              <path d="M0 46 h30 v18 h-30z" opacity="0.55" />
              <path d="M34 46 h30 v18 h-30z" opacity="0.4" />
              <path d="M16 26 h32 v16 h-32z" opacity="0.5" />
            </g>
            <g stroke="#fbe3d2" strokeWidth="1.6" opacity="0.9" fill="none">
              <path d="M0 46 h64 M0 26 h64" opacity="0.4" />
              <circle cx="32" cy="16" r="6.5" />
              <circle cx="32" cy="16" r="2.4" fill="#fbe3d2" />
            </g>
          </g>
        </svg>
      );
    case 'mosaic':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7a5b96" /><stop offset="1" stopColor="#4d3566" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <g transform="rotate(45 32 32)" fill="#d9c7ee">
              <rect x="14" y="14" width="14" height="14" rx="3" opacity="0.9" />
              <rect x="36" y="14" width="14" height="14" rx="3" opacity="0.55" />
              <rect x="14" y="36" width="14" height="14" rx="3" opacity="0.55" />
              <rect x="36" y="36" width="14" height="14" rx="3" opacity="0.28" />
            </g>
            <circle cx="32" cy="32" r="4.2" fill="#f3ebfd" />
          </g>
        </svg>
      );
    case 'midnight':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1d2740" /><stop offset="1" stopColor="#0c1224" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <circle cx="43" cy="21" r="9" fill="#f4ecd2" />
            <circle cx="39" cy="18" r="9" fill={`url(#${id})`} />
            <g fill="#f4ecd2">
              <circle cx="16" cy="14" r="1.3" /><circle cx="24" cy="26" r="1" />
              <circle cx="12" cy="34" r="1.1" /><circle cx="52" cy="38" r="1.2" />
              <circle cx="30" cy="9" r="0.9" /><circle cx="56" cy="12" r="0.9" />
            </g>
            <path d="M-4 54 Q 16 44 34 54 T 70 52 V70 H-4 Z" fill="#060a16" />
          </g>
        </svg>
      );
    case 'coral-arc':
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f0938a" /><stop offset="1" stopColor="#c2554f" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <g fill="none" stroke="#ffe4de" strokeLinecap="round">
              <path d="M8 52 A 24 24 0 0 1 56 52" strokeWidth="5" opacity="0.95" />
              <path d="M16 52 A 16 16 0 0 1 48 52" strokeWidth="4" opacity="0.7" />
              <path d="M24 52 A 8 8 0 0 1 40 52" strokeWidth="3" opacity="0.5" />
            </g>
            <circle cx="32" cy="20" r="3.4" fill="#ffe4de" />
          </g>
        </svg>
      );
    case 'stone':
    default:
      return (
        <svg {...common}>
          <defs>
            {clip}
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8e9aa5" /><stop offset="1" stopColor="#5f6a75" />
            </linearGradient>
          </defs>
          <g {...round}>
            <rect width="64" height="64" fill={`url(#${id})`} />
            <g fill="#e9edf1">
              <ellipse cx="32" cy="48" rx="16" ry="8" opacity="0.95" />
              <ellipse cx="32" cy="36" rx="12" ry="6.5" opacity="0.8" />
              <ellipse cx="32" cy="26" rx="8" ry="4.8" opacity="0.65" />
              <ellipse cx="32" cy="18" rx="4.6" ry="3" opacity="0.5" />
            </g>
            <ellipse cx="27" cy="46" rx="4" ry="2" fill="#5f6a75" opacity="0.35" />
          </g>
        </svg>
      );
  }
}
