import { describe, it, expect } from 'vitest';
import { resources, NAMESPACES } from './locales';

// Recursively flatten all leaf string values from a nested object.
function flattenValues(obj: unknown): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const out: string[] = [];
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out.push(value);
    } else if (value !== null && typeof value === 'object') {
      out.push(...flattenValues(value));
    }
  }
  return out;
}

describe('NAMESPACES coverage', () => {
  it('includes counter namespace', () => {
    expect(NAMESPACES).toContain('counter');
  });

  it('includes canteen namespace', () => {
    expect(NAMESPACES).toContain('canteen');
  });

  it('includes accounts namespace', () => {
    expect(NAMESPACES).toContain('accounts');
  });
});

describe('representative prisoner keys present and non-empty', () => {
  it('counter.cardTitle exists in vi and en', () => {
    expect(resources.vi.counter.cardTitle).toBeTruthy();
    expect(resources.en.counter.cardTitle).toBeTruthy();
  });

  it('counter.labelZone uses zone wording in both locales', () => {
    // VI should say "Khu giam", EN should say "Zone"
    expect(resources.vi.counter.labelZone).toBe('Khu giam');
    expect(resources.en.counter.labelZone).toBe('Zone');
  });

  it('verify.lockedPrisonerId uses prisoner wording in both locales', () => {
    expect(resources.vi.verify.lockedPrisonerId).toBe('Mã phạm nhân');
    expect(resources.en.verify.lockedPrisonerId).toBe('Prisoner ID');
  });

  it('accounts.pageTitle exists in vi and en', () => {
    expect(resources.vi.accounts.pageTitle).toBeTruthy();
    expect(resources.en.accounts.pageTitle).toBeTruthy();
  });
});

describe('sensitive prisoner term retired from Vietnamese strings', () => {
  // The blunt term "tù nhân" is replaced everywhere by the neutral "phạm nhân".
  // This guards against regressions reintroducing it via new VI strings.
  const RETIRED = /tù nhân/i;

  for (const ns of NAMESPACES) {
    const nsData = resources.vi[ns];
    if (!nsData) continue;

    const violations = flattenValues(nsData).filter((v) => RETIRED.test(v));

    it(`vi/${ns}: does not use "tù nhân"`, () => {
      expect(
        violations,
        `Found retired term in vi/${ns}: ${violations.join(' | ')}`,
      ).toEqual([]);
    });
  }
});

describe('no orphaned staff terms in non-operator-context values', () => {
  // Scans all locale string values for legacy staff/department terminology.
  // Strings that contain "vận hành" (operator context in VI) or "operator"
  // (operator context in EN) are exempted — they legitimately refer to the
  // system operator role, not to prisoners or prison blocks.
  const BANNED = /nhân viên|employee|phòng ban|department/i;
  const OPERATOR_EXEMPT = /vận hành|operator/i;

  for (const lang of ['vi', 'en'] as const) {
    for (const ns of NAMESPACES) {
      const nsData = resources[lang][ns];
      if (!nsData) continue;

      const allValues = flattenValues(nsData);
      const violations = allValues.filter(
        (v) => BANNED.test(v) && !OPERATOR_EXEMPT.test(v),
      );

      it(`${lang}/${ns}: no orphaned staff terms outside operator context`, () => {
        expect(
          violations,
          `Found banned terms in ${lang}/${ns}: ${violations.join(' | ')}`,
        ).toEqual([]);
      });
    }
  }
});
