import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { prisma, type User, type UserRole } from '@yme/database';
import { env } from '@yme/config';

/**
 * Session auth (spec §42).
 *
 * Opaque random tokens in an httpOnly cookie, stored as a SHA-256 hash. Not
 * JWTs: sessions here need to be revocable the moment an operator leaves, and
 * a stateless token cannot be revoked without building the very session table
 * a JWT was supposed to avoid.
 *
 * The token is hashed at rest so a database leak does not hand over live
 * sessions. SHA-256 rather than argon2 for the token specifically — it is 256
 * bits of entropy from a CSPRNG, so it is not brute-forcible and does not need
 * a slow KDF. Passwords do, and use argon2id.
 */

export const SESSION_COOKIE = 'yme_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

  if (!user || !user.isActive) {
    // Hash anyway so a missing account and a wrong password take the same
    // time; otherwise response timing enumerates valid emails.
    await argon2.hash(password).catch(() => undefined);
    return null;
  }

  try {
    const ok = await argon2.verify(user.passwordHash, password);
    return ok ? user : null;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipAddress: meta.ip ?? null,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('Not signed in');
  return user;
}

/** Write actions require an editor or owner; viewers are read-only. */
export async function requireEditor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === 'VIEWER') throw new AuthError('This account is read-only');
  return user;
}

export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'OWNER') throw new AuthError('Owner role required');
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * CSRF: double-submit token compared in constant time.
 *
 * Next server actions carry their own origin checks, but the login POST and
 * the media route are plain handlers, and defence in depth costs one cookie.
 */
export const CSRF_COOKIE = 'yme_csrf';

export async function issueCsrfToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE)?.value;
  if (existing) return existing;
  const token = randomBytes(24).toString('base64url');
  store.set(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/',
  });
  return token;
}

export async function verifyCsrfToken(submitted: string | null): Promise<boolean> {
  if (!submitted) return false;
  const store = await cookies();
  const expected = store.get(CSRF_COOKIE)?.value;
  if (!expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

/** Removes expired rows. Called opportunistically from the health page. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
