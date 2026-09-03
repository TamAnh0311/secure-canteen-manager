import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { omrForms } from '@/lib/api';
import type {
  GenericOmrMaster,
  IssuedOmrFormBatch,
  OmrFormCapabilities,
  OmrFormMode,
  OmrFormModeCapability,
  OmrRoster,
  OmrRosterOptions,
} from '@/lib/api/omr-forms';
import { formatDate } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  PageHeader,
  Select,
  Spinner,
} from '@/ui';
import { AssignedZoneScope } from '@/features/_shared/assigned-zone-scope';

const UNASSIGNED_CELL_VALUE = 'cell:null';
const ASSIGNED_CELL_PREFIX = 'cell:value:';
const MODES: OmrFormMode[] = ['code', 'full_list'];

function pdfObjectUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function cellValue(cell: string | null): string {
  return cell === null ? UNASSIGNED_CELL_VALUE : `${ASSIGNED_CELL_PREFIX}${cell}`;
}

function capabilityFor(
  capabilities: OmrFormCapabilities,
  mode: OmrFormMode,
): OmrFormModeCapability | undefined {
  return capabilities.modes.find((entry) => entry.mode === mode);
}

export function OrderFormPage() {
  const { t } = useTranslation('orderForm');
  const [capabilities, setCapabilities] = useState<OmrFormCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    omrForms.getCapabilities()
      .then((next) => {
        if (!cancelled) setCapabilities(next);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t('setupFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const generic = capabilities?.operationalMode === 'generic';

  return (
    <>
      <PageHeader
        title={generic ? t('genericPageTitle') : t('pageTitle')}
        subtitle={generic ? t('genericPageSubtitle') : t('pageSubtitle')}
      />
      <AssignedZoneScope />

      {error && <Banner tone="danger" className="mb-4" aria-live="assertive">{error}</Banner>}
      {loading && (
        <Card className="max-w-3xl flex justify-center py-8" aria-label={t('setupLoading')}>
          <Spinner size={24} />
        </Card>
      )}
      {!loading && capabilities?.operationalMode === 'generic' && (
        <GenericMasterWorkflow capabilities={capabilities} />
      )}
      {!loading && capabilities?.operationalMode !== 'generic' && capabilities && (
        <IssuedOrderFormWorkflow capabilities={capabilities} />
      )}
    </>
  );
}

function IssuedOrderFormWorkflow({ capabilities }: { capabilities: OmrFormCapabilities }) {
  const { t } = useTranslation('orderForm');
  const [options, setOptions] = useState<OmrRosterOptions | null>(null);
  const [selectedZone, setSelectedZone] = useState('');
  const [selectedCellValue, setSelectedCellValue] = useState('');
  const [roster, setRoster] = useState<OmrRoster | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<OmrFormMode>(() => (
    MODES.find((candidate) => capabilityFor(capabilities, candidate)?.available) ?? 'code'
  ));
  const [issued, setIssued] = useState<IssuedOmrFormBatch | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setIssued(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    omrForms.getRosterOptions()
      .then((next) => {
        if (!cancelled) setOptions(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSetupError(error instanceof Error ? error.message : t('setupFailed'));
      })
      .finally(() => {
        if (!cancelled) setSetupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const selectedCell = selectedCellValue === UNASSIGNED_CELL_VALUE
    ? null
    : selectedCellValue.slice(ASSIGNED_CELL_PREFIX.length);
  const hasCellSelection = selectedCellValue !== '';

  useEffect(() => {
    if (!selectedZone || !hasCellSelection) {
      setRoster(null);
      setRosterLoading(false);
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);
    omrForms.getRoster(selectedZone, selectedCell)
      .then((nextRoster) => {
        if (!cancelled) setRoster(nextRoster);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRoster(null);
          setRosterError(error instanceof Error ? error.message : t('rosterFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCellSelection, selectedCell, selectedZone, t]);

  const selectedZoneOption = options?.zones.find((entry) => entry.zone === selectedZone);
  const prisoners = roster?.prisoners ?? [];
  const maxBatchSize = capabilities.maxBatchSize;
  const allVisibleSelected = prisoners.length > 0
    && prisoners.every((prisoner) => selectedIds.has(prisoner.id));
  const someVisibleSelected = prisoners.some((prisoner) => selectedIds.has(prisoner.id));
  const currentCapability = capabilityFor(capabilities, mode);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  const selectedIdList = useMemo(
    () => prisoners.filter((prisoner) => selectedIds.has(prisoner.id)).map((prisoner) => prisoner.id),
    [prisoners, selectedIds],
  );

  function resetRosterSelection() {
    setSelectedIds(new Set());
    setIssueError(null);
    revokePreview();
  }

  function handleZoneChange(zone: string) {
    setSelectedZone(zone);
    setSelectedCellValue('');
    setRoster(null);
    setRosterError(null);
    resetRosterSelection();
  }

  function handleCellChange(value: string) {
    setSelectedCellValue(value);
    setRoster(null);
    setRosterError(null);
    resetRosterSelection();
  }

  function togglePrisoner(userId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < maxBatchSize) next.add(userId);
      return next;
    });
    setIssueError(null);
  }

  function toggleAllVisible() {
    if (allVisibleSelected) setSelectedIds(new Set());
    else if (prisoners.length <= maxBatchSize) {
      setSelectedIds(new Set(prisoners.map((prisoner) => prisoner.id)));
    }
    setIssueError(null);
  }

  async function issue() {
    if (
      issuing
      || selectedIdList.length === 0
      || !currentCapability?.available
      || selectedIdList.length > maxBatchSize
    ) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const result = await omrForms.issueOmrFormBatch(selectedIdList, mode);
      const nextUrl = pdfObjectUrl(result.pdfBase64);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      setIssued(result);
      setDialogOpen(false);
      requestAnimationFrame(() => previewHeadingRef.current?.focus());
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : t('issueFailed'));
      setDialogOpen(false);
    } finally {
      setIssuing(false);
    }
  }

  function printIssuedForms() {
    if (previewFrameRef.current?.contentWindow) previewFrameRef.current.contentWindow.print();
    else if (previewUrl) window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      {setupError && <Banner tone="danger" className="mb-4" aria-live="assertive">{setupError}</Banner>}

      <Card className="max-w-3xl mb-4">
        <h2 className="text-lg font-semibold mb-3">{t('rosterFiltersTitle')}</h2>
        {setupLoading && (
          <div className="flex justify-center py-5" aria-label={t('rosterLoading')}>
            <Spinner size={24} />
          </div>
        )}
        {!setupLoading && options && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('zoneLabel')} htmlFor="order-form-zone">
              <Select
                id="order-form-zone"
                value={selectedZone}
                onValueChange={handleZoneChange}
                items={options.zones.map((entry) => ({ value: entry.zone, label: entry.zone }))}
                placeholder={t('zonePlaceholder')}
                ariaLabel={t('zoneLabel')}
              />
            </Field>
            <Field label={t('cellLabel')} htmlFor="order-form-cell">
              <Select
                id="order-form-cell"
                value={selectedCellValue}
                onValueChange={handleCellChange}
                items={(selectedZoneOption?.cells ?? []).map((cell) => ({
                  value: cellValue(cell),
                  label: cell ?? t('unassignedCell'),
                }))}
                placeholder={t('cellPlaceholder')}
                ariaLabel={t('cellLabel')}
                disabled={!selectedZone}
              />
            </Field>
          </div>
        )}
      </Card>

      {rosterError && <Banner tone="danger" className="mb-4" aria-live="assertive">{rosterError}</Banner>}
      {issueError && <Banner tone="danger" className="mb-4" aria-live="assertive">{issueError}</Banner>}

      {rosterLoading && (
        <div className="max-w-3xl flex justify-center py-8" aria-label={t('rosterLoading')}>
          <Spinner size={24} />
        </div>
      )}

      {!rosterLoading && roster && (
        <Card className="max-w-3xl mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-sm text-muted-fg">{t('rosterCount', { count: prisoners.length })}</p>
            <p className="text-sm font-medium" aria-live="polite">
              {t('selectedCount', { selected: selectedIds.size, max: maxBatchSize })}
            </p>
          </div>
          {prisoners.length === 0 ? (
            <p className="text-sm text-muted-fg">{t('rosterEmpty')}</p>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <label className="flex items-center gap-3 p-3 bg-accent-subtle font-medium text-sm">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={prisoners.length > maxBatchSize}
                  className="size-4 accent-primary"
                />
                {t('selectAll')}
              </label>
              {prisoners.length > maxBatchSize && (
                <p className="px-3 py-2 text-xs text-warning-fg">
                  {t('selectionLimit', { max: maxBatchSize })}
                </p>
              )}
              <ul className="divide-y divide-border">
                {prisoners.map((prisoner) => {
                  const checked = selectedIds.has(prisoner.id);
                  return (
                    <li key={prisoner.id}>
                      <label className="flex items-start gap-3 p-3 hover:bg-accent-subtle">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePrisoner(prisoner.id)}
                          disabled={!checked && selectedIds.size >= maxBatchSize}
                          aria-label={t('selectPrisoner', { name: prisoner.name, id: prisoner.legacyId })}
                          className="size-4 mt-0.5 accent-primary"
                        />
                        <span>
                          <span className="block font-semibold">{prisoner.name}</span>
                          <span className="block text-xs text-muted-fg font-mono">{prisoner.legacyId}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card className="max-w-3xl mb-4">
        <fieldset>
          <legend className="text-lg font-semibold mb-3">{t('modeTitle')}</legend>
          <div className="flex flex-col gap-3">
            {MODES.map((candidate) => {
              const capability = capabilityFor(capabilities, candidate);
              if (!capability) return null;
              return (
                <label
                  key={candidate}
                  className={[
                    'flex items-start gap-3 border border-border rounded p-3',
                    capability.available ? 'cursor-pointer' : 'opacity-60',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="order-form-mode"
                    value={candidate}
                    checked={mode === candidate}
                    onChange={() => setMode(candidate)}
                    disabled={!capability.available}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">{modeLabel(t, candidate)}</span>
                    <span className="block text-xs text-muted-fg">
                      {capabilityDetails(t, capability)}
                    </span>
                    {!capability.available && (
                      <span className="block text-xs text-danger mt-1">
                        {t('modeUnavailableReason', { reason: unavailableReason(t, capability.unavailableCode) })}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Button
          className="mt-4"
          onClick={() => setDialogOpen(true)}
          disabled={issuing || selectedIdList.length === 0 || selectedIdList.length > maxBatchSize || !currentCapability?.available}
        >
          {t('issueButton')}
        </Button>
      </Card>

      {issued && previewUrl && (
        <section aria-live="polite">
          <h2 ref={previewHeadingRef} tabIndex={-1} className="text-lg font-semibold mb-2">
            {t('previewTitle')}
          </h2>
          <p className="text-sm mb-2">
            {t('previewSummary', {
              count: issued.manifest.length,
              pages: issued.pageCount,
              mode: modeLabel(t, issued.mode),
              orientation: orientationLabel(t, issued.orientation),
              date: formatDate(issued.serviceDate),
            })}
          </p>
          <Banner tone="warning" className="mb-3">
            {t('printGuidance', { orientation: orientationLabel(t, issued.orientation) })}
          </Banner>
          <Button className="mb-3" variant="outline" onClick={printIssuedForms}>
            {t('printButton')}
          </Button>
          <iframe
            ref={previewFrameRef}
            title={t('previewFrameTitle')}
            src={`${previewUrl}#toolbar=0`}
            className="w-full border border-border rounded"
            style={{ height: '75vh', minHeight: 480 }}
          />
        </section>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogTitle>{t('issueTitle')}</DialogTitle>
          <DialogDescription>
            {t('issueDescription', { count: selectedIdList.length })} {t('reissueWarning')}
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button onClick={issue} loading={issuing} disabled={issuing}>{t('issueButton')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface MasterState {
  master: GenericOmrMaster;
  url: string;
}

function GenericMasterWorkflow({ capabilities }: { capabilities: OmrFormCapabilities }) {
  const { t } = useTranslation('orderForm');
  const [masters, setMasters] = useState<Partial<Record<OmrFormMode, MasterState>>>({});
  const [loadingMode, setLoadingMode] = useState<OmrFormMode | null>(null);
  const [errors, setErrors] = useState<Partial<Record<OmrFormMode, string>>>({});
  const [previewMode, setPreviewMode] = useState<OmrFormMode | null>(null);
  const mastersRef = useRef<Partial<Record<OmrFormMode, MasterState>>>({});
  const requestsRef = useRef<Partial<Record<OmrFormMode, Promise<MasterState>>>>({});
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => () => {
    Object.values(mastersRef.current).forEach((entry) => {
      if (entry) URL.revokeObjectURL(entry.url);
    });
  }, []);

  const loadMaster = useCallback((mode: OmrFormMode): Promise<MasterState> => {
    const cached = mastersRef.current[mode];
    if (cached) return Promise.resolve(cached);
    const inFlight = requestsRef.current[mode];
    if (inFlight) return inFlight;

    setLoadingMode(mode);
    setErrors((current) => ({ ...current, [mode]: undefined }));
    const request = omrForms.getGenericMaster(mode)
      .then((master) => {
        const state = { master, url: pdfObjectUrl(master.pdfBase64) };
        mastersRef.current = { ...mastersRef.current, [mode]: state };
        setMasters(mastersRef.current);
        return state;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t('genericMasterFailed');
        setErrors((current) => ({ ...current, [mode]: message }));
        throw error;
      })
      .finally(() => {
        delete requestsRef.current[mode];
        setLoadingMode((current) => current === mode ? null : current);
      });
    requestsRef.current[mode] = request;
    return request;
  }, [t]);

  async function preview(mode: OmrFormMode) {
    try {
      await loadMaster(mode);
      setPreviewMode(mode);
      requestAnimationFrame(() => previewHeadingRef.current?.focus());
    } catch {
      // The card-level error remains visible and actionable.
    }
  }

  async function download(mode: OmrFormMode) {
    try {
      const state = await loadMaster(mode);
      const link = document.createElement('a');
      link.href = state.url;
      link.download = `generic-order-form-${mode}-${state.master.revision}.pdf`;
      link.click();
    } catch {
      // The card-level error remains visible and actionable.
    }
  }

  async function print(mode: OmrFormMode) {
    try {
      const state = await loadMaster(mode);
      setPreviewMode(mode);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (previewFrameRef.current?.contentWindow) previewFrameRef.current.contentWindow.print();
        else window.open(state.url, '_blank', 'noopener,noreferrer');
      }));
    } catch {
      // The card-level error remains visible and actionable.
    }
  }

  const activePreview = previewMode ? masters[previewMode] : undefined;

  return (
    <>
      <Banner tone="info" className="mb-4 max-w-5xl">
        {t('genericReadOnlyNotice')}
      </Banner>
      <div className="grid max-w-5xl gap-4 md:grid-cols-2">
        {MODES.map((mode) => {
          const capability = capabilityFor(capabilities, mode);
          if (!capability) return null;
          const busy = loadingMode === mode;
          return (
            <Card key={mode} className="flex min-h-64 flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
                    {t('genericMasterBadge')}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">{modeLabel(t, mode)}</h2>
                </div>
                <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-semibold text-success">
                  {t('genericReadOnlyBadge')}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-fg">{capabilityDetails(t, capability)}</p>
              <p className="mt-3 text-sm">{t(mode === 'code' ? 'genericCodeDescription' : 'genericFullListDescription')}</p>
              {!capability.available && (
                <Banner tone="danger" className="mt-4">
                  {t('modeUnavailableReason', { reason: unavailableReason(t, capability.unavailableCode) })}
                </Banner>
              )}
              {errors[mode] && <Banner tone="danger" className="mt-4" aria-live="assertive">{errors[mode]}</Banner>}
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Button type="button" onClick={() => void preview(mode)} loading={busy} disabled={!capability.available}>
                  {t('genericPreviewButton')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void download(mode)} disabled={busy || !capability.available}>
                  {t('genericDownloadButton')}
                </Button>
                <Button type="button" variant="outline" onClick={() => void print(mode)} disabled={busy || !capability.available}>
                  {t('genericPrintButton')}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {previewMode && activePreview && (
        <section className="mt-6 max-w-5xl" aria-live="polite">
          <h2 ref={previewHeadingRef} tabIndex={-1} className="text-lg font-semibold">
            {t('genericPreviewTitle', { mode: modeLabel(t, previewMode) })}
          </h2>
          <p className="mt-1 text-sm text-muted-fg">
            {t('genericPreviewSummary', {
              revision: activePreview.master.revision,
              orientation: orientationLabel(t, activePreview.master.orientation),
              reference: activePreview.master.formReference,
            })}
          </p>
          <Banner tone="warning" className="my-3">
            {t('genericPrintGuidance', { orientation: orientationLabel(t, activePreview.master.orientation) })}
          </Banner>
          <iframe
            ref={previewFrameRef}
            title={t('genericPreviewFrameTitle', { mode: modeLabel(t, previewMode) })}
            src={`${activePreview.url}#toolbar=0`}
            className="w-full rounded border border-border"
            style={{ height: '75vh', minHeight: 480 }}
          />
        </section>
      )}
    </>
  );
}

type Translate = ReturnType<typeof useTranslation<'orderForm'>>['t'];

function modeLabel(t: Translate, value: OmrFormMode): string {
  return t(value === 'code' ? 'codeMode' : 'fullListMode');
}

function orientationLabel(t: Translate, value: 'portrait' | 'landscape'): string {
  return t(value);
}

function capabilityDetails(t: Translate, capability: OmrFormModeCapability): string {
  return t(
    capability.mode === 'full_list' && capability.capacity !== null
      ? 'fullListModeDetails'
      : 'modeDetails',
    {
      orientation: orientationLabel(t, capability.orientation),
      count: capability.itemCount,
      capacity: capability.capacity,
      revision: capability.templateRevision ?? t('templateNotAvailable'),
    },
  );
}

function unavailableReason(t: Translate, code: string | null): string {
  switch (code) {
    case 'OMR_FORM.TEMPLATE_NOT_READY':
      return t('templateNotReady');
    case 'OMR_TEMPLATE.CAPACITY_EXCEEDED':
      return t('fullListCapacityExceeded');
    case 'OMR_TEMPLATE.CATALOG_CHANGED':
      return t('fullListCatalogChanged');
    default:
      return code ?? t('modeUnavailable');
  }
}
