import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { audit } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import type { AuditLogEntry } from '@/lib/api/audit';
import {
  Banner,
  Button,
  Card,
  EmptyRow,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusChip,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/ui';

const PAGE_SIZE = 25;

/** Format an ISO timestamp to a readable local string. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Map HTTP status codes to visual tones. */
function statusTone(code: number): 'success' | 'danger' | 'neutral' {
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400) return 'danger';
  return 'neutral';
}

/** Distinct action values seen across canteen operations. */
const ACTION_OPTIONS = [
  'menu.create', 'menu.update', 'menu.delete', 'menu.reorder',
  'form.generate', 'order.create', 'order.accept', 'order.reject',
  'operator.create', 'operator.deactivate', 'operator.zone_update',
  'config.purchase_limit_update', 'config.payment_update',
  'auth.login', 'kiosk.order',
];

const RESOURCE_OPTIONS = [
  'menu', 'orders', 'operators', 'counter', 'auth',
  'kiosk', 'purchase-limit-config', 'payment-config',
];

export function AuditLogPage() {
  const { t } = useTranslation('auditLog');

  // Filter state
  const [operatorFilter, setOperatorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  // Applied filters (only update on submit)
  const [appliedFilters, setAppliedFilters] = useState<{
    operatorId?: string;
    action?: string;
    resource?: string;
    dateFrom?: string;
    dateTo?: string;
  }>({});

  const query = useQuery(
    () => audit.listAuditLogs({
      ...appliedFilters,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [appliedFilters, page],
  );

  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));

  // Expanded detail row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setAppliedFilters({
      operatorId: operatorFilter || undefined,
      action: actionFilter || undefined,
      resource: resourceFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  }

  function handleReset() {
    setOperatorFilter('');
    setActionFilter('');
    setResourceFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(0);
    setAppliedFilters({});
  }

  function roleLabel(role: string): string {
    const map: Record<string, string> = {
      admin: t('roleAdmin'),
      operator: t('roleOperator'),
      cashier: t('roleCashier'),
    };
    return map[role] ?? role;
  }

  function toggleDetail(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function formatDetail(detail: string | null): string {
    if (!detail) return '—';
    try {
      return JSON.stringify(JSON.parse(detail), null, 2);
    } catch {
      return detail;
    }
  }

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

      {query.error && (
        <Banner tone="danger" className="mb-4">{query.error.message}</Banner>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <form onSubmit={handleFilter} className="grid gap-x-4 gap-y-2 md:grid-cols-3 lg:grid-cols-6 items-end">
          <Field label={t('filterAction')} htmlFor="audit-action">
            <Select
              id="audit-action"
              value={actionFilter}
              onValueChange={setActionFilter}
              items={[
                { value: '', label: t('allActions') },
                ...ACTION_OPTIONS.map((a) => ({ value: a, label: a })),
              ]}
              ariaLabel={t('filterAction')}
            />
          </Field>
          <Field label={t('filterResource')} htmlFor="audit-resource">
            <Select
              id="audit-resource"
              value={resourceFilter}
              onValueChange={setResourceFilter}
              items={[
                { value: '', label: t('allResources') },
                ...RESOURCE_OPTIONS.map((r) => ({ value: r, label: r })),
              ]}
              ariaLabel={t('filterResource')}
            />
          </Field>
          <Field label={t('filterDateFrom')} htmlFor="audit-date-from">
            <Input id="audit-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label={t('filterDateTo')} htmlFor="audit-date-to">
            <Input id="audit-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <div className="flex gap-2 items-end mb-3.5">
            <Button type="submit">{t('filterApply')}</Button>
            <Button type="button" variant="ghost" onClick={handleReset}>{t('filterReset')}</Button>
          </div>
        </form>
      </Card>

      {/* Results */}
      <Card className="p-0">
        {query.loading && !query.data && (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        )}
        <Table>
          <THead>
            <Tr>
              <Th>{t('colTime')}</Th>
              <Th>{t('colOperator')}</Th>
              <Th>{t('colRole')}</Th>
              <Th>{t('colAction')}</Th>
              <Th>{t('colResource')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th>{t('colIp')}</Th>
              <Th>{t('colDetail')}</Th>
            </Tr>
          </THead>
          <TBody>
            {!query.loading && (query.data?.data.length ?? 0) === 0 ? (
              <EmptyRow colSpan={8}>{t('empty')}</EmptyRow>
            ) : (
              query.data?.data.map((entry: AuditLogEntry) => (
                <>
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap text-xs">{formatTime(entry.createdAt)}</Td>
                    <Td className="font-medium">{entry.username}</Td>
                    <Td>{roleLabel(entry.role)}</Td>
                    <Td>
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{entry.action}</code>
                    </Td>
                    <Td>
                      <span className="text-xs">{entry.resource}</span>
                      {entry.resourceId && (
                        <span className="text-xs text-gray-400 ml-1" title={entry.resourceId}>
                          #{entry.resourceId.slice(0, 8)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <StatusChip
                        tone={statusTone(entry.statusCode)}
                        label={String(entry.statusCode)}
                      />
                    </Td>
                    <Td className="text-xs text-gray-500">{entry.ip ?? '—'}</Td>
                    <Td>
                      {entry.detail ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleDetail(entry.id)}
                        >
                          {expandedId === entry.id ? t('hideDetail') : t('showDetail')}
                        </Button>
                      ) : '—'}
                    </Td>
                  </Tr>
                  {expandedId === entry.id && entry.detail && (
                    <Tr key={`${entry.id}-detail`}>
                      <Td colSpan={8}>
                        <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto max-h-48 whitespace-pre-wrap">
                          {formatDetail(entry.detail)}
                        </pre>
                      </Td>
                    </Tr>
                  )}
                </>
              ))
            )}
          </TBody>
        </Table>

        {/* Pagination */}
        {query.data && query.data.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm">
            <span className="text-gray-500">
              {t('total', { count: query.data.total })} — {t('page', { page: page + 1, totalPages })}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('prev')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
