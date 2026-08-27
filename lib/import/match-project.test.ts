import { describe, expect, test } from 'vitest';
import { matchProject } from './tracker';

// The five real projects, exactly as the projects table spells them.
const projects = [
  { id: 'sm', name: '2361-2367 San Marco' },
  { id: 'rin', name: '2650 Rinconia' },
  { id: 'blair', name: '3375 Blair Dr' },
  { id: 'am', name: '3701 Alta Mesa' },
  { id: 'flicker', name: '9268-9270 Flicker Way' },
];

describe('matchProject', () => {
  test("matches the tracker's Property strings, street suffix and all", () => {
    expect(matchProject('3701 Alta Mesa Dr', projects)).toBe('am');
    expect(matchProject('2361-2367 San Marco Dr', projects)).toBe('sm');
    expect(matchProject('3375 Blair Dr', projects)).toBe('blair');
    expect(matchProject('9268-9270 Flicker Way', projects)).toBe('flicker');
  });

  test('a house-number RANGE on one side still matches the shortened form ("2650-2656 Rinconia Dr")', () => {
    // The audit case: every Rinconia invoice imported project-less because
    // "2650-2656 rinconia dr" contains neither "2650 rinconia" nor its
    // alphanumeric collapse.
    expect(matchProject('2650-2656 Rinconia Dr', projects)).toBe('rin');
  });

  test('a bare neighborhood name still resolves (tracker task rows write "Blair")', () => {
    expect(matchProject('Blair', projects)).toBe('blair');
  });

  test('the LEADING house number still disambiguates two properties on the same street', () => {
    // 3941 Alta Mesa Dr is a real, different property (tracker Lists sheet) —
    // it must not silently attach to the 3701 project.
    expect(matchProject('3941 Alta Mesa Dr', projects)).toBeNull();
  });

  test('"All" and blank mean no project', () => {
    expect(matchProject('All', projects)).toBeNull();
    expect(matchProject(null, projects)).toBeNull();
  });
});
