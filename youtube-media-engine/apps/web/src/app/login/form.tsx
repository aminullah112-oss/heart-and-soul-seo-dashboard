'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { login } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-ink transition hover:bg-accent-dim disabled:opacity-50"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useFormState(login, null);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="email" className="mb-1 block text-xs text-paper-muted">Email</label>
        <input
          id="email" name="email" type="email" required autoComplete="username"
          className="w-full rounded border border-ink-line bg-ink px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs text-paper-muted">Password</label>
        <input
          id="password" name="password" type="password" required autoComplete="current-password"
          className="w-full rounded border border-ink-line bg-ink px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      {state?.error && (
        <p className="rounded border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{state.error}</p>
      )}
      <Submit />
    </form>
  );
}
