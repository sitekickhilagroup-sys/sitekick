import { describe, expect, it } from 'vitest';
import { vendorKey } from './tracker';

// Every pair below is a vendor the invoice audit found sitting in the database
// twice, because `vendors.name` is unique on the exact string.
describe('vendorKey', () => {
  it('collapses ampersand spacing', () => {
    expect(vendorKey('Thang Le & Associates')).toBe(vendorKey('Thang le& Associates'));
  });

  it('collapses hyphen versus space', () => {
    expect(vendorKey('Grover Hollingsworth')).toBe(vendorKey('Grover-Hollingsworth'));
  });

  it('collapses a missing period', () => {
    expect(vendorKey('A.G.I Geotechnical')).toBe(vendorKey('A.G.I. Geotechnical'));
  });

  it('collapses a trailing corporate suffix', () => {
    expect(vendorKey('PREMISE')).toBe(vendorKey('PREMISE LLC'));
    expect(vendorKey('Crest Real Estate')).toBe(vendorKey('Crest Real Estate LLC'));
  });

  it('is case insensitive', () => {
    expect(vendorKey('SNO SOLUTIONS')).toBe(vendorKey('Sno Solutions'));
  });

  it('still separates genuinely different vendors', () => {
    expect(vendorKey('Grover Hollingsworth')).not.toBe(vendorKey('Thang Le'));
    expect(vendorKey('A.G.I Geotechnical')).not.toBe(vendorKey('AGI Structural'));
  });

  it('returns an empty key for a name with no identifying characters', () => {
    expect(vendorKey('   ')).toBe('');
    expect(vendorKey('LLC')).toBe('');
  });
});
