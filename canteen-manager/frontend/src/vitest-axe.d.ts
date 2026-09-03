/**
 * Type augmentation for vitest-axe: adds toHaveNoViolations to Vitest's
 * Assertion interface. vitest-axe ships extend-expect.d.ts but does not
 * re-export it via the main typings entrypoint, so we declare it locally.
 */
import type { AxeResults } from 'vitest-axe';

declare module 'vitest' {
  // Augment Assertion<T> so expect(axeResults).toHaveNoViolations() type-checks.
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T extends AxeResults ? void : never;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
