import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { operators, users } from '@/lib/api';
import type { Operator } from '@/lib/types';
import { ToastProvider } from '@/ui';
import { OperatorsPage } from './operators-page';

vi.mock('@/lib/api', () => ({
  operators: {
    listOperators: vi.fn(),
    createOperator: vi.fn(),
    deactivateOperator: vi.fn(),
    updateOperatorZone: vi.fn(),
  },
  users: { listZones: vi.fn() },
}));

const OPERATOR: Operator = {
  id: '5a681ff0-a6cc-40b8-af79-2761aa3d721c',
  username: 'zone-a',
  displayName: 'Zone A Operator',
  role: 'operator',
  zone: 'A',
  isActive: true,
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
};

function renderPage() {
  return render(<ToastProvider><OperatorsPage /></ToastProvider>);
}

beforeEach(() => {
  vi.mocked(operators.listOperators).mockReset().mockResolvedValue([OPERATOR]);
  vi.mocked(users.listZones).mockReset().mockResolvedValue(['A', 'B']);
  vi.mocked(operators.deactivateOperator).mockReset().mockResolvedValue({ ...OPERATOR, isActive: false });
  vi.mocked(operators.createOperator).mockReset().mockResolvedValue(OPERATOR);
  vi.mocked(operators.updateOperatorZone).mockReset().mockResolvedValue(OPERATOR);
});

describe('OperatorsPage', () => {
  it('lists the safe operator projection without rendering a password', async () => {
    renderPage();
    expect(await screen.findByText('zone-a')).toBeInTheDocument();
    expect(screen.getByText('Zone A Operator')).toBeInTheDocument();
    expect(screen.queryByText(/passwordHash/i)).not.toBeInTheDocument();
  });

  it('deactivates an active operator and refreshes the list', async () => {
    renderPage();
    await screen.findByText('zone-a');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /vô hiệu hóa/i }));
    });
    expect(operators.deactivateOperator).toHaveBeenCalledWith(OPERATOR.id);
    expect(operators.listOperators).toHaveBeenCalledTimes(2);
  });

  it('requires a zone before creating an operator account', async () => {
    renderPage();
    await screen.findByText('zone-a');
    fireEvent.change(screen.getByLabelText(/tên đăng nhập/i), { target: { value: 'new-op' } });
    fireEvent.change(screen.getByLabelText(/tên hiển thị/i), { target: { value: 'New Operator' } });
    fireEvent.change(screen.getByLabelText(/^mật khẩu/i), { target: { value: 'password123' } });
    expect(screen.getByRole('button', { name: /tạo tài khoản/i })).toBeDisabled();
  });
});
