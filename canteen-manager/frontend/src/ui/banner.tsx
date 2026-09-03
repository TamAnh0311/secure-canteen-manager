import type { HTMLAttributes, ReactNode } from 'react';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<BannerTone, string> = {
  info: 'bg-info-bg text-info-fg',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
};

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone: BannerTone;
  children: ReactNode;
}

export function Banner({ tone, children, className, ...props }: BannerProps) {
  return (
    <div
      className={[
        'flex items-center gap-2.5 px-3.5 py-2.5 rounded text-[13px]',
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}
