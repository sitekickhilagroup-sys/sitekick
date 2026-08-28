/**
 * Avatar preset registry — pure data (no JSX, no server imports) so both the
 * server actions (validation) and client/server renderers can use it. The
 * drawings themselves live in components/profile/preset-avatar.tsx.
 */
export const PRESET_KEYS = [
  'skyline', 'blueprint', 'crane', 'topo', 'sage-hills',
  'terracotta', 'mosaic', 'midnight', 'coral-arc', 'stone',
] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

// The first shipped set stored plain color keys; map them to their nearest
// designed successor instead of breaking saved profiles.
const LEGACY: Record<string, PresetKey> = {
  forest: 'sage-hills', moss: 'sage-hills', clay: 'terracotta', sand: 'crane',
  sky: 'skyline', plum: 'mosaic', coral: 'coral-arc', slate: 'stone',
};

export function resolvePresetKey(raw: string): PresetKey | null {
  if ((PRESET_KEYS as readonly string[]).includes(raw)) return raw as PresetKey;
  return LEGACY[raw] ?? null;
}

/** `preset:<key>` → resolved key, or null for URLs / unknown values. */
export function presetOf(avatar: string | null | undefined): PresetKey | null {
  if (!avatar?.startsWith('preset:')) return null;
  return resolvePresetKey(avatar.slice('preset:'.length));
}
