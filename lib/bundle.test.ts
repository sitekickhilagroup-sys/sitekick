import { describe, expect, it } from 'vitest';
import { bundleCommunication, isBundleableName, orderBundle, BUNDLE_SUMMARY_MARK, BUNDLE_TRANSCRIPT_MARK } from './bundle.ts';

const short = { name: 'August_24_2026_Internal_Meeting_Summary.docx', text: 'BLAIR\nPlanning submittal is scheduled.' };
const long = { name: 'Weekly LA Team Meeting (10).docx', text: 'Noa Meir 0:30 Hello?\n'.repeat(50) };

describe('orderBundle', () => {
  it('name hints win: "Summary" is the summary even when order is reversed', () => {
    expect(orderBundle(long, short).summary.name).toBe(short.name);
    expect(orderBundle(short, long).summary.name).toBe(short.name);
  });
  it('falls back to length when names carry no hint', () => {
    const a = { name: 'a.docx', text: 'tiny' };
    const b = { name: 'b.docx', text: 'x'.repeat(500) };
    expect(orderBundle(b, a).summary.name).toBe('a.docx');
  });
  it('"Meeting Recording" in the name marks the transcript side', () => {
    const rec = { name: 'Weekly-20260824-Meeting Recording.docx', text: 'short but raw' };
    const sum = { name: 'notes.docx', text: 'a much longer curated text than the recording side here' };
    expect(orderBundle(rec, sum).transcript.name).toBe(rec.name);
  });
});

describe('bundleCommunication', () => {
  it('emits summary first, transcript second, with both markers and names', () => {
    const merged = bundleCommunication(long, short);
    const sumAt = merged.indexOf(BUNDLE_SUMMARY_MARK);
    const traAt = merged.indexOf(BUNDLE_TRANSCRIPT_MARK);
    expect(sumAt).toBeGreaterThanOrEqual(0);
    expect(traAt).toBeGreaterThan(sumAt);
    expect(merged).toContain(short.name);
    expect(merged).toContain('Planning submittal is scheduled.');
  });
});

describe('isBundleableName', () => {
  it('accepts transcript text formats only', () => {
    expect(isBundleableName('a.TXT')).toBe(true);
    expect(isBundleableName('b.docx')).toBe(true);
    expect(isBundleableName('c.pdf')).toBe(false);
    expect(isBundleableName('d.xlsx')).toBe(false);
  });
});
