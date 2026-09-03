import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchImageObjectUrl } from '@/lib/api-client';
import type { QueueSheetItem } from '@/lib/types';
import { isSafeScannerOriginalMediaType } from './scanner-artifact-media';

function revoke(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

// Loads the auth-gated warped sheet image as a blob object URL (a plain <img src>
// cannot carry the Bearer token), prefetches the next sheet so advancing feels
// instant, and revokes object URLs to avoid leaks. fetchImageObjectUrl prepends
// the /api base; warpedImageUrl is base-relative.
export function useWarpedImage(current: QueueSheetItem | null, next: QueueSheetItem | null) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const prefetchRef = useRef<{ id: string; url: string; mediaType: string } | null>(null);

  const mediaSource = useCallback((sheet: QueueSheetItem | null): { path: string; mediaType: string } | null => {
    if (!sheet) return null;
    if (sheet.warpedImageUrl) {
      return { path: sheet.warpedImageUrl, mediaType: 'image/png' };
    }
    const source = sheet.scannerEvidence?.artifacts.find((artifact) =>
      artifact.kind === 'source' &&
      artifact.state === 'available' &&
      artifact.url &&
      isSafeScannerOriginalMediaType(artifact.mediaType),
    );
    return source?.url
      ? { path: source.url, mediaType: source.mediaType.toLowerCase() }
      : null;
  }, []);

  const loadImage = useCallback((sheet: QueueSheetItem | null) => {
    if (!sheet) {
      setImageUrl(null);
      setMediaType(null);
      setImageError(false);
      setImageLoading(false);
      return;
    }
    const source = mediaSource(sheet);
    if (!source) {
      setImageUrl(null);
      setMediaType(null);
      setImageError(false);
      setImageLoading(false);
      return;
    }
    // Reuse the prefetched URL when it matches the sheet we are switching to.
    const pre = prefetchRef.current;
    if (pre && pre.id === sheet.id) {
      prefetchRef.current = null;
      setImageError(false);
      setImageLoading(false);
      setImageUrl(pre.url);
      setMediaType(pre.mediaType);
      return;
    }
    setImageError(false);
    setImageLoading(true);
    setMediaType(null);
    let cancelled = false;
    fetchImageObjectUrl(source.path)
      .then((url) => {
        if (cancelled) {
          revoke(url);
          return;
        }
        setImageUrl(url);
        setMediaType(source.mediaType);
        setImageLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setImageError(true);
        setImageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaSource]);

  // Load the current image; revoke the previous object URL on change/unmount.
  useEffect(() => {
    const cleanup = loadImage(current);
    return () => {
      cleanup?.();
      setImageUrl((prev) => {
        revoke(prev);
        return null;
      });
      setMediaType(null);
    };
  }, [current, loadImage]);

  // Prefetch the next sheet's image once the current one is in view.
  useEffect(() => {
    const source = mediaSource(next);
    if (!next || !source || prefetchRef.current?.id === next.id) return;
    let cancelled = false;
    fetchImageObjectUrl(source.path)
      .then((url) => {
        if (cancelled) {
          revoke(url);
          return;
        }
        prefetchRef.current = { id: next.id, url, mediaType: source.mediaType };
      })
      .catch(() => {
        /* prefetch is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [mediaSource, next]);

  // Revoke any unconsumed prefetched object URL when the screen unmounts.
  useEffect(
    () => () => {
      revoke(prefetchRef.current?.url ?? null);
      prefetchRef.current = null;
    },
    [],
  );

  const retryImage = useCallback(() => loadImage(current), [current, loadImage]);

  return { imageUrl, mediaType, imageError, imageLoading, retryImage };
}
