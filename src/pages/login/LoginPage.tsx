import { AudioLines, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { LanguageButton, useI18n } from '../../shared/i18n';

type LoginPageProps = {
  initialError?: 'invalid-password' | 'connection' | null;
  onLogin: (password: string) => Promise<boolean>;
};

export function LoginPage({ initialError, onLogin }: LoginPageProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!await onLogin(password)) {
        setError('invalid-password');
        setPassword('');
      }
    } catch {
      setError('connection');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="login-page">
    <div className="login-language"><LanguageButton /></div>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-mark" aria-hidden="true"><AudioLines size={24} /></div>
      <span className="login-kicker"><LockKeyhole size={13} /> {t('auth.restricted')}</span>
      <h1 id="login-title">MuVisual</h1>
      <p>{t('auth.description')}</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="auth-password">{t('auth.password')}</label>
        <input
          id="auth-password"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
        />
        {error && <div className="login-error" role="alert">
          {t(error === 'invalid-password' ? 'auth.invalidPassword' : 'auth.connectionError')}
        </div>}
        <button type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
          <span>{submitting ? t('auth.signingIn') : t('auth.signIn')}</span>
        </button>
      </form>
    </section>
  </main>;
}
