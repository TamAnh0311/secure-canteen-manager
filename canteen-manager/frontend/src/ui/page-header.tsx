import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={['flex items-start justify-between gap-4 mb-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div>
        <h1 className="text-xl font-semibold leading-[1.4]">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted-fg mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
