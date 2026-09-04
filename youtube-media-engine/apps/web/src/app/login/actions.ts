'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createSession, destroySession, sessionCookieOptions, SESSION_COOKIE, verifyPassword } from '@/lib/auth';
import { prisma } from '@yme/database';

/**
 * Login.
 *
 * Rate limited per email and per IP in the database rather than in memory:
 * a memory limiter resets on deploy and does not cover multiple web replicas,
 * which is precisely when someone would be trying.
 */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

export async function login(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Email and password are required' };

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? 'unknown';

  const since = new Date(Date.now() - WINDOW_MS);
  const recentFailures = await prisma.auditLog.count({
    where: { action: 'auth.login_failed', createdAt: { gte: since }, OR: [{ entityId: email }, { ipAddress: ip }] },
  });

  if (recentFailures >= MAX_ATTEMPTS) {
    return { error: 'Too many failed attempts. Wait 15 minutes and try again.' };
  }

  const user = await verifyPassword(email, password);
  if (!user) {
    await prisma.auditLog.create({
      data: { action: 'auth.login_failed', entity: 'User', entityId: email, ipAddress: ip },
    });
    // Deliberately does not say which of the two was wrong.
    return { error: 'Invalid email or password' };
  }

  const token = await createSession(user.id, { userAgent: headerList.get('user-agent') ?? undefined, ip });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id, ipAddress: ip },
  });

  redirect('/');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
