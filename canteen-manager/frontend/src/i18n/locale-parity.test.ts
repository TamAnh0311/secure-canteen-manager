import { describe, it, expect } from 'vitest';
import { resources, NAMESPACES } from './locales';

// Recursively collect dotted key paths for every leaf string in a namespace.
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      out.push(...flattenKeys(value, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

// Guards against vi/en drift: a key added to one language but not the other
// would surface as a raw key (or English fallback) in the UI. CI fails here
// instead of letting an untranslated string reach a user.
describe('locale parity (vi ⇄ en)', () => {
  for (const ns of NAMESPACES) {
    it(`namespace "${ns}" has identical key sets in vi and en`, () => {
      const vi = flattenKeys(resources.vi[ns]);
      const en = flattenKeys(resources.en[ns]);

      const onlyInVi = vi.filter((k) => !en.includes(k));
      const onlyInEn = en.filter((k) => !vi.includes(k));

      expect(onlyInVi, `keys only in vi/${ns}`).toEqual([]);
      expect(onlyInEn, `keys only in en/${ns}`).toEqual([]);
    });
  }
});
