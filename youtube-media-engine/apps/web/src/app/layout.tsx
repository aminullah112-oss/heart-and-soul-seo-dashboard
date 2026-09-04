import type { Metadata } from 'next';
import './globals.css';
import { getSessionUser } from '@/lib/auth';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Media Engine',
  description: 'AI × Business × Money — production control',
};

// Every page reads live production state; caching it would show stale queues.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body className="min-h-screen">
        {user ? <Nav user={user} /> : null}
        <main className={user ? 'mx-auto max-w-[1400px] px-6 py-8' : ''}>{children}</main>
      </body>
    </html>
  );
}
