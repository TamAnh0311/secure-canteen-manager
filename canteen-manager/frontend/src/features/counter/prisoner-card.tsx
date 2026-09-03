import { useTranslation } from 'react-i18next';
import { formatVnd, formatTime } from '@/lib/format';
import {
  Banner,
  Card,
  CardHead,
  EmptyRow,
  StatusChip,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/ui';
import type { PrisonerLookup, AccountTransactionType } from '@/lib/types';

interface PrisonerCardProps {
  lookup: PrisonerLookup;
}

function txTypeLabel(
  type: AccountTransactionType,
  t: (key: string) => string,
): string {
  if (type === 'topup') return t('typeTopup');
  if (type === 'order_debit') return t('typeOrderDebit');
  return t('typeReversal');
}

export function PrisonerCard({ lookup }: PrisonerCardProps) {
  const { t } = useTranslation('counter');
  const { user, balance, ledger } = lookup;

  return (
    <div className="flex flex-col gap-4">
      {/* Info card */}
      <Card>
        <CardHead
          title={t('cardTitle')}
          actions={
            <StatusChip
              tone={user.isActive ? 'success' : 'neutral'}
              label={user.isActive ? t('statusActive') : t('statusInactive')}
              dot
            />
          }
        />

        {!user.isActive && (
          <Banner tone="warning" className="mb-3">
            {t('inactiveNotice')}
          </Banner>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-fg">{t('labelId')}</dt>
          <dd className="font-mono">{user.legacyId}</dd>

          <dt className="text-muted-fg">{t('labelName')}</dt>
          <dd className="font-medium">{user.name}</dd>

          {user.zone && (
            <>
              <dt className="text-muted-fg">{t('labelZone')}</dt>
              <dd>{user.zone}</dd>
            </>
          )}

          <dt className="text-muted-fg">{t('labelBalance')}</dt>
          <dd className="font-semibold tabular-nums">{formatVnd(balance)}</dd>
        </dl>
      </Card>

      {/* Ledger table */}
      <Card className="p-0">
        <CardHead title={t('ledgerTitle')} className="px-4 pt-4" />
        <Table>
          <THead>
            <Tr>
              <Th>{t('colDate')}</Th>
              <Th>{t('colType')}</Th>
              <Th numeric>{t('colAmount')}</Th>
              <Th numeric>{t('colBalance')}</Th>
              <Th>{t('colMethod')}</Th>
              <Th>{t('colRef')}</Th>
            </Tr>
          </THead>
          <TBody>
            {ledger.length === 0 ? (
              <EmptyRow colSpan={6}>{t('ledgerEmpty')}</EmptyRow>
            ) : (
              ledger.map((tx) => (
                <Tr key={tx.id}>
                  <Td>
                    <span className="font-mono text-xs text-muted-fg">
                      {formatTime(tx.createdAt, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      } as Intl.DateTimeFormatOptions)}
                    </span>
                  </Td>
                  <Td>{txTypeLabel(tx.type, t)}</Td>
                  <Td numeric>
                    <span
                      className={
                        tx.amount >= 0 ? 'text-success-fg' : 'text-danger-fg'
                      }
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {formatVnd(tx.amount)}
                    </span>
                  </Td>
                  <Td numeric className="tabular-nums">
                    {formatVnd(tx.balanceAfter)}
                  </Td>
                  <Td>{tx.method ?? '—'}</Td>
                  <Td>
                    <span className="font-mono text-xs text-muted-fg">
                      {tx.ref ?? '—'}
                    </span>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
