import { useEffect, useState } from 'react';
import type { ImportedMidi } from '../features/midi-import';
import { getSession, login } from '../features/auth';
import { preloadPiano } from '../features/playback';
import { LibraryPage } from '../pages/library';
import { LoginPage } from '../pages/login';
import { StudioPage } from '../pages/studio';
import '../styles.css';

type AuthStatus = 'checking' | 'guest' | 'authenticated';
type LoginError = 'invalid-password' | 'connection' | null;
type AuthBootstrapResult = { authenticated: boolean; error: LoginError };

const returnToKey = 'muvisual-auth-return-to';
let authBootstrap: Promise<AuthBootstrapResult> | null = null;

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function safeReturnTo() {
  const saved = sessionStorage.getItem(returnToKey);
  sessionStorage.removeItem(returnToKey);
  if (!saved) return '/';
  try {
    const target = new URL(saved, window.location.origin);
    return target.origin === window.location.origin && target.pathname !== '/login'
      ? `${target.pathname}${target.search}${target.hash}`
      : '/';
  } catch {
    return '/';
  }
}

function showLogin() {
  if (window.location.pathname !== '/login') {
    sessionStorage.setItem(returnToKey, currentPath());
    window.history.replaceState(window.history.state, '', '/login');
  }
}

function showApp() {
  if (window.location.pathname === '/login') {
    window.history.replaceState(window.history.state, '', safeReturnTo());
  }
}

function bootstrapAuthentication() {
  if (authBootstrap) return authBootstrap;

  const url = new URL(window.location.href);
  const access = url.searchParams.get('access');
  if (access !== null) {
    url.searchParams.delete('access');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    authBootstrap = login(access)
      .then(authenticated => ({ authenticated, error: authenticated ? null : 'invalid-password' as const }))
      .catch(() => ({ authenticated: false, error: 'connection' as const }));
  } else {
    authBootstrap = getSession()
      .then(authenticated => ({ authenticated, error: null }))
      .catch(() => ({ authenticated: false, error: 'connection' as const }));
  }
  return authBootstrap;
}

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [loginError, setLoginError] = useState<LoginError>(null);
  const [activeMidi, setActiveMidi] = useState<ImportedMidi | null>(null);

  useEffect(() => {
    let active = true;
    void bootstrapAuthentication().then(result => {
      if (!active) return;
      setLoginError(result.error);
      if (result.authenticated) {
        showApp();
        setAuthStatus('authenticated');
        void preloadPiano();
      } else {
        showLogin();
        setAuthStatus('guest');
      }
    });
    return () => { active = false; };
  }, []);

  const handleLogin = async (password: string) => {
    const authenticated = await login(password);
    if (authenticated) {
      showApp();
      setLoginError(null);
      setAuthStatus('authenticated');
      void preloadPiano();
    }
    return authenticated;
  };

  if (authStatus === 'checking') {
    return <main className="auth-loading" aria-label="Checking authentication">
      <span className="auth-loading-mark" aria-hidden="true">M</span>
    </main>;
  }

  if (authStatus === 'guest') {
    return <LoginPage initialError={loginError} onLogin={handleLogin} />;
  }

  return activeMidi
    ? <StudioPage initialMidi={activeMidi} onBack={() => setActiveMidi(null)} />
    : <LibraryPage onOpenMidi={setActiveMidi} onHome={() => setActiveMidi(null)} />;
}
