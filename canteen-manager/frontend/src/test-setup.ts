import '@testing-library/jest-dom';
import { expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';
// Initialize the i18n singleton (Vietnamese default) so component tests resolve
// t() without each test wiring its own provider.
import '@/i18n';

// Wire axe custom matchers (toHaveNoViolations) into Vitest's expect.
expect.extend(matchers);
