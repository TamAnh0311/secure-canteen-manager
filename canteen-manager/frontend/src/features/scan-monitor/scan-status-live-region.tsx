/**
 * Visually-hidden live region that announces scan-monitor KPI updates to AT.
 *
 * Politeness is "polite" (not assertive) because scan updates are informational
 * — AT queues the announcement until a natural speech pause. Assertive would
 * interrupt the operator every 2 s on each auto-poll cycle.
 *
 * aria-atomic="true" ensures the full sentence is read on each update rather
 * than only the changed text fragment.
 */
interface ScanStatusLiveRegionProps {
  message: string;
}

export function ScanStatusLiveRegion({ message }: ScanStatusLiveRegionProps) {
  return (
    <div
      className="sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
