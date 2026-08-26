import { describe, expect, test } from 'vitest';
import { laDateTime } from './date.ts';

describe('laDateTime', () => {
  test('formats a UTC instant as LA-local YYYY-MM-DD HH:mm', () => {
    // 2026-03-17T18:05:00Z is 11:05 PT (UTC-7, PDT already in effect in March).
    expect(laDateTime('2026-03-17T18:05:00Z')).toBe('2026-03-17 11:05');
  });

  test('crosses the calendar-day boundary correctly (late UTC evening = next-day-blank PT morning)', () => {
    // 2026-01-15T07:30:00Z is 2026-01-14 23:30 PT (UTC-8, PST in January) —
    // the exact "rolls to tomorrow in UTC" trap laToday()'s own comment warns
    // about, checked here in the other direction (UTC date ahead of LA date).
    expect(laDateTime('2026-01-15T07:30:00Z')).toBe('2026-01-14 23:30');
  });

  test('zero-pads single-digit month/day/hour/minute', () => {
    expect(laDateTime('2026-01-05T09:03:00Z')).toBe('2026-01-05 01:03');
  });
});
