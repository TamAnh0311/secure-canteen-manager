import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth/use-auth';
import { Button, LanguageToggle } from '@/ui';
import { formatDate } from '@/lib/format';
import { SideNav } from './side-nav';

const OMR_GLYPH = (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style={{ flex: 'none' }}>
    <rect x="1" y="1" width="20" height="20" rx="3" fill="none" stroke="#2563EB" strokeWidth="2" />
    <circle cx="6.5"  cy="6.5"  r="1.6" fill="#2563EB" />
    <circle cx="11"   cy="6.5"  r="1.6" fill="#CBD5E1" />
    <circle cx="15.5" cy="6.5"  r="1.6" fill="#2563EB" />
    <circle cx="6.5"  cy="11"   r="1.6" fill="#CBD5E1" />
    <circle cx="11"   cy="11"   r="1.6" fill="#2563EB" />
    <circle cx="15.5" cy="11"   r="1.6" fill="#CBD5E1" />
    <circle cx="6.5"  cy="15.5" r="1.6" fill="#2563EB" />
    <circle cx="11"   cy="15.5" r="1.6" fill="#CBD5E1" />
    <circle cx="15.5" cy="15.5" r="1.6" fill="#2563EB" />
  </svg>
);

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

export function AppShell() {
  const { operator, logout } = useAuth();
  const { t } = useTranslation('common');
  const displayName = operator?.displayName ?? operator?.username ?? '';

  return (
    <div
      className="grid min-h-screen"
      style={{
        gridTemplateColumns: 'var(--nav-w) 1fr',
        gridTemplateRows: 'var(--header-h) 1fr',
        gridTemplateAreas: '"brand header" "nav main"',
      }}
    >
      {/* Brand */}
      <div
        className="no-print flex items-center gap-2 px-4 bg-card border-r border-b border-border font-semibold text-[15px]"
        style={{ gridArea: 'brand' }}
      >
        {OMR_GLYPH}
        <span>
          Canteen
          <span className="font-mono text-primary">OMR</span>
        </span>
      </div>

      {/* Topbar */}
      <header
        className="no-print flex items-center justify-between px-5 bg-card border-b border-border"
        style={{ gridArea: 'header' }}
      >
        <div className="flex items-center gap-3 text-[13px] text-muted-fg">
          <span className="font-mono">{t('airGapped')}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDate(new Date())}</span>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-fg">{displayName}</span>
          <span
            className="w-7 h-7 rounded-full bg-accent-subtle text-primary grid place-items-center font-semibold text-xs shrink-0"
            aria-hidden="true"
          >
            {initials(displayName)}
          </span>
          <LanguageToggle />
          <Button variant="ghost" size="sm" onClick={logout}>
            {t('signOut')}
          </Button>
        </div>
      </header>

      {/* Side nav */}
      <div className="no-print" style={{ gridArea: 'nav' }}>
        <SideNav />
      </div>

      {/* Main content */}
      <main
        id="main"
        className="overflow-auto p-5"
        style={{ gridArea: 'main', maxWidth: '1440px', width: '100%' }}
      >
        <Outlet />
      </main>
    </div>
  );
}
