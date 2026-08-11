type SessionResponse = {
  authenticated: boolean;
};

export async function getSession() {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Unable to check authentication');
  return (await response.json() as SessionResponse).authenticated;
}

export async function login(password: string) {
  const response = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error('Unable to sign in');
  return (await response.json() as SessionResponse).authenticated;
}

export async function logout() {
  const response = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Unable to sign out');
}
