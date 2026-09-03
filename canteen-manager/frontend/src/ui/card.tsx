import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={['bg-card border border-border rounded shadow p-4', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </div>
  );
});

export interface CardHeadProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  actions?: ReactNode;
}

export const CardHead = forwardRef<HTMLDivElement, CardHeadProps>(function CardHead(
  { title, actions, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={['flex items-center justify-between mb-3', className].filter(Boolean).join(' ')}
      {...props}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
});
