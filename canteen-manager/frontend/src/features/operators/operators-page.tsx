import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { operators, users } from '@/lib/api';
import { useQuery } from '@/lib/use-query';
import type { Operator, Role } from '@/lib/types';
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
  useToast,
} from '@/ui';

const UNASSIGNED = '__unassigned__';

export function OperatorsPage() {
  const { t } = useTranslation('operators');
  const { toast } = useToast();
  const operatorQuery = useQuery(() => operators.listOperators(), []);
  const zoneQuery = useQuery(() => users.listZones(), []);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [zone, setZone] = useState(UNASSIGNED);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const zoneItems = [
    { value: UNASSIGNED, label: t('unassigned') },
    ...(zoneQuery.data ?? []).map((value) => ({ value, label: value })),
  ];
  const roleItems = [
    { value: 'operator', label: t('roleOperator') },
    { value: 'cashier', label: t('roleCashier') },
    { value: 'admin', label: t('roleAdmin') },
  ];
  const canCreate = username.trim() && displayName.trim() && password.length >= 8
    && (role !== 'operator' || zone !== UNASSIGNED);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    try {
      await operators.createOperator({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role,
        zone: role === 'operator' && zone !== UNASSIGNED ? zone : null,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole('operator');
      setZone(UNASSIGNED);
      operatorQuery.refetch();
      toast({ tone: 'success', message: t('created') });
    } catch (error) {
      toast({ tone: 'danger', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setCreating(false);
    }
  }

  async function updateZone(operator: Operator, nextZone: string) {
    setBusyId(operator.id);
    try {
      await operators.updateOperatorZone(
        operator.id,
        nextZone === UNASSIGNED ? null : nextZone,
      );
      operatorQuery.refetch();
      toast({ tone: 'success', message: t('zoneUpdated') });
    } catch (error) {
      toast({ tone: 'danger', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusyId(null);
    }
  }

  async function deactivate(operator: Operator) {
    setBusyId(operator.id);
    try {
      await operators.deactivateOperator(operator.id);
      operatorQuery.refetch();
      toast({ tone: 'success', message: t('deactivated') });
    } catch (error) {
      toast({ tone: 'danger', message: error instanceof Error ? error.message : t('actionFailed') });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />
      {(operatorQuery.error || zoneQuery.error) && (
        <Banner tone="danger" className="mb-4">
          {(operatorQuery.error ?? zoneQuery.error)?.message}
        </Banner>
      )}

      <Card className="mb-4">
        <h2 className="text-lg font-semibold mb-4">{t('createTitle')}</h2>
        <form onSubmit={handleCreate} className="grid gap-x-4 md:grid-cols-2">
          <Field label={t('username')} htmlFor="operator-username" required>
            <Input id="operator-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label={t('displayName')} htmlFor="operator-display-name" required>
            <Input id="operator-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label={t('password')} htmlFor="operator-password" required help={t('passwordHelp')}>
            <Input id="operator-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t('role')} htmlFor="operator-role" required>
            <Select id="operator-role" value={role} onValueChange={(v) => setRole(v as Role)} items={roleItems} ariaLabel={t('role')} />
          </Field>
          <Field label={t('zone')} htmlFor="operator-zone" required={role === 'operator'} help={role !== 'operator' ? t('zoneIgnored') : undefined}>
            <Select id="operator-zone" value={zone} onValueChange={setZone} items={zoneItems} ariaLabel={t('zone')} disabled={role !== 'operator' || zoneQuery.loading} />
          </Field>
          <div className="flex items-end mb-3.5">
            <Button type="submit" loading={creating} disabled={!canCreate || creating}>{t('create')}</Button>
          </div>
        </form>
      </Card>

      <Card className="p-0">
        {operatorQuery.loading && !operatorQuery.data && <div className="flex justify-center py-8"><Spinner size={24} /></div>}
        <Table>
          <THead><Tr><Th>{t('username')}</Th><Th>{t('displayName')}</Th><Th>{t('role')}</Th><Th>{t('zone')}</Th><Th>{t('status')}</Th><Th>{t('actions')}</Th></Tr></THead>
          <TBody>
            {!operatorQuery.loading && (operatorQuery.data?.length ?? 0) === 0
              ? <EmptyRow colSpan={6}>{t('empty')}</EmptyRow>
              : operatorQuery.data?.map((operator) => (
                <Tr key={operator.id}>
                  <Td>{operator.username}</Td>
                  <Td>{operator.displayName}</Td>
                  <Td>{t(`role${operator.role[0].toUpperCase()}${operator.role.slice(1)}`)}</Td>
                  <Td>
                    {operator.role === 'operator' ? (
                      <Select
                        value={operator.zone ?? UNASSIGNED}
                        onValueChange={(value) => void updateZone(operator, value)}
                        items={zoneItems}
                        ariaLabel={t('zoneFor', { name: operator.displayName })}
                        disabled={busyId === operator.id}
                      />
                    ) : '—'}
                  </Td>
                  <Td><StatusChip tone={operator.isActive ? 'success' : 'neutral'} label={operator.isActive ? t('active') : t('inactive')} dot /></Td>
                  <Td>
                    <Button variant="danger" size="sm" disabled={!operator.isActive || busyId === operator.id} onClick={() => void deactivate(operator)}>
                      {t('deactivate')}
                    </Button>
                  </Td>
                </Tr>
              ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
