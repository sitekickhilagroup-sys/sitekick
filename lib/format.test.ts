import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime } from './format.ts';

describe('fmtDate', () => {
  it('renders ISO dates as MM/DD/YY', () => {
    expect(fmtDate('2026-08-28')).toBe('08/28/26');
  });
  it('takes the date part of a full timestamp', () => {
    expect(fmtDate('2026-08-28T21:01:24.198705+00')).toBe('08/28/26');
  });
  it('passes non-dates through and blanks empties', () => {
    expect(fmtDate('—')).toBe('—');
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
  });
});

describe('fmtDateTime', () => {
  it('keeps the time part for audit rows', () => {
    expect(fmtDateTime('2026-08-28 14:05')).toBe('08/28/26 14:05');
    expect(fmtDateTime('2026-08-28T14:05:33Z')).toBe('08/28/26 14:05');
  });
  it('falls back to fmtDate without a time part', () => {
    expect(fmtDateTime('2026-08-28')).toBe('08/28/26');
  });
});
