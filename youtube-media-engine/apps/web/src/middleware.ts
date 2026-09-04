import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-constants';

/**
 * Edge-level gate.
 *
 * Only checks that a session cookie EXISTS — validating it needs the database,
 * which the edge runtime cannot reach. Real authorisation happens in each page
 * and server action via getSessionUser(); this just avoids rendering the shell
 * for obviously-anonymous requests.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  if (!req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Basic hardening headers. A CSP is deliberately not set here — Next's
  // inline bootstrap needs a nonce, and a broken CSP that everyone disables is
  // worse than none. See docs/SECURITY.md.
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
