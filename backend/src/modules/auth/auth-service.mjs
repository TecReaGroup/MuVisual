import { createHmac, timingSafeEqual } from 'node:crypto';
import { auth } from '../../config/constants.mjs';
import { environment } from '../../config/environment.mjs';

const authCookieName = environment.isProduction ? '__Host-muvisual_auth' : 'muvisual_auth';

export function secureEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

export function createSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + auth.sessionMaxAge;
  const signature = createHmac('sha256', environment.authPassword).update(String(expiresAt)).digest('base64url');
  return `${expiresAt}.${signature}`;
}

export function hasValidSession(request) {
  const cookies = Object.fromEntries((request.headers.cookie ?? '').split(';').flatMap(part => {
    const separator = part.indexOf('=');
    if (separator === -1) return [];
    return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
  }));
  const session = cookies[authCookieName];
  if (!session) return false;

  const separator = session.indexOf('.');
  if (separator === -1) return false;
  const expiresAt = session.slice(0, separator);
  const signature = session.slice(separator + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  const expected = createHmac('sha256', environment.authPassword).update(expiresAt).digest('base64url');
  return secureEqual(signature, expected);
}

export function sessionCookie(value, maxAge = auth.sessionMaxAge) {
  const attributes = [
    `${authCookieName}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (environment.isProduction) attributes.push('Secure');
  return attributes.join('; ');
}
