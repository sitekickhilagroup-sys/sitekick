# Sitekick Design System

## Design direction

Sitekick should feel calm, precise, trustworthy and contemporary. It is an operational system for complex project information, not a marketing site. The visual system should reduce cognitive load, make hierarchy obvious and reserve strong color for meaning.

## Typography

### Primary family

Geist Sans

Use for navigation, headings, body copy, tasks, buttons, statuses and explanations. It replaces the previous Arial and Georgia combination with one consistent modern family.

### Data family

Geist Mono

Use only for case numbers, permit numbers, action IDs, dates when tabular alignment matters, version numbers and code examples.

### Hierarchy

- Display heading: 40px, weight 650, line-height 1.1, letter-spacing -0.035em.
- Page heading: 32px, weight 650, line-height 1.15, letter-spacing -0.025em.
- Section heading: 24px, weight 650, line-height 1.2.
- Card heading: 15px, weight 650, line-height 1.35.
- Body: 14px, weight 400, line-height 1.5.
- Supporting explanation: minimum 12px, line-height 1.45.
- Metadata and labels: minimum 11px, weight 650-750, letter-spacing up to 0.08em.
- Never use explanatory text below 11px.

## Core palette

### Foundation

- Ink: `#16221F` - primary text and high-emphasis content.
- Muted: `#71807B` - supporting text and metadata.
- Line: `#DFE5DF` - borders and separators.
- Paper: `#FBFBF7` - application background.
- Surface: `#FFFFFF` - cards, rows and active work surfaces.
- Deep Surface: `#172923` - intelligence and developer panels.

### Semantic green

- Primary Green: `#316C5B` - primary actions, active phase and trusted progress.
- Soft Green: `#DCEBE4` - completed states, selected filters and low-intensity success.

### Attention amber

- Amber: `#A96725` - verify, conditional state and attention without hard blocking.
- Soft Amber: `#FFF3DE` - amber background.
- Insight Gold: `#D9B578` - intelligence highlights on dark surfaces.

### Blocking red

- Red: `#A3483F` - true blockers and critical risk only.
- Soft Red: `#FBE8E5` - blocker background.

### External waiting blue

- Blue: `#416B84` - City, agency or consultant waiting states.
- Soft Blue: `#EAF2F7` - external waiting background.

## Semantic rules

- Green means progress, completion, selection or an enabled primary action.
- Red means a verified blocker. Do not use it for general urgency.
- Amber means Verify, conditional or a decision is needed.
- Blue means waiting on an external party.
- Gray means neutral, upcoming, unavailable or unknown.
- Never encode meaning with color alone. Always pair color with a text label or icon.

## Layout and spacing

- Base spacing unit: 4px.
- Standard gaps: 8px, 12px, 16px, 24px and 32px.
- Card radius: 12-18px depending on hierarchy.
- Button radius: 8-18px depending on control type.
- Keep action rows compact but never sacrifice legibility.
- Use progressive disclosure with `+` for explanations and context.
- My Work favors density and direct Update controls.
- Portfolio favors whitespace and project-level understanding.
- Project Process favors hierarchy and connected context.
- Invoices favors exact tabular data, visible Update controls and a permanent main-navigation entry.
- Weekly Review favors Project > Sub-topic > Action hierarchy with current status and notes.
- Developer Handoff exposes the implementation guide, full specification, agent manual, design system, seed contract and continuation brief.

## Accessibility

- Body and explanatory text must meet WCAG AA contrast.
- Interactive controls need visible focus states.
- Minimum touch target: 32px in dense desktop tables, 44px on mobile.
- Do not rely on hover to reveal required actions.
- Status must always be readable as text.
