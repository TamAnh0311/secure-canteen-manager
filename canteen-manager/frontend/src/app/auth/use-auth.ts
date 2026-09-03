import { useAuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';
import type { Role } from '@/lib/types';

export interface UseAuthResult extends AuthContextValue {
  isAdmin: boolean;
  isCashier: boolean;
  hasRole: (...roles: Role[]) => boolean;
}

export function useAuth(): UseAuthResult {
  const ctx = useAuthContext();
  const role = ctx.operator?.role;
  return {
    ...ctx,
    isAdmin: role === 'admin',
    isCashier: role === 'cashier',
    hasRole: (...roles: Role[]) => roles.includes(role as Role),
  };
}
