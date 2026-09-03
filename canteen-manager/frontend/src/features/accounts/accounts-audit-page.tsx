import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { accounts, users } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import { formatVnd, formatTime, formatDate } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Input,
  PageHeader,
  Spinner,
  StatusChip,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/ui';
import { detentionStatusLabel } from '@/lib/detention-status';
import type { AccountTransactionType, User } from '@/lib/types';

const PAGE_SIZE = 20;

function txTypeLabel(
  type: AccountTransactionType,
  t: (key: string) => string,
): string {
  if (type === 'topup') return t('typeTopup');
  if (type === 'order_debit') return t('typeOrderDebit');
  return t('typeReversal');
}

export function AccountsAuditPage() {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');

  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [page, setPage] = useState(0);

  // Debounce search input ~300 ms. Timer handle lives in a ref — it never drives
  // rendering, so keeping it out of state avoids a re-render on every keystroke.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchQ(val);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => setDebouncedQ(val), 300);
    },
    [],
  );

  const {
    data: searchResults,
    loading: searchLoading,
  } = useQuery(
    () =>
      debouncedQ.trim()
        ? users.listUsers({ q: debouncedQ.trim(), limit: 10 })
        : Promise.resolve([] as User[]),
    [debouncedQ],
  );

  const {
    data: balance,
    loading: balanceLoading,
    error: balanceError,
  } = useQuery(
    () =>
      selectedUser
        ? accounts.getBalance(selectedUser.id)
        : Promise.resolve(null),
    [selectedUser?.id],
  );

  const {
    data: ledger,
    loading: ledgerLoading,
    error: ledgerError,
  } = useQuery(
    () =>
      selectedUser
        ? accounts.getLedger(selectedUser.id, {
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          })
        : Promise.resolve(null),
    [selectedUser?.id, page],
  );

  function selectPrisoner(user: User) {
    setSelectedUser(user);
    setSearchQ('');
    setDebouncedQ('');
    setPage(0);
  }

  const showResults =
    debouncedQ.trim().length > 0 && (searchResults ?? []).length > 0;

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

      {/* Prisoner search */}
      <div className="relative max-w-md mb-4">
        <Input
          type="search"
          value={searchQ}
          onChange={handleSearchChange}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchAriaLabel')}
        />
        {searchLoading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size={14} />
          </span>
        )}
        {showResults && (
          <ul
            role="listbox"
            aria-label={t('searchResultsLabel')}
            className="absolute z-10 mt-1 w-full bg-card border border-border rounded shadow-md"
          >
            {(searchResults ?? []).map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedUser?.id === u.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent-subtle focus:outline-none focus:bg-accent-subtle"
                  onClick={() => selectPrisoner(u)}
                >
                  <span className="font-mono text-xs text-muted-fg mr-2">
                    {u.legacyId}
                  </span>
                  {u.name}
                  {u.zone && (
                    <span className="ml-2 text-xs text-muted-fg">
                      · {u.zone}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {debouncedQ.trim().length > 0 &&
          !searchLoading &&
          (searchResults ?? []).length === 0 && (
            <p className="mt-1 text-sm text-muted-fg">{t('searchNoMatch')}</p>
          )}
      </div>

      {/* No prisoner selected yet */}
      {!selectedUser && (
        <Banner tone="info">{t('selectPrisonerPrompt')}</Banner>
      )}

      {/* Selected prisoner audit view */}
      {selectedUser && (
        <div className="flex flex-col gap-4">
          {/* Balance card */}
          <Card>
            <CardHead title={selectedUser.name} />
            {balanceLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-fg">
                <Spinner size={14} />
                <span>{t('loading')}</span>
              </div>
            )}
            {balanceError && (
              <Banner tone="danger">
                {t('balanceError', { message: balanceError.message })}
              </Banner>
            )}
            {!balanceLoading && balance && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm max-w-xs mt-2">
                <dt className="text-muted-fg">{t('balanceLabel')}</dt>
                <dd className="font-semibold tabular-nums">
                  {formatVnd(balance.balance)}
                </dd>
              </dl>
            )}

            {/* Read-only detainee profile (synced from legacy / demo seed). Null fields → —. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm max-w-sm mt-4 pt-4 border-t border-border">
              <dt className="text-muted-fg">{t('profileDob')}</dt>
              <dd>{selectedUser.dateOfBirth ? formatDate(selectedUser.dateOfBirth) : '—'}</dd>
              <dt className="text-muted-fg">{t('profileHometown')}</dt>
              <dd>{selectedUser.hometown ?? '—'}</dd>
              <dt className="text-muted-fg">{t('profileOffense')}</dt>
              <dd>{selectedUser.offense ?? '—'}</dd>
              <dt className="text-muted-fg">{t('profileArrestDate')}</dt>
              <dd>{selectedUser.arrestDate ? formatDate(selectedUser.arrestDate) : '—'}</dd>
              <dt className="text-muted-fg">{t('profileDetention')}</dt>
              <dd>
                {selectedUser.detentionStatus ? (
                  <StatusChip
                    tone="neutral"
                    label={detentionStatusLabel(selectedUser.detentionStatus, tCommon)}
                  />
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </Card>

          {/* Ledger table */}
          <Card className="p-0">
            <CardHead title={t('pageTitle')} className="px-4 pt-4" />

            {ledgerLoading && (
              <div className="flex justify-center py-6">
                <Spinner size={20} />
              </div>
            )}

            {ledgerError && (
              <div className="px-4 pb-4">
                <Banner tone="danger">
                  {t('ledgerError', { message: ledgerError.message })}
                </Banner>
              </div>
            )}

            {!ledgerLoading && (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t('colDate')}</Th>
                    <Th>{t('colType')}</Th>
                    <Th numeric>{t('colAmount')}</Th>
                    <Th numeric>{t('colBalanceAfter')}</Th>
                    <Th>{t('colMethod')}</Th>
                    <Th>{t('colRef')}</Th>
                    <Th>{t('colOperator')}</Th>
                    <Th>{t('colNote')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(ledger ?? []).length === 0 ? (
                    <EmptyRow colSpan={8}>{t('ledgerEmpty')}</EmptyRow>
                  ) : (
                    (ledger ?? []).map((tx) => (
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
                              tx.amount >= 0
                                ? 'text-success-fg'
                                : 'text-danger-fg'
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
                        <Td>
                          <span className="font-mono text-xs text-muted-fg">
                            {tx.operatorId}
                          </span>
                        </Td>
                        <Td>{tx.note ?? '—'}</Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>
            )}

            {/* Pagination */}
            {!ledgerLoading && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  {t('prev')}
                </Button>
                <span className="text-muted-fg">
                  {t('pageInfo', { page: page + 1 })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(ledger ?? []).length < PAGE_SIZE}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('next')}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
