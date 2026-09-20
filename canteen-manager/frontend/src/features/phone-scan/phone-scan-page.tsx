import { useCallback, useEffect, useRef, useState } from 'react';
import { processScan, ScanProcessResult } from '@/lib/api/scan-local';

type Phase = 'camera' | 'preview' | 'processing' | 'result';

const styles = {
  root: {
    background: '#111',
    color: '#fff',
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    fontFamily: 'system-ui, sans-serif',
    padding: '0',
  },
  header: {
    width: '100%',
    padding: '12px 16px',
    background: '#1a1a1a',
    borderBottom: '1px solid #333',
    fontSize: '18px',
    fontWeight: 600,
    textAlign: 'center' as const,
  },
  body: {
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '16px',
    gap: '16px',
  },
  video: {
    width: '100%',
    maxWidth: '480px',
    borderRadius: '8px',
    background: '#000',
    display: 'block',
  },
  canvas: {
    display: 'none',
  },
  previewImg: {
    width: '100%',
    maxWidth: '480px',
    borderRadius: '8px',
    display: 'block',
  },
  button: {
    padding: '14px 28px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    minWidth: '140px',
  },
  primaryButton: {
    background: '#2563eb',
    color: '#fff',
  },
  secondaryButton: {
    background: '#374151',
    color: '#fff',
  },
  dangerButton: {
    background: '#dc2626',
    color: '#fff',
  },
  row: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
  },
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #333',
    borderTop: '4px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  statusBadge: (status: ScanProcessResult['status']) => ({
    padding: '6px 14px',
    borderRadius: '20px',
    fontWeight: 700,
    fontSize: '14px',
    background:
      status === 'created'
        ? '#166534'
        : status === 'review_required'
          ? '#92400e'
          : '#374151',
    color: '#fff',
  }),
  table: {
    width: '100%',
    maxWidth: '480px',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    borderBottom: '1px solid #333',
    color: '#9ca3af',
    fontWeight: 600,
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #222',
  },
  warning: {
    background: '#451a03',
    border: '1px solid #78350f',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '14px',
    color: '#fde68a',
    width: '100%',
    maxWidth: '480px',
  },
  error: {
    background: '#450a0a',
    border: '1px solid #7f1d1d',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '14px',
    color: '#fca5a5',
    width: '100%',
    maxWidth: '480px',
  },
  sectionLabel: {
    fontSize: '13px',
    color: '#9ca3af',
    alignSelf: 'flex-start',
    maxWidth: '480px',
    width: '100%',
  },
};

// Inject keyframe animation once
const SPIN_STYLE_ID = 'phone-scan-spin';
if (typeof document !== 'undefined' && !document.getElementById(SPIN_STYLE_ID)) {
  const el = document.createElement('style');
  el.id = SPIN_STYLE_ID;
  el.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(el);
}

export function PhoneScanPage() {
  const [phase, setPhase] = useState<Phase>('camera');
  const [imageData, setImageData] = useState<string | null>(null);
  const [result, setResult] = useState<ScanProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Camera error: ${msg}`);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Auto-start camera on mount, stop on unmount
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setImageData(dataUrl);
    stopCamera();
    setPhase('preview');
  }, [stopCamera]);

  const handleRetake = useCallback(() => {
    setImageData(null);
    setResult(null);
    setError(null);
    setPhase('camera');
    startCamera();
  }, [startCamera]);

  const handleSubmit = useCallback(async () => {
    if (!imageData) return;
    setPhase('processing');
    setError(null);
    try {
      // Strip the data URL prefix to get raw base64
      const base64 = imageData.split(',')[1];
      const res = await processScan(base64);
      setResult(res);
      setPhase('result');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Submission failed: ${msg}`);
      setPhase('preview');
    }
  }, [imageData]);

  const handleScanAnother = useCallback(() => {
    setImageData(null);
    setResult(null);
    setError(null);
    setPhase('camera');
    startCamera();
  }, [startCamera]);

  return (
    <div style={styles.root}>
      <div style={styles.header}>Canteen Scan</div>

      <div style={styles.body}>
        {/* Camera phase */}
        {phase === 'camera' && (
          <>
            {error && <div style={styles.error}>{error}</div>}
            <video
              ref={videoRef}
              style={styles.video}
              autoPlay
              playsInline
              muted
            />
            <canvas ref={canvasRef} style={styles.canvas} />
            <button
              style={{ ...styles.button, ...styles.primaryButton }}
              onClick={handleCapture}
              disabled={!!error}
            >
              Capture
            </button>
          </>
        )}

        {/* Preview phase */}
        {phase === 'preview' && imageData && (
          <>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.sectionLabel}>Review your image before submitting:</div>
            <img src={imageData} alt="Captured form" style={styles.previewImg} />
            <div style={styles.row}>
              <button
                style={{ ...styles.button, ...styles.secondaryButton }}
                onClick={handleRetake}
              >
                Retake
              </button>
              <button
                style={{ ...styles.button, ...styles.primaryButton }}
                onClick={handleSubmit}
              >
                Submit
              </button>
            </div>
          </>
        )}

        {/* Processing phase */}
        {phase === 'processing' && (
          <>
            <div style={styles.spinner} />
            <div style={{ color: '#9ca3af', fontSize: '14px' }}>Processing scan…</div>
          </>
        )}

        {/* Result phase */}
        {phase === 'result' && result && (
          <>
            <div style={styles.statusBadge(result.status)}>
              {result.status === 'created'
                ? 'Order Created'
                : result.status === 'review_required'
                  ? 'Review Required'
                  : 'No Items Found'}
            </div>

            {result.orderId && (
              <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                Order ID: <strong style={{ color: '#fff' }}>{result.orderId}</strong>
              </div>
            )}

            {result.items.length > 0 && (
              <>
                <div style={styles.sectionLabel}>Items:</div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Code</th>
                      <th style={styles.th}>Name</th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.menuItemId}>
                        <td style={styles.td}>{item.code}</td>
                        <td style={styles.td}>{item.name}</td>
                        <td style={{ ...styles.td, textAlign: 'right' as const }}>{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {result.warnings.length > 0 && (
              <>
                <div style={styles.sectionLabel}>Warnings:</div>
                {result.warnings.map((w, i) => (
                  <div key={i} style={styles.warning}>
                    {w}
                  </div>
                ))}
              </>
            )}

            <div style={styles.row}>
              <button
                style={{ ...styles.button, ...styles.primaryButton }}
                onClick={handleScanAnother}
              >
                Scan Another
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
