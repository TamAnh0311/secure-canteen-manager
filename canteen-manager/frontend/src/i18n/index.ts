// Configured i18next singleton. Vietnamese-first with English fallback. Import
// this module once (main.tsx, test-setup.ts) to initialize; non-React modules
// (e.g. api-client.ts) can import the default export to call `i18n.t(...)`.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, persistLanguage, resolveLanguage } from './resolve-language';
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './locales';

const isDev = Boolean(import.meta.env?.DEV);

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  ns: NAMESPACES as unknown as string[],
  defaultNS: DEFAULT_NAMESPACE,
  interpolation: { escapeValue: false },
  returnNull: false,
  // Dev surfaces missing keys as a console warning while still rendering the
  // fallback so the UI never goes blank. Locale parity is enforced by a test.
  saveMissing: isDev,
  missingKeyHandler: isDev
    ? (lngs, ns, key) => {
        console.warn(`[i18n] missing key "${ns}:${key}" for [${lngs.join(', ')}]`);
      }
    : undefined,
});

// Keep persistence + <html lang> in sync for every change (toggle or
// programmatic). Single subscriber so all callers stay consistent.
i18n.on('languageChanged', (lng) => {
  if (lng === 'vi' || lng === 'en') persistLanguage(lng);
});

// Mirror the initial language onto <html lang> on load.
if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language === 'en' ? 'en' : 'vi';
}

export default i18n;
