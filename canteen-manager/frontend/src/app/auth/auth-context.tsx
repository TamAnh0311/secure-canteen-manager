import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { auth } from '@/lib/api';
import { clearToken, getToken, setToken } from '@/lib/token-storage';
import { UNAUTHORIZED_EVENT } from '@/lib/api-client';
import type { Operator } from '@/lib/types';

export type AuthStatus = 'loading' | 'authed' | 'anon';

export interface AuthContextValue {
  operator: Operator | null;
  status: AuthStatus;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const logout = useCallback(() => {
    clearToken();
    setOperator(null);
    setStatus('anon');
  }, []);

  // Bootstrap: verify existing token or immediately mark anon.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStatus('anon');
      return;
    }
    auth.me()
      .then((op) => {
        setOperator(op);
        setStatus('authed');
      })
      .catch(() => {
        // Token present but invalid — clear and surface as anon.
        clearToken();
        setStatus('anon');
      });
  }, []);

  // React to 401s emitted by apiFetch from anywhere in the app.
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [logout]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { token, operator: op } = await auth.login(username, password);
      setToken(token);
      setOperator(op);
      setStatus('authed');
    },
    [],
  );

  return (
    <AuthContext.Provider value={{ operator, status, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used inside <AuthProvider>');
  }
  return ctx;
}
