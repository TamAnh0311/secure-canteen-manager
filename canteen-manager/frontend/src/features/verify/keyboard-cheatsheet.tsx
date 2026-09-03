import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/ui';

interface KeyboardCheatsheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Reference overlay for the full key map; opened with `?`.
export function KeyboardCheatsheet({ open, onOpenChange }: KeyboardCheatsheetProps) {
  const { t } = useTranslation('verify');

  const ROWS: { keys: string[]; actionKey: string }[] = [
    { keys: ['Tab'],         actionKey: 'cheatTab' },
    { keys: ['↵'],           actionKey: 'cheatEnter' },
    { keys: ['R'],           actionKey: 'cheatReject' },
    { keys: ['S'],           actionKey: 'cheatSkip' },
    { keys: ['+', '−'],      actionKey: 'cheatZoom' },
    { keys: ['F'],           actionKey: 'cheatFit' },
    { keys: ['?'],           actionKey: 'cheatHelp' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent maxWidth={420}>
        <DialogTitle>{t('cheatsheetTitle')}</DialogTitle>
        <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
          {ROWS.map((row) => (
            <div key={row.actionKey} className="contents">
              <dt className="flex items-center gap-1">
                {row.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="inline-flex min-w-[22px] justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted-fg">{t(row.actionKey as Parameters<typeof t>[0])}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
