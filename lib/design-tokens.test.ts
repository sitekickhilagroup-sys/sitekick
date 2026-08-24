import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

// Fixed by the client's "UX/UI version fixing" spec. Renaming or dropping one
// silently breaks the approved design on every redesigned page.
const SPEC_TOKENS = [
  'sk-page', 'sk-surface', 'sk-surface-soft', 'sk-ink', 'sk-text',
  'sk-muted', 'sk-muted-light', 'sk-line', 'sk-line-strong',
  'sk-green', 'sk-green-hover', 'sk-green-soft', 'sk-green-soft-strong',
  'sk-cream', 'sk-cream-border',
  'sk-amber', 'sk-amber-dot', 'sk-amber-halo',
  'sk-salmon', 'sk-salmon-text', 'sk-red-dot', 'sk-red-halo',
  'sk-blue', 'sk-blue-soft', 'sk-shadow', 'sk-panel-shadow',
  'sk-green-dark', 'sk-surface-header', 'sk-salmon-surface', 'sk-salmon-border',
  'sk-upload-surface', 'sk-detail-surface',
];

// Tokens with no existing live equivalent to alias. These carry a literal light
// value, so they need an explicit dark value too or the redesigned pages lose
// contrast under [data-theme="dark"].
const NEW_TOKENS = [
  'sk-surface-soft', 'sk-text', 'sk-muted-light', 'sk-line-strong',
  'sk-green-hover', 'sk-green-soft', 'sk-cream', 'sk-cream-border',
  'sk-amber-dot', 'sk-amber-halo', 'sk-red-dot', 'sk-red-halo',
  'sk-shadow', 'sk-panel-shadow', 'sk-green-dark', 'sk-surface-header',
  'sk-salmon-surface', 'sk-salmon-border', 'sk-upload-surface', 'sk-detail-surface',
];

// The sk palette's dark overrides live in their own [data-theme="dark"] block —
// the original one above it only covers the pre-existing palette.
function skDarkBlock(source: string): string {
  const marker = source.indexOf('--sk-surface-soft', source.indexOf('--sk-surface-soft') + 1);
  if (marker === -1) return '';
  const start = source.lastIndexOf('[data-theme="dark"]', marker);
  if (start === -1) return '';
  return source.slice(start, source.indexOf('}', marker));
}

describe('sk design tokens', () => {
  it('defines every token the redesign spec names', () => {
    const missing = SPEC_TOKENS.filter((t) => !new RegExp(`--${t}\\s*:`).test(css));
    expect(missing).toEqual([]);
  });

  it('gives every non-aliased token a dark-theme value', () => {
    const dark = skDarkBlock(css);
    const missing = NEW_TOKENS.filter((t) => !new RegExp(`--${t}\\s*:`).test(dark));
    expect(missing).toEqual([]);
  });

  it('scopes the redesign typography behind .sk-page', () => {
    expect(css).toContain('.sk-page');
    expect(css).toMatch(/\.sk-page\s*\{[^}]*Geist/);
  });
});
