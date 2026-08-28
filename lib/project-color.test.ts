import { describe, expect, it } from 'vitest';
import { projectColor } from './project-color';

describe('projectColor', () => {
  it('is deterministic — same id, same color, every call', () => {
    const a = projectColor('11111111-2222-3333-4444-555555555555');
    const b = projectColor('11111111-2222-3333-4444-555555555555');
    expect(a).toEqual(b);
  });

  it('null project gets the fixed neutral, distinct from real ids', () => {
    const general = projectColor(null);
    expect(general.hue).toBe(220);
    expect(projectColor(undefined)).toEqual(general);
  });

  it('different ids spread across distinguishable hues', () => {
    // Four real project ids should not collapse onto one or two hues.
    const ids = ['blair-llc-3374', 'san-marco-2361', 'rinconia-2650', 'alta-mesa-3701'];
    const hues = ids.map((id) => projectColor(id).hue);
    const distinct = new Set(hues.map((h) => Math.round(h / 25))); // 25° buckets
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it('emits valid hsl() strings for every surface', () => {
    const c = projectColor('some-project');
    for (const v of [c.solid, c.text, c.soft, c.border]) {
      expect(v).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    }
  });
});
