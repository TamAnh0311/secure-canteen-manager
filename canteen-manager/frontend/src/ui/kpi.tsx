import type { HTMLAttributes, ReactNode } from 'react';

export interface KpiProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
}

export function Kpi({ label, value, className, ...props }: KpiProps) {
  return (
    <div className={['flex flex-col gap-1', className].filter(Boolean).join(' ')} {...props}>
      <div className="font-mono text-[28px] font-semibold leading-[1.1]">{value}</div>
      <div className="text-[13px] text-muted-fg">{label}</div>
    </div>
  );
}
