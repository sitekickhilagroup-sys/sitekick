import { describe, expect, it } from 'vitest';
import { matchingProjectIds, identifyDeterministicProject } from './project-match';

const projects = [
  { id: 'p1', name: '2361-2367 San Marco', city_case: 'ENV-2024-0011', address: '2361 San Marco Ave' },
  { id: 'p2', name: '2650 Rinconia', city_case: 'ENV-2024-0022', address: '2650 Rinconia Dr' },
];

describe('matchingProjectIds', () => {
  it('returns a single id when exactly one project matches', () => {
    expect(matchingProjectIds('Re: case ENV-2024-0011, corrections list', projects)).toEqual(['p1']);
  });

  it('returns both ids when two projects match (ambiguous) — the distinction identifyDeterministicProject collapses to null', () => {
    expect(matchingProjectIds('San Marco and Rinconia both had updates', projects)).toEqual(['p1', 'p2']);
  });

  it('returns an empty array when no project matches', () => {
    expect(matchingProjectIds('General admin: renew the corporate insurance policy', projects)).toEqual([]);
  });

  it('matches by short (address-prefix-stripped) name', () => {
    expect(matchingProjectIds("Let's run through San Marco first", projects)).toEqual(['p1']);
  });
});

describe('identifyDeterministicProject', () => {
  it('collapses zero matches to null', () => {
    expect(identifyDeterministicProject('nothing relevant here', projects)).toBeNull();
  });
  it('collapses two-or-more matches to null (ambiguous)', () => {
    expect(identifyDeterministicProject('San Marco and Rinconia both had updates', projects)).toBeNull();
  });
  it('returns the id for exactly one match', () => {
    expect(identifyDeterministicProject('Notes for 2650 Rinconia Dr', projects)).toBe('p2');
  });
});
