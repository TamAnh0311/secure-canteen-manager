import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { menu } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatTime } from '@/lib/format';
import type { FormTemplateMode, MenuFormTemplateStatus } from '@/lib/types';
import '@/styles/print.css';
import { Banner, Button, Card, CardHead, PageHeader, Spinner, useToast } from '@/ui';

const MODES: FormTemplateMode[] = ['code', 'full_list'];

function pdfUrl(pdfBase64: string): string {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

interface TemplateCardProps {
  status: MenuFormTemplateStatus;
  generating: boolean;
  onGenerate: () => void;
}

function TemplateCard({ status, generating, onGenerate }: TemplateCardProps) {
  const { t } = useTranslation('formPrint');
  const isCode = status.mode === 'code';
  const capacityExceeded = status.capacity != null && status.activeItemCount > status.capacity;

  return (
    <section aria-labelledby={`${status.mode}-template-title`}>
      <Card className="h-full">
        <CardHead
          title={<span id={`${status.mode}-template-title`}>{t(isCode ? 'codeTitle' : 'fullListTitle')}</span>}
          actions={
            <Button
              variant="outline"
              onClick={onGenerate}
              disabled={generating || !status.available}
              loading={generating}
            >
              {t(
                isCode
                  ? status.generatedAt ? 'regenerateCode' : 'generateCode'
                  : status.generatedAt ? 'regenerateFullList' : 'generateFullList',
              )}
            </Button>
          }
        />
        <p className="text-sm text-muted-fg mb-3">
          {t(isCode ? 'codeGeometry' : 'fullListGeometry')}
        </p>
        <div aria-live="polite">
          {!status.available ? (
            <Banner tone="danger">
              {capacityExceeded
                ? t('templateUnavailableCapacity', {
                    count: status.activeItemCount,
                    capacity: status.capacity,
                  })
                : t('templateUnavailable')}
            </Banner>
          ) : status.generatedAt ? (
            <Banner tone="success">
              {t('templateGenerated', {
                time: formatTime(status.generatedAt, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                } as Intl.DateTimeFormatOptions),
                version: status.version ?? '—',
              })}
            </Banner>
          ) : (
            <Banner tone="info">{t('templateNotGenerated')}</Banner>
          )}
        </div>
      </Card>
    </section>
  );
}

export function FormPrintPage() {
  const { t } = useTranslation('formPrint');
  const { toast } = useToast();
  const [generatingMode, setGeneratingMode] = useState<FormTemplateMode | null>(null);
  const [preview, setPreview] = useState<{ mode: FormTemplateMode; url: string } | null>(null);
  const activeUrl = useRef<string | null>(null);
  const formQuery = useQuery(() => menu.getForm(), []);

  useEffect(() => () => {
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
  }, []);

  async function handleGenerate(mode: FormTemplateMode) {
    if (generatingMode) return;
    setGeneratingMode(mode);
    try {
      const result = await menu.generateForm(mode);
      const url = pdfUrl(result.pdfBase64);
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      activeUrl.current = url;
      setPreview({ mode, url });
      formQuery.refetch();
      toast({ tone: 'success', message: t('toastGenerated') });
    } catch (err) {
      toast({
        tone: 'danger',
        message: err instanceof Error ? err.message : t('toastGenerateFailed'),
      });
    } finally {
      setGeneratingMode(null);
    }
  }

  const templates = formQuery.data?.templates;
  const previewModeTitle = preview?.mode === 'code' ? t('codeTitle') : t('fullListTitle');

  return (
    <>
      <div className="no-print">
        <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

        {formQuery.error && <Banner tone="danger" className="mb-4">{formQuery.error.message}</Banner>}
        <Banner tone="warning" className="mb-4">{t('calibrationOnly')}</Banner>

        {formQuery.loading && !templates && (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        )}
        {templates && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {MODES.map((mode) => (
              <TemplateCard
                key={mode}
                status={templates[mode]}
                generating={generatingMode === mode}
                onGenerate={() => void handleGenerate(mode)}
              />
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div className="flex flex-col gap-4">
          <Card className="no-print p-3">
            <CardHead title={t('pdfPreviewModeTitle', { mode: previewModeTitle })} className="mb-0" />
          </Card>
          <div className="no-print">
            <iframe
              src={`${preview.url}#toolbar=0`}
              title={t(preview.mode === 'code' ? 'codeIframeTitle' : 'fullListIframeTitle')}
              className="w-full border border-border rounded"
              style={{ height: '80vh', minHeight: 480 }}
            />
          </div>
        </div>
      )}
    </>
  );
}
