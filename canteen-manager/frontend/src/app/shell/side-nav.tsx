import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth/use-auth';
import { NAV_GROUPS } from './nav-items';

export function SideNav() {
  const { isAdmin, hasRole } = useAuth();
  const { t } = useTranslation('common');

  return (
    <nav
      className="grid-area-nav bg-card border-r border-border overflow-y-auto p-2"
      aria-label={t('navAria')}
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.group}>
          <div className="text-[11px] uppercase tracking-[0.06em] text-muted-fg px-2.5 pt-3.5 pb-1.5">
            {t(`navGroup.${group.group}`)}
          </div>
          {group.items.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            if (item.roles && !hasRole(...item.roles)) return null;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2.5 h-9 px-2.5 rounded text-sm mb-0.5',
                    isActive
                      ? 'bg-accent-subtle text-primary font-medium shadow-[inset_3px_0_0_var(--primary)]'
                      : 'text-foreground hover:bg-muted',
                  ].join(' ')
                }
              >
                <span className="w-4 text-center opacity-80 shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
                {t(`nav.${item.id}`)}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
