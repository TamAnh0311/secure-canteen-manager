/**
 * Role-gating tests for RoleRoute and counter nav item visibility.
 *
 * Key invariants:
 * - cashier role → RoleRoute(['cashier','admin']) renders children.
 * - plain operator role → RoleRoute redirects to /dashboard.
 * - admin role → RoleRoute(['cashier','admin']) renders children.
 * - counter nav item visible to cashier and admin; hidden from plain operator.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { RoleRoute } from '@/app/protected-route';
import type { Role } from '@/lib/types';

// Minimal mock of useAuth — returns a controlled role without touching the real
// AuthContext so these tests are pure unit tests with no network/provider setup.
function mockUseAuth(role: Role | null) {
  vi.doMock('@/app/auth/use-auth', () => ({
    useAuth: () => ({
      operator: role ? { id: 'op1', role, username: 'u', displayName: 'U', isActive: true, createdAt: '', updatedAt: '' } : null,
      status: role ? 'authed' : 'anon',
      isAdmin: role === 'admin',
      isCashier: role === 'cashier',
      hasRole: (...roles: Role[]) => role !== null && roles.includes(role),
      login: vi.fn(),
      logout: vi.fn(),
    }),
  }));
}

function renderWithRole(role: Role | null) {
  // Inline the RoleRoute logic by importing useAuth directly within the test
  // render — we stub useAuth via vi.doMock above before calling this.
  // Use a real MemoryRouter so Navigate works.
  return render(
    <MemoryRouter initialEntries={['/counter']}>
      <Routes>
        <Route path="/dashboard" element={<div>dashboard</div>} />
        <Route path="/counter" element={<RoleRoute roles={['cashier', 'admin']} />}>
          <Route index element={<div>counter-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// NOTE: vi.doMock is module-level; we use a direct useAuth mock approach by
// mocking the module before each describe block. Because vitest resets modules
// between files (not between its/describes), we isolate via vi.mock at the top.

vi.mock('@/app/auth/use-auth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/app/auth/use-auth';
const mockUseAuthFn = useAuth as ReturnType<typeof vi.fn>;

function setRole(role: Role | null) {
  mockUseAuthFn.mockReturnValue({
    operator: role ? { id: 'op1', role, username: 'u', displayName: 'U', isActive: true, createdAt: '', updatedAt: '' } : null,
    status: role ? 'authed' : 'loading',
    isAdmin: role === 'admin',
    isCashier: role === 'cashier',
    hasRole: (...roles: Role[]) => role !== null && (roles as Role[]).includes(role),
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe('RoleRoute — cashier allowed', () => {
  it('renders children when role is cashier', () => {
    setRole('cashier');
    renderWithRole('cashier');
    expect(screen.getByText('counter-content')).toBeInTheDocument();
  });
});

describe('RoleRoute — admin allowed', () => {
  it('renders children when role is admin', () => {
    setRole('admin');
    renderWithRole('admin');
    expect(screen.getByText('counter-content')).toBeInTheDocument();
  });
});

describe('RoleRoute — plain operator blocked', () => {
  it('redirects to /dashboard when role is operator', () => {
    setRole('operator');
    renderWithRole('operator');
    // Counter content must not render; dashboard placeholder must appear.
    expect(screen.queryByText('counter-content')).not.toBeInTheDocument();
    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });
});

// Nav item visibility
import { NAV_GROUPS } from '@/app/shell/nav-items';

describe('Counter nav item — role visibility metadata', () => {
  const counterItem = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'counter');

  it('counter nav item exists in NAV_GROUPS', () => {
    expect(counterItem).toBeDefined();
  });

  it('counter nav item roles include cashier and admin', () => {
    expect(counterItem?.roles).toContain('cashier');
    expect(counterItem?.roles).toContain('admin');
  });

  it('counter nav item does NOT include operator role', () => {
    expect(counterItem?.roles).not.toContain('operator');
  });
});
