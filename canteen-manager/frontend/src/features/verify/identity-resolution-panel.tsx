import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { scans } from '@/lib/api';
import { formatDate, formatVnd } from '@/lib/format';
import type {
  IdentityCandidate,
  IdentityEvidence,
  IdentityPreview,
  QueueSheetItem,
  RankedIdentityCandidate,
} from '@/lib/types';
import { Banner, Button, Field, Input, Spinner, Textarea } from '@/ui';

export type IdentitySelectionSource = 'ranked' | 'manual';

export interface IdentitySelection {
  user: IdentityCandidate;
  source: IdentitySelectionSource;
}

type IdentitySelectionSheet = {
  bindingKind: QueueSheetItem['bindingKind'];
  rankedCandidates: QueueSheetItem['rankedCandidates'];
  scannerEvidence: Pick<NonNullable<QueueSheetItem['scannerEvidence']>, 'requiresIdentityReason'> | null;
};

type ScannerReasonEvidence = Pick<
  NonNullable<QueueSheetItem['scannerEvidence']>,
  'requiresIdentityReason' | 'catalogueDrift' | 'blockers'
>;

export type ReviewReasonKind = 'identity' | 'scanner_review' | null;

export interface IdentityResolutionPanelProps {
  sheetId: string;
  bindingKind?: 'generic' | 'scanner';
  form: QueueSheetItem['form'];
  evidence: IdentityEvidence[];
  rankedCandidates: RankedIdentityCandidate[];
  selection: IdentitySelection | null;
  preview: IdentityPreview | null;
  previewLoading: boolean;
  previewError: string | null;
  reason: string;
  reasonKind?: ReviewReasonKind;
  onSelect: (selection: IdentitySelection) => void;
  onReasonChange: (reason: string) => void;
  onRetryPreview: () => void;
}

export function identityReasonRequired(
  selection: IdentitySelection | null,
  rankedCandidates: RankedIdentityCandidate[],
): boolean {
  if (!selection) return false;
  return selection.source === 'manual'
    || (rankedCandidates.length > 0 && rankedCandidates[0].userId !== selection.user.id);
}

export function reviewReasonKind(
  selection: IdentitySelection | null,
  rankedCandidates: RankedIdentityCandidate[],
  scannerEvidence: ScannerReasonEvidence | null,
): ReviewReasonKind {
  if (
    identityReasonRequired(selection, rankedCandidates) ||
    scannerEvidence?.requiresIdentityReason === true
  ) {
    return 'identity';
  }
  if (
    scannerEvidence?.catalogueDrift === true ||
    scannerEvidence?.blockers.some((blocker) =>
      blocker.includes('.ITEM_') || blocker.includes('.QUANTITY_')
    )
  ) {
    return 'scanner_review';
  }
  return null;
}

export function scannerExactIdentitySelection(
  sheet: IdentitySelectionSheet | null,
): IdentitySelection | null {
  if (sheet?.bindingKind !== 'scanner' || sheet.scannerEvidence?.requiresIdentityReason !== false) {
    return null;
  }
  const candidate = sheet.rankedCandidates[0];
  if (!candidate || !candidate.reasons.includes('exact_id') || !candidate.reasons.includes('room_match')) {
    return null;
  }
  return {
    source: 'ranked',
    user: {
      id: candidate.userId,
      legacyId: candidate.legacyId,
      name: candidate.name,
      zone: candidate.zone,
      cell: candidate.cell,
    },
  };
}

export function IdentityResolutionPanel({
  sheetId,
  bindingKind = 'generic',
  form,
  evidence,
  rankedCandidates,
  selection,
  preview,
  previewLoading,
  previewError,
  reason,
  reasonKind,
  onSelect,
  onReasonChange,
  onRetryPreview,
}: IdentityResolutionPanelProps) {
  const { t } = useTranslation('verify');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IdentityCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const searchRequestRef = useRef(0);

  useEffect(() => {
    searchRequestRef.current += 1;
    setQuery('');
    setResults([]);
    setSearching(false);
    setSearchError(null);
    setSearched(false);
  }, [sheetId]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2 || searching) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearching(true);
    setSearchError(null);
    try {
      const nextResults = await scans.searchIdentityCandidates(sheetId, normalized);
      if (searchRequestRef.current !== requestId) return;
      setResults(nextResults);
      setSearched(true);
    } catch (error) {
      if (searchRequestRef.current !== requestId) return;
      setResults([]);
      setSearched(true);
      setSearchError(error instanceof Error ? error.message : t('identitySearchFailed'));
    } finally {
      if (searchRequestRef.current === requestId) setSearching(false);
    }
  }

  const resolvedReasonKind = reasonKind === undefined
    ? (identityReasonRequired(selection, rankedCandidates) ? 'identity' : null)
    : reasonKind;
  const scannerReviewReason = resolvedReasonKind === 'scanner_review';
  const selectedId = selection?.user.id ?? null;
  const firstCandidate = rankedCandidates[0];
  const exactScannerCandidate = bindingKind === 'scanner' && firstCandidate &&
    firstCandidate.reasons.includes('exact_id') && firstCandidate.reasons.includes('room_match')
    ? firstCandidate
    : null;
  const exactScannerSelection = Boolean(
    exactScannerCandidate && selection?.source === 'ranked' && selectedId === exactScannerCandidate.userId,
  );
  const evidenceFlagLabel = (flag: string) => {
    const normalized = flag.toLowerCase();
    const known = ['low_confidence', 'conflict', 'missing'];
    return t(`identityEvidenceFlag.${known.includes(normalized) ? normalized : 'unknown'}`);
  };
  const evidenceStatusLabel = (status: string | undefined) => {
    const known = ['recognized', 'blank', 'abstained', 'error'];
    return known.includes(status ?? '') ? t(`identityEvidenceStatus.${status}`) : t('identityEvidenceUnknown');
  };
  const candidateReasonLabel = (reason: string) => {
    const normalized = reason.toLowerCase();
    const known = ['exact_id', 'room_match', 'room_mismatch', 'cell_exact', 'name_exact', 'name_similar', 'name_mismatch', 'prisoner_id_exact', 'prisoner_id_conflict', 'optional_id_absent'];
    return t(known.includes(normalized) ? `candidateReason.${normalized}` : 'candidateReason.unknown');
  };

  return (
    <section aria-labelledby="identity-resolution-title" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="identity-resolution-title" className="text-base font-semibold">
            {t(bindingKind === 'scanner' ? 'identityScannerResolutionTitle' : 'identityResolutionTitle')}
          </h2>
          <p className="mt-1 text-xs text-muted-fg">
            {t(bindingKind === 'scanner' ? 'identityScannerResolutionHint' : 'identityResolutionHint')}
          </p>
        </div>
        <span className="rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning-fg">
          {t(exactScannerSelection ? 'identityScannerExactBadge' : 'identityExplicitBadge')}
        </span>
      </div>

      <dl
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
        aria-label={t(bindingKind === 'scanner' ? 'identityScannerEvidenceTitle' : 'identityEvidenceTitle')}
      >
        {(['name', 'cell', 'prisoner_id'] as const).map((field) => {
          const item = evidence.find((candidate) => candidate.field === field);
          return (
            <div key={field} className="rounded border border-border bg-background px-3 py-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                {t(`identityEvidenceField.${field}`)}
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {item?.rawText || evidenceStatusLabel(item?.status)}
              </dd>
              <dd className="mt-1 text-xs text-muted-fg">
                {evidenceStatusLabel(item?.status)}
                {item?.flags.length ? ` · ${item.flags.map(evidenceFlagLabel).join(', ')}` : ''}
              </dd>
            </div>
          );
        })}
      </dl>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">{t('rankedCandidatesTitle')}</legend>
        <p className="mt-1 text-xs text-muted-fg">
          {t(bindingKind === 'scanner' ? 'rankedCandidatesScannerHint' : 'rankedCandidatesHint')}
        </p>
        {rankedCandidates.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-border p-3 text-sm text-muted-fg">
            {t('rankedCandidatesEmpty')}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {rankedCandidates.map((candidate, index) => (
              <CandidateOption
                key={candidate.userId}
                name={`identity-${sheetId}`}
                candidate={{
                  id: candidate.userId,
                  legacyId: candidate.legacyId,
                  name: candidate.name,
                  zone: candidate.zone,
                  cell: candidate.cell,
                }}
                checked={selection?.source === 'ranked' && selectedId === candidate.userId}
                label={t('rankedCandidateLabel', { rank: index + 1 })}
                details={candidate.reasons.map(candidateReasonLabel).join(' · ')}
                onSelect={(user) => onSelect({ user, source: 'ranked' })}
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className="my-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-fg">{t('identityOr')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={(event) => void search(event)} role="search">
        <Field
          label={t('identitySearchLabel')}
          htmlFor={`identity-search-${sheetId}`}
          help={t('identitySearchHelp')}
        >
          <div className="flex gap-2">
            <Input
              id={`identity-search-${sheetId}`}
              type="search"
              minLength={2}
              maxLength={100}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              aria-describedby={`identity-search-${sheetId}-help`}
            />
            <Button type="submit" variant="outline" loading={searching} disabled={query.trim().length < 2}>
              {t('identitySearchButton')}
            </Button>
          </div>
        </Field>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {searchError && <Banner tone="danger">{searchError}</Banner>}
        {searched && !searchError && results.length === 0 && (
          <p className="rounded border border-dashed border-border p-3 text-sm text-muted-fg">
            {t('identitySearchEmpty')}
          </p>
        )}
      </div>

      {results.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">{t('identitySearchResults')}</legend>
          {results.map((candidate) => (
            <CandidateOption
              key={candidate.id}
              name={`identity-${sheetId}`}
              candidate={candidate}
              checked={selection?.source === 'manual' && selectedId === candidate.id}
              label={t('identityManualCandidate')}
              onSelect={(user) => onSelect({ user, source: 'manual' })}
            />
          ))}
        </fieldset>
      )}

      <div className="mt-4" aria-live="polite" aria-atomic="true">
        {!selection && (
          <Banner tone="warning">
            {t(bindingKind === 'scanner' ? 'identityScannerSelectionRequired' : 'identitySelectionRequired')}
          </Banner>
        )}
        {selection && previewLoading && (
          <div className="flex items-center gap-2 rounded border border-border p-3 text-sm">
            <Spinner size={16} /> {t('identityPreviewLoading')}
          </div>
        )}
        {selection && previewError && (
          <Banner tone="danger">
            <span>{previewError}</span>
            <Button type="button" variant="ghost" size="sm" className="ml-2" onClick={onRetryPreview}>
              {t('identityPreviewRetry')}
            </Button>
          </Banner>
        )}
        {selection && preview && preview.user.id === selection.user.id && (
          <div className="rounded border border-primary/30 bg-accent-subtle p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
              {t('identityPreviewTitle')}
            </p>
            <p className="mt-1 font-semibold">{preview.user.name}</p>
            <p className="text-sm text-muted-fg">
              {preview.user.legacyId} · {preview.user.zone ?? '—'} · {preview.user.cell ?? '—'}
            </p>
            <p className="mt-2 text-sm">
              {t('identityPreviewBalance')}: <span className="font-semibold tabular-nums">{formatVnd(preview.balance)}</span>
              {' · '}{t('lockedServiceDate')}: {formatDate(form.serviceDate)}
            </p>
            {preview.existingOrder && (
              <div className="mt-2 rounded border border-warning/40 bg-warning-bg p-2 text-sm">
                <p className="font-semibold text-warning-fg">
                  {t('identityPreviewExistingOrder', { total: formatVnd(preview.existingOrder.total) })}
                </p>
                {preview.existingOrder.items.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-fg">
                    {preview.existingOrder.items.map((item) => (
                      <li key={item.menuItemId}>
                        {t('identityPreviewExistingItem', { quantity: item.quantity, name: item.name })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {resolvedReasonKind && (
        <Field
          className="mt-4 mb-0"
          label={t(scannerReviewReason ? 'scannerReviewReasonLabel' : 'identityReasonLabel')}
          htmlFor={`identity-reason-${sheetId}`}
          required
          help={t(scannerReviewReason ? 'scannerReviewReasonHelp' : 'identityReasonHelp', {
            count: reason.length,
            max: 500,
          })}
          error={reason.trim()
            ? undefined
            : t(scannerReviewReason ? 'scannerReviewReasonRequired' : 'identityReasonRequired')}
        >
          <Textarea
            id={`identity-reason-${sheetId}`}
            value={reason}
            maxLength={500}
            required
            aria-invalid={!reason.trim()}
            aria-describedby={reason.trim()
              ? `identity-reason-${sheetId}-help`
              : `identity-reason-${sheetId}-error`}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </Field>
      )}
    </section>
  );
}

function CandidateOption({
  name,
  candidate,
  checked,
  label,
  details,
  onSelect,
}: {
  name: string;
  candidate: IdentityCandidate;
  checked: boolean;
  label: string;
  details?: string;
  onSelect: (candidate: IdentityCandidate) => void;
}) {
  return (
    <label className={[
      'flex cursor-pointer items-start gap-3 rounded border p-3 transition-colors',
      checked ? 'border-primary bg-accent-subtle' : 'border-border hover:bg-muted',
    ].join(' ')}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => onSelect(candidate)}
        className="mt-1 size-4 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-fg">{label}</span>
        <span className="block font-semibold">{candidate.name}</span>
        <span className="block text-sm text-muted-fg">
          {candidate.legacyId} · {candidate.zone ?? '—'} · {candidate.cell ?? '—'}
        </span>
        {details && <span className="mt-1 block text-xs text-muted-fg">{details}</span>}
      </span>
    </label>
  );
}
