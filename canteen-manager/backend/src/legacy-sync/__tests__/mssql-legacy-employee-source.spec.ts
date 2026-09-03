import { mapLegacyRow, RawRow } from '../mssql-legacy-employee-source';
import { DetentionStatus } from '../../users/user.entity';

// Pure mapping from a raw legacy SQL row to a canonical LegacyEmployee. Exercised here without
// a live MSSQL connection so the coercion + detention-status validation are locked down.
function makeRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    legacyId: 'E1',
    name: 'Alice',
    zone: 'Khu A1',
    cell: 'Buồng 1',
    isActive: 1,
    dateOfBirth: null,
    hometown: null,
    offense: null,
    arrestDate: null,
    detentionStatus: null,
    ...overrides,
  };
}

describe('mapLegacyRow — detainee profile fields', () => {
  it('maps all-NULL extras to null (stock DEFAULT_QUERY shape)', () => {
    const emp = mapLegacyRow(makeRow());
    expect(emp.dateOfBirth).toBeNull();
    expect(emp.hometown).toBeNull();
    expect(emp.offense).toBeNull();
    expect(emp.arrestDate).toBeNull();
    expect(emp.detentionStatus).toBeNull();
  });

  it('passes date and text fields through as strings', () => {
    const emp = mapLegacyRow(
      makeRow({
        dateOfBirth: '1990-05-12',
        hometown: 'Hà Nội',
        offense: 'Trộm cắp tài sản',
        arrestDate: '2022-01-03',
      }),
    );
    expect(emp.dateOfBirth).toBe('1990-05-12');
    expect(emp.hometown).toBe('Hà Nội');
    expect(emp.offense).toBe('Trộm cắp tài sản');
    expect(emp.arrestDate).toBe('2022-01-03');
  });

  it.each([
    ['temporary_hold', DetentionStatus.TEMPORARY_HOLD],
    ['pre_trial_detention', DetentionStatus.PRE_TRIAL_DETENTION],
    ['convicted', DetentionStatus.CONVICTED],
  ])('maps valid status %s to the enum', (raw, expected) => {
    expect(mapLegacyRow(makeRow({ detentionStatus: raw })).detentionStatus).toBe(expected);
  });

  it('maps an unknown/garbage status to null (never throws)', () => {
    expect(mapLegacyRow(makeRow({ detentionStatus: 'released' })).detentionStatus).toBeNull();
    expect(mapLegacyRow(makeRow({ detentionStatus: 42 })).detentionStatus).toBeNull();
    expect(mapLegacyRow(makeRow({ detentionStatus: '' })).detentionStatus).toBeNull();
  });

  it('still maps the existing canonical columns', () => {
    const emp = mapLegacyRow(makeRow({ legacyId: 'E9', name: 'Bob', zone: null, cell: null, isActive: 0 }));
    expect(emp).toMatchObject({ legacyId: 'E9', name: 'Bob', zone: null, cell: null, isActive: false });
  });
});
