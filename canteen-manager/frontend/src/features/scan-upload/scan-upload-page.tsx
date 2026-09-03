import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api-client';
import { scans } from '@/lib/api';
import type { SheetStatus, SubmitScanResult } from '@/lib/types';
import { sheetStatusDisplay } from '@/lib/status-display';
import { Banner, Button, Card, PageHeader } from '@/ui';
import {
  bytesToBase64,
  createUploadItems,
  isRetryableStatus,
  makeSheetId,
  scanUploadReducer,
  sha256Hex,
  validateScanFile,
  validateScanMagic,
  type ScanUploadItem,
} from './scan-upload-model';

export function ScanUploadPage() {
  const { t } = useTranslation('scanUpload');
  const { t: tCommon } = useTranslation('common');
  const [items, dispatch] = useReducer(scanUploadReducer, []);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const workerActive = useRef(false);
  const completionRef = useRef<HTMLHeadingElement>(null);
  const hadActive = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const active = items.some((item) => item.status === 'uploading');
  const waitingCount = items.filter((item) => item.status === 'waiting').length;
  useUploadNavigationGuard(active, t('leavePrompt'));

  useEffect(() => {
    if (active) {
      hadActive.current = true;
      return;
    }
    if (hadActive.current && items.length > 0 && items.every((item) => item.status !== 'waiting')) {
      hadActive.current = false;
      setAnnouncement(t('batchComplete'));
      completionRef.current?.focus();
    }
  }, [active, items, t]);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const next = createUploadItems(files, itemsRef.current.length);
    const checked: ScanUploadItem[] = [];
    for (const item of next) {
      const localError = item.file ? validateScanFile(item.file) : 'unsupported';
      if (localError) {
        checked.push({ ...item, file: undefined, status: 'failed', error: t(`validation.${localError}`), retryable: false });
        continue;
      }
      if (!(await validateScanMagic(item.file!))) {
        checked.push({ ...item, file: undefined, status: 'failed', error: t('validation.magic'), retryable: false });
        continue;
      }
      checked.push(item);
    }
    dispatch({ type: 'add', items: checked });
    if (inputRef.current) inputRef.current.value = '';
    setAnnouncement(t('filesAdded', { count: files.length }));
  }, [t]);

  const processItem = useCallback(async (item: ScanUploadItem, sequence: number) => {
    if (!item.file) return;
    dispatch({ type: 'uploading', key: item.key });
    let checksum: string;
    let imageBase64: string;
    try {
      const buffer = await item.file.arrayBuffer();
      checksum = await sha256Hex(buffer);
      imageBase64 = bytesToBase64(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('unknownError');
      dispatch({ type: 'failed', key: item.key, error: message, retryable: false });
      setAnnouncement(t('failedAnnouncement', { name: item.name }));
      return;
    }
    try {
      const result = await scans.submitScan({
        sheetId: makeSheetId(checksum, sequence),
        batch: 'browser-upload',
        checksum,
        imageBase64,
      });
      dispatch({ type: 'accepted', key: item.key, result });
      setAnnouncement(t('acceptedAnnouncement', { name: item.name }));
    } catch (error) {
      if (error instanceof ApiError && duplicateResult(error)) {
        const result = duplicateResult(error)!;
        dispatch({ type: 'duplicate', key: item.key, result, error: error.message });
        setAnnouncement(t('duplicateAnnouncement', { name: item.name }));
      } else {
        const retryable = error instanceof ApiError
          ? isRetryableStatus(error.status)
          : error instanceof TypeError;
        const message = error instanceof Error ? error.message : t('unknownError');
        dispatch({ type: 'failed', key: item.key, error: message, retryable });
        setAnnouncement(t('failedAnnouncement', { name: item.name }));
      }
    }
  }, [t]);

  const uploadAll = useCallback(async () => {
    if (workerActive.current) return;
    workerActive.current = true;
    try {
      const waiting = itemsRef.current.filter((item) => item.status === 'waiting');
      for (let index = 0; index < waiting.length; index += 1) {
        await processItem(waiting[index], index);
      }
    } finally {
      workerActive.current = false;
    }
  }, [processItem]);

  const retry = useCallback(async (item: ScanUploadItem) => {
    if (workerActive.current || !item.retryable || !item.file) return;
    dispatch({ type: 'retry', key: item.key });
    workerActive.current = true;
    try {
      await processItem({ ...item, status: 'waiting' }, itemsRef.current.indexOf(item));
    } finally {
      workerActive.current = false;
    }
  }, [processItem]);

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="p-5">
          <button
            ref={pickerRef}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void addFiles(event.dataTransfer.files);
            }}
            className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary/40 bg-accent-subtle px-6 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden="true" className="text-4xl">⇧</span>
            <span className="text-lg font-semibold">{t('pickerTitle')}</span>
            <span id="scan-upload-guidance" className="text-sm text-muted-fg">{t('pickerHint')}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            aria-label={t('pickerLabel')}
            aria-describedby="scan-upload-guidance"
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => event.target.files && void addFiles(event.target.files)}
          />

          {items.length > 0 && (
            <ol className="mt-5 space-y-2" aria-label={t('fileListLabel')}>
              {items.map((item) => (
                <UploadRow
                  key={item.key}
                  item={item}
                  onRemove={() => {
                    dispatch({ type: 'remove', key: item.key });
                    window.setTimeout(() => pickerRef.current?.focus(), 0);
                  }}
                  onRetry={() => void retry(item)}
                  resultStatus={item.result ? tCommon(sheetStatusDisplay(item.result.status).key) : null}
                />
              ))}
            </ol>
          )}

          {items.length > 0 && !active && items.every((item) => item.status !== 'waiting') && (
            <h2 ref={completionRef} tabIndex={-1} className="mt-4 text-sm font-semibold focus:outline-none">
              {t('batchComplete')}
            </h2>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" disabled={waitingCount === 0 || active} loading={active} onClick={() => void uploadAll()}>
              {active ? t('uploading') : t('uploadAll', { count: waitingCount })}
            </Button>
            <Link to="/scan-monitor" className="text-sm font-medium text-primary underline">
              {t('backToMonitor')}
            </Link>
          </div>
        </Card>

        <aside>
          <Banner tone="info" className="flex-col items-start">
            <p className="font-semibold">{t('requirementsTitle')}</p>
            <p className="mt-1 text-sm">{t('requirementsBody')}</p>
          </Banner>
        </aside>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </>
  );
}

function UploadRow({ item, onRemove, onRetry, resultStatus }: { item: ScanUploadItem; onRemove: () => void; onRetry: () => void; resultStatus: string | null }) {
  const { t } = useTranslation('scanUpload');
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{item.name}</p>
        <p className="text-xs tabular-nums text-muted-fg">{formatBytes(item.size)}</p>
        {item.status === 'failed' && item.error && <p className="mt-1 text-xs text-danger">{item.error}</p>}
        {item.status === 'duplicate' && item.result && (
          <p className="mt-1 text-xs text-muted-fg">{t('duplicateResult', { sheetId: item.result.sheetId })}</p>
        )}
        {item.result && (
          <p className="mt-1 text-xs text-muted-fg">
            {t('sheetResult', { sheetId: item.result.sheetId, status: resultStatus })}
          </p>
        )}
      </div>
      <span className="rounded bg-muted px-2 py-1 text-xs font-semibold">{t(`status.${item.status}`)}</span>
      {item.status !== 'uploading' && item.status !== 'accepted' && item.status !== 'duplicate' && (
        <Button variant="ghost" size="sm" aria-label={t('removeFile', { name: item.name })} onClick={onRemove}>{t('remove')}</Button>
      )}
      {item.status === 'failed' && item.retryable && <Button variant="outline" size="sm" aria-label={t('retryFile', { name: item.name })} onClick={onRetry}>{t('retry')}</Button>}
      {(item.status === 'accepted' || item.status === 'duplicate') && (
        <Link to={`/scan-monitor?sheet=${item.result?.id ?? ''}`} className="text-sm text-primary underline">{t('viewMonitor')}</Link>
      )}
    </li>
  );
}

function duplicateResult(error: ApiError): SubmitScanResult | null {
  if (!error.body || typeof error.body !== 'object') return null;
  const body = error.body as Record<string, unknown>;
  return body.code === 'SHEET.DEDUP_CONFLICT' && typeof body.id === 'string' && typeof body.sheetId === 'string' && isSheetStatus(body.status)
    ? { id: body.id, sheetId: body.sheetId, status: body.status }
    : null;
}

function formatBytes(bytes: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024))} MiB`;
}

function isSheetStatus(value: unknown): value is SheetStatus {
  return typeof value === 'string' && ['pending', 'processing', 'auto_accepted', 'flagged', 'verified', 'rejected'].includes(value);
}

function useUploadNavigationGuard(active: boolean, prompt: string) {
  const blocker = useBlocker(active);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(prompt)) blocker.proceed();
    else blocker.reset();
  }, [blocker, prompt]);
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
