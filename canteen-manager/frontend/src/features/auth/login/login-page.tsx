import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth/use-auth';
import { Button, Banner, Field, Input, LanguageToggle } from '@/ui';
import { ApiError } from '@/lib/api-client';

const OMR_GLYPH = (
  <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
    <rect x="1" y="1" width="20" height="20" rx="3" fill="none" stroke="#2563EB" strokeWidth="2" />
    <circle cx="6.5"  cy="6.5"  r="1.6" fill="#2563EB" />
    <circle cx="11"   cy="6.5"  r="1.6" fill="#CBD5E1" />
    <circle cx="15.5" cy="6.5"  r="1.6" fill="#2563EB" />
    <circle cx="6.5"  cy="11"   r="1.6" fill="#CBD5E1" />
    <circle cx="11"   cy="11"   r="1.6" fill="#2563EB" />
    <circle cx="15.5" cy="11"   r="1.6" fill="#CBD5E1" />
    <circle cx="6.5"  cy="15.5" r="1.6" fill="#2563EB" />
    <circle cx="11"   cy="15.5" r="1.6" fill="#CBD5E1" />
    <circle cx="15.5" cy="15.5" r="1.6" fill="#2563EB" />
  </svg>
);

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('auth');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already authenticated — skip the login screen.
  if (status === 'authed') {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // Never reveal which field failed — generic message only.
      if (err instanceof ApiError) {
        setError(t('errorInvalidCredentials'));
      } else {
        setError(t('errorUnableToSignIn'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="w-[380px] bg-card border border-border rounded-[10px] shadow p-7">
        <div className="flex justify-end mb-1">
          <LanguageToggle />
        </div>
        {/* Brand */}
        <div className="flex items-center justify-center gap-2.5 text-xl font-semibold mb-1">
          {OMR_GLYPH}
          <span>
            Canteen<span className="font-mono text-primary">OMR</span>
          </span>
        </div>
        <p className="text-xs text-muted-fg text-center mb-5">
          {t('backOfficeSignIn')}
        </p>

        <Banner tone="info" className="mb-4">
          <span aria-hidden="true">⛓</span>
          {t('airGappedNotice')}
        </Banner>

        {error && (
          <Banner tone="danger" role="alert" aria-live="assertive" className="mb-4">
            {error}
          </Banner>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Field label={t('username')} htmlFor="login-username" required>
            <Input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="font-mono"
              required
              disabled={submitting}
            />
          </Field>

          <Field label={t('password')} htmlFor="login-password" required>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={submitting}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full mt-1.5"
          >
            {t('signIn')}
          </Button>
        </form>
      </div>
    </div>
  );
}
