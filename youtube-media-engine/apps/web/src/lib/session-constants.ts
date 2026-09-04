/**
 * Constants shared between the edge middleware and the Node runtime.
 *
 * Kept in its own module with zero imports on purpose: middleware runs in the
 * edge runtime, and importing these from lib/auth.ts drags argon2, Prisma and
 * node:crypto into the edge bundle, which fails to build.
 */
export const SESSION_COOKIE = 'yme_session';
export const CSRF_COOKIE = 'yme_csrf';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
