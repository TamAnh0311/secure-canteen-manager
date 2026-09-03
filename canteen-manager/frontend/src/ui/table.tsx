import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {}

export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, ...props },
  ref,
) {
  return (
    <table
      ref={ref}
      className={['w-full border-collapse bg-card', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

export const THead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function THead(props, ref) {
    return <thead ref={ref} {...props} />;
  },
);

export const TBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TBody(props, ref) {
    return <tbody ref={ref} {...props} />;
  },
);

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
}

export const Tr = forwardRef<HTMLTableRowElement, TrProps>(function Tr(
  { selected = false, className, ...props },
  ref,
) {
  return (
    <tr
      ref={ref}
      className={[
        'hover:bg-muted',
        selected ? 'bg-accent-subtle shadow-[inset_3px_0_0_var(--primary)]' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
});

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export const Th = forwardRef<HTMLTableCellElement, ThProps>(function Th(
  { numeric = false, className, ...props },
  ref,
) {
  return (
    <th
      ref={ref}
      className={[
        'sticky top-0 z-[1] bg-muted text-muted-fg text-xs font-semibold uppercase tracking-[0.04em]',
        'px-3 py-2 border-b border-border',
        numeric ? 'text-right' : 'text-left',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
});

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export const Td = forwardRef<HTMLTableCellElement, TdProps>(function Td(
  { numeric = false, className, ...props },
  ref,
) {
  return (
    <td
      ref={ref}
      className={[
        'px-3 py-2 border-b border-border text-sm align-middle',
        numeric ? 'text-right' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
});

export interface EmptyRowProps {
  colSpan: number;
  children?: ReactNode;
}

export function EmptyRow({ colSpan, children }: EmptyRowProps) {
  const { t } = useTranslation('common');
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-fg">
        {children ?? t('noData')}
      </td>
    </tr>
  );
}
