# UX/UI Version Fixing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Sitekick's six primary pages (Portfolio, My Work, Project Process, Data Inbox, Invoices, Weekly Review) to the visual system defined in the client's "UX/UI version fixing" document, and fix the defects listed in the "תיקונים נעה" tab — without changing live data, routes, persistence, or the More section.

**Architecture:** The redesign is a **styling and markup** change layered onto the existing Next.js App Router + Tailwind v4 codebase. The client's `--sk-*` palette is introduced in `app/globals.css`, aliased onto the live tokens wherever the two already agree, so dark theme keeps working. Typography and layout changes are **route-scoped** behind a `.sk-page` wrapper class so the More section is untouched. Three pages (Data Inbox, Invoices, Weekly Review) get route-specific headers, which requires splitting `app/(dash)` into a `(standard)` group (global header) and a `(focused)` group (per-page header). No schema changes, no migrations, no new server actions unless a defect fix demands one.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2.8, Tailwind CSS v4 (`@import "tailwindcss"` + `@theme inline`), TypeScript 5, Supabase (`@supabase/ssr`), Vitest 4, self-hosted Geist via the `geist` npm package, i18n en/he with RTL.

**Spec:** Google Doc "UX/UI version fixing" — <https://docs.google.com/document/d/1j6tIMFNxHjjwkfeS6OC_HFggVMVwa_IVQ099g1vkkpQ/edit>

Working copies of the spec, split per page, live in the session scratchpad:
`…\scratchpad\doc\01-preamble.md` (shared system + Portfolio), `02-mywork.md`, `03-project-process.md`, `04-data-inbox.md`, `05-invoices.md`, `06-weekly-review.md`, `07-more-preserve.md`, `08-noa-hebrew.md`.

**Visual reference source (read-only donor, DO NOT copy wholesale):**
`C:\Users\doraz\OneDrive\Desktop\Work\Sitekick\SiteKick-review-2026-08-22\SiteKick-review-2026-08-22\sitekick-source`
This is a **different stack** — Vite + Cloudflare Worker + Drizzle/D1, flat routes, plain per-page CSS, LTR-only, no i18n, no dark theme. Treat it as a source of geometry, spacing values and markup structure only. Never port its routing, data layer, or physical-direction CSS.

---

## Global Constraints

These apply to **every** task in this plan. A task is not done if it violates one.

**Source priority (spec preamble):**
1. The comparison screenshots and the spec document define the target visual result and route behavior.
2. The reference source provides working reference code for implementing that result.
3. **The live repository remains authoritative** for current records, canonical IDs, routes, APIs, authentication, persistence and live-only functionality.
4. When demo values in the reference conflict with live values, **preserve the live values**.
5. When the reference lacks an existing live capability, **preserve and integrate the live capability**.

**Never do (spec preamble):**
- Do not replace the live app directory with the reference's app directory, or copy the reference over the repo.
- Do not replace live database records with seed or demo records.
- Do not replace current project, action, invoice or Weekly Review data.
- Do not replace database migrations to reproduce a visual design.
- Do not remove newer live functionality because it is absent from the reference.
- Do not restore an older Header that removes More, notifications, language, theme or sign-out.
- Do not duplicate canonical actions between screens.
- Do not bypass the State Writer (`lib/state-writer.ts`), and do not remove audit or Undo behavior.
- Do not hardcode screenshot values (counts, totals, names). Always render live state.
- Do not change database schema or migrations for a purely visual task.

**More section is regression-protected (spec `07-more-preserve.md`):**
- `/inbox`, `/drafts`, `/digest`, `/directory`, `/settings`, `/guide` keep their current UI, layout, styling, content and behavior — unchanged.
- More pages keep the **standard global header**. Route-specific headers must never appear on them.
- The More dropdown keeps its position, appearance, dropdown/active/hover/focus behavior, width, spacing, colors, typography, border, radius, shadow, keyboard nav and click-outside behavior.
- Settings is frozen exactly as implemented, including page width, card layout, spacing, typography, colors and responsive behavior.

**CSS isolation (spec `07-more-preserve.md` §CSS isolation requirement):**
- All new styles must be route-scoped behind a page wrapper class.
- **Forbidden:** bare global selectors on `header`, `nav`, `main`, `section`, `button`, `input`, `select`, `textarea`, `table`, `h1`, `h2`.
- No new container-width rule may change the Settings layout.
- No responsive rule from a redesigned page may reach the More section.

**Exact design tokens (spec preamble §Exact Color and Typography Specification):**

| Token | Light value | Live token it aliases |
|---|---|---|
| `--sk-page` | `#fbfbf7` | `--bg` |
| `--sk-surface` | `#ffffff` | `--card` |
| `--sk-surface-soft` | `#fafbf8` | *(new)* |
| `--sk-ink` | `#16221f` | `--ink` |
| `--sk-text` | `#26332f` | *(new)* |
| `--sk-muted` | `#71807b` | `--ink2` |
| `--sk-muted-light` | `#8b9692` | *(new)* |
| `--sk-line` | `#dfe5df` | `--line` |
| `--sk-line-strong` | `#b8cec4` | *(new)* |
| `--sk-green` | `#316c5b` | `--sage` |
| `--sk-green-hover` | `#285b4d` | *(new)* |
| `--sk-green-soft` | `#e7f0eb` | *(new)* |
| `--sk-green-soft-strong` | `#dcebe4` | `--sage-soft` |
| `--sk-cream` | `#fff7e9` | *(new)* |
| `--sk-cream-border` | `#ecd9b8` | *(new)* |
| `--sk-amber` | `#a96725` | `--apricot` |
| `--sk-amber-dot` | `#d99a45` | *(new)* |
| `--sk-amber-halo` | `#faead2` | *(new)* |
| `--sk-salmon` | `#fbe8e5` | `--coral-soft` |
| `--sk-salmon-text` | `#a3483f` | `--coral` |
| `--sk-red-dot` | `#b94f45` | *(new)* |
| `--sk-red-halo` | `#f8e3df` | *(new)* |
| `--sk-blue` | `#416b84` | `--mist` |
| `--sk-blue-soft` | `#eaf2f7` | `--mist-soft` |
| `--sk-shadow` | `rgba(37, 58, 50, 0.05)` | *(new)* |
| `--sk-green-dark` | `#143128` | *(new — live `--deep` is `#172923`, close but different)* |
| `--sk-surface-header` | `#f3f5f1` | *(new — table/column header bars)* |
| `--sk-salmon-surface` | `#fff8f6` | *(new — My Work project sections)* |
| `--sk-salmon-border` | `#edcbc5` | *(new)* |
| `--sk-upload-surface` | `#f7fbf8` | *(new — Data Inbox drop zone)* |
| `--sk-detail-surface` | `#f7f8f4` | *(new — Project Process detail panel)* |

Radii: **page-scoped, not global.** Portfolio, Project Process, Data Inbox, Invoices and Weekly Review use small 8 / medium 11 / large 15. **My Work's spec section 14 specifies 6 / 10 / 14 under the same names** — so radii are declared per page scope, never as one shared `--sk-radius-*` triple. Shared shadow: `--sk-panel-shadow: 0 8px 24px rgba(37, 58, 50, 0.05)`.

**Two spec-internal contradictions, already resolved here:** the Invoices spec defines `--sk-blue-soft: #eaf2f7` while the Weekly Review spec defines `#edf6fa` for the same name. This plan uses **`#eaf2f7`**, because it matches the existing live `--mist-soft` and can therefore be aliased rather than duplicated. Likewise the radius triple above.

Colour usage rules: page background `--sk-page`; cards and panels `--sk-surface`; soft rows and info cards `--sk-surface-soft`; headings `--sk-ink`; body `--sk-text`; metadata `--sk-muted` / `--sk-muted-light`; borders `--sk-line`; active nav and selected states `--sk-green-soft`; primary buttons and links `--sk-green`; Agent Review Inbox `--sk-cream` on `--sk-cream-border`; risk and blocking badges `--sk-salmon` on `--sk-salmon-text`. **No pure black for interface text. No gradients. No additional saturated colours** unless an existing semantic status requires them.

**Typography (all six pages):**
- Interface font: `"Geist", Arial, Helvetica, sans-serif`. Geist is already self-hosted through the `geist` npm package and wired as `--font-geist-sans` / `--font-geist-mono` in `app/layout.tsx:18`.
- Technical identifiers only (project IDs, case numbers): `"Geist Mono", ui-monospace, SFMono-Regular, monospace`.
- **Remove Georgia / serif typography from all six redesigned pages.** Every page spec states this independently (`02-mywork.md:152,640`, `03-project-process.md:203,731`, `04-data-inbox.md:788`, `05-invoices.md:782`, `06-weekly-review.md:1033`, preamble `:539`). Serif **stays** on More pages and `/login`.
- Desktop scale: page title `clamp(30px, 3vw, 38px)` / 1.08 / 650 / `-0.035em`; panel title 22px / 1.2 / 650 / `-0.025em`; project name 14px / 1.25 / 650; body 11px / 1.5 / 400; nav 13px / 1 / 450 (active 650); eyebrow 9px / 1.2 / 700 / `0.12em` uppercase; metadata 8px / 1.35 / 450; status badge 9px / 1.25 / 500; button 10px / 1 / 650; big count 26px / 1 / 650.
- Spacing scale: 4px increments — 4, 8, 12, 16, 20, 24, 32.

**Live-only constraints the spec does not mention but that will break if ignored:**
- **RTL.** The app renders `dir="rtl"` for Hebrew (`app/layout.tsx:18`, `lib/i18n/dirFor`). Use logical properties everywhere — Tailwind `ms-/me-/ps-/pe-/start-/end-`, and `margin-inline-start` / `padding-inline-end` / `inset-inline-start` in raw CSS. The reference source is LTR-only and uses `left`/`right`; **never** copy those declarations verbatim.
- **Dark theme.** `[data-theme="dark"]` overrides the live tokens. Any genuinely new `--sk-*` token needs a dark counterpart or the redesigned pages will break in dark mode.
- **i18n parity.** Every user-visible string goes through `getT()` and must be added to **both** `lib/i18n/en.json` and `lib/i18n/he.json`. `lib/i18n/parity.test.ts` fails the build if the key sets diverge.
- **Server components.** Most pages are async server components reading Supabase directly. Interactivity added for the redesign must go in a `'use client'` child component, not by converting the page.

**Per-task validation gate — every task ends with all of these passing:**

```bash
npm run typecheck
```

```bash
npm run test
```

```bash
npm run build
```

Then, in the browser preview: exercise the page's interactions, and confirm `/settings` and the More dropdown are visually and behaviourally unchanged. **Do not start the next task while any of these fail.**

**Baseline (verified 2026-08-24, commit `b8889d1`):** `npm run typecheck` clean, `npm run test` 13 files / 78 tests passing, `npm run build` exit 0. Any failure after a task is caused by that task.

---

## File Structure

**Modified — shared foundation:**
- `app/globals.css` — add the `--sk-*` token block, dark counterparts, `@theme inline` registrations, and the `.sk-page` scope class. No changes to existing token values.
- `app/(dash)/layout.tsx` — reduced to auth/cookie shell; header moves down into the `(standard)` group.
- `components/nav-links.tsx` — nav typography to the doc's 13px/450 (active 650) scale.

**Created — route groups:**
- `app/(dash)/(standard)/layout.tsx` — the global header + `<main>` container, for Portfolio, My Work, Project Process and all More pages.
- `app/(dash)/(focused)/layout.tsx` — bare pass-through for the three pages that own their header.
- `components/chrome/focused-header.tsx` — shared shell for the three route-specific headers.

**Moved (route group reorganisation, URLs unchanged):**
- `app/(dash)/page.tsx`, `work/`, `projects/`, `inbox/`, `drafts/`, `digest/`, `directory/`, `settings/`, `guide/`, `loading.tsx` → `app/(dash)/(standard)/…`
- `app/(dash)/upload/`, `invoices/`, `weekly/` → `app/(dash)/(focused)/…`

**Modified — per page:** the page file plus its component folder (`components/portfolio/`, `components/overview/`, `components/work/`, `components/process/`, `components/upload/`, `components/invoices/`, `components/weekly/`).

**Untouched — regression-protected:** everything under More (`inbox`, `drafts`, `digest`, `directory`, `settings`, `guide`), `app/login/`, `app/api/`, `app/actions/` (except where a `08-noa-hebrew.md` defect requires it), `lib/`, `supabase/migrations/`.

---

## Phase 0 — Foundation

Everything in Phase 0 is shared by all six pages. Do it first, in order. No page work starts until Phase 0 is green.

### Task 1: Design tokens and the route-scoped type system

Introduces the spec's `--sk-*` palette without disturbing the existing tokens, and creates the `.sk-page` wrapper that carries Geist-first typography onto redesigned pages only.

**Files:**
- Modify: `app/globals.css` (append after the `[data-theme="dark"]` block at line 34, extend `@theme inline` at lines 36-74, append the scope class at end of file)
- Test: `lib/design-tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--sk-page`, `--sk-surface`, `--sk-surface-soft`, `--sk-ink`, `--sk-text`, `--sk-muted`, `--sk-muted-light`, `--sk-line`, `--sk-line-strong`, `--sk-green`, `--sk-green-hover`, `--sk-green-soft`, `--sk-green-soft-strong`, `--sk-cream`, `--sk-cream-border`, `--sk-amber`, `--sk-amber-dot`, `--sk-amber-halo`, `--sk-salmon`, `--sk-salmon-text`, `--sk-red-dot`, `--sk-red-halo`, `--sk-blue`, `--sk-blue-soft`, `--sk-shadow`, `--sk-radius-small`, `--sk-radius-medium`, `--sk-radius-large`, `--sk-panel-shadow`; Tailwind utilities `bg-sk-*`, `text-sk-*`, `border-sk-*`; and the CSS class `.sk-page`, which every later task applies to its page root.

- [ ] **Step 1: Write the failing test**

Create `lib/design-tokens.test.ts`:

```ts
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

// Tokens with no existing live equivalent to alias. These carry a literal
// light value, so they need an explicit dark value too or the redesigned
// pages lose contrast under [data-theme="dark"].
const NEW_TOKENS = [
  'sk-surface-soft', 'sk-text', 'sk-muted-light', 'sk-line-strong',
  'sk-green-hover', 'sk-green-soft', 'sk-cream', 'sk-cream-border',
  'sk-amber-dot', 'sk-amber-halo', 'sk-red-dot', 'sk-red-halo',
  'sk-shadow', 'sk-panel-shadow', 'sk-green-dark', 'sk-surface-header',
  'sk-salmon-surface', 'sk-salmon-border', 'sk-upload-surface', 'sk-detail-surface',
];

function darkBlock(source: string): string {
  const start = source.indexOf('[data-theme="dark"]');
  if (start === -1) return '';
  return source.slice(start, source.indexOf('}', start));
}

describe('sk design tokens', () => {
  it('defines every token the redesign spec names', () => {
    const missing = SPEC_TOKENS.filter((t) => !new RegExp(`--${t}\\s*:`).test(css));
    expect(missing).toEqual([]);
  });

  it('gives every non-aliased token a dark-theme value', () => {
    const dark = darkBlock(css);
    const missing = NEW_TOKENS.filter((t) => !new RegExp(`--${t}\\s*:`).test(dark));
    expect(missing).toEqual([]);
  });

  it('scopes the redesign typography behind .sk-page', () => {
    expect(css).toContain('.sk-page');
    expect(css).toMatch(/\.sk-page\s*\{[^}]*Geist/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run lib/design-tokens.test.ts
```

Expected: FAIL — all three assertions fail, because no `--sk-*` token and no `.sk-page` class exist yet.

- [ ] **Step 3: Add the token block to `app/globals.css`**

Insert immediately after the closing brace of the `[data-theme="dark"]` block (currently line 34), **before** `@theme inline`:

```css
/* Redesign palette from the client's "UX/UI version fixing" spec. Most of it
   is the existing palette under different names, so alias those — dark theme
   then follows the live tokens for free. Only genuinely new colours carry a
   literal value, and each of those gets a dark counterpart below. */
:root {
  --sk-page: var(--bg);
  --sk-surface: var(--card);
  --sk-surface-soft: #fafbf8;
  --sk-ink: var(--ink);
  --sk-text: #26332f;
  --sk-muted: var(--ink2);
  --sk-muted-light: #8b9692;
  --sk-line: var(--line);
  --sk-line-strong: #b8cec4;

  --sk-green: var(--sage);
  --sk-green-hover: #285b4d;
  --sk-green-soft: #e7f0eb;
  --sk-green-soft-strong: var(--sage-soft);

  --sk-cream: #fff7e9;
  --sk-cream-border: #ecd9b8;
  --sk-amber: var(--apricot);
  --sk-amber-dot: #d99a45;
  --sk-amber-halo: #faead2;

  --sk-salmon: var(--coral-soft);
  --sk-salmon-text: var(--coral);
  --sk-red-dot: #b94f45;
  --sk-red-halo: #f8e3df;

  --sk-blue: var(--mist);
  --sk-blue-soft: var(--mist-soft);

  --sk-green-dark: #143128;
  --sk-surface-header: #f3f5f1;
  --sk-salmon-surface: #fff8f6;
  --sk-salmon-border: #edcbc5;
  --sk-upload-surface: #f7fbf8;
  --sk-detail-surface: #f7f8f4;

  --sk-shadow: rgba(37, 58, 50, 0.05);
  --sk-panel-shadow: 0 8px 24px rgba(37, 58, 50, 0.05);
}

[data-theme="dark"] {
  --sk-surface-soft: #212c27;
  --sk-text: #d3dad7;
  --sk-muted-light: #7e8a85;
  --sk-line-strong: #3a5648;
  --sk-green-hover: #9bcbb6;
  --sk-green-soft: #23372f;
  --sk-cream: #2c2519;
  --sk-cream-border: #4a3e28;
  --sk-amber-dot: #c08a4a;
  --sk-amber-halo: #3b2f1f;
  --sk-red-dot: #c97267;
  --sk-red-halo: #402a27;
  --sk-green-dark: #0f241d;
  --sk-surface-header: #212c27;
  --sk-salmon-surface: #2b1f1d;
  --sk-salmon-border: #4a332e;
  --sk-upload-surface: #1a241f;
  --sk-detail-surface: #18211d;
  --sk-shadow: rgba(0, 0, 0, 0.35);
  --sk-panel-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
```

Radii are **not** declared here — see the note in Global Constraints. Each page task declares its own radius values inside its page scope.

- [ ] **Step 4: Register the colours as Tailwind utilities**

Inside the existing `@theme inline { … }` block (line 36), before the closing brace, add:

```css
  --color-sk-page: var(--sk-page);
  --color-sk-surface: var(--sk-surface);
  --color-sk-surface-soft: var(--sk-surface-soft);
  --color-sk-ink: var(--sk-ink);
  --color-sk-text: var(--sk-text);
  --color-sk-muted: var(--sk-muted);
  --color-sk-muted-light: var(--sk-muted-light);
  --color-sk-line: var(--sk-line);
  --color-sk-line-strong: var(--sk-line-strong);
  --color-sk-green: var(--sk-green);
  --color-sk-green-hover: var(--sk-green-hover);
  --color-sk-green-soft: var(--sk-green-soft);
  --color-sk-green-soft-strong: var(--sk-green-soft-strong);
  --color-sk-cream: var(--sk-cream);
  --color-sk-cream-border: var(--sk-cream-border);
  --color-sk-amber: var(--sk-amber);
  --color-sk-amber-dot: var(--sk-amber-dot);
  --color-sk-amber-halo: var(--sk-amber-halo);
  --color-sk-salmon: var(--sk-salmon);
  --color-sk-salmon-text: var(--sk-salmon-text);
  --color-sk-red-dot: var(--sk-red-dot);
  --color-sk-red-halo: var(--sk-red-halo);
  --color-sk-blue: var(--sk-blue);
  --color-sk-blue-soft: var(--sk-blue-soft);
  --color-sk-green-dark: var(--sk-green-dark);
  --color-sk-surface-header: var(--sk-surface-header);
  --color-sk-salmon-surface: var(--sk-salmon-surface);
  --color-sk-salmon-border: var(--sk-salmon-border);
  --color-sk-upload-surface: var(--sk-upload-surface);
  --color-sk-detail-surface: var(--sk-detail-surface);
```

`@theme inline` emits the `var()` reference rather than a resolved colour, so these utilities keep following the theme at runtime — the same mechanism the existing `--color-bg: var(--bg)` uses.

- [ ] **Step 5: Add the route-scoped type system at the end of `app/globals.css`**

```css
/* Route-scoped redesign typography. Only pages that opt in by putting
   .sk-page on their root get Geist-first type and the spec's 11px body;
   More pages never carry the class, so their approved Arial/Georgia
   treatment is untouched. Selectors stay class-based — the spec forbids
   bare element selectors that could leak into More. */
.sk-page {
  font-family: "Geist", var(--font-geist-sans), Arial, Helvetica, sans-serif;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sk-text);
}

/* Safety net for any .font-serif left behind mid-migration. Each page task
   still strips the class itself — the spec forbids leaving a mixture. */
.sk-page .font-serif {
  font-family: inherit;
  font-weight: 650;
}

.sk-page .font-mono {
  font-family: "Geist Mono", var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace;
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run lib/design-tokens.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 7: Run the full validation gate**

```bash
npm run typecheck && npm run test && npm run build
```

Expected: typecheck clean, 14 test files / 81 tests passing, build exit 0.

- [ ] **Step 8: Verify More is untouched**

Start the preview, visit `/settings` and `/guide`, and confirm they render exactly as before (Arial body, Georgia headings, same widths). Nothing carries `.sk-page` yet, so any visible change here means a global selector leaked — fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add app/globals.css lib/design-tokens.test.ts && git commit -m "feat(design): add sk design tokens and route-scoped type system"
```

---

### Task 2: Split `app/(dash)` into `(standard)` and `(focused)` route groups

The Data Inbox, Invoices and Weekly Review specs each define a **route-specific header**, and `07-more-preserve.md` confirms it: *"Do not apply any of the route-specific Headers created for: Data Inbox. Invoices. Weekly Review."* A layout at `app/(dash)/` applies to every child, so the global header must move down into a group that excludes those three routes.

**Route groups do not change URLs**, and auth is enforced in `proxy.ts` by pathname (`proxy.ts:40-58`), not by layout — so this move cannot affect authentication or any route's address.

**Files:**
- Create: `app/(dash)/(standard)/layout.tsx`
- Create: `app/(dash)/(focused)/layout.tsx`
- Modify: `app/(dash)/layout.tsx` (reduce to shell)
- Move: `app/(dash)/page.tsx`, `work/`, `projects/`, `inbox/`, `drafts/`, `digest/`, `directory/`, `settings/`, `guide/`, `loading.tsx` → `app/(dash)/(standard)/`
- Move: `app/(dash)/upload/`, `app/(dash)/invoices/`, `app/(dash)/weekly/` → `app/(dash)/(focused)/`

**Interfaces:**
- Consumes: `.sk-page` from Task 1.
- Produces: `app/(dash)/(standard)/layout.tsx` renders the global header and the `<main id="main" className="mx-auto max-w-[1400px] px-4 py-4 sm:py-6">` container. `app/(dash)/(focused)/layout.tsx` renders `{children}` inside `<main id="main">` with no header and no width cap — each focused page supplies its own header and container.

- [ ] **Step 1: Move the standard-header routes**

```bash
mkdir -p "app/(dash)/(standard)" "app/(dash)/(focused)"
git mv "app/(dash)/page.tsx" "app/(dash)/loading.tsx" "app/(dash)/(standard)/"
git mv "app/(dash)/work" "app/(dash)/projects" "app/(dash)/inbox" "app/(dash)/drafts" "app/(dash)/digest" "app/(dash)/directory" "app/(dash)/settings" "app/(dash)/guide" "app/(dash)/(standard)/"
```

- [ ] **Step 2: Move the focused routes**

```bash
git mv "app/(dash)/upload" "app/(dash)/invoices" "app/(dash)/weekly" "app/(dash)/(focused)/"
```

- [ ] **Step 3: Create `app/(dash)/(standard)/layout.tsx`**

Move the entire current body of `app/(dash)/layout.tsx` here unchanged — the header markup, nav links, notification bell, locale/theme toggles, sign-out, mobile nav and `<main>` container. Rename the export to `StandardLayout`. Do not alter its contents in this task; the header restyle is Task 3.

- [ ] **Step 4: Create `app/(dash)/(focused)/layout.tsx`**

```tsx
// Data Inbox, Invoices and Weekly Review each render their own route-specific
// header (spec sections 2-3 of each page). They opt out of the global header
// but keep the skip target and the page shell.
export default function FocusedLayout({ children }: { children: React.ReactNode }) {
  return <main id="main">{children}</main>;
}
```

- [ ] **Step 5: Reduce `app/(dash)/layout.tsx` to a shell**

```tsx
// Auth is enforced in proxy.ts by pathname, so this layout only needs to be a
// common parent for the (standard) and (focused) groups.
export default function DashLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
```

Move the skip link into `app/(dash)/(standard)/layout.tsx` and add an equivalent one to the focused layout in Task 3, so keyboard users keep a skip target on every page.

- [ ] **Step 6: Verify every URL still resolves**

```bash
npm run build
```

Expected: exit 0, and the route list printed by the build still contains `/`, `/work`, `/projects`, `/upload`, `/invoices`, `/weekly`, `/inbox`, `/drafts`, `/digest`, `/directory`, `/settings`, `/guide` — with no `(standard)` or `(focused)` segment in any URL.

- [ ] **Step 7: Run the validation gate**

```bash
npm run typecheck && npm run test && npm run build
```

- [ ] **Step 8: Verify in the browser**

Visit all twelve routes. Confirm: the global header appears on the nine standard routes, is absent on `/upload`, `/invoices` and `/weekly` (they will look bare until their own headers land in Phases 4-6), the More dropdown opens and closes, and `/settings` is unchanged.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor(routing): split dash into standard and focused route groups"
```

---

### Task 3: Restyle the shared header to the spec

**Files:**
- Modify: `app/(dash)/(standard)/layout.tsx` (header element and lockup)
- Modify: `components/nav-links.tsx:50-113` (desktop nav typography)

**Interfaces:**
- Consumes: `--sk-*` tokens from Task 1; the `(standard)` group from Task 2.
- Produces: no new exports — `NavLinks` and `MobileNav` keep their current props (`{ links, more, moreLabel }` and `{ links, more, menuLabel, children }`).

**Spec requirements (preamble §1 Header):** taller, cleaner header; Hilla Group / SiteKick branding at the left; nav order Portfolio, My Work, Project Process, Data Inbox, Invoices, Weekly Review, More; the active tab is a **pale-green rounded tab**; More dropdown and its arrow unchanged; notification bell, language control, theme control and Sign out all preserved and visually integrated.

**Already correct today — do not "fix" these:** nav order (`app/(dash)/layout.tsx:28-43`), pale-green active pill (`components/nav-links.tsx:60` `bg-sage-soft`), More dropdown with `▾` (`nav-links.tsx:87`), My Work count badge (`nav-links.tsx:65-69`), and all four right-hand utilities.

- [ ] **Step 1: Raise the header height and padding**

In `app/(dash)/(standard)/layout.tsx`, change the header inner row from `h-14` to `h-16` and widen the gap:

```tsx
<div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-6 lg:gap-8">
```

The mobile nav drawer positions itself with `top-14` (`components/nav-links.tsx:197,199`); update both to `top-16` so the drawer still meets the header edge.

- [ ] **Step 2: Apply the spec's nav typography**

In `components/nav-links.tsx`, on the desktop `<Link>` at line 58, replace the inherited `text-sm` sizing with the spec scale — 13px, weight 450, active weight 650:

```tsx
className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] leading-none transition-colors ${
  active
    ? 'bg-sk-green-soft font-[650] text-sk-green'
    : 'font-[450] text-sk-muted hover:bg-sk-surface-soft hover:text-sk-ink'
}`}
```

Apply the same `text-[13px]`, `font-[450]` / `font-[650]` treatment to the More button at line 80. **Leave the dropdown panel at line 90 and every `role="menuitem"` link at line 100 exactly as they are** — `07-more-preserve.md` freezes the More menu's typography, colors, border, radius and shadow.

- [ ] **Step 3: Run the validation gate**

```bash
npm run typecheck && npm run test && npm run build
```

- [ ] **Step 4: Verify header and More in the browser**

Confirm: the header is taller with the same contents; the active tab is a pale-green rounded pill; the More dropdown opens, closes on Escape and on outside click, and its panel is visually identical to before; keyboard tab order still reaches the bell, language, theme and Sign out. Check at `dir="rtl"` by switching the language to Hebrew — the lockup must sit on the right and the utilities on the left, with no horizontal overflow.

- [ ] **Step 5: Commit**

```bash
git add "app/(dash)/(standard)/layout.tsx" components/nav-links.tsx && git commit -m "style(header): taller header and spec nav typography"
```

---

## Phase 0.5 — Blocker model (pulled forward from the Blocker Audit tab)

Added after the plan was first written. The doc's fourth tab, "Blocker Audit and Required Corrections", turned out to define **system logic**, not just project data — specifically how the Portfolio card derives Main Blocker and its counts. Phase 1 restyles exactly that card, so the model comes first and the card gets styled once against its final shape.

**Spec source:** tab 4 §"System logic and Portfolio card derivation" and §"Mandatory blocker test"; tab 6 §"דרישות יישום לדור". Tab 2's "Impact on process" field is the same feature described from the UI side.

**The rules implemented:**
- Seven classifications: Primary Blocker, Workstream Blocker, Future Gate, External Gate / Waiting, Urgent Action, Verify, Information Only.
- The mandatory test — before anything is Blocking the system must name which stage cannot advance, what releases it, which source proves it, and whether the relationship is still current. If it cannot, the item is Waiting / Verify / Action / Future Gate / Information Only instead.
- Main Blocker comes only from an open **primary** blocker aimed at the current phase or an active sub-stage. With none, the strongest External Gate or Workstream Blocker is shown **and labelled honestly** — never silently called project-wide.
- Two independently blocked workstreams surface as Primary plus Technical, separately.
- The blocking count includes only primary and workstream. External waits, urgent actions and Verify each get their own count.

### Task 3.5: blocker classification schema and derivation — **done**

**Files:** created `supabase/migrations/0009_blocker_classification.sql`, `lib/blockers.ts`, `lib/blockers.test.ts`; modified `lib/types.ts`, `lib/queries.ts`.

- Migration adds the `blocker_kind` enum and 11 columns: `kind`, `blocks_phase`, `blocks_substage`, `blocked_deliverable`, `relationship_reason`, `confidence`, `effective_from`, `last_verified_at`, `release_condition`, `manually_corrected_by`, `undo_event_id`. The doc's `source_evidence_id` maps onto the existing `blockers.document_id` rather than duplicating it.
- **Existing rows default to `kind = 'verify'`.** They carry none of the evidence the mandatory test requires, so they stop counting as confirmed blockers until reclassified. Tab 4 lists the correct classification per project per blocker — that is a Phase 7 data pass, tracked as **D14** alongside the other cleanups.
- `selectBlockerView(blockers, { currentPhaseKey, activeSubstages })` in `lib/blockers.ts` implements the selection and counting rules, covered by 14 tests.
- `PortfolioEntry` gains `primaryBlockerKind`, `technicalBlocker` and `blockerCounts`; `mainBlocker` and `blockingCount` keep their names but now come from the derivation.

**Still open, deliberately deferred:**
- The editable `blocker_type` control (tab 6) belongs with Phase 3's "Impact on process" field, which is the same requirement from tab 2.
- Automatic release rules — evidence satisfying a `release_condition` clearing the blocker, and contradicting evidence flipping it to Verify — are Phase 7 logic, not Phase 1 styling.
- `relationship_type` still holds `blocks | supports | parallel | unrelated | needs_verification`; tab 4 asks for `Blocks | Required for | Affects | Related | Independent | Conditional`. Not needed for the card; reconcile in Phase 7.

---

## Phases 1-6 — Per-page work

Spec order, which this plan follows: Portfolio → My Work → Project Process → Data Inbox → Invoices → Weekly Review. **Complete and validate one page before starting the next.**

Each page task ends with the standard gate (`typecheck`, `test`, `build`, browser check, More unchanged) plus one commit.

### A note that applies to every page task

Much more is already correct than the spec implies — the previous sprints ported large parts of the reference. The gaps below are the *real* deltas; do not rebuild working components. In particular, **these already match the spec and must not be rewritten:** the Portfolio three info cards and five-stage rail (`components/portfolio/project-accordion.tsx:112-131,150-169`), the Project Process 1.08/0.92 workspace split (`components/process/process-explorer.tsx:130`), the phase-rail bottom-strip state colours (`process-explorer.tsx:98-126`), the My Work five summary cards and their active state (`app/(dash)/work/page.tsx:280-297`), the Weekly Review Project → Sub-topic → Row hierarchy (`app/(dash)/weekly/page.tsx:96-132`), and the Weekly six-status selector (`components/weekly/review-board.tsx:225-233`).

---

## Phase 1 — Portfolio

### Task 4: Portfolio layout — 80/20 row and Ranked Attention relocation

**Files:** Modify `app/(dash)/(standard)/page.tsx`

| Spec requirement | Live state | Edit |
|---|---|---|
| Ranked Attention out of the persistent right column, **component, data and behavior preserved** | `page.tsx:103-131`, first child of the `<aside>` at `:101` | Lift the `<section>` out of the `<aside>` and render it after the Project Map section (`:99`), wrapped in `<details>` with a `<summary>` using `t('portfolio.ranked_kicker')`. **Never `hidden` or `display:none`** — the spec forbids deleting on visual grounds, and the reference's own answer (`.ranked-attention{display:none}`) is not acceptable here. |
| Project Map ≈80% / Agent Review Inbox ≈20% | `:73` `lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)]` ≈ 69/30, and the right column holds two panels | `:73` → `lg:grid-cols-[minmax(0,4fr)_minmax(0,1fr)]`. The `<aside>` keeps only the Review Inbox; drop its `space-y-4`. Add `lg:sticky lg:top-[4.5rem]` to match the reference's sticky inbox against the taller header from Task 3. |
| Review Inbox: cream background, thin warm border, compact height, real count and review action | `:134-146` `border-line bg-card p-5 shadow-card`; count `font-serif text-2xl text-apricot` | `bg-sk-cream border-sk-cream-border`, `p-5` → `p-4`, count → `text-[26px] font-[650]` with `font-serif` removed. Keep `min-h-11` on the CTA below `sm:`. |
| Intro: eyebrow, title, subtitle, "Open today's plan" card on the right with the **real** count | Already correct in structure (`:51-69`); count is `data.tasks.length` — real, not hardcoded | No structural change. Typography only, in Task 5. |
| Inactive-projects `<details>` and `IntelligenceTabs` | `:87-98` and `:150-180`; neither appears in the spec or the reference | **Keep both.** Preamble: "Do not remove newer live functionality because it is absent from the ZIP." |

### Task 5: Portfolio typography and card styling

**Files:** Modify `app/(dash)/(standard)/page.tsx`, `components/portfolio/project-accordion.tsx`

- Add `className="sk-page"` to the page root (`page.tsx:49`) to pick up the Task 1 type scope.
- Remove the `font-serif` utility at `page.tsx:54, 63, 78, 105, 137` and `project-accordion.tsx:77, 99`, replacing each with an explicit weight from the spec scale: page title → `text-[clamp(30px,3vw,38px)] font-[650] leading-[1.08] tracking-[-0.035em]`; open-plan count → `text-[26px] font-[650] leading-none text-sage`; panel title → `text-[22px] font-[650] tracking-[-0.025em]`; project name → `text-[14px] font-[650] leading-[1.25]`.
- Eyebrows at `page.tsx:53, 77, 104, 136` → `text-[9px] font-bold tracking-[0.12em]`.
- Info cards (`project-accordion.tsx:112-131`): `bg-inset` → `bg-sk-surface-soft`; eyebrows → 9px/700/0.12em; gap `gap-2.5` → `gap-2`.
- Expanded card border: keep `border-sage-line` (`#BCD8CB`) rather than adding `--sk-line-strong` (`#b8cec4`) as a near-duplicate — the spec says to reuse existing variables for the same semantic purpose.
- Radii within the Portfolio scope: 8 / 11 / 15.
- **MAIN BLOCKER panel now renders the Phase 0.5 model.** Use `entry.primaryBlockerKind` to label it: only `'primary'` may read as a project-wide blocker; a `'workstream'` or `'external_gate'` fallback must say so. Render `entry.technicalBlocker` as an optional second line when present. The chip shows `entry.blockingCount` (primary + workstream only) — surface `blockerCounts.waiting` and `blockerCounts.verify` as their own labels, never folded into the blocking number.

---

## Phase 2 — My Work

### Task 6: Container, intro, summary cards and view-context row

**Files:** Modify `app/(dash)/(standard)/work/page.tsx`

- Root (`:239`) → `mx-auto w-full max-w-[1060px] px-2 sm:px-4 space-y-4 pb-16` plus `sk-page`. **Do not narrow the shared `<main>`** — Portfolio needs it wide, and Settings depends on it.
- Intro eyebrow (`:242`) → `text-[9px] font-bold tracking-[0.14em]`; title (`:243`) → `text-[clamp(26px,2.6vw,30px)] font-[650] leading-[1.1] tracking-[-0.035em]`, drop `font-serif`. Same for `components/work/add-action.tsx:148`.
- Summary cards (`:280-297`): gap, 5-column grid, active state and `aria-current="page"` are already correct. Count (`:292`) → `text-[23px] font-[650] leading-none tracking-[-0.02em]` without `font-serif`; label (`:293`) → `text-[10px] font-[650]`. Keep them as `<Link>` — real URLs with working back-button behaviour satisfy the spec's "preserve accessible button semantics" better than `<button>` would.
- View context row (`:300-306`): drop `font-serif` at `:302` → `text-[13px] font-[650]`; `bg-card2/70` → `bg-sk-surface-soft`; radius → 10px.

### Task 7: Payment run, project sections and the task table grid

**Files:** Modify `app/(dash)/(standard)/work/page.tsx`, `components/work/work-table-row.tsx`, `lib/i18n/en.json`, `lib/i18n/he.json`

- Payment run (`:336-348`): restructure the `<summary>` to `[36px | 1fr | auto | 20px]` and move the `approvedTotal` out of the `work.payment_run_sub` sub-line into its own right-hand cell. **New i18n key** `work.payment_open_total` = `"{total} open"` in **both** locales. Keep the native `<details>`/`<summary>` — it carries keyboard behaviour and `aria-expanded` for free. Radius → 10px.
- Project sections (`:378-427`): wrap header and table in one `<section className="rounded-[12px] border border-sk-salmon-border bg-sk-salmon-surface p-3.5">`; the inner table stays `bg-card`.
- Count badge (`:393-395`): today's `work.today_n` = `"{n} today"` has no noun and no plural form, so it renders "1 today". Add `work.tasks_today_one` / `work.tasks_today_other` to both locales — **Hebrew plural rules differ from English, so the Hebrew values are not a copy of the English ones** — and select on `groupTasks.length === 1`. Style as a salmon chip.
- Section header (`:385-392`): project name → `text-[13px] font-[650] leading-[1.25]`. Split the `font-mono` span so only `city_case` is monospace — the phase label is currently inside it, and the spec restricts Geist Mono to identifiers.
- **Column grid is defined twice and must stay in lockstep:** `page.tsx:398` (header row) and `work-table-row.tsx:58` (every row). Set both to `minmax(240px,2.2fr) minmax(130px,1.15fr) minmax(150px,1.25fr) minmax(70px,0.55fr) minmax(120px,0.9fr)`. Extract to a shared exported constant so they cannot drift again.
- Header bar `bg-card2/60` → `bg-sk-surface-header`.
- Mobile (spec section 15): below `lg` the grid collapses to one unlabelled column while the header row is `hidden`. Add `<span className="lg:hidden …">` labels inside each cell in `work-table-row.tsx:77-102`, sourced from the existing `work.col_*` i18n keys — never hardcoded English.
- Radii within the My Work scope: **6 / 10 / 14** (this page's spec differs from the others).

### Task 8: Status controls

**Files:** Modify `components/work/work-table-row.tsx`, `components/work/verb-menu.tsx`

- Today only a `Blocking` badge renders (`work-table-row.tsx:106-110`). The spec asks for Blocking, Verify, In Progress, With the City, Completed — **but `lib/types.ts:10` defines `TaskStatus = 'open' | 'done' | 'dropped'` and the page queries `.eq('status','open')`, so three of those have no data source and `Completed` is unreachable on this page.** See Decision D5.
- Implement only what is derivable: `Blocking` (`priority === 'critical'`), `Waiting` (`waiting_for` set), `Overdue`/`Urgent` (`due` vs `laToday()`, already at `:92-102`). Add a `statusBadge()` helper above `:56` using the salmon / amber / blue / green token pairs. **Every badge keeps a text label** — the spec forbids communicating status by colour alone, and live already complies.
- Update button (`verb-menu.tsx:74`) is currently an outlined pill; the spec wants a filled dark-green rectangle → `rounded-[6px] bg-sage text-white text-[9px] font-[650] px-2.5`. Keep `min-h-11 sm:min-h-0`, `aria-expanded` and `aria-haspopup`. Using the `.bg-sage` class rather than a literal hex matters: `app/globals.css:87-90` already fixes its dark-mode contrast.
- Details toggle (`:112-119`): add `border border-sage-line text-sage rounded-[6px]`. **Keep the visible "Details" text** — the reference's icon-only `content:"+"` version destroys the accessible name.
- Preserve `VerbMenu`'s Undo path (`verb-menu.tsx:28-33`) and `AddAction`'s duplicate-reconciliation dialog untouched.

---

## Phase 3 — Project Process

### Task 9: Switcher, intro, position card, phase rail, parallel notice

**Files:** Modify `app/(dash)/(standard)/projects/[id]/page.tsx`, `components/process/process-explorer.tsx`, `components/process/summary-editor.tsx`

| Spec requirement | Live state | Edit |
|---|---|---|
| Active switcher pill = pale-green fill + stronger green border; inactive = white + thin border | `page.tsx:129-145` — **inverted**: active is `bg-card` (white) with `shadow-card`, inactive is `bg-card2` | Swap the branches: active → `bg-sage-soft border-sage-line text-sage font-semibold`, inactive → `bg-card border-line text-ink2`. Drop the pill's `shadow-card`. Keep `min-h-11` only below `sm:`. Do not touch the `allProjects` filter or the hrefs. |
| Title in Geist | `page.tsx:153` `font-serif text-3xl sm:text-4xl` | → `text-[clamp(27px,3vw,32px)] font-[650] leading-[1.08] tracking-[-0.035em]`. Same for `process-explorer.tsx:114, 133, 261`. |
| Current Position card visible on mobile, beneath the project summary | `page.tsx:192-202` is `hidden … md:flex` — it **disappears below 768px**, contradicting the spec's own mobile section | Drop `hidden`/`md:flex`; let the flex-wrap parent stack it. Value → `text-[10px] font-[650]`, label → `text-[9px] tracking-[0.13em]`. Keep the `positionText` derivation (`:117-124`) — it is computed from real state. |
| Five phase cards in one horizontal row | `process-explorer.tsx:98-126` is `sm:grid-cols-3 lg:grid-cols-5` — two rows on tablet | → `sm:grid-cols-5`, keeping `overflow-x-auto` for mobile. Name `font-serif text-[15px]` → `text-[12px] font-[650]`; state line → `text-[8px]`; radius `rounded-[13px]` → `rounded-[10px]`. The bottom-strip state colours already match — keep them. |
| Parallel notice **below** the phase rail | **Wrong order** — the notice is at `page.tsx:205-213` but the rail lives inside `ProcessExplorer` (`:215`), so it currently renders above | Move the notice JSX into `process-explorer.tsx` between the `<ol>` and the workspace `<div>`. `ProcessExplorer` already knows `isParallel` per phase, so it can compute `phases.some(p => p.isParallel)` itself and needs only the two label strings passed through `labels`. |
| Notice styling: cream ground, circular directional icon | `bg-apricot-soft` + a bare `↔` span | → `bg-sk-cream border-sk-cream-border`, and wrap the `↔` in `h-8 w-8 rounded-full grid place-items-center`. |

### Task 10: Workspace, sub-stage list, detail panel, connected actions

**Files:** Modify `components/process/process-explorer.tsx`, `components/process/scenario-box.tsx`

- The joined workspace (`:130`) already has the spec's `minmax(0,1.08fr) minmax(0,0.92fr)` split, border, background and content-driven height. **Only** change `rounded-2xl` → `rounded-[15px]`.
- Sub-stage rows (`:146-177`): name → `text-[10px] font-[550]`, note → `text-[8px]`, radius → `rounded-[9px]`, default background → `bg-sk-surface-soft`. **Remove `truncate`** from the spans at `:164` and `:166` — the spec requires natural wrapping.
- Selected sub-stage panel (`:252-312`): the nine status buttons are `min-h-11 … text-xs`, which the spec says must not overpower the panel → `text-[8px] font-[650] px-2 py-1 rounded-[7px]` with `sm:min-h-0`. **Keep all nine and keep `aria-pressed`.**
- `scenario-box.tsx:46,115` → `bg-sk-cream border-sk-cream-border rounded-[10px]`.
- Connected actions empty state (`:322`) is currently a bare `<p>`; replace with the reference's dashed panel — `rounded-[9px] border border-dashed border-line bg-card px-4 py-4 text-center`.
- `tasks.slice(0, 4)` silently truncates while the spec forbids merging or dropping connected actions. Either raise the cap or add a visible "show all" affordance into `/work?view=all`. Do not leave a silent cap.
- `components/process/phase-column.tsx` and `substage-row.tsx` are **imported by no route**. Leave them alone in this pass; they are flagged for separate deletion.

---

## Phase 4 — Data Inbox

The nav label "Data inbox" points at `/upload` (`app/(dash)/layout.tsx:32`), so this page is `app/(focused)/upload/`.

### Task 11: Route-specific shell

**Files:** Create `components/chrome/data-inbox-header.tsx`; modify `app/(dash)/(focused)/upload/page.tsx`

- Render the spec's simplified bar: Hilla lockup left (reuse the markup from the standard layout), four centred links — Portfolio, Data Inbox, Invoices, Weekly Review — with the active one as a **dark-green bold link, not a pale-green pill**, and a compact outlined control on the right. **Do not reuse `NavLinks`**, whose active style is exactly the pill the spec rejects.
- Re-add the `#main` skip link, which today exists only in the standard layout.
- **Banner truthfulness.** The spec's "DEVELOPER CLONE" banner text claims no private storage is connected. **That is false for this app** — `app/api/upload/route.ts:52` writes to a real Supabase Storage bucket and every branch inserts live `documents` rows. The spec anticipates this and requires the copy be configurable rather than false. Drive the second line from an env label and default it to something accurate. For the same reason, the right-hand pill must not say "Reference mode"; use the real signed-in state instead.
- See Decision D4 for which global utilities the shell keeps.

### Task 12: Intake workspace

**Files:** Create `components/upload/intake-panel.tsx`; modify `app/(dash)/(focused)/upload/dropzone.tsx`, `components/upload/paste-update.tsx`

- The five "source" cards at `page.tsx:50-57` are **static `<article>`s with no state and no click handler** — decoration. Replace with four real tabs in a client `intake-panel.tsx` holding `useState<'email'|'meeting'|'document'|'sheet'|'text'>`, each `<button aria-pressed>`.
- **Only one intake surface renders at a time.** Today `PasteUpdate` sits permanently below the drop zone — the exact thing the spec forbids. Move it inside the panel, shown only when the text mode is selected, reachable from a compact "paste an update instead" action. `paste-update.tsx` needs **no logic change** — its action call, 12-character guard and `/inbox` link all stay; restyle only.
- Drop zone (`dropzone.tsx:41-65`) is one button whose only content is a status span, with copy that never varies. Give it a `source` prop and render icon, title, format list, a primary Choose-file button and a note. **Preserve verbatim**: `send(file)`, the `FormData` shape, the `fetch('/api/upload')` call, the drag handlers, `aria-busy` and `role="status"`.
- The project `<select>` passes project **names**, not ids, because the API reads `project_hint` as free text. Keep it that way; only relocate and shrink it.
- **Format copy must match what the API actually does.** Verified branches in `app/api/upload/route.ts`: PDF → invoice agent; XLSX/XLS → workbook import; CSV/TXT/DOCX → text to the comms agent; EML → parsed email; JSONL and ZIP/OLM → archives, storing all but agent-processing only the newest 10; **MP4 → stored and linked only, transcription explicitly not implemented**. `.doc`, `.mbox` and `.msg` have no branch and are not in `accept` — **do not list them**, even though the spec's example line does. Never describe MP4 as transcribed. State the real 20 MB cap and the single-file-per-request limit.
- Google Sheet mode: there is **no user-facing Sheet endpoint** — Sheets sync is cron-only, server-only, gated on service-account env vars and a `settings` row. Render an informational panel describing that and linking to `/settings`. **Do not ship a Sheet URL box that posts nowhere.**
- Disable the trigger while `state === 'busy'` — a second click currently fires a second upload. Do **not** add a progress percentage: the POST is a single `fetch` with no multipart endpoint behind it, so a percentage would be fake.

### Task 13: Workflow panel, processing queue and states

**Files:** Modify `app/(dash)/(focused)/upload/page.tsx`, `lib/i18n/en.json`, `lib/i18n/he.json`

- "What happens next" is `sm:grid-cols-5` (`:84-94`) — literally the five wide horizontal cards the spec forbids. Move it beside the intake panel as a vertical `<aside>` with numbered circles. The five step names exist; **the descriptions do not** — new keys in both locales.
- Queue (`:96-119`): restyle to the spec's five-column grid. `documents` has **no filename, size, status or uploader column**, and the spec forbids migrations here — so show what exists. A filename *is* recoverable from `storage_path` for the PDF and MP4 branches; elsewhere label the column honestly rather than inventing one.
- Statuses: only `Uploaded` and `Processed` are derivable today. Add **`Ready for review`** by joining pending `agent_proposals` on `document_id` — an additive query, no migration. **Do not fabricate `Processing`, `Permission required` or `Failed`** — the upload route is synchronous and never persists a failure row.
- The eyebrow must not read "EXAMPLE IMPORTS" — the queue is bound to real rows. Use "RECENT IMPORTS".
- Empty state is **missing entirely** — `:96` is `{docs.length > 0 && …}`, so zero documents renders nothing. Render the section unconditionally with an empty branch. New keys in both locales.
- Success state: `dropzone.tsx:61` confirms receipt but offers no next step. Add the next-step line and the `/inbox` link, copying the pattern `paste-update.tsx:73-76` already uses correctly.
- Call `router.refresh()` after a successful upload so the queue reflects it without a manual reload.

---

## Phase 5 — Invoices

### Task 14: Shell, financial header, summary card, view tabs

**Files:** Create `components/invoices/financial-header.tsx`; modify `app/(dash)/(focused)/invoices/page.tsx`; create `app/(dash)/(focused)/loading.tsx`

- Route-specific header: brand left, "Financial Control" centred, source label right. Use a three-column `1fr auto 1fr` grid — the spec requires centring **relative to the viewport**, which a `justify-between` flex row does not achieve. The source label must be derived, not hardcoded.
- Moving out of `(dash)` drops `app/(dash)/loading.tsx` coverage — add a focused-group `loading.tsx` with skeleton rows.
- Summary card (`:108-111`): today a plain `<p>`. Wrap in a dark-green card using `--sk-green-dark`, white total, pale count, `font-variant-numeric: tabular-nums`. Keep the `openTotal` / `openInvoices.length` derivation exactly.
- `money()` uses `maximumFractionDigits: 0`, dropping cents everywhere. The spec requires decimals preserved on row amounts — add a second formatter for rows and leave the headline card rounded.
- View tabs (`:95-135`): render All Invoices and Payment Summary as primary; demote `david` into a secondary menu. **Keep the `?tab=david` URL working** — the spec forbids deleting secondary views.
- Waiting-on banner (`:114-121`) is the full-width amber banner the spec explicitly rejects. Demote to a compact line. Keep the bidi FSI/PDI wrapping — Hebrew RTL depends on it.
- Drop `font-serif` from the `<h1>` (`:106`) and add `sk-page` to the root.

### Task 15: Filters, table, row actions, status badges

**Files:** Modify `components/invoices/filter-bar.tsx`, `components/invoices/status-chain.tsx`, `components/invoices/link-editor.tsx`, `app/(dash)/(focused)/invoices/page.tsx`

- Vendor quick filters (`:137-161`) already have counts and `aria-current`; restyle active from near-black to `bg-sk-green-soft text-sk-green`. Live renders **every** vendor — add a cap plus a "more vendors" affordance.
- `filter-bar.tsx` is a permanently open toolbar. Wrap it in a disclosure collapsed by default, showing the count of active filters, and add a reset that clears the six filter keys but **not** `tab`. **Do not touch** `set()` or the `router.replace` call — filtering logic and URL persistence must be preserved.
- Table: keep the semantic `<table>` (the spec asks to preserve table semantics) and add a `<colgroup>` carrying `minmax(180px,1.5fr) minmax(155px,1.25fr) minmax(135px,1.1fr) minmax(95px,0.75fr) minmax(85px,0.7fr) minmax(95px,0.75fr)`. **Do not** convert to the reference's `display:grid` divs.
- Column 4 is labelled "Date" and renders `received_date ?? invoice_date`; the spec calls it "Due". **`invoices.due` is nullable and no live code ever writes it** — so either relabel the column honestly or render `due` and accept it empty. Do not synthesise a due date. Same reasoning kills a working Overdue badge for now (Decision D6).
- Row actions (`:204-241`) are three identical underlined links plus a bare `✎`. Make Open invoice a green text link and turn the LinkEditor trigger into a labelled **Update** button. Keep the `aria-label` that includes row context — it is the only thing distinguishing rows for screen readers. Do not make the `<tr>` clickable.
- Status badges: replace the dot rail with compact badges — `received` → amber-soft, `for_rowan_approval` → cream (this is the spec's "Waiting"), `approved` → green-soft, `paid` → stronger green plus the paid date, `on_hold` → salmon. **Every badge keeps its text label.** `on_hold` currently has no advance control and is terminal in the UI — preserve that or invoices become unrecoverable.

### Task 16: Payment Summary and error states

**Files:** Create `components/invoices/payment-summary.tsx`; create `app/(dash)/(focused)/error.tsx`; modify `app/(dash)/(focused)/invoices/page.tsx`

- Build a **derived** summary — totals, open count, amount waiting per person, vendor totals, project totals, status breakdown — as read-only aggregation over the same rows. It must be **additive**: the existing `?tab=payment_summary` row set must keep rendering, or workbook rows silently disappear.
- **Error handling is a real functional gap:** `page.tsx:28-30` does `(invoicesQ.data ?? []) as Invoice[]` and never reads `invoicesQ.error`, so a Supabase failure renders an empty table indistinguishable from "no invoices". Surface the error and add a retry. The spec is explicit: do not hide financial-data failures.
- Empty state: add the reset action from Task 15.
- Add a success confirmation after an update. Undo is **new** behaviour here, not preservation — treat it as optional scope.

---

## Phase 6 — Weekly Review

### Task 17: Shell, header, mode, intro, workflow strip

**Files:** Create `components/weekly/weekly-header.tsx`; modify `app/(dash)/(focused)/weekly/page.tsx`, `components/weekly/review-board.tsx`, both i18n files

- Lift the Sunday/Monday toggle out of the page body (`review-board.tsx:38-47`) into the route header as a segmented control; keep `aria-pressed`.
- **The mode is currently `useState(false)` — client-only, lost on refresh, invisible to the server.** The spec requires it come from application state. Promote it to a URL param (`?mode=draft|meeting`) or a cookie. **Do not add a `mode` column** — the spec forbids schema changes for visual work.
- Intro: eyebrow "WEEKLY TEAM REVIEW", title "Monday Project Meeting", plus a dark-green progress card carrying the existing `{done}/{total}` derivation. Copy changes to `weekly.title` and `weekly.sub` land in **both** locales.
- Mode context banner: new, cream for Sunday and `--sk-blue-soft` for Monday. Cheapest implementation is the reference's own mechanism — one class on the page root flips the palette. New keys in both locales.
- Workflow strip (`:57-66`): the copy is already correct; add numbered circles, connectors, and an active state derived from the mode. No new strings.
- Drop `font-serif` at `page.tsx:42` and `review-board.tsx:51`.

### Task 18: The review document

**Files:** Modify `components/weekly/review-board.tsx`, `app/(dash)/(focused)/weekly/page.tsx`, both i18n files

- **Accordion behaviour is the forbidden pattern:** `useState<string|null>(groups[0]?.projectName)` opens exactly one project. The spec requires all expanded by default and multiple open simultaneously → `useState<Set<string>>` seeded with every project name. Note this **reverses an earlier documented spec decision** cited in the code comment at `:17-20`; see Decision D7.
- **Dead prop:** `:100` reads `labels.subTopic`, which `page.tsx` never passes — so the spec-required "SUB-TOPIC" eyebrow silently never renders. Pass it. It is a **new** string in both locales, not an existing one being restyled.
- `weekly.actions_n` = `"{n} actions"` renders "1 actions". Add a singular key in both locales.
- **Completed actions are hidden** behind `<details>` (`:118-129`) while the spec requires every action displayed. Render one flat list with a completed visual treatment instead of hiding. Give every action a sequence badge from a **single continuous counter** — today two independent counters both start at 1, and the badge only renders when `carried_from` is set.
- Action card → the spec's `34px minmax(0,1fr) 120px 210px` grid at `sm:` and up, keeping the mobile stack.
- **The weekly note is an `<input>` — single line.** The spec is explicit that long meeting notes must not be forced onto one line → `<textarea rows={2}>`, preserving `defaultValue` and the `onBlur` save contract.
- General section must render **last**; `buildGroups` currently emits it in first-encountered order, so sort it to the end.
- Add the missing "no sub-topics" and "no actions" empty states, both locales.
- Keep the seventh status option (`dropped` / Not applicable) — the spec's list of six does not license removing a real one.

### Task 19: Save, persistence and the upload card

**Files:** Modify `components/weekly/review-board.tsx`, `app/actions/weekly.ts`

- **Monday is read-only today** (`:23,25` `readOnly = saved || present`) and Save plus the upload card vanish entirely (`:68`). The spec requires live status and note updates in Monday mode, and Save Review available. Remove `present` from `readOnly` and drop the `!present` guard. This is a **behaviour change, not a restyle** — see Decision D7.
- Save copy must describe what actually happens: fields autosave individually, and Save Review is a checkpoint. Do not describe it vaguely.
- Upload card: make the eyebrow mode-dependent; the accept list is `.mp4,.txt,.docx` — **do not add M4A or Teams**, which are not supported.
- Save errors currently discard the real message and render a generic string in all five handlers. Surface the actual error; the button stays enabled, so retry already works. Add a `role="status"` success confirmation.
- Preserve `attachRecording`, the `agent_proposals` review path and `logActivity` exactly — the spec forbids bypassing the State Writer.

---

## Phase 7 — "תיקונים נעה" corrections

**Full defect catalogue: `2026-08-24-noa-corrections-analysis.md`.** Read it before starting; it carries the verbatim Hebrew, the translations, and the file-and-line root cause for every item.

This phase is **functional and data work, not styling**. It needs migrations (`0009` onward) and thirteen data-cleanup passes. The "no schema changes" rule from Phases 1-6 is scoped to purely visual work and does not apply here.

**Bundle the UI half with the matching visual phase** — Weekly Review items land in the same two files as Phase 6, and Invoices items in the same files as Phase 5. Doing them separately means rewriting the same JSX twice. The server-side half (`lib/weekly.ts`, `lib/dedup.ts`, `lib/import/tracker.ts`, `lib/parse/xlsx.ts`, `app/actions/*`) is standalone and testable.

Suggested task order, because the dependencies are real:

1. **Task 20 — Dedup root cause.** `lib/dedup.ts:43` and `app/actions/tasks.ts:72` both skip candidates from other projects, which is why a San Marco task and its General twin are never compared. This single line is the cause of all eleven duplicate groups. Extend matching to the spec's six signals. `lib/dedup.test.ts` already exists — add failing cases first.
2. **Task 21 — Merge / Master Action.** New state on `tasks`, transfer of evidence and history, undo, and "Keep both and link them" in the Review Inbox using the unused `relationships` table. Migration required.
3. **Task 22 — Data cleanup D1/D2** using the merge feature. Never hand-fix in SQL — history would be lost.
4. **Task 23 — Weekly review selection logic.** Active-project filter, changed-this-week filter, include/remove, carry-forward status gate, and the inverted completed-task rules in `lib/weekly.ts:31-55`. `lib/weekly.test.ts` exists — extend it.
5. **Task 24 — Weekly write-through.** `setItemSnapshot` never touches `tasks`, which is the source of "three different statuses on three screens".
6. **Task 25 — Invoice import correctness.** Vendor normalisation, the dedup key, the On Hold status mapping, the invoice-link column, and the fabricated paid dates. All four are import bugs that keep producing bad rows.
7. **Task 26 — Invoice UI.** Full-field edit form with audit, Payment Summary as a real view, add-invoice with duplicate check.
8. **Task 27 — Data cleanup D3-D13**, in the documented order: D6 before D4, D1/D2 before D13.

**Do not run Prepare Review for real use until Tasks 23-24 and the D-series cleanup are complete** — the spec says so explicitly, and re-preparing early regenerates the duplicates.

---

## How to execute this plan

Tasks 1-3 are written as bite-sized steps with the exact code, because they are shared foundation and one mistake there reaches every page. Tasks 4-19 are specified at **file-and-edit level** rather than as micro-steps: visual work has no meaningful unit test, so the deliverable per task is the named edits plus the standard gate and a browser check. Phase 7 returns to test-first, because it is logic — the existing suites (`lib/dedup.test.ts`, `lib/weekly.test.ts`) are the place to add failing cases before fixing.

Work is committed **directly to `main`** for this project, one commit per task, per Dor's instruction for this piece of work.

Two execution options:

1. **Subagent-driven (recommended)** — a fresh subagent per task with review between tasks. Suits this plan because the page phases are independent once Phase 0 lands.
2. **Inline** — execute in-session with checkpoints after each phase.

---

## Open decisions for Dor

**D1 — Header restyle reaches More pages.** The Portfolio spec wants a "taller, cleaner header", but `07-more-preserve.md` says *"Do not modify the Header appearance or behavior on More pages as part of the current redesign work."* It is one shared component, so both cannot hold literally. Recommendation: apply the restyle globally and keep the header's **contents** frozen, since the same document also insists More pages "must continue to show the existing standard Header" — forking a second header for More would contradict that more seriously than a few pixels of height. Needs Noa's sign-off.

**D2 — Serif removal is page-scoped, not global.** `font-serif` appears in 33 files. The six redesigned pages lose it per spec; More pages and `/login` keep it. The consequence is a deliberate typographic split across the app — Geist on redesigned pages, Georgia display type on More. Confirm that is acceptable rather than a bug.

**D3 — The type scale goes below readable, and the reference itself walked it back.** The page specs call for 7px column headings and status badges and 8px metadata. The reference applies no root scaling, so these are literal pixel sizes — and its own `management.css` ends with a block headed *"Readability pass: explanatory copy should never require squinting"* that overrides those exact selectors back **up** to 10-12px with `!important`. The specs also contradict themselves, saying "Do not reduce body text below readable sizes merely to fit more content". This is not a WCAG failure on its own (2.2 has no minimum font size, only resize-to-200%, which still works), but 7px is not usable. Recommendation: implement the *hierarchy ratios* faithfully with a floor of 10px for anything decision-relevant and 9px for uppercase eyebrows — roughly where live already sits — and report the deviation, which the spec's own validation section asks for.

**D4 — Which global utilities survive on the three focused pages.** The Data Inbox, Invoices and Weekly Review specs each list the notification bell, language selector, theme control and Sign out under "Hidden global controls". The preamble separately says "Preserve and visually integrate the existing notification bell, language control, theme control and Sign out", but that bullet sits inside the **Portfolio** header section, so the documents are reconcilable: the standard header keeps everything, the three focused shells are leaner. The practical problem is specific to this app and absent from the reference, which has neither dark mode nor a second locale: theme and `dir` come from cookies set on `<html>`, so a user who is in dark mode or Hebrew and lands on `/invoices` has **no control on that page to get back out**. Recommendation: hide nav, bell and More as specified; keep the locale and theme controls as two quiet icon buttons in the focused headers' right cluster; keep Sign out reachable via the brand link home. Needs Noa's sign-off — the strict reading is total removal, which is only safe once every `--sk-*` token has a dark value (Task 1 does that).

**D5 — Three of My Work's five status badges have no data behind them.** The spec asks for Blocking, Verify, In Progress, With the City and Completed. Live has `TaskStatus = 'open' | 'done' | 'dropped'` and the page queries `.eq('status','open')`, so Completed can never appear here and Verify and In Progress have no source at all; those labels exist only in the reference's in-memory demo type. The spec also forbids schema changes. Recommendation: ship only the derivable badges (Blocking, Waiting, Overdue/Urgent) and report the rest as unmatched rather than inventing a mapping. If Noa wants the full set, it is a schema conversation, not a styling one.

**D6 — Two invoice statuses would require a migration, and the Due column is empty.** The spec's status list includes `Processing` and `Rejected`; the live `invoice_status` enum has only `received`, `for_rowan_approval`, `approved`, `paid`, `on_hold`, and the same spec says "Do not change database schema". Nothing satisfies both. Recommendation: treat the list as a **palette** specification, map the five real values to the spec's colour treatments, and report `Processing` and `Rejected` as unmatched. Separately, `invoices.due` is nullable and **no live code ever writes it**, so the spec's Due column and Overdue behaviour would render permanently empty — decide whether to relabel the column or backfill the data.

**D7 — Two Weekly Review requirements reverse earlier deliberate decisions.** The spec requires all project sections expanded with multiple open at once; the code comment at `components/weekly/review-board.tsx:17-20` cites an earlier spec saying only one opens at a time. The spec also requires Monday Presentation to stay editable with Save available; live deliberately makes it read-only. Both are behaviour changes, not restyles, and the second interacts with the fact that `Save Review` currently freezes the board permanently. Needs product sign-off before Task 18/19.

**D8 — "תיקונים נעה" is not a small task.** It was described as the small related one, but it is a functional and data-integrity backlog: new merge logic, corrected import parsing, at least one migration, and thirteen separate cleanup passes over live Supabase rows — including the finding that **every imported Paid invoice currently carries a fabricated payment date** and that the empty Payment Summary is caused by a hard-coded column at import time, not by a filter. Some items (the SNO Solutions duplicates) are duplicated in the source workbook itself and **no code change can decide them** — Noa has to adjudicate. Recommendation: schedule Phase 7 as its own block of work rather than as an add-on to the visual pass, and confirm the source workbook before touching the date mapping.

