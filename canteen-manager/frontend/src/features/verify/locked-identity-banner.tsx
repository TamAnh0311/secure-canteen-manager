import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatVnd } from '@/lib/format';
import type { ExistingOrderSummary, MatchedUser, QueueSheetItem } from '@/lib/types';

interface LockedIdentityBannerProps {
  identity: MatchedUser | null;
  balance: number | null;
  form: QueueSheetItem['form'];
  existingOrder: ExistingOrderSummary | null;
}

export function LockedIdentityBanner({
  identity,
  balance,
  form,
  existingOrder,
}: LockedIdentityBannerProps) {
  const { t } = useTranslation('verify');
  const titleId = useId();
  const ready = Boolean(identity && form.serial && form.revision && form.serviceDate);

  return (
    <section
      aria-labelledby={titleId}
      className={[
        'rounded-md border px-4 py-3',
        ready ? 'border-success/40 bg-success-bg' : 'border-danger bg-danger-bg',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {t('lockedIdentityTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-fg">{t('lockedIdentityHint')}</p>
        </div>
        <span className="rounded bg-card px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-success">
          {t('lockedIdentityBadge')}
        </span>
      </div>

      {!ready || !identity ? (
        <p className="mt-3 text-sm font-semibold text-danger">{t('lockedIdentityMissing')}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <IdentityField label={t('lockedName')} value={identity.name} />
          <IdentityField label={t('lockedPrisonerId')} value={identity.legacyId} mono />
          <IdentityField label={t('lockedZone')} value={identity.zone ?? '—'} />
          <IdentityField label={t('lockedCell')} value={identity.cell ?? '—'} />
          <IdentityField
            label={t('lockedBalance')}
            value={balance == null ? '—' : formatVnd(balance)}
            mono
          />
          <IdentityField label={t('lockedServiceDate')} value={formatDate(form.serviceDate)} />
          <IdentityField label={t('lockedFormSerial')} value={form.serial} mono />
          <IdentityField label={t('lockedRevision')} value={form.revision} mono />
        </dl>
      )}

      {existingOrder && (
        <div className="mt-3 rounded border border-warning/50 bg-warning-bg px-3 py-2 text-xs text-foreground">
          <p className="font-semibold">{t('lockedExistingOrder')}</p>
          <ul className="mt-1 space-y-0.5">
            {existingOrder.items.map((item) => (
              <li key={item.menuItemId}>
                {item.name} × {item.quantity}
              </li>
            ))}
          </ul>
          <p className="mt-1 font-semibold tabular-nums">
            {t('supersedePriorTotal')}: {formatVnd(existingOrder.total)}
          </p>
        </div>
      )}
    </section>
  );
}

function IdentityField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-fg">{label}</dt>
      <dd className={['mt-0.5 break-words font-medium', mono ? 'font-mono tabular-nums' : ''].join(' ')}>
        {value}
      </dd>
    </div>
  );
}
