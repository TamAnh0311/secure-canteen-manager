import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { legacySync, users } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatDate, formatNumber, formatTime, formatVnd } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Input,
  PageHeader,
  Spinner,
  StatusChip,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@/ui';
import { syncStatusDisplay } from '@/lib/status-display';
import { detentionStatusLabel } from '@/lib/detention-status';
import { useAuth } from '@/app/auth/use-auth';
import { AssignedZoneScope, useAssignedZone } from '@/features/_shared/assigned-zone-scope';

export function UsersPage() {
  const { t } = useTranslation('users');
  const { t: tCommon } = useTranslation('common');
  const { isAdmin, operator } = useAuth();
  const { toast } = useToast();
  const assignedZone = useAssignedZone();

  const [q, setQ] = useState('');
  const [zone, setZone] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [debouncedZone, setDebouncedZone] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  // Debounce search inputs ~300 ms
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => setDebouncedQ(q), 300);
    return () => { if (qTimer.current) clearTimeout(qTimer.current); };
  }, [q]);

  useEffect(() => {
    if (zoneTimer.current) clearTimeout(zoneTimer.current);
    zoneTimer.current = setTimeout(() => setDebouncedZone(zone), 300);
    return () => { if (zoneTimer.current) clearTimeout(zoneTimer.current); };
  }, [zone]);

  const {
    data: userList,
    error: userError,
    loading: userLoading,
    refetch: refetchUsers,
  } = useQuery(
    () => users.listUsers({
      q: debouncedQ || undefined,
      zone: operator?.role === 'operator' ? undefined : debouncedZone || undefined,
    }),
    [debouncedQ, debouncedZone, operator?.role],
  );

  const {
    data: syncStatus,
    error: syncError,
    loading: syncLoading,
    refetch: refetchSync,
  } = useQuery(() => legacySync.getSyncStatus(), []);

  async function handleResync() {
    setSyncBusy(true);
    try {
      const result = await legacySync.triggerSync();
      if ('skipped' in result && result.skipped) {
        toast({ tone: 'info', message: t('toastSyncSkipped', { reason: result.reason }) });
      } else {
        toast({ tone: 'success', message: t('toastSyncSuccess') });
      }
      refetchSync();
      refetchUsers();
    } catch (err) {
      toast({ tone: 'danger', message: err instanceof Error ? err.message : t('toastSyncFailed') });
    } finally {
      setSyncBusy(false);
    }
  }

  const list = userList ?? [];

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={
          <div className="flex items-center gap-2">
            <div className="w-52">
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchAriaLabel')}
              />
            </div>
            {operator?.role !== 'operator' && <div className="w-36">
              <Input
                type="text"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder={t('zonePlaceholder')}
                aria-label={t('zoneAriaLabel')}
              />
            </div>}
            {isAdmin && (
              <Button
                variant="outline"
                onClick={handleResync}
                disabled={syncBusy}
                loading={syncBusy}
              >
                {t('syncNow')}
              </Button>
            )}
          </div>
        }
      />
      <AssignedZoneScope />

      {/* Sync status banner */}
      {!syncLoading && syncStatus && (() => {
        const display = syncStatusDisplay(syncStatus.status);
        const bannerTone = syncStatus.status === 'failed'
          ? 'danger' as const
          : syncStatus.status === 'running'
            ? 'info' as const
            : 'success' as const;
        const syncTs = syncStatus.finishedAt ?? syncStatus.startedAt;
        return (
          <Banner tone={bannerTone} className="mb-4" aria-live="polite">
            <span>↻</span>
            <span>
              {t('lastSync')}{' '}
              <strong>
                {formatTime(syncTs, { dateStyle: 'short', timeStyle: 'short' } as Intl.DateTimeFormatOptions)}
              </strong>
              {syncStatus.rowCount !== null && t('syncRowCount', { n: formatNumber(syncStatus.rowCount) })}
              {syncStatus.status === 'running' && t('syncRunning')}
            </span>
            <StatusChip tone={display.tone} label={tCommon(display.key)} dot className="ml-auto" />
          </Banner>
        );
      })()}

      {syncStatus?.error && (
        <Banner tone="danger" className="mb-4">
          {t('syncError', { message: syncStatus.error })}
        </Banner>
      )}

      {syncError && (
        <Banner tone="warning" className="mb-4">
          {t('syncStatusError', { message: syncError.message })}
        </Banner>
      )}

      {userError && (
        <Banner tone="danger" className="mb-4">
          {userError.message}
        </Banner>
      )}

      <Card className="p-0">
        <CardHead
          title={t('directoryTitle', { count: list.length })}
          className="px-4 pt-4"
          actions={
            <span className="text-xs text-muted-fg">{t('directoryHint')}</span>
          }
        />

        {userLoading && !userList && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}

        <Table>
          <THead>
            <Tr>
              <Th>{t('colEmpId')}</Th>
              <Th>{t('colName')}</Th>
              <Th>{t('colZone')}</Th>
              <Th numeric>{t('colBalance')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th>{t('colDetention')}</Th>
              <Th>{t('colDob')}</Th>
              <Th>{t('colSynced')}</Th>
            </Tr>
          </THead>
          <TBody>
            {!userLoading && list.length === 0 ? (
              <EmptyRow colSpan={8}>
                {assignedZone && !debouncedQ
                  ? tCommon('assignedZoneEmpty', { zone: assignedZone })
                  : debouncedQ || debouncedZone ? t('emptySearch') : t('emptyDefault')}
              </EmptyRow>
            ) : (
              list.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <span className="font-mono text-sm">{u.legacyId}</span>
                  </Td>
                  <Td>{u.name}</Td>
                  <Td>{u.zone}</Td>
                  <Td numeric className="tabular-nums font-medium">
                    {formatVnd(u.balance)}
                  </Td>
                  <Td>
                    <StatusChip
                      tone={u.isActive ? 'success' : 'neutral'}
                      label={u.isActive ? t('statusActive') : t('statusInactive')}
                      dot
                    />
                  </Td>
                  <Td>
                    {u.detentionStatus ? (
                      <StatusChip
                        tone="neutral"
                        label={detentionStatusLabel(u.detentionStatus, tCommon)}
                      />
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{u.dateOfBirth ? formatDate(u.dateOfBirth) : '—'}</Td>
                  <Td>
                    <span className="font-mono text-xs text-muted-fg">
                      {formatTime(u.syncedAt, { timeStyle: 'short' })}
                    </span>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
