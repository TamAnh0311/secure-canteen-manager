import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { scans } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatTime } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CardHead,
  ConfidenceChip,
  EmptyRow,
  Kpi,
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
import { sheetStatusDisplay } from '@/lib/status-display';
import { DateRangePicker, tomorrowRange, type DateRange } from '@/features/_shared/date-range-picker';
import { ScanStatusLiveRegion } from './scan-status-live-region';
import type { Sheet } from '@/lib/types';
import { AssignedZoneScope } from '@/features/_shared/assigned-zone-scope';
import { buildVerifyUrl } from '@/features/verify/verify-route';

const POLL_INTERVAL_MS = 2000;

export function ScanMonitorPage() {
  const [range, setRange] = useState<DateRange>(tomorrowRange);
  const [paused, setPaused] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const targetId = searchParams.get('sheet');
  const [targetSheet, setTargetSheet] = useState<Sheet | null>(null);
  const focusedTargetRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation('scan');
  const { t: tCommon } = useTranslation('common');
  const { toast } = useToast();

  const { data, error, loading, refetch } = useQuery(
    () => scans.listScans({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    [range.dateFrom, range.dateTo],
  );

  const kpiQuery = useQuery(
    () => scans.getKpi({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
    [range.dateFrom, range.dateTo],
  );

  useEffect(() => {
    if (!targetId) {
      setTargetSheet(null);
      focusedTargetRef.current = null;
      return;
    }
    let cancelled = false;
    void scans.getScan(targetId).then((sheet) => {
      if (cancelled) return;
      setTargetSheet(sheet);
      setRange({ dateFrom: sheet.serviceDate, dateTo: sheet.serviceDate });
    }).catch(() => setTargetSheet(null));
    return () => { cancelled = true; };
  }, [targetId]);

  // Auto-poll every 2 s unless paused.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const kpiRefetchRef = useRef(kpiQuery.refetch);
  kpiRefetchRef.current = kpiQuery.refetch;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      refetchRef.current();
      kpiRefetchRef.current();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const sheets = data ?? [];
  const kpi = kpiQuery.data;
  const flaggedCount = kpi?.flagged ?? sheets.filter((s) => s.status === 'flagged').length;

  useEffect(() => {
    if (!targetId || focusedTargetRef.current === targetId || !sheets.some((sheet) => sheet.id === targetId)) return;
    const row = document.getElementById(`scan-row-${targetId}`);
    row?.scrollIntoView?.({ block: 'center' });
    row?.focus();
    focusedTargetRef.current = targetId;
  }, [sheets, targetId]);

  // Demo helper: fabricate a flagged OMR sheet dated to today and refresh the
  // feed so it appears immediately (no scanner required).
  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      await scans.generateDemoRecord();
      refetchRef.current();
      kpiRefetchRef.current();
      toast({ tone: 'success', message: t('toastRecordGenerated') });
    } catch (err) {
      toast({
        tone: 'danger',
        message: err instanceof Error ? err.message : t('toastRecordFailed'),
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? t('resumeFeed') : t('pauseFeed')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              loading={generating}
            >
              {t('generateRecord')}
            </Button>
            {flaggedCount > 0 && (
              <Button variant="primary" size="sm" onClick={() => navigate('/verify')}>
                {t('verifyFlagged', { count: flaggedCount })}
              </Button>
            )}
          </div>
        }
      />
      <AssignedZoneScope />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-accent-subtle">
        <div>
          <p className="font-semibold">{t('uploadScans')}</p>
          <p className="mt-1 text-sm text-muted-fg">{t('uploadScansHint')}</p>
        </div>
        <Link
          to="/scan-upload"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-semibold text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('uploadScans')}
        </Link>
      </Card>

      {targetSheet && (
        <Banner tone="info" className="mb-4">
          <span>{t('showingSheet', { sheetId: targetSheet.sheetId })}</span>
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>{t('clearShowingSheet')}</Button>
        </Banner>
      )}

      {/* Live status announcement for assistive tech */}
      <ScanStatusLiveRegion
        message={
          kpi
            ? t('statusAnnouncement', {
                flagged: kpi.flagged,
                ready: kpi.ready,
                needsReview: kpi.needsReview,
                rejected: kpi.rejected,
              })
            : ''
        }
      />

      {/* KPI strip */}
      {kpi && (
        <div
          className="grid gap-4 mb-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
        >
          <Card><Kpi label={t('kpiPendingEvidence')} value={<span className="text-info">{kpi.pending + kpi.processing}</span>} /></Card>
          <Card><Kpi label={t('kpiReady')} value={<span className="text-success">{kpi.ready}</span>} /></Card>
          <Card><Kpi label={t('kpiNeedsReview')} value={<span className="text-warning">{kpi.needsReview}</span>} /></Card>
          <Card><Kpi label={t('kpiIntegrityFault')} value={<span className="text-danger">{kpi.integrityFault}</span>} /></Card>
          <Card><Kpi label={t('kpiRejected')} value={<span className="text-danger">{kpi.rejected}</span>} /></Card>
        </div>
      )}

      {error && (
        <Banner tone="danger" className="mb-4">
          {error.message}
        </Banner>
      )}

      <Card className="p-0">
        <CardHead
          title={t('incomingSheets')}
          className="px-4 pt-4"
          actions={
            <span className="text-[13px] text-muted-fg">
              {paused ? t('feedPaused') : t('feedAutoRefresh')}
            </span>
          }
        />

        {loading && !data && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}

        <Table>
          <THead>
            <Tr>
              <Th>{t('colSheetId')}</Th>
              <Th>{t('colBatch')}</Th>
              <Th>{t('colSource')}</Th>
              <Th numeric>{t('colAvgConf')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th>{t('colTime')}</Th>
              <Th></Th>
            </Tr>
          </THead>
          <TBody>
            {sheets.length === 0 && !loading ? (
              <EmptyRow colSpan={7}>{t('noSheetsYet')}</EmptyRow>
            ) : (
              sheets.map((sheet) => {
                const display = sheetStatusDisplay(sheet.status);
                const isFlagged = sheet.status === 'flagged';
                return (
                  <Tr
                    key={sheet.id}
                    id={`scan-row-${sheet.id}`}
                    tabIndex={sheet.id === targetId ? -1 : undefined}
                    selected={sheet.id === targetId}
                  >
                    <Td>
                      <span className="font-mono text-sm">{sheet.sheetId}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-sm">{sheet.batch}</span>
                    </Td>
                    <Td>
                      <span className="rounded-full bg-accent-subtle px-2 py-1 text-xs font-semibold">
                        {sheet.source === 'scanner'
                          ? t(sheet.scannerReviewState === 'ready' ? 'sourceScannerReady' : 'sourceScannerReview')
                          : t('sourceOmr')}
                      </span>
                    </Td>
                    <Td numeric>
                      {sheet.avgConfidence != null ? (
                        <ConfidenceChip value={sheet.avgConfidence} />
                      ) : (
                        <span className="text-muted-fg text-xs">—</span>
                      )}
                    </Td>
                    <Td>
                      <StatusChip tone={display.tone} label={tCommon(display.key)} dot />
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-muted-fg">
                        {sheet.processedAt
                          ? formatTime(sheet.processedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                          : '—'}
                      </span>
                    </Td>
                    <Td>
                      {isFlagged && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => navigate(buildVerifyUrl(sheet.id, range))}
                        >
                          {t('verifyButton')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
