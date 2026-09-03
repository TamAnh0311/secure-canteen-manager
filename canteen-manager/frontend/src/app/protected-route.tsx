import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/app/auth/use-auth';
import { Spinner } from '@/ui';
import type { Role } from '@/lib/types';

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (status === 'anon') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export function AdminRoute() {
  const { isAdmin, status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

export interface RoleRouteProps {
  roles: Role[];
}

// Renders children when the logged-in operator holds at least one of the
// listed roles. Redirects to /dashboard otherwise (same pattern as AdminRoute).
export function RoleRoute({ roles }: RoleRouteProps) {
  const { hasRole, status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (!hasRole(...roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
