import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { LoginForm } from './form';
import { env } from '@yme/config';

export default async function LoginPage() {
  if (await getSessionUser()) redirect('/');

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-lg font-semibold">Media Engine</h1>
          <p className="mt-1 text-sm text-paper-faint">AI × Business × Money — production control</p>
        </div>
        <LoginForm />
        {env.MOCK_MODE && (
          <p className="mt-6 rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            MOCK_MODE is on. No external API is called and nothing can be published.
          </p>
        )}
      </div>
    </div>
  );
}
