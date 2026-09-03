import type { HTMLAttributes } from 'react';

export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClasses: Record<ChipTone, string> = {
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
};

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone: ChipTone;
  label: string;
  dot?: boolean;
}

export function StatusChip({ tone, label, dot = false, className, ...props }: StatusChipProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium leading-none',
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {dot && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

export interface ConfidenceChipProps extends HTMLAttributes<HTMLSpanElement> {
  value: number;
}

// value is a 0..1 fraction; values > 1 are treated as already-percent.
export function ConfidenceChip({ value, className, ...props }: ConfidenceChipProps) {
  const pct = value > 1 ? value : value * 100;
  const rounded = Math.round(pct);
  const band =
    pct >= 95
      ? 'bg-success-bg text-success-fg'
      : pct >= 80
        ? 'bg-warning-bg text-warning-fg'
        : 'bg-danger-bg text-danger-fg';
  return (
    <span
      className={[
        'inline-block font-mono text-[11px] font-semibold px-1.5 py-px rounded-[4px]',
        band,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {rounded}%
    </span>
  );
}
