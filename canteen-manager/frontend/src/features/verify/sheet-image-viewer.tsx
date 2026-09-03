import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner } from '@/ui';
import type { RoiTemplate } from '@/lib/types';

// The right pane tells the image which field group + index is focused so the
// matching overlay can be highlighted. The confirm group has no ROI box, so it
// highlights nothing — it only participates in Tab group navigation.
export type FocusedField =
  | { group: 'menu'; position: number }
  | { group: 'confirm' }
  | null;

interface SheetImageViewerProps {
  imageUrl: string | null;
  mediaType: string | null;
  loading: boolean;
  error: boolean;
  roiTemplate: RoiTemplate | null;
  focused: FocusedField;
  zoom: number;
  onRetry: () => void;
}

// Left work surface: the perspective-corrected sheet on a dark backdrop with ROI
// rectangles drawn over the v3 order lines. The warped image is in
// template pixel space, so a single rendered/template scale maps every box.
export function SheetImageViewer({
  imageUrl,
  mediaType,
  loading,
  error,
  roiTemplate,
  focused,
  zoom,
  onRetry,
}: SheetImageViewerProps) {
  const { t } = useTranslation('verify');
  const imgRef = useRef<HTMLImageElement>(null);
  const [rendered, setRendered] = useState({ w: 0, h: 0 });
  const isPdf = mediaType === 'application/pdf';

  // Track the rendered image size so overlays scale to the displayed (zoomed)
  // bitmap rather than the intrinsic template pixels.
  const measure = useCallback(() => {
    const el = imgRef.current;
    if (el) setRendered({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, imageUrl, zoom]);

  const scaleX = roiTemplate ? rendered.w / roiTemplate.template_width_px : 0;
  const scaleY = roiTemplate ? rendered.h / roiTemplate.template_height_px : 0;
  const overlayLines = roiTemplate?.entry_regions?.length
    ? roiTemplate.entry_regions
    : roiTemplate?.order_lines ?? [];

  return (
    <section
      aria-label={t('imageSectionLabel')}
      className="relative bg-[#0F172A] overflow-auto grid place-items-center py-14"
    >
      <div className="absolute top-3 left-3 z-10 flex gap-1.5 text-xs text-white/80">
        <span className="rounded bg-white/10 px-2 py-1">{t('imageZoomHint', { pct: Math.round(zoom * 100) })}</span>
        <span className="rounded bg-white/10 px-2 py-1">
          <kbd className="font-mono">+</kbd>/<kbd className="font-mono">−</kbd> {t('imageZoomKeys')}
        </span>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-2 text-white/70">
          <Spinner size={28} />
          <span className="text-[13px]">{t('imageLoading')}</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col items-center gap-3 text-white/80">
          <span aria-hidden="true" className="text-3xl">
            ⚠
          </span>
          <p className="text-[13px]">{t('imageError')}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('imageRetry')}
          </Button>
          <p className="text-xs text-white/50 max-w-[260px] text-center">
            {t('imageEditable')}
          </p>
        </div>
      )}

      {imageUrl && !loading && !error && isPdf && (
        <div className="relative" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          <iframe
            src={imageUrl}
            title={t('imagePdfTitle')}
            className="block w-[640px] max-w-none rounded bg-white shadow-lg"
            style={{ height: '75vh', minHeight: 480 }}
          />
        </div>
      )}

      {imageUrl && !loading && !error && !isPdf && (
        <div className="relative" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt={t('imageAlt')}
            onLoad={measure}
            className="block w-[640px] max-w-none bg-white rounded shadow-lg"
            width={roiTemplate?.template_width_px}
            height={roiTemplate?.template_height_px}
          />
          {roiTemplate && scaleX > 0 && (
            <svg
              className="absolute inset-0 pointer-events-none"
              width={rendered.w}
              height={rendered.h}
              aria-hidden="true"
            >
              {overlayLines.flatMap((line) =>
                [...line.code_boxes, ...line.qty_boxes].map((box, boxIndex) => {
                  const active = focused?.group === 'menu' && focused.position === line.line_index;
                  return (
                    <rect
                      key={`line-${line.line_index}-${boxIndex}`}
                      x={box.x * scaleX}
                      y={box.y * scaleY}
                      width={box.w * scaleX}
                      height={box.h * scaleY}
                      fill={active ? 'rgba(37,99,235,0.18)' : 'none'}
                      stroke={active ? '#2563EB' : 'rgba(37,99,235,0.55)'}
                      strokeWidth={active ? 3 : 1.5}
                      rx={2}
                    />
                  );
                }),
              )}
            </svg>
          )}
        </div>
      )}
    </section>
  );
}
