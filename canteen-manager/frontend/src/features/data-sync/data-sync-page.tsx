import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { legacySync } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatTime } from '@/lib/format';
import type { SyncRun } from '@/lib/types';
import { Banner, Button, Card, CardHead, PageHeader, Spinner, useToast } from '@/ui';

/** Formats a duration in milliseconds to a human-readable string. */
function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function DataSyncPage() {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const statusQuery = useQuery(() => legacySync.getSyncStatus(), []);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await legacySync.triggerSync();
      if ('skipped' in result && result.skipped) {
        toast({ tone: 'warning', message: `Sync skipped: ${result.reason}` });
      } else {
        const run = result as SyncRun;
        toast({
          tone: run.status === 'success' ? 'success' : 'danger',
          message: run.status === 'success'
            ? `Synced ${run.rowCount} records`
            : `Sync failed: ${run.error ?? 'unknown error'}`,
        });
      }
      statusQuery.refetch();
    } catch (err) {
      toast({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setSyncing(false);
    }
  }

  const status = statusQuery.data;

  return (
    <>
      <PageHeader
        title="Data Sync"
        subtitle="Synchronize prisoner records from the government legacy database (SQL Server 2005)"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trigger sync */}
        <Card>
          <CardHead
            title="Manual Sync"
            actions={
              <Button
                variant="primary"
                onClick={handleSync}
                disabled={syncing}
                loading={syncing}
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </Button>
            }
          />
          <p className="text-sm text-muted-fg">
            Pull the latest prisoner records from the legacy SQL Server database.
            This upserts all active prisoners and deactivates those no longer present.
          </p>
          <p className="text-sm text-muted-fg mt-2">
            Automatic sync runs on a cron schedule when <code>LEGACY_SYNC_ENABLED=true</code> is set.
          </p>
        </Card>

        {/* Last sync status */}
        <Card>
          <CardHead title="Last Sync" />
          {statusQuery.loading && !status && (
            <div className="flex justify-center py-4"><Spinner size={20} /></div>
          )}
          {statusQuery.error && (
            <Banner tone="danger">{statusQuery.error.message}</Banner>
          )}
          {status && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-fg">Status</span>
                <span className={
                  status.status === 'success' ? 'text-green-600 font-medium' :
                  status.status === 'failed' ? 'text-red-600 font-medium' :
                  'text-yellow-600 font-medium'
                }>
                  {status.status.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Trigger</span>
                <span>{status.trigger}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Started</span>
                <span>{formatTime(status.startedAt, { dateStyle: 'short', timeStyle: 'medium' } as Intl.DateTimeFormatOptions)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Duration</span>
                <span>{formatDuration(status.startedAt, status.finishedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Records</span>
                <span>{status.rowCount ?? '—'}</span>
              </div>
              {status.error && (
                <Banner tone="danger" className="mt-2">{status.error}</Banner>
              )}
            </div>
          )}
          {!statusQuery.loading && !status && !statusQuery.error && (
            <p className="text-sm text-muted-fg">No sync has been run yet.</p>
          )}
        </Card>
      </div>

      {/* Connection info */}
      <Card className="mt-4">
        <CardHead title="Connection Settings" />
        <p className="text-sm text-muted-fg mb-3">
          The legacy database connection is configured via environment variables in the Electron app settings.
          These are set during first launch or by editing the config file.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm font-mono">
          <div><span className="text-muted-fg">LEGACY_SQL_HOST</span></div>
          <div><span className="text-muted-fg">LEGACY_SQL_PORT</span> (default: 1433)</div>
          <div><span className="text-muted-fg">LEGACY_SQL_DB</span></div>
          <div><span className="text-muted-fg">LEGACY_SQL_USER / LEGACY_SQL_PASS</span></div>
        </div>
      </Card>
    </>
  );
}
