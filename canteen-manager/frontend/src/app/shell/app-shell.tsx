import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth/use-auth';
import { Button, LanguageToggle } from '@/ui';
import { formatDate } from '@/lib/format';
import { SideNav } from './side-nav';

const APP_ICON = (
  <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true" style={{ flex: 'none' }}>
    <rect width="64" height="64" rx="14" fill="#1e40af" />
    <path d="M20 16h24a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z" fill="#3b82f6" opacity="0.4" />
    <text x="32" y="44" textAnchor="middle" fontSize="28" fontWeight="bold" fill="white" fontFamily="Arial,sans-serif">CM</text>
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
        {APP_ICON}
        <span>Canteen Manager</span>
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
