// Language resolution + persistence for the app. Vietnamese is the default;
// English is an opt-in switch the user can toggle. The choice survives reloads
// via localStorage and is mirrored onto <html lang> for a11y/SEO correctness.

export type AppLanguage = 'vi' | 'en';

export const DEFAULT_LANGUAGE: AppLanguage = 'vi';
export const SUPPORTED_LANGUAGES: readonly AppLanguage[] = ['vi', 'en'];

const STORAGE_KEY = 'canteen.lang';

function isSupported(value: string | null): value is AppLanguage {
  return value === 'vi' || value === 'en';
}

/** Read the persisted language, defaulting to Vietnamese. Tolerates a missing
 *  or unavailable localStorage (private mode) by falling back to the default. */
export function resolveLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    // localStorage unavailable — use the default.
  }
  return DEFAULT_LANGUAGE;
}

/** Persist the chosen language and mirror it onto <html lang>. Called from the
 *  i18n `languageChanged` subscriber so toggle and programmatic changes stay
 *  consistent. Tolerates unavailable localStorage. */
export function persistLanguage(lng: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // localStorage unavailable — skip persistence.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
}
