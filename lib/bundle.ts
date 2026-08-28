// A meeting often produces TWO complementary files: a curated summary
// (short, decisions and asks) and the raw spoken transcript (long, carries
// owners, dates, amounts, timeline estimates and the verbatim quotes the
// agent needs as evidence). Uploaded together they are ONE communication —
// this merges them so extract-comms runs once over both.

export const BUNDLE_SUMMARY_MARK = '=== MEETING SUMMARY (curated) ===';
export const BUNDLE_TRANSCRIPT_MARK = '=== FULL TRANSCRIPT (raw, spoken) ===';

export interface BundlePart {
  name: string;
  text: string;
}

/** Which of the two files is the curated summary? The summary is reliably
 *  the far shorter one (5K vs 41K for the Aug 24 pair). Name hints break the
 *  tie when lengths are close. */
export function orderBundle(a: BundlePart, b: BundlePart): { summary: BundlePart; transcript: BundlePart } {
  const looksSummary = (p: BundlePart) => /summary|סיכום/i.test(p.name);
  const looksTranscript = (p: BundlePart) => /transcript|recording|meeting recording|תמלול/i.test(p.name);
  if (looksSummary(a) && !looksSummary(b)) return { summary: a, transcript: b };
  if (looksSummary(b) && !looksSummary(a)) return { summary: b, transcript: a };
  if (looksTranscript(a) && !looksTranscript(b)) return { summary: b, transcript: a };
  if (looksTranscript(b) && !looksTranscript(a)) return { summary: a, transcript: b };
  return a.text.length <= b.text.length
    ? { summary: a, transcript: b }
    : { summary: b, transcript: a };
}

export function bundleCommunication(a: BundlePart, b: BundlePart): string {
  const { summary, transcript } = orderBundle(a, b);
  return [
    `${BUNDLE_SUMMARY_MARK} ${summary.name}`,
    '',
    summary.text.trim(),
    '',
    `${BUNDLE_TRANSCRIPT_MARK} ${transcript.name}`,
    '',
    transcript.text.trim(),
    '',
  ].join('\n');
}

/** Files the bundle path accepts. PDFs count: real summary emails arrive as
 *  PDF exports (the Aug-3 pair) — the route extracts their text via
 *  lib/pdf.ts. A single PDF on its own still goes to the invoice agent. */
export function isBundleableName(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith('.txt') || n.endsWith('.docx') || n.endsWith('.pdf');
}
