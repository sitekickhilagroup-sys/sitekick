// Deterministic (non-model) project matching against raw communication text —
// a literal case-number/address/name substring check, computed in plain JS
// before any Anthropic call. Shared by agents/extract-comms.ts (narrows the
// OPEN TASKS list to a single identified project) and lib/preflight.ts (the
// Demo Safety Gate's Data Inbox triage) so both features use exactly the
// same signal — a document extract-comms would narrow for is the same
// document preflight calls a "candidate."

export interface ProjectMatchCandidate {
  id: string;
  name: string;
  city_case?: string | null;
  address?: string | null;
}

function shortName(name: string): string {
  // Project names in this codebase are address-led ("2361-2367 San Marco"),
  // but a communication usually names the property by its short, colloquial
  // label alone ("San Marco first", "Oakdell — framing bids?"). Stripping a
  // leading street-number prefix gives that label as an extra literal
  // signal, alongside the full name, case number, and address.
  return name.replace(/^[\d][\d\s\-–—/]*/, '').trim();
}

/** Every project whose case number, address, full name, or short name
 *  appears as a literal substring of `rawText`. Order matches `projects`;
 *  a project can appear at most once. */
export function matchingProjectIds(rawText: string, projects: ProjectMatchCandidate[]): string[] {
  const text = rawText.toLowerCase();
  const matched: string[] = [];
  for (const p of projects) {
    const signals = [p.city_case, p.address, p.name, shortName(p.name)]
      .filter((s): s is string => !!s && s.trim().length >= 3);
    if (signals.some((s) => text.includes(s.toLowerCase()))) matched.push(p.id);
  }
  return matched;
}

/** Single-project identification: exactly one match, or null (0 or 2+ —
 *  both are "not confidently identified," collapsed the same way here since
 *  extract-comms only needs a safe yes/no; callers that need to distinguish
 *  "ambiguous" from "no evidence" should use matchingProjectIds directly —
 *  see lib/preflight.ts. */
export function identifyDeterministicProject(rawText: string, projects: ProjectMatchCandidate[]): string | null {
  const matches = matchingProjectIds(rawText, projects);
  return matches.length === 1 ? matches[0] : null;
}
