import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/app/auth/auth-context';
import { Banner } from '@/ui';

export function AssignedZoneScope() {
  const operator = useContext(AuthContext)?.operator ?? null;
  const { t } = useTranslation('common');

  if (operator?.role !== 'operator') return null;

  return (
    <Banner
      tone={operator.zone ? 'info' : 'danger'}
      className="mb-4"
      aria-live="polite"
    >
      {operator.zone
        ? t('assignedZoneScope', { zone: operator.zone })
        : t('assignedZoneMissing')}
    </Banner>
  );
}

export function useAssignedZone(): string | null {
  const operator = useContext(AuthContext)?.operator ?? null;
  return operator?.role === 'operator' ? operator.zone : null;
}
