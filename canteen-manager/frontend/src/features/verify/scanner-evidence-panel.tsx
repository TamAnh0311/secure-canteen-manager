import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueueSheetItem } from '@/lib/types';
import { Banner, Button } from '@/ui';
import { fetchImageObjectUrl } from '@/lib/api-client';

interface ScannerEvidencePanelProps {
  evidence: NonNullable<QueueSheetItem['scannerEvidence']>;
  onSelectItemCandidate?: (rowIndex: number, code: string) => void;
  onRetryArtifact?: (artifactId: string) => Promise<void>;
  onReject?: () => void;
}

const terminalStates = new Set(['missing', 'permanent_failed', 'integrity_fault', 'purged']);
interface ArtifactPreviewProps {
  mediaType: string;
  url: string;
  label: string;
}

function ArtifactPreview({ mediaType, url, label }: ArtifactPreviewProps) {
  const { t } = useTranslation('verify');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const isImage = mediaType.startsWith('image/');

  useEffect(() => {
    if (!isImage) {
      setObjectUrl(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setError(false);
    fetchImageObjectUrl(url).then((next) => {
      if (cancelled) URL.revokeObjectURL(next);
      else setObjectUrl(next);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      setObjectUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [isImage, retry, url]);

  return (
    <div className="grid gap-2">
      {objectUrl && isImage && (
        <img src={objectUrl} alt={label} className="max-h-44 w-full rounded-md object-contain bg-muted" />
      )}
      {error && (
        <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
          {t('imageRetry')}
        </Button>
      )}
    </div>
  );
}

export function ScannerEvidencePanel({
  evidence,
  onSelectItemCandidate,
  onRetryArtifact,
  onReject,
}: ScannerEvidencePanelProps) {
  const { t } = useTranslation('verify');
  const unavailable = evidence.artifacts.filter((artifact) => artifact.state !== 'available');
  const terminal = unavailable.some((artifact) => terminalStates.has(artifact.state));
  const [isExpanded, setIsExpanded] = useState(false);
  const artifactKindLabel = (kind: string) => {
    const known = ['source', 'crop', 'review-crop'];
    return t(`scannerArtifactKind.${known.includes(kind) ? kind : 'unknown'}`);
  };

  useEffect(() => {
    setIsExpanded(false);
  }, [evidence.documentId, evidence.resultId, evidence.revision]);

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="scanner-evidence-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p id="scanner-evidence-title" className="font-semibold">{t('scannerEvidenceTitle')}</p>
          <p className="mt-1 text-xs text-muted-fg">
            {t(evidence.outcome === 'accepted' ? 'scannerOutcomeAccepted' : 'scannerOutcomeNeedsReview')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={isExpanded}
            aria-controls="scanner-evidence-details"
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            {t(isExpanded ? 'scannerEvidenceHide' : 'scannerEvidenceShow')}
          </Button>
          <span className="rounded-full bg-accent-subtle px-3 py-1 text-xs font-semibold">
            {t(evidence.outcome === 'accepted' ? 'scannerOutcomeAccepted' : 'scannerOutcomeNeedsReview')}
          </span>
        </div>
      </div>

      {unavailable.length > 0 && (
        <Banner tone={terminal ? 'danger' : 'warning'} className="mt-3">
          {t(terminal ? 'scannerArtifactsTerminal' : 'scannerArtifactsPending')}
          {onRetryArtifact && unavailable.some((artifact) => artifact.state !== 'purged') && (
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={() => {
                const artifact = unavailable.find((item) => item.state !== 'purged');
                if (artifact) void onRetryArtifact(artifact.artifactId);
              }}
            >
              {t('scannerArtifactRetry')}
            </Button>
          )}
          {terminal && onReject && <Button variant="ghost" size="sm" className="ml-2" onClick={onReject}>{t('confirmReject')}</Button>}
        </Banner>
      )}

      <div id="scanner-evidence-details" hidden={!isExpanded}>
        {evidence.catalogueDrift && (
          <Banner tone="warning" className="mt-3">{t('scannerCatalogueDrift')}</Banner>
        )}
        {evidence.items.length > 0 && (
          <div className="mt-4 grid gap-2">
            {evidence.items.map((item) => (
              <div key={item.rowIndex} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{t('scannerRow', { row: item.rowIndex + 1 })}</span>
                  <span className="font-mono text-xs">{item.catalogueItemId ?? t('scannerUnresolved')}</span>
                </div>
                {item.itemRawText && <p className="mt-1 text-muted-fg">{item.itemRawText}</p>}
                {item.quantityRawText && <p className="mt-1 text-xs text-muted-fg">{t('scannerQuantityRaw', { value: item.quantityRawText })}</p>}
                {item.itemCandidates.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2" aria-label={t('scannerCandidatesTitle')}>
                    {item.itemCandidates.map((candidate) => (
                      <Button
                        key={candidate.catalogueItemId}
                        variant="outline"
                        size="sm"
                        onClick={() => onSelectItemCandidate?.(item.rowIndex, candidate.catalogueItemId)}
                      >
                        {candidate.catalogueItemId}
                      </Button>
                    ))}
                  </div>
                )}
                {item.quantityCandidates.length > 0 && (
                  <p className="mt-1 text-xs text-muted-fg">
                    {t('scannerQuantityCandidates', {
                      candidates: item.quantityCandidates.map((candidate) => candidate.value).filter((value) => value !== null).join(', '),
                    })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {evidence.artifacts.length > 0 && (
          <ul className="mt-4 grid gap-2" aria-label={t('scannerArtifactsTitle')}>
            {evidence.artifacts.map((artifact) => (
              <li key={artifact.artifactId} className="grid gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span>{artifactKindLabel(artifact.kind)}{artifact.rowIndex === null ? '' : ` · ${t('scannerRow', { row: artifact.rowIndex + 1 })}`}</span>
                  <span>{t(`scannerArtifactState.${['pending', 'processing', 'retrying', 'available', 'missing', 'permanent_failed', 'integrity_fault', 'purged'].includes(artifact.state) ? artifact.state : 'unknown'}`)}</span>
                </div>
                {artifact.state === 'available' && artifact.kind !== 'source' && artifact.url && artifact.mediaType.startsWith('image/') && (
                  <ArtifactPreview
                    mediaType={artifact.mediaType}
                    url={artifact.url}
                    label={artifactKindLabel(artifact.kind)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
