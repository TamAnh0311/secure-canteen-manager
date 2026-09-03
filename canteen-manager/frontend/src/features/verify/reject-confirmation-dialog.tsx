import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui';

interface RejectConfirmationDialogProps {
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function RejectConfirmationDialog({
  open,
  saving,
  onOpenChange,
  onConfirm,
}: RejectConfirmationDialogProps) {
  const { t } = useTranslation('verify');

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent maxWidth={440}>
        <DialogTitle>{t('rejectDialogTitle')}</DialogTitle>
        <DialogDescription>{t('rejectDialogBody')}</DialogDescription>
        <div className="mt-3 rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {t('rejectDialogWarning')}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('rejectDialogCancel')}
          </Button>
          <Button
            variant="outline"
            className="border-danger text-danger hover:bg-danger-bg"
            loading={saving}
            onClick={onConfirm}
          >
            {t('rejectDialogConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
