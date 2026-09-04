import Link from 'next/link';
import { logout } from '@/app/login/actions';
import type { SessionUser } from '@/lib/auth';

const LINKS = [
  ['/', 'Dashboard'],
  ['/topics', 'Topic radar'],
  ['/queue', 'Production'],
  ['/health', 'Health'],
  ['/settings', 'Settings'],
] as const;

export function Nav({ user }: { user: SessionUser }) {
  return (
    <header className="border-b border-ink-line bg-ink-raised">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3">
        <span className="text-sm font-semibold tracking-tight">
          Media Engine
          <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-widest text-paper-faint">
            AI × Business × Money
          </span>
        </span>
        <nav className="flex gap-1">
          {LINKS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded px-3 py-1.5 text-sm text-paper-muted transition hover:bg-ink hover:text-paper"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-paper-faint">
          <span>
            {user.email}
            <span className="ml-2 rounded bg-ink px-1.5 py-0.5 uppercase tracking-wider">{user.role}</span>
          </span>
          <form action={logout}>
            <button type="submit" className="rounded px-2 py-1 hover:bg-ink hover:text-paper">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
