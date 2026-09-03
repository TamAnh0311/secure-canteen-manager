import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '@/i18n/resolve-language';

// Short, locale-agnostic button labels. The group's accessible name (from the
// `common:language` key) supplies the context for screen readers.
const CODE: Record<AppLanguage, string> = { vi: 'VI', en: 'EN' };

export interface LanguageToggleProps {
  className?: string;
}

/** Compact VI | EN segmented toggle. Switches language live; persistence and
 *  <html lang> sync happen in the i18n `languageChanged` subscriber. */
export function LanguageToggle({ className }: LanguageToggleProps) {
  const { t, i18n } = useTranslation('common');
  const active = i18n.language === 'en' ? 'en' : 'vi';

  return (
    <div
      role="group"
      aria-label={t('language')}
      className={['inline-flex rounded border border-border overflow-hidden', className]
        .filter(Boolean)
        .join(' ')}
    >
      {SUPPORTED_LANGUAGES.map((lng) => {
        const isActive = active === lng;
        return (
          <button
            key={lng}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              if (!isActive) void i18n.changeLanguage(lng);
            }}
            className={[
              'px-2.5 h-7 text-[12px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              isActive
                ? 'bg-primary text-primary-fg'
                : 'bg-card text-muted-fg hover:bg-muted',
            ].join(' ')}
          >
            {CODE[lng]}
          </button>
        );
      })}
    </div>
  );
}
