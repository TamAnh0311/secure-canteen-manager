import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export interface DialogContentProps {
  children: ReactNode;
  maxWidth?: number | string;
  className?: string;
}

export function DialogContent({ children, maxWidth = 480, className }: DialogContentProps) {
  const { t } = useTranslation('common');
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
      <RadixDialog.Content
        style={{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }}
        className={[
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2',
          'bg-card border border-border rounded shadow-lg p-5 focus:outline-none',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
        <RadixDialog.Close
          aria-label={t('close')}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded text-muted-fg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ✕
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RadixDialog.Title
      className={['text-base font-semibold pr-8', className].filter(Boolean).join(' ')}
    >
      {children}
    </RadixDialog.Title>
  );
}

export function DialogDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Description
      className={['text-[13px] text-muted-fg mt-1', className].filter(Boolean).join(' ')}
    >
      {children}
    </RadixDialog.Description>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={['flex items-center justify-end gap-2 mt-5', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
