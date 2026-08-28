// Stable per-project identity color (Dor, 2026-08-29): the red "blocking"
// circle stopped carrying signal the moment every project had blockers, so
// each project gets its own color instead. Derived from the project id — no
// schema, no config, and the same project renders the same color everywhere,
// every render, on every machine ("random" to the eye, deterministic to the
// code).

export interface ProjectColor {
  /** 0–359 — the identity itself; everything else is derived. */
  hue: number;
  /** Solid dot / accent, readable on white and near-white surfaces. */
  solid: string;
  /** Text on the soft chip background. */
  text: string;
  /** Soft chip / badge background. */
  soft: string;
  /** Hairline border matching the soft surface. */
  border: string;
}

/** FNV-1a over the id — tiny, stable, spreads short uuid strings well. */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Spaced-hue palette rather than raw hash%360: with 4–10 projects, two raw
 * hues can land 8° apart and read as the same color. 12 anchor hues spaced
 * ≥25° apart, chosen to stay distinguishable for common color-vision
 * deficiencies as far as 12 slots allow; the hash picks the slot plus a
 * small ±8° jitter so added projects don't shift existing ones.
 */
const HUE_ANCHORS = [16, 42, 88, 148, 172, 200, 226, 258, 286, 316, 340, 65];

export function projectColor(id: string | null | undefined): ProjectColor {
  // Null project ("General") gets a fixed neutral slate so it never collides
  // with a real project's identity.
  if (!id) {
    return {
      hue: 220,
      solid: 'hsl(220 8% 55%)',
      text: 'hsl(220 10% 38%)',
      soft: 'hsl(220 12% 94%)',
      border: 'hsl(220 10% 86%)',
    };
  }
  const h = hash(id);
  const anchor = HUE_ANCHORS[h % HUE_ANCHORS.length];
  const jitter = ((h >>> 8) % 17) - 8; // −8..+8
  const hue = (anchor + jitter + 360) % 360;
  // Yellow-green band needs darker text to stay readable on the soft chip.
  const isBright = hue >= 40 && hue <= 180;
  return {
    hue,
    solid: `hsl(${hue} 62% ${isBright ? 34 : 46}%)`,
    text: `hsl(${hue} 58% ${isBright ? 26 : 34}%)`,
    soft: `hsl(${hue} 55% 93%)`,
    border: `hsl(${hue} 45% 84%)`,
  };
}
